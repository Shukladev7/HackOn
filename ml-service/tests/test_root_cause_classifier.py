"""
Unit tests for the Root Cause Classifier.

Tests cover:
- _determine_primary_category logic (threshold, tie-breaking, manual review)
- _build_classification_prompt structure
- _clamp_score edge cases
- classify() integration with mocked OpenAI client
- Timeout handling
- Error handling

Requirements: 3.1, 3.2, 3.3
"""

import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.ml.root_cause_classifier import (
    ClassificationResult,
    CourierSubCause,
    CustomerSubCause,
    RootCauseCategory,
    RootCauseClassifier,
    SystemSubCause,
)


# --- Fixtures ---


@pytest.fixture
def classifier():
    """Classifier with default threshold (0.6)."""
    return RootCauseClassifier(confidence_threshold=0.6, sub_cause_threshold=0.5)


@pytest.fixture
def classifier_low_threshold():
    """Classifier with low threshold (0.3)."""
    return RootCauseClassifier(confidence_threshold=0.3, sub_cause_threshold=0.5)


@pytest.fixture
def sample_evidence():
    """Sample normalized evidence payload."""
    return {
        "delivery_attempt": {
            "attemptNumber": 2,
            "timestamp": "2024-01-15T10:30:00Z",
            "gpsLocation": {"lat": 28.6139, "lng": 77.209},
            "statusCode": "FAILED",
            "failureReason": "customer_not_available",
        },
        "gps_data": {
            "courier_reached_address": False,
            "time_at_location_seconds": 30,
            "distance_from_address_meters": 500,
        },
        "call_logs": [
            {"timestamp": "2024-01-15T10:25:00Z", "duration_seconds": 0, "status": "not_answered"}
        ],
        "delivery_scans": [
            {"timestamp": "2024-01-15T10:28:00Z", "type": "attempt", "hub_id": "HUB001"}
        ],
        "order_history": {"prior_orders": 5, "return_rate": 0.1, "avg_order_value": 1200.0},
        "support_tickets": [],
        "address_validation": {"valid": True, "confidence": 0.95},
        "hub_events": [{"type": "package_received", "timestamp": "2024-01-15T08:00:00Z"}],
        "completeness": {
            "collected": ["gps", "call_logs", "delivery_scans", "order_history", "hub_events"],
            "unavailable": ["support_tickets", "address_validation"],
        },
    }


def _make_openai_response(scores: dict) -> MagicMock:
    """Helper to create a mock OpenAI API response."""
    content = json.dumps(scores)
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


# --- Tests for _determine_primary_category ---


class TestDeterminePrimaryCategory:
    """Tests for the _determine_primary_category method."""

    def test_no_score_above_threshold_returns_none(self, classifier):
        """Req 3.3: If no score exceeds threshold, route to manual review."""
        scores = {"customer_score": 0.3, "courier_score": 0.4, "system_score": 0.5}
        assert classifier._determine_primary_category(scores) is None

    def test_single_score_above_threshold(self, classifier):
        """Req 3.2: Assign primary category based on highest score above threshold."""
        scores = {"customer_score": 0.8, "courier_score": 0.3, "system_score": 0.2}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.CUSTOMER_ISSUE

    def test_courier_wins_with_highest_score(self, classifier):
        """Req 3.2: Highest score above threshold wins."""
        scores = {"customer_score": 0.7, "courier_score": 0.9, "system_score": 0.4}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.COURIER_ISSUE

    def test_system_wins_with_highest_score(self, classifier):
        """Req 3.2: System wins when it has the highest score."""
        scores = {"customer_score": 0.65, "courier_score": 0.5, "system_score": 0.85}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.SYSTEM_ISSUE

    def test_tie_breaking_courier_over_system(self, classifier):
        """Req 3.2: Courier > System in tie-breaking."""
        scores = {"customer_score": 0.3, "courier_score": 0.8, "system_score": 0.8}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.COURIER_ISSUE

    def test_tie_breaking_courier_over_customer(self, classifier):
        """Req 3.2: Courier > Customer in tie-breaking."""
        scores = {"customer_score": 0.8, "courier_score": 0.8, "system_score": 0.3}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.COURIER_ISSUE

    def test_tie_breaking_system_over_customer(self, classifier):
        """Req 3.2: System > Customer in tie-breaking."""
        scores = {"customer_score": 0.8, "courier_score": 0.3, "system_score": 0.8}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.SYSTEM_ISSUE

    def test_all_three_tied_above_threshold(self, classifier):
        """Req 3.2: All tied → Courier wins (highest priority)."""
        scores = {"customer_score": 0.8, "courier_score": 0.8, "system_score": 0.8}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.COURIER_ISSUE

    def test_threshold_boundary_exactly_at_threshold_excluded(self, classifier):
        """Req 3.2: Score exactly at threshold does NOT qualify (must exceed)."""
        scores = {"customer_score": 0.6, "courier_score": 0.6, "system_score": 0.6}
        # Scores at exactly threshold are not above threshold
        assert classifier._determine_primary_category(scores) is None

    def test_threshold_boundary_just_above(self, classifier):
        """Req 3.2: Score just above threshold qualifies."""
        scores = {"customer_score": 0.61, "courier_score": 0.3, "system_score": 0.3}
        assert classifier._determine_primary_category(scores) == RootCauseCategory.CUSTOMER_ISSUE

    def test_custom_threshold(self, classifier_low_threshold):
        """Configurable threshold affects category assignment."""
        scores = {"customer_score": 0.35, "courier_score": 0.2, "system_score": 0.1}
        assert (
            classifier_low_threshold._determine_primary_category(scores)
            == RootCauseCategory.CUSTOMER_ISSUE
        )

    def test_all_zero_scores(self, classifier):
        """All zero scores → manual review."""
        scores = {"customer_score": 0.0, "courier_score": 0.0, "system_score": 0.0}
        assert classifier._determine_primary_category(scores) is None


# --- Tests for _clamp_score ---


class TestClampScore:
    """Tests for the _clamp_score static method."""

    def test_normal_value(self):
        assert RootCauseClassifier._clamp_score(0.5) == 0.5

    def test_zero(self):
        assert RootCauseClassifier._clamp_score(0.0) == 0.0

    def test_one(self):
        assert RootCauseClassifier._clamp_score(1.0) == 1.0

    def test_negative_clamped_to_zero(self):
        assert RootCauseClassifier._clamp_score(-0.5) == 0.0

    def test_above_one_clamped(self):
        assert RootCauseClassifier._clamp_score(1.5) == 1.0

    def test_none_returns_zero(self):
        assert RootCauseClassifier._clamp_score(None) == 0.0

    def test_string_returns_zero(self):
        assert RootCauseClassifier._clamp_score("invalid") == 0.0

    def test_numeric_string(self):
        assert RootCauseClassifier._clamp_score("0.7") == 0.7


# --- Tests for _build_classification_prompt ---


class TestBuildClassificationPrompt:
    """Tests for prompt construction."""

    def test_prompt_contains_evidence_sections(self, classifier, sample_evidence):
        """Prompt includes all evidence sections."""
        prompt = classifier._build_classification_prompt(sample_evidence)
        assert "Delivery Attempt" in prompt
        assert "GPS Data" in prompt
        assert "Call Logs" in prompt
        assert "Delivery Scans" in prompt
        assert "Order History" in prompt
        assert "Support Tickets" in prompt
        assert "Address Validation" in prompt
        assert "Hub Events" in prompt
        assert "Evidence Completeness" in prompt

    def test_prompt_contains_classification_instructions(self, classifier, sample_evidence):
        """Prompt includes classification instructions."""
        prompt = classifier._build_classification_prompt(sample_evidence)
        assert "customer_score" in prompt
        assert "courier_score" in prompt
        assert "system_score" in prompt
        assert "sub_cause" in prompt

    def test_prompt_contains_valid_sub_causes(self, classifier, sample_evidence):
        """Prompt lists all valid sub-causes."""
        prompt = classifier._build_classification_prompt(sample_evidence)
        assert "fake_delivery_attempt" in prompt
        assert "customer_unavailable" in prompt
        assert "address_mapping_error" in prompt

    def test_prompt_with_empty_evidence(self, classifier):
        """Handles empty evidence gracefully."""
        prompt = classifier._build_classification_prompt({})
        assert "Delivery Attempt" in prompt
        assert "Response Format" in prompt

    def test_prompt_is_string(self, classifier, sample_evidence):
        """Prompt is always a string."""
        prompt = classifier._build_classification_prompt(sample_evidence)
        assert isinstance(prompt, str)
        assert len(prompt) > 0


# --- Tests for classify() method ---


class TestClassify:
    """Tests for the full classify() method with mocked OpenAI client."""

    @pytest.mark.asyncio
    async def test_successful_classification_courier_issue(self, sample_evidence):
        """classify() returns correct result for courier issue."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.2,
                    "courier_score": 0.85,
                    "system_score": 0.1,
                    "sub_cause": "fake_delivery_attempt",
                    "sub_cause_confidence": 0.8,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert result.customer_score == 0.2
        assert result.courier_score == 0.85
        assert result.system_score == 0.1
        assert result.primary_category == RootCauseCategory.COURIER_ISSUE
        assert result.sub_cause == "fake_delivery_attempt"
        assert result.sub_cause_confidence == 0.8
        assert result.requires_manual_review is False
        assert result.confidence_threshold == 0.6

    @pytest.mark.asyncio
    async def test_classification_triggers_manual_review(self, sample_evidence):
        """classify() triggers manual review when no score exceeds threshold."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.4,
                    "courier_score": 0.5,
                    "system_score": 0.3,
                    "sub_cause": None,
                    "sub_cause_confidence": 0.2,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert result.primary_category is None
        assert result.requires_manual_review is True

    @pytest.mark.asyncio
    async def test_classification_clamps_out_of_range_scores(self, sample_evidence):
        """classify() clamps scores that exceed [0.0, 1.0]."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 1.5,
                    "courier_score": -0.3,
                    "system_score": 0.7,
                    "sub_cause": "routing_engine_issue",
                    "sub_cause_confidence": 0.6,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert result.customer_score == 1.0
        assert result.courier_score == 0.0
        assert result.system_score == 0.7

    @pytest.mark.asyncio
    async def test_classification_sub_cause_below_threshold_is_unspecified(self, sample_evidence):
        """Sub-cause is 'unspecified' when confidence is below sub_cause_threshold."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.8,
                    "courier_score": 0.2,
                    "system_score": 0.1,
                    "sub_cause": "customer_unavailable",
                    "sub_cause_confidence": 0.3,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert result.sub_cause == "unspecified"
        assert result.sub_cause_confidence == 0.3

    @pytest.mark.asyncio
    async def test_classification_timeout_returns_manual_review(self, sample_evidence):
        """classify() returns manual review on timeout."""

        async def slow_response(*args, **kwargs):
            await asyncio.sleep(15)  # Exceeds 10s timeout
            return _make_openai_response(
                {"customer_score": 0.8, "courier_score": 0.2, "system_score": 0.1}
            )

        mock_client = AsyncMock()
        mock_client.chat.completions.create = slow_response

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
            timeout_seconds=0.1,  # Very short timeout for testing
        )

        result = await classifier.classify(sample_evidence)

        assert result.requires_manual_review is True
        assert result.primary_category is None
        assert result.customer_score == 0.0
        assert result.courier_score == 0.0
        assert result.system_score == 0.0

    @pytest.mark.asyncio
    async def test_classification_error_returns_manual_review(self, sample_evidence):
        """classify() returns manual review on API error."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("API rate limit exceeded")
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert result.requires_manual_review is True
        assert result.primary_category is None

    @pytest.mark.asyncio
    async def test_classification_timestamp_is_iso_format(self, sample_evidence):
        """Classification timestamp is ISO 8601 format."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.7,
                    "courier_score": 0.2,
                    "system_score": 0.1,
                    "sub_cause": "customer_unavailable",
                    "sub_cause_confidence": 0.6,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        # Should be parseable as ISO 8601
        ts = datetime.fromisoformat(result.classification_timestamp)
        assert ts is not None

    @pytest.mark.asyncio
    async def test_classification_result_is_dataclass(self, sample_evidence):
        """Result is a proper ClassificationResult dataclass."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.7,
                    "courier_score": 0.2,
                    "system_score": 0.1,
                    "sub_cause": "customer_unavailable",
                    "sub_cause_confidence": 0.6,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6,
            sub_cause_threshold=0.5,
            openai_client=mock_client,
        )

        result = await classifier.classify(sample_evidence)

        assert isinstance(result, ClassificationResult)
        assert hasattr(result, "customer_score")
        assert hasattr(result, "courier_score")
        assert hasattr(result, "system_score")
        assert hasattr(result, "primary_category")
        assert hasattr(result, "sub_cause")
        assert hasattr(result, "sub_cause_confidence")
        assert hasattr(result, "confidence_threshold")
        assert hasattr(result, "requires_manual_review")
        assert hasattr(result, "classification_timestamp")


# --- Tests for _validate_sub_cause ---


class TestValidateSubCause:
    """Tests for the _validate_sub_cause method.

    Requirements: 3.4, 3.5, 3.6, 3.7
    """

    @pytest.fixture
    def classifier(self):
        return RootCauseClassifier(confidence_threshold=0.6, sub_cause_threshold=0.5)

    # --- Customer sub-causes (Req 3.4) ---

    def test_valid_customer_unavailable(self, classifier):
        """Req 3.4: customer_unavailable is valid for CUSTOMER_ISSUE."""
        result = classifier._validate_sub_cause(
            "customer_unavailable", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "customer_unavailable"

    def test_valid_customer_wrong_address(self, classifier):
        """Req 3.4: wrong_address is valid for CUSTOMER_ISSUE."""
        result = classifier._validate_sub_cause(
            "wrong_address", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "wrong_address"

    def test_valid_customer_refused_delivery(self, classifier):
        """Req 3.4: refused_delivery is valid for CUSTOMER_ISSUE."""
        result = classifier._validate_sub_cause(
            "refused_delivery", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "refused_delivery"

    def test_valid_customer_cancellation(self, classifier):
        """Req 3.4: cancellation is valid for CUSTOMER_ISSUE."""
        result = classifier._validate_sub_cause(
            "cancellation", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "cancellation"

    def test_valid_customer_not_interested(self, classifier):
        """Req 3.4: not_interested is valid for CUSTOMER_ISSUE."""
        result = classifier._validate_sub_cause(
            "not_interested", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "not_interested"

    # --- Courier sub-causes (Req 3.5) ---

    def test_valid_courier_fake_attempt(self, classifier):
        """Req 3.5: fake_delivery_attempt is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "fake_delivery_attempt", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "fake_delivery_attempt"

    def test_valid_courier_no_contact(self, classifier):
        """Req 3.5: courier_never_contacted is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "courier_never_contacted", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "courier_never_contacted"

    def test_valid_courier_gps_anomaly(self, classifier):
        """Req 3.5: gps_anomaly is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "gps_anomaly", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "gps_anomaly"

    def test_valid_courier_route_deviation(self, classifier):
        """Req 3.5: route_deviation is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "route_deviation", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "route_deviation"

    def test_valid_courier_incorrect_status(self, classifier):
        """Req 3.5: incorrect_status_update is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "incorrect_status_update", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "incorrect_status_update"

    def test_valid_courier_failed_despite_available(self, classifier):
        """Req 3.5: failed_despite_availability is valid for COURIER_ISSUE."""
        result = classifier._validate_sub_cause(
            "failed_despite_availability", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "failed_despite_availability"

    # --- System sub-causes (Req 3.6) ---

    def test_valid_system_address_mapping(self, classifier):
        """Req 3.6: address_mapping_error is valid for SYSTEM_ISSUE."""
        result = classifier._validate_sub_cause(
            "address_mapping_error", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "address_mapping_error"

    def test_valid_system_routing_engine(self, classifier):
        """Req 3.6: routing_engine_issue is valid for SYSTEM_ISSUE."""
        result = classifier._validate_sub_cause(
            "routing_engine_issue", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "routing_engine_issue"

    def test_valid_system_order_sync(self, classifier):
        """Req 3.6: order_synchronization_failure is valid for SYSTEM_ISSUE."""
        result = classifier._validate_sub_cause(
            "order_synchronization_failure", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "order_synchronization_failure"

    def test_valid_system_wrong_logistics(self, classifier):
        """Req 3.6: wrong_logistics_assignment is valid for SYSTEM_ISSUE."""
        result = classifier._validate_sub_cause(
            "wrong_logistics_assignment", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "wrong_logistics_assignment"

    def test_valid_system_platform_bug(self, classifier):
        """Req 3.6: platform_bug is valid for SYSTEM_ISSUE."""
        result = classifier._validate_sub_cause(
            "platform_bug", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "platform_bug"

    # --- Invalid sub-causes return "unspecified" (Req 3.7) ---

    def test_invalid_sub_cause_for_customer_returns_unspecified(self, classifier):
        """Req 3.7: Invalid sub-cause for customer category returns 'unspecified'."""
        result = classifier._validate_sub_cause(
            "fake_delivery_attempt", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "unspecified"

    def test_invalid_sub_cause_for_courier_returns_unspecified(self, classifier):
        """Req 3.7: Invalid sub-cause for courier category returns 'unspecified'."""
        result = classifier._validate_sub_cause(
            "customer_unavailable", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "unspecified"

    def test_invalid_sub_cause_for_system_returns_unspecified(self, classifier):
        """Req 3.7: Invalid sub-cause for system category returns 'unspecified'."""
        result = classifier._validate_sub_cause(
            "route_deviation", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "unspecified"

    def test_completely_unknown_sub_cause_returns_unspecified(self, classifier):
        """Req 3.7: Completely unknown sub-cause returns 'unspecified'."""
        result = classifier._validate_sub_cause(
            "some_random_cause", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "unspecified"

    def test_none_sub_cause_returns_unspecified(self, classifier):
        """Req 3.7: None sub-cause returns 'unspecified'."""
        result = classifier._validate_sub_cause(None, RootCauseCategory.COURIER_ISSUE)
        assert result == "unspecified"

    def test_none_primary_category_returns_unspecified(self, classifier):
        """Req 3.7: None primary category (manual review) returns 'unspecified'."""
        result = classifier._validate_sub_cause("customer_unavailable", None)
        assert result == "unspecified"

    def test_empty_string_sub_cause_returns_unspecified(self, classifier):
        """Req 3.7: Empty string sub-cause returns 'unspecified'."""
        result = classifier._validate_sub_cause("", RootCauseCategory.SYSTEM_ISSUE)
        assert result == "unspecified"

    # --- Cross-category validation ---

    def test_courier_sub_cause_in_customer_category_is_unspecified(self, classifier):
        """Sub-cause from a different category is rejected."""
        result = classifier._validate_sub_cause(
            "gps_anomaly", RootCauseCategory.CUSTOMER_ISSUE
        )
        assert result == "unspecified"

    def test_system_sub_cause_in_courier_category_is_unspecified(self, classifier):
        """System sub-cause in courier category is rejected."""
        result = classifier._validate_sub_cause(
            "platform_bug", RootCauseCategory.COURIER_ISSUE
        )
        assert result == "unspecified"

    def test_customer_sub_cause_in_system_category_is_unspecified(self, classifier):
        """Customer sub-cause in system category is rejected."""
        result = classifier._validate_sub_cause(
            "cancellation", RootCauseCategory.SYSTEM_ISSUE
        )
        assert result == "unspecified"


# --- Integration tests for sub-cause in classify() ---


class TestClassifySubCauseIntegration:
    """Integration tests verifying sub-cause validation in the full classify() flow.

    Requirements: 3.4, 3.5, 3.6, 3.7
    """

    @pytest.fixture
    def sample_evidence(self):
        return {
            "delivery_attempt": {"attemptNumber": 1, "statusCode": "FAILED"},
            "gps_data": {},
            "call_logs": [],
            "delivery_scans": [],
            "order_history": {},
            "support_tickets": [],
            "address_validation": {},
            "hub_events": [],
            "completeness": {"collected": ["gps"], "unavailable": []},
        }

    @pytest.mark.asyncio
    async def test_valid_customer_sub_cause_preserved(self, sample_evidence):
        """Req 3.4: Valid customer sub-cause is preserved in classify result."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.85,
                    "courier_score": 0.1,
                    "system_score": 0.05,
                    "sub_cause": "wrong_address",
                    "sub_cause_confidence": 0.75,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.CUSTOMER_ISSUE
        assert result.sub_cause == "wrong_address"

    @pytest.mark.asyncio
    async def test_valid_courier_sub_cause_preserved(self, sample_evidence):
        """Req 3.5: Valid courier sub-cause is preserved in classify result."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.1,
                    "courier_score": 0.9,
                    "system_score": 0.05,
                    "sub_cause": "fake_delivery_attempt",
                    "sub_cause_confidence": 0.85,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.COURIER_ISSUE
        assert result.sub_cause == "fake_delivery_attempt"

    @pytest.mark.asyncio
    async def test_valid_system_sub_cause_preserved(self, sample_evidence):
        """Req 3.6: Valid system sub-cause is preserved in classify result."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.1,
                    "courier_score": 0.2,
                    "system_score": 0.88,
                    "sub_cause": "order_synchronization_failure",
                    "sub_cause_confidence": 0.7,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.SYSTEM_ISSUE
        assert result.sub_cause == "order_synchronization_failure"

    @pytest.mark.asyncio
    async def test_invalid_sub_cause_becomes_unspecified(self, sample_evidence):
        """Req 3.7: Invalid sub-cause (wrong category) becomes 'unspecified'."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.85,
                    "courier_score": 0.1,
                    "system_score": 0.05,
                    "sub_cause": "gps_anomaly",  # courier sub-cause, but primary is customer
                    "sub_cause_confidence": 0.7,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.CUSTOMER_ISSUE
        assert result.sub_cause == "unspecified"

    @pytest.mark.asyncio
    async def test_low_confidence_sub_cause_becomes_unspecified(self, sample_evidence):
        """Req 3.7: Sub-cause with confidence < 0.5 becomes 'unspecified'."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.1,
                    "courier_score": 0.9,
                    "system_score": 0.05,
                    "sub_cause": "fake_delivery_attempt",
                    "sub_cause_confidence": 0.4,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.COURIER_ISSUE
        assert result.sub_cause == "unspecified"
        assert result.sub_cause_confidence == 0.4

    @pytest.mark.asyncio
    async def test_null_sub_cause_with_high_confidence_becomes_unspecified(self, sample_evidence):
        """Req 3.7: Null sub-cause from LLM with high confidence becomes 'unspecified'."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.8,
                    "courier_score": 0.1,
                    "system_score": 0.1,
                    "sub_cause": None,
                    "sub_cause_confidence": 0.7,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.primary_category == RootCauseCategory.CUSTOMER_ISSUE
        assert result.sub_cause == "unspecified"

    @pytest.mark.asyncio
    async def test_sub_cause_at_exact_threshold_is_unspecified(self, sample_evidence):
        """Req 3.7: Sub-cause confidence at exactly 0.5 (< threshold means < not <=) is unspecified."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.8,
                    "courier_score": 0.1,
                    "system_score": 0.1,
                    "sub_cause": "customer_unavailable",
                    "sub_cause_confidence": 0.5,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        # 0.5 is NOT less than 0.5, so the sub-cause should be validated (not unspecified for threshold)
        assert result.sub_cause == "customer_unavailable"

    @pytest.mark.asyncio
    async def test_sub_cause_just_below_threshold_is_unspecified(self, sample_evidence):
        """Req 3.7: Sub-cause confidence just below 0.5 becomes 'unspecified'."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_make_openai_response(
                {
                    "customer_score": 0.8,
                    "courier_score": 0.1,
                    "system_score": 0.1,
                    "sub_cause": "customer_unavailable",
                    "sub_cause_confidence": 0.49,
                }
            )
        )

        classifier = RootCauseClassifier(
            confidence_threshold=0.6, sub_cause_threshold=0.5, openai_client=mock_client
        )
        result = await classifier.classify(sample_evidence)

        assert result.sub_cause == "unspecified"
