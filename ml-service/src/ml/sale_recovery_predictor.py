"""
Sale Recovery Predictor module.

Uses a logistic regression model (scikit-learn) to predict the probability
that an RTO shipment can be successfully redelivered to the original customer.

Requirements:
- 4.1: Compute recovery probability within 5 seconds
- 4.2: Use same prediction for courier/system issues (underlying issue resolved)
- 4.3: Features: order history, time since order, product category, price tier, communication signals
- 4.4: Impute missing features with population median and flag as partially imputed
"""

import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder

import joblib


MODEL_VERSION = "1.0.0"

# Valid values for categorical features
VALID_PRICE_TIERS = ("low", "medium", "high", "premium")
VALID_PRODUCT_CATEGORIES = (
    "electronics",
    "clothing",
    "home",
    "beauty",
    "sports",
    "books",
    "food",
    "other",
)


@dataclass
class PredictionFeatures:
    """Features extracted for recovery prediction."""

    prior_orders: int
    return_rate: float
    avg_order_value: float
    hours_since_order: float
    product_category: str
    price_tier: str  # 'low', 'medium', 'high', 'premium'
    responded_to_notifications: bool
    initiated_support: bool
    updated_preferences: bool
    imputed_features: list = field(default_factory=list)  # names of imputed features


@dataclass
class RecoveryPrediction:
    """Result of recovery probability prediction."""

    recovery_probability: float  # 0.0 to 1.0
    features_used: PredictionFeatures
    partially_imputed: bool
    model_version: str
    predicted_at: str


class SaleRecoveryPredictor:
    """
    Predicts the probability of successful redelivery using logistic regression.

    Uses customer behavior data, order attributes, and communication signals
    to estimate recovery likelihood. Missing numeric features are imputed
    with population medians and flagged.
    """

    POPULATION_MEDIANS = {
        "prior_orders": 3,
        "return_rate": 0.12,
        "avg_order_value": 850.0,
        "hours_since_order": 48.0,
    }

    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize the predictor.

        Args:
            model_path: Path to a serialized model file. If None or file
                        doesn't exist, a default model is created with
                        pre-set coefficients.
        """
        self._model: Optional[LogisticRegression] = None
        self._model_path = model_path
        self._category_encoder = LabelEncoder()
        self._price_tier_encoder = LabelEncoder()

        # Fit encoders with known categories
        self._category_encoder.fit(list(VALID_PRODUCT_CATEGORIES))
        self._price_tier_encoder.fit(list(VALID_PRICE_TIERS))

        self._load_or_create_model()

    def _load_or_create_model(self) -> None:
        """Load model from disk or create a default logistic regression."""
        if self._model_path and os.path.exists(self._model_path):
            self._model = joblib.load(self._model_path)
        else:
            self._model = self._create_default_model()

    def _create_default_model(self) -> LogisticRegression:
        """
        Create a logistic regression with pre-set coefficients.

        Feature order:
        [prior_orders, return_rate, avg_order_value, hours_since_order,
         product_category_encoded, price_tier_encoded,
         responded_to_notifications, initiated_support, updated_preferences]
        """
        model = LogisticRegression()

        # Pre-set coefficients based on domain knowledge:
        # - More prior orders → higher recovery
        # - Higher return rate → lower recovery
        # - Higher avg order value → slightly higher recovery (invested customer)
        # - More hours since order → lower recovery (interest fades)
        # - Communication signals → positive indicators
        n_features = 9
        model.classes_ = np.array([0, 1])
        model.coef_ = np.array([[
            0.15,   # prior_orders: more orders = more likely to accept redelivery
            -1.5,   # return_rate: high return rate = less likely
            0.0003, # avg_order_value: slight positive effect
            -0.008, # hours_since_order: urgency decreases over time
            0.02,   # product_category_encoded: minor effect
            0.1,    # price_tier_encoded: higher tier slightly positive
            0.8,    # responded_to_notifications: strong positive signal
            0.6,    # initiated_support: positive signal
            0.5,    # updated_preferences: positive signal
        ]])
        model.intercept_ = np.array([-0.5])
        model.n_features_in_ = n_features

        return model

    async def predict(
        self,
        classification: dict,
        customer_data: dict,
        order_data: dict,
    ) -> RecoveryPrediction:
        """
        Compute recovery probability using the trained model.

        For courier/system issues, the prediction assumes the underlying
        issue has been resolved (Req 4.2), so the same model is used
        regardless of root cause category.

        Args:
            classification: Root cause classification result dict.
            customer_data: Customer profile and history data.
            order_data: Order details including product info.

        Returns:
            RecoveryPrediction with probability clamped to [0.0, 1.0].
        """
        start_time = time.monotonic()

        features = self._extract_features(customer_data, order_data)
        feature_vector = self._features_to_vector(features)

        # Predict using logistic regression
        probability = float(self._model.predict_proba(feature_vector)[0][1])

        # Clamp to valid range
        probability = max(0.0, min(1.0, probability))

        elapsed = time.monotonic() - start_time
        if elapsed > 5.0:
            # Log warning but still return result (Req 4.1)
            pass

        prediction = RecoveryPrediction(
            recovery_probability=probability,
            features_used=features,
            partially_imputed=len(features.imputed_features) > 0,
            model_version=MODEL_VERSION,
            predicted_at=datetime.now(timezone.utc).isoformat(),
        )

        return prediction

    def _extract_features(
        self, customer_data: dict, order_data: dict
    ) -> PredictionFeatures:
        """
        Extract and impute features from raw customer/order data.

        Missing numeric features are replaced with population medians
        and flagged in the imputed_features list (Req 4.4).

        Args:
            customer_data: Dict with keys like 'prior_orders', 'return_rate',
                          'avg_order_value', 'responded_to_notifications', etc.
            order_data: Dict with keys like 'hours_since_order',
                       'product_category', 'price_tier'.

        Returns:
            PredictionFeatures with imputation applied where needed.
        """
        imputed: list = []

        # Extract numeric features with imputation
        prior_orders = customer_data.get("prior_orders")
        if prior_orders is None:
            prior_orders = self.POPULATION_MEDIANS["prior_orders"]
            imputed.append("prior_orders")
        prior_orders = int(prior_orders)

        return_rate = customer_data.get("return_rate")
        if return_rate is None:
            return_rate = self.POPULATION_MEDIANS["return_rate"]
            imputed.append("return_rate")
        return_rate = float(return_rate)

        avg_order_value = customer_data.get("avg_order_value")
        if avg_order_value is None:
            avg_order_value = self.POPULATION_MEDIANS["avg_order_value"]
            imputed.append("avg_order_value")
        avg_order_value = float(avg_order_value)

        hours_since_order = order_data.get("hours_since_order")
        if hours_since_order is None:
            hours_since_order = self.POPULATION_MEDIANS["hours_since_order"]
            imputed.append("hours_since_order")
        hours_since_order = float(hours_since_order)

        # Extract categorical features (default to safe values if missing)
        product_category = order_data.get("product_category", "other")
        if product_category not in VALID_PRODUCT_CATEGORIES:
            product_category = "other"

        price_tier = order_data.get("price_tier", "medium")
        if price_tier not in VALID_PRICE_TIERS:
            price_tier = "medium"

        # Communication signals (boolean, default False)
        responded_to_notifications = bool(
            customer_data.get("responded_to_notifications", False)
        )
        initiated_support = bool(customer_data.get("initiated_support", False))
        updated_preferences = bool(customer_data.get("updated_preferences", False))

        return PredictionFeatures(
            prior_orders=prior_orders,
            return_rate=return_rate,
            avg_order_value=avg_order_value,
            hours_since_order=hours_since_order,
            product_category=product_category,
            price_tier=price_tier,
            responded_to_notifications=responded_to_notifications,
            initiated_support=initiated_support,
            updated_preferences=updated_preferences,
            imputed_features=imputed,
        )

    def _features_to_vector(self, features: PredictionFeatures) -> np.ndarray:
        """
        Convert PredictionFeatures to a numpy array for model input.

        Encodes categorical features as integers using label encoders.
        """
        # Encode categorical features
        category_encoded = self._category_encoder.transform(
            [features.product_category]
        )[0]
        price_tier_encoded = self._price_tier_encoder.transform(
            [features.price_tier]
        )[0]

        vector = np.array([[
            features.prior_orders,
            features.return_rate,
            features.avg_order_value,
            features.hours_since_order,
            category_encoded,
            price_tier_encoded,
            int(features.responded_to_notifications),
            int(features.initiated_support),
            int(features.updated_preferences),
        ]])

        return vector

    def save_model(self, path: Optional[str] = None) -> str:
        """
        Save the current model to disk.

        Args:
            path: Destination path. Defaults to self._model_path.

        Returns:
            The path where the model was saved.
        """
        save_path = path or self._model_path or "model.joblib"
        joblib.dump(self._model, save_path)
        return save_path
