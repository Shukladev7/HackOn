"""
Tests for the POST /ml/v1/classify endpoint.

Tests cover:
- Valid request/response flow
- Request validation (Pydantic models)
- Circuit breaker integration (503 when open)
- Error handling
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.circuit_breaker import CircuitBreaker, CircuitBreakerError, CircuitState
from src.app import create_app
from src.ml.root_cause_classifier import ClassificationResult, RootCauseCategory


@pytest.fixture
def app():
    """Create a fresh FastAPI app for testing."""
    return create_app()


@pytest.fixture
async def client(app):
    """Async HTTP client for testing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def reset_circuit_breaker():
    """Reset the circuit breaker before each test."""
    from src.api.routes import openai_circuit_breaker
    openai_circuit_breaker.reset()
    yield
    openai_circuit_breaker.reset()


def make_classify_request(rto_event_id: str = "rto_evt_123") -> dict:
    """Helper to create a valid classify request payload."""
    return {
        "rto_event_id": rto_event_id,
        "delivery_attempt": {
            "attempt_number": 2,
            "timestamp": "2024-01-15T10:30:00Z",
            "gps_location": {"lat": 28.6139, "lng": 77.2090},
            "status_code": "FAILED",
            "failure_reason": "customer_unavailable",
        },
        "gps_data": {"traces": [{"lat": 28.6139, "lng": 77.2090, "ts": "2024-01-15T10:29:00Z"}]},
        "call_logs": [{"timestamp": "2024-01-15T10:25:00Z", "duration": 15, "answered": False}],
        "delivery_scans": [{"scan_type": "out_for_delivery", "timestamp": "2024-01-15T08:00:00Z"}],
        "order_history": {"prior_orders": 5, "return_rate": 0.1, "avg_order_value": 1200.0},
        "support_tickets": [],
        "address_validation": {"valid": True, "confidence": 0.95},
        "hub_events": [{"event_type": "scan_in", "timestamp": "2024-01-15T07:00:00Z"}],
        "completeness": {
            "collected": ["gps", "call_logs", "delivery_scans", "order_history", "address_validation", "hub_events"],
            "unavailable": ["support_tickets"],
            "timeout_timestamps": {"support_tickets": "2024-01-15T10:30:05Z"},
        },
    }


def make_classification_result(**overrides) -> ClassificationResult:
    """Helper to create a ClassificationResult with sensible defaults."""
    defaults = {
        "customer_score": 0.8,
        "courier_score": 0.2,
        "system_score": 0.1,
        "primary_category": RootCauseCategory.CUSTOMER_ISSUE,
        "sub_cause": "customer_unavailable",
        "sub_cause_confidence": 0.75,
        "confidence_threshold": 0.6,
        "requires_manual_review": False,
        "classification_timestamp": "2024-01-15T10:30:08+00:00",
    }
    defaults.update(overrides)
    return ClassificationResult(**defaults)


class TestClassifyEndpointSuccess:
    """Test successful classification requests."""

    @patch("src.api.routes.get_classifier")
    async def test_classify_returns_200_with_valid_result(self, mock_get_classifier, client):
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=make_classification_result())
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())

        assert response.status_code == 200
        data = response.json()
        assert data["customer_score"] == 0.8
        assert data["courier_score"] == 0.2
        assert data["system_score"] == 0.1
        assert data["primary_category"] == "customer_issue"
        assert data["sub_cause"] == "customer_unavailable"
        assert data["sub_cause_confidence"] == 0.75
        assert data["confidence_threshold"] == 0.6
        assert data["requires_manual_review"] is False
        assert "classification_timestamp" in data

    @patch("src.api.routes.get_classifier")
    async def test_classify_with_manual_review(self, mock_get_classifier, client):
        result = make_classification_result(
            customer_score=0.4,
            courier_score=0.3,
            system_score=0.2,
            primary_category=None,
            sub_cause=None,
            sub_cause_confidence=0.0,
            requires_manual_review=True,
        )
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=result)
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())

        assert response.status_code == 200
        data = response.json()
        assert data["primary_category"] is None
        assert data["requires_manual_review"] is True

    @patch("src.api.routes.get_classifier")
    async def test_classify_with_courier_issue(self, mock_get_classifier, client):
        result = make_classification_result(
            customer_score=0.1,
            courier_score=0.9,
            system_score=0.2,
            primary_category=RootCauseCategory.COURIER_ISSUE,
            sub_cause="fake_delivery_attempt",
            sub_cause_confidence=0.85,
        )
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=result)
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())

        assert response.status_code == 200
        data = response.json()
        assert data["primary_category"] == "courier_issue"
        assert data["courier_score"] == 0.9
        assert data["sub_cause"] == "fake_delivery_attempt"

    @patch("src.api.routes.get_classifier")
    async def test_classify_minimal_payload(self, mock_get_classifier, client):
        """Test with minimal required fields only."""
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=make_classification_result())
        mock_get_classifier.return_value = mock_classifier

        # Only rto_event_id is required
        response = await client.post(
            "/ml/v1/classify",
            json={"rto_event_id": "rto_123"},
        )

        assert response.status_code == 200


class TestClassifyEndpointValidation:
    """Test request validation with Pydantic models."""

    async def test_missing_rto_event_id_returns_422(self, client):
        payload = make_classify_request()
        del payload["rto_event_id"]
        response = await client.post("/ml/v1/classify", json=payload)
        assert response.status_code == 422

    async def test_empty_rto_event_id_returns_422(self, client):
        payload = make_classify_request()
        payload["rto_event_id"] = ""
        response = await client.post("/ml/v1/classify", json=payload)
        assert response.status_code == 422

    async def test_invalid_json_returns_422(self, client):
        response = await client.post(
            "/ml/v1/classify",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


class TestClassifyEndpointCircuitBreaker:
    """Test circuit breaker integration."""

    @patch("src.api.routes.get_classifier")
    async def test_returns_503_when_circuit_breaker_open(self, mock_get_classifier, client):
        """When the circuit breaker is open, the endpoint should return 503."""
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(side_effect=RuntimeError("OpenAI API error"))
        mock_get_classifier.return_value = mock_classifier

        # Trip the circuit breaker (5 failures)
        for _ in range(5):
            response = await client.post("/ml/v1/classify", json=make_classify_request())
            # These should be 500 (error passes through before breaker trips)

        # Now the circuit breaker is open - next call should get 503
        response = await client.post("/ml/v1/classify", json=make_classify_request())
        assert response.status_code == 503
        data = response.json()
        assert data["detail"]["error"] == "service_unavailable"
        assert data["detail"]["circuit_breaker_state"] == "open"

    @patch("src.api.routes.get_classifier")
    async def test_returns_500_on_classification_failure(self, mock_get_classifier, client):
        """Classification errors before circuit trips return 500."""
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(side_effect=RuntimeError("OpenAI timeout"))
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())
        assert response.status_code == 500
        data = response.json()
        assert data["detail"]["error"] == "classification_failed"

    @patch("src.api.routes.get_classifier")
    async def test_circuit_breaker_state_in_health_check(self, mock_get_classifier, client):
        """Health endpoint should report circuit breaker state."""
        response = await client.get("/ml/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["circuit_breaker"]["openai"]["state"] == "closed"
        assert data["circuit_breaker"]["openai"]["consecutive_failures"] == 0


class TestClassifyEndpointResponseSchema:
    """Test that the response matches the ClassifyResponse schema."""

    @patch("src.api.routes.get_classifier")
    async def test_response_has_all_required_fields(self, mock_get_classifier, client):
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=make_classification_result())
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())
        data = response.json()

        required_fields = [
            "customer_score",
            "courier_score",
            "system_score",
            "primary_category",
            "sub_cause",
            "sub_cause_confidence",
            "confidence_threshold",
            "requires_manual_review",
            "classification_timestamp",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    @patch("src.api.routes.get_classifier")
    async def test_scores_are_floats_in_valid_range(self, mock_get_classifier, client):
        mock_classifier = AsyncMock()
        mock_classifier.classify = AsyncMock(return_value=make_classification_result())
        mock_get_classifier.return_value = mock_classifier

        response = await client.post("/ml/v1/classify", json=make_classify_request())
        data = response.json()

        for score_field in ["customer_score", "courier_score", "system_score"]:
            assert isinstance(data[score_field], float)
            assert 0.0 <= data[score_field] <= 1.0
