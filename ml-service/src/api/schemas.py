"""
Pydantic request/response models for the ML service API.

Provides input validation and serialization for:
- Classification endpoint (POST /ml/v1/classify)
- Recovery prediction endpoint (POST /ml/v1/predict-recovery)
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ============================================================
# Classification Endpoint Models
# ============================================================


class EvidenceCompleteness(BaseModel):
    """Metadata about evidence collection completeness."""

    collected: list[str] = Field(
        default_factory=list,
        description="Source types that responded successfully",
    )
    unavailable: list[str] = Field(
        default_factory=list,
        description="Source types that timed out or failed",
    )
    timeout_timestamps: dict[str, str] = Field(
        default_factory=dict,
        description="Timestamps when each unavailable source timed out",
    )


class ClassifyRequest(BaseModel):
    """Request payload for the /ml/v1/classify endpoint.

    Accepts normalized evidence containing delivery failure data
    from the Evidence Collection Engine.
    """

    rto_event_id: str = Field(
        ...,
        min_length=1,
        description="Identifier of the RTO event being classified",
    )
    delivery_attempt: dict[str, Any] = Field(
        default_factory=dict,
        description="Delivery attempt details (timestamp, GPS, status, failure reason)",
    )
    gps_data: dict[str, Any] = Field(
        default_factory=dict,
        description="GPS traces and location data",
    )
    call_logs: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Call log records between courier and customer",
    )
    delivery_scans: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Package scan events from delivery process",
    )
    order_history: dict[str, Any] = Field(
        default_factory=dict,
        description="Customer order history and statistics",
    )
    support_tickets: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Related customer support tickets",
    )
    address_validation: dict[str, Any] = Field(
        default_factory=dict,
        description="Address validation results",
    )
    hub_events: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Hub/sorting center events",
    )
    completeness: EvidenceCompleteness = Field(
        default_factory=EvidenceCompleteness,
        description="Evidence collection completeness metadata",
    )


class ClassifyResponse(BaseModel):
    """Response payload for the /ml/v1/classify endpoint.

    Contains the full ClassificationResult from the Root Cause Classifier.
    """

    customer_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Customer issue confidence score (0.0 to 1.0)",
    )
    courier_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Courier issue confidence score (0.0 to 1.0)",
    )
    system_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="System issue confidence score (0.0 to 1.0)",
    )
    primary_category: Optional[str] = Field(
        None,
        description="Primary root cause category or null if manual review needed",
    )
    sub_cause: Optional[str] = Field(
        None,
        description="Specific sub-cause within the primary category, or null",
    )
    sub_cause_confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence in the identified sub-cause",
    )
    confidence_threshold: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Threshold used for category assignment",
    )
    requires_manual_review: bool = Field(
        ...,
        description="Whether the case requires human review",
    )
    classification_timestamp: str = Field(
        ...,
        description="ISO 8601 timestamp of classification",
    )


# ============================================================
# Recovery Prediction Endpoint Models
# ============================================================


class ClassificationInput(BaseModel):
    """Classification result from the Root Cause Classifier."""

    primary_category: Optional[str] = Field(
        default=None,
        description="Primary root cause category: customer_issue, courier_issue, or system_issue",
    )
    customer_score: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Customer issue confidence score"
    )
    courier_score: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Courier issue confidence score"
    )
    system_score: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="System issue confidence score"
    )
    sub_cause: Optional[str] = Field(default=None, description="Specific sub-cause")


class CustomerDataInput(BaseModel):
    """Customer profile and history data for recovery prediction."""

    prior_orders: Optional[int] = Field(
        default=None, ge=0, description="Number of prior orders placed by the customer"
    )
    return_rate: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Customer's historical return rate"
    )
    avg_order_value: Optional[float] = Field(
        default=None, ge=0.0, description="Customer's average order value"
    )
    responded_to_notifications: Optional[bool] = Field(
        default=None, description="Whether customer responded to delivery notifications"
    )
    initiated_support: Optional[bool] = Field(
        default=None, description="Whether customer initiated support contact"
    )
    updated_preferences: Optional[bool] = Field(
        default=None, description="Whether customer updated delivery preferences"
    )


class OrderDataInput(BaseModel):
    """Order details for recovery prediction."""

    hours_since_order: Optional[float] = Field(
        default=None, ge=0.0, description="Hours elapsed since order was placed"
    )
    product_category: Optional[str] = Field(
        default=None,
        description="Product category (electronics, clothing, home, beauty, sports, books, food, other)",
    )
    price_tier: Optional[str] = Field(
        default=None,
        description="Product price tier (low, medium, high, premium)",
    )


class RecoveryPredictionRequest(BaseModel):
    """Request body for POST /ml/v1/predict-recovery."""

    classification: ClassificationInput = Field(
        default_factory=ClassificationInput,
        description="Root cause classification result",
    )
    customer_data: CustomerDataInput = Field(
        default_factory=CustomerDataInput,
        description="Customer profile and history data",
    )
    order_data: OrderDataInput = Field(
        default_factory=OrderDataInput,
        description="Order details including product info",
    )


class PredictionFeaturesResponse(BaseModel):
    """Features used in the prediction."""

    prior_orders: int
    return_rate: float
    avg_order_value: float
    hours_since_order: float
    product_category: str
    price_tier: str
    responded_to_notifications: bool
    initiated_support: bool
    updated_preferences: bool
    imputed_features: list[str]


class RecoveryPredictionResponse(BaseModel):
    """Response body for POST /ml/v1/predict-recovery."""

    recovery_probability: float = Field(
        ge=0.0, le=1.0, description="Predicted probability of successful redelivery"
    )
    features_used: PredictionFeaturesResponse = Field(
        description="Features extracted and used for prediction"
    )
    partially_imputed: bool = Field(
        description="Whether any features were imputed with population medians"
    )
    model_version: str = Field(description="Version of the prediction model used")
    predicted_at: str = Field(description="ISO 8601 timestamp of prediction")
