"""
Tests for the POST /ml/v1/predict-recovery endpoint.

Covers:
- Successful prediction with full data
- Prediction with missing fields (imputation)
- Prediction with empty body
- Response schema validation
- Input validation (Pydantic)
- Same prediction for courier/system issues (Req 4.2)
- Performance constraint (Req 4.1: < 5 seconds)
"""

import time

import pytest
from httpx import AsyncClient, ASGITransport

from src.app import create_app


@pytest.fixture
def app():
    """Create a fresh FastAPI application."""
    return create_app()


@pytest.fixture
async def client(app):
    """Async test client for the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestPredictRecoveryEndpoint:
    """Tests for POST /ml/v1/predict-recovery."""

    @pytest.mark.asyncio
    async def test_successful_prediction_with_full_data(self, client):
        """Full request body returns a valid prediction response."""
        payload = {
            "classification": {
                "primary_category": "customer_issue",
                "customer_score": 0.8,
                "courier_score": 0.1,
                "system_score": 0.1,
            },
            "customer_data": {
                "prior_orders": 10,
                "return_rate": 0.05,
                "avg_order_value": 1200.0,
                "responded_to_notifications": True,
                "initiated_support": True,
                "updated_preferences": False,
            },
            "order_data": {
                "hours_since_order": 12.0,
                "product_category": "electronics",
                "price_tier": "high",
            },
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert 0.0 <= data["recovery_probability"] <= 1.0
        assert data["partially_imputed"] is False
        assert data["model_version"] == "1.0.0"
        assert "predicted_at" in data
        assert data["features_used"]["prior_orders"] == 10
        assert data["features_used"]["return_rate"] == 0.05
        assert data["features_used"]["imputed_features"] == []

    @pytest.mark.asyncio
    async def test_prediction_with_missing_customer_fields(self, client):
        """Missing customer fields are imputed with population medians."""
        payload = {
            "classification": {"primary_category": "customer_issue"},
            "customer_data": {},
            "order_data": {
                "hours_since_order": 24.0,
                "product_category": "clothing",
                "price_tier": "medium",
            },
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["partially_imputed"] is True
        assert "prior_orders" in data["features_used"]["imputed_features"]
        assert "return_rate" in data["features_used"]["imputed_features"]
        assert "avg_order_value" in data["features_used"]["imputed_features"]
        # Medians applied
        assert data["features_used"]["prior_orders"] == 3
        assert data["features_used"]["return_rate"] == 0.12
        assert data["features_used"]["avg_order_value"] == 850.0

    @pytest.mark.asyncio
    async def test_prediction_with_missing_order_fields(self, client):
        """Missing order fields are imputed."""
        payload = {
            "classification": {},
            "customer_data": {
                "prior_orders": 5,
                "return_rate": 0.1,
                "avg_order_value": 900.0,
            },
            "order_data": {},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["partially_imputed"] is True
        assert "hours_since_order" in data["features_used"]["imputed_features"]
        assert data["features_used"]["hours_since_order"] == 48.0

    @pytest.mark.asyncio
    async def test_prediction_with_empty_body(self, client):
        """Empty body (all defaults) still returns a valid prediction."""
        payload = {}

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert 0.0 <= data["recovery_probability"] <= 1.0
        assert data["partially_imputed"] is True
        assert data["model_version"] == "1.0.0"

    @pytest.mark.asyncio
    async def test_response_contains_all_required_fields(self, client):
        """Response has recovery_probability, features_used, partially_imputed, model_version, predicted_at."""
        payload = {
            "classification": {},
            "customer_data": {"prior_orders": 5},
            "order_data": {"hours_since_order": 10.0},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert "recovery_probability" in data
        assert "features_used" in data
        assert "partially_imputed" in data
        assert "model_version" in data
        assert "predicted_at" in data

    @pytest.mark.asyncio
    async def test_features_used_contains_all_fields(self, client):
        """features_used has all expected feature fields."""
        payload = {
            "classification": {},
            "customer_data": {"prior_orders": 7},
            "order_data": {"product_category": "books"},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        features = response.json()["features_used"]
        expected_keys = {
            "prior_orders",
            "return_rate",
            "avg_order_value",
            "hours_since_order",
            "product_category",
            "price_tier",
            "responded_to_notifications",
            "initiated_support",
            "updated_preferences",
            "imputed_features",
        }
        assert set(features.keys()) == expected_keys

    @pytest.mark.asyncio
    async def test_same_prediction_for_courier_and_system_issues(self, client):
        """Req 4.2: Same prediction regardless of classification category."""
        customer_data = {
            "prior_orders": 8,
            "return_rate": 0.1,
            "avg_order_value": 1000.0,
            "responded_to_notifications": True,
            "initiated_support": False,
            "updated_preferences": False,
        }
        order_data = {
            "hours_since_order": 20.0,
            "product_category": "electronics",
            "price_tier": "high",
        }

        courier_payload = {
            "classification": {
                "primary_category": "courier_issue",
                "courier_score": 0.9,
                "customer_score": 0.1,
                "system_score": 0.1,
            },
            "customer_data": customer_data,
            "order_data": order_data,
        }
        system_payload = {
            "classification": {
                "primary_category": "system_issue",
                "system_score": 0.85,
                "customer_score": 0.1,
                "courier_score": 0.1,
            },
            "customer_data": customer_data,
            "order_data": order_data,
        }

        resp_courier = await client.post("/ml/v1/predict-recovery", json=courier_payload)
        resp_system = await client.post("/ml/v1/predict-recovery", json=system_payload)

        assert resp_courier.status_code == 200
        assert resp_system.status_code == 200
        assert (
            resp_courier.json()["recovery_probability"]
            == resp_system.json()["recovery_probability"]
        )

    @pytest.mark.asyncio
    async def test_prediction_completes_within_5_seconds(self, client):
        """Req 4.1: Endpoint must respond within 5 seconds."""
        payload = {
            "classification": {"primary_category": "customer_issue"},
            "customer_data": {"prior_orders": 5},
            "order_data": {"hours_since_order": 10.0, "product_category": "home"},
        }

        start = time.monotonic()
        response = await client.post("/ml/v1/predict-recovery", json=payload)
        elapsed = time.monotonic() - start

        assert response.status_code == 200
        assert elapsed < 5.0

    @pytest.mark.asyncio
    async def test_invalid_score_range_rejected(self, client):
        """Scores outside [0, 1] should be rejected by validation."""
        payload = {
            "classification": {
                "customer_score": 1.5,  # Invalid: > 1.0
            },
            "customer_data": {},
            "order_data": {},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_invalid_return_rate_rejected(self, client):
        """return_rate outside [0, 1] should be rejected."""
        payload = {
            "classification": {},
            "customer_data": {"return_rate": -0.1},
            "order_data": {},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_negative_prior_orders_rejected(self, client):
        """Negative prior_orders should be rejected."""
        payload = {
            "classification": {},
            "customer_data": {"prior_orders": -1},
            "order_data": {},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_product_category_handled_gracefully(self, client):
        """Invalid product category defaults to 'other' (handled by predictor)."""
        payload = {
            "classification": {},
            "customer_data": {"prior_orders": 5},
            "order_data": {
                "hours_since_order": 10.0,
                "product_category": "nonexistent_category",
                "price_tier": "medium",
            },
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["features_used"]["product_category"] == "other"

    @pytest.mark.asyncio
    async def test_probability_is_float(self, client):
        """recovery_probability is a float, not an integer."""
        payload = {
            "classification": {},
            "customer_data": {"prior_orders": 10, "return_rate": 0.05},
            "order_data": {"hours_since_order": 5.0},
        }

        response = await client.post("/ml/v1/predict-recovery", json=payload)

        assert response.status_code == 200
        prob = response.json()["recovery_probability"]
        assert isinstance(prob, float)
