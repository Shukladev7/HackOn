"""
Tests for the Sale Recovery Predictor module.

Covers:
- Feature extraction with and without missing data
- Population median imputation and flagging
- Recovery probability output validity (bounded [0, 1])
- Performance constraint (< 5 seconds)
- Categorical feature handling
- Communication signal extraction
"""

import time

import pytest
import numpy as np

from src.ml.sale_recovery_predictor import (
    SaleRecoveryPredictor,
    PredictionFeatures,
    RecoveryPrediction,
    VALID_PRICE_TIERS,
    VALID_PRODUCT_CATEGORIES,
)


@pytest.fixture
def predictor():
    """Create a predictor instance with the default model."""
    return SaleRecoveryPredictor(model_path=None)


@pytest.fixture
def full_customer_data():
    """Complete customer data with no missing fields."""
    return {
        "prior_orders": 10,
        "return_rate": 0.05,
        "avg_order_value": 1200.0,
        "responded_to_notifications": True,
        "initiated_support": True,
        "updated_preferences": False,
    }


@pytest.fixture
def full_order_data():
    """Complete order data with no missing fields."""
    return {
        "hours_since_order": 12.0,
        "product_category": "electronics",
        "price_tier": "high",
    }


class TestFeatureExtraction:
    """Unit tests for _extract_features method."""

    def test_extracts_all_features_when_complete(
        self, predictor, full_customer_data, full_order_data
    ):
        """All fields present → no imputation needed."""
        features = predictor._extract_features(full_customer_data, full_order_data)

        assert features.prior_orders == 10
        assert features.return_rate == 0.05
        assert features.avg_order_value == 1200.0
        assert features.hours_since_order == 12.0
        assert features.product_category == "electronics"
        assert features.price_tier == "high"
        assert features.responded_to_notifications is True
        assert features.initiated_support is True
        assert features.updated_preferences is False
        assert features.imputed_features == []

    def test_imputes_missing_prior_orders(self, predictor, full_order_data):
        """Missing prior_orders → imputed with population median."""
        customer_data = {"return_rate": 0.1, "avg_order_value": 500.0}
        features = predictor._extract_features(customer_data, full_order_data)

        assert features.prior_orders == SaleRecoveryPredictor.POPULATION_MEDIANS["prior_orders"]
        assert "prior_orders" in features.imputed_features

    def test_imputes_missing_return_rate(self, predictor, full_order_data):
        """Missing return_rate → imputed with population median."""
        customer_data = {"prior_orders": 5, "avg_order_value": 500.0}
        features = predictor._extract_features(customer_data, full_order_data)

        assert features.return_rate == SaleRecoveryPredictor.POPULATION_MEDIANS["return_rate"]
        assert "return_rate" in features.imputed_features

    def test_imputes_missing_avg_order_value(self, predictor, full_order_data):
        """Missing avg_order_value → imputed with population median."""
        customer_data = {"prior_orders": 5, "return_rate": 0.1}
        features = predictor._extract_features(customer_data, full_order_data)

        assert features.avg_order_value == SaleRecoveryPredictor.POPULATION_MEDIANS["avg_order_value"]
        assert "avg_order_value" in features.imputed_features

    def test_imputes_missing_hours_since_order(self, predictor, full_customer_data):
        """Missing hours_since_order → imputed with population median."""
        order_data = {"product_category": "electronics", "price_tier": "high"}
        features = predictor._extract_features(full_customer_data, order_data)

        assert features.hours_since_order == SaleRecoveryPredictor.POPULATION_MEDIANS["hours_since_order"]
        assert "hours_since_order" in features.imputed_features

    def test_imputes_all_missing_numeric_features(self, predictor):
        """All numeric features missing → all imputed, all flagged."""
        features = predictor._extract_features({}, {})

        assert features.prior_orders == 3
        assert features.return_rate == 0.12
        assert features.avg_order_value == 850.0
        assert features.hours_since_order == 48.0
        assert set(features.imputed_features) == {
            "prior_orders",
            "return_rate",
            "avg_order_value",
            "hours_since_order",
        }

    def test_invalid_product_category_defaults_to_other(self, predictor, full_customer_data):
        """Invalid product category → defaults to 'other'."""
        order_data = {"hours_since_order": 5.0, "product_category": "invalid_cat", "price_tier": "low"}
        features = predictor._extract_features(full_customer_data, order_data)

        assert features.product_category == "other"

    def test_invalid_price_tier_defaults_to_medium(self, predictor, full_customer_data):
        """Invalid price tier → defaults to 'medium'."""
        order_data = {"hours_since_order": 5.0, "product_category": "electronics", "price_tier": "ultra"}
        features = predictor._extract_features(full_customer_data, order_data)

        assert features.price_tier == "medium"

    def test_communication_signals_default_to_false(self, predictor, full_order_data):
        """Missing communication signals default to False."""
        features = predictor._extract_features({}, full_order_data)

        assert features.responded_to_notifications is False
        assert features.initiated_support is False
        assert features.updated_preferences is False


class TestPrediction:
    """Unit tests for the predict method."""

    @pytest.mark.asyncio
    async def test_prediction_returns_valid_probability(
        self, predictor, full_customer_data, full_order_data
    ):
        """Prediction probability must be in [0, 1]."""
        result = await predictor.predict({}, full_customer_data, full_order_data)

        assert isinstance(result, RecoveryPrediction)
        assert 0.0 <= result.recovery_probability <= 1.0

    @pytest.mark.asyncio
    async def test_prediction_not_partially_imputed_with_complete_data(
        self, predictor, full_customer_data, full_order_data
    ):
        """No imputation when data is complete."""
        result = await predictor.predict({}, full_customer_data, full_order_data)

        assert result.partially_imputed is False
        assert result.features_used.imputed_features == []

    @pytest.mark.asyncio
    async def test_prediction_partially_imputed_with_missing_data(self, predictor):
        """Missing features → partially_imputed flag set."""
        result = await predictor.predict({}, {}, {})

        assert result.partially_imputed is True
        assert len(result.features_used.imputed_features) > 0

    @pytest.mark.asyncio
    async def test_prediction_includes_model_version(
        self, predictor, full_customer_data, full_order_data
    ):
        """Prediction includes the model version string."""
        result = await predictor.predict({}, full_customer_data, full_order_data)

        assert result.model_version == "1.0.0"

    @pytest.mark.asyncio
    async def test_prediction_includes_timestamp(
        self, predictor, full_customer_data, full_order_data
    ):
        """Prediction includes an ISO timestamp."""
        result = await predictor.predict({}, full_customer_data, full_order_data)

        assert result.predicted_at is not None
        assert "T" in result.predicted_at  # ISO format indicator

    @pytest.mark.asyncio
    async def test_prediction_completes_within_5_seconds(
        self, predictor, full_customer_data, full_order_data
    ):
        """Req 4.1: Prediction must complete within 5 seconds."""
        start = time.monotonic()
        await predictor.predict({}, full_customer_data, full_order_data)
        elapsed = time.monotonic() - start

        assert elapsed < 5.0

    @pytest.mark.asyncio
    async def test_same_prediction_regardless_of_classification(
        self, predictor, full_customer_data, full_order_data
    ):
        """
        Req 4.2: Same prediction for courier/system issues
        (assumes underlying issue resolved).
        """
        courier_classification = {
            "primary_category": "courier_issue",
            "customer_score": 0.1,
            "courier_score": 0.8,
            "system_score": 0.1,
        }
        system_classification = {
            "primary_category": "system_issue",
            "customer_score": 0.1,
            "courier_score": 0.1,
            "system_score": 0.8,
        }

        result_courier = await predictor.predict(
            courier_classification, full_customer_data, full_order_data
        )
        result_system = await predictor.predict(
            system_classification, full_customer_data, full_order_data
        )

        assert result_courier.recovery_probability == result_system.recovery_probability

    @pytest.mark.asyncio
    async def test_high_engagement_customer_gets_higher_probability(self, predictor):
        """Customer with positive communication signals should get higher probability."""
        engaged_customer = {
            "prior_orders": 15,
            "return_rate": 0.02,
            "avg_order_value": 2000.0,
            "responded_to_notifications": True,
            "initiated_support": True,
            "updated_preferences": True,
        }
        disengaged_customer = {
            "prior_orders": 1,
            "return_rate": 0.5,
            "avg_order_value": 200.0,
            "responded_to_notifications": False,
            "initiated_support": False,
            "updated_preferences": False,
        }
        order_data = {
            "hours_since_order": 6.0,
            "product_category": "electronics",
            "price_tier": "premium",
        }

        result_engaged = await predictor.predict({}, engaged_customer, order_data)
        result_disengaged = await predictor.predict({}, disengaged_customer, order_data)

        assert result_engaged.recovery_probability > result_disengaged.recovery_probability


class TestModelManagement:
    """Tests for model loading and saving."""

    def test_creates_default_model_when_no_path(self):
        """Predictor creates a functional model when no path is given."""
        predictor = SaleRecoveryPredictor(model_path=None)
        assert predictor._model is not None

    def test_creates_default_model_when_path_doesnt_exist(self, tmp_path):
        """Predictor creates default model if path doesn't exist."""
        predictor = SaleRecoveryPredictor(model_path=str(tmp_path / "nonexistent.joblib"))
        assert predictor._model is not None

    def test_saves_and_loads_model(self, tmp_path):
        """Model can be saved and loaded back."""
        model_path = str(tmp_path / "test_model.joblib")
        predictor1 = SaleRecoveryPredictor(model_path=None)
        predictor1.save_model(model_path)

        predictor2 = SaleRecoveryPredictor(model_path=model_path)
        assert predictor2._model is not None

        # Both should produce the same predictions
        features = predictor1._extract_features(
            {"prior_orders": 5, "return_rate": 0.1, "avg_order_value": 1000.0},
            {"hours_since_order": 24.0, "product_category": "electronics", "price_tier": "high"},
        )
        vec = predictor1._features_to_vector(features)

        prob1 = predictor1._model.predict_proba(vec)[0][1]
        prob2 = predictor2._model.predict_proba(vec)[0][1]
        assert abs(prob1 - prob2) < 1e-10


class TestFeatureVector:
    """Tests for feature-to-vector conversion."""

    def test_vector_has_correct_shape(self, predictor, full_customer_data, full_order_data):
        """Feature vector should have 9 elements."""
        features = predictor._extract_features(full_customer_data, full_order_data)
        vector = predictor._features_to_vector(features)

        assert vector.shape == (1, 9)

    def test_all_valid_categories_encode_without_error(self, predictor):
        """All valid product categories should encode successfully."""
        for category in VALID_PRODUCT_CATEGORIES:
            order_data = {"hours_since_order": 10.0, "product_category": category, "price_tier": "medium"}
            features = predictor._extract_features({}, order_data)
            vector = predictor._features_to_vector(features)
            assert vector.shape == (1, 9)

    def test_all_valid_price_tiers_encode_without_error(self, predictor):
        """All valid price tiers should encode successfully."""
        for tier in VALID_PRICE_TIERS:
            order_data = {"hours_since_order": 10.0, "product_category": "other", "price_tier": tier}
            features = predictor._extract_features({}, order_data)
            vector = predictor._features_to_vector(features)
            assert vector.shape == (1, 9)
