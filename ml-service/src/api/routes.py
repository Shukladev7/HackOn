"""
API routes for the RTO Reallocation ML Service.

Endpoints:
- GET  /health              — Service health check
- GET  /models/status       — Model health and version info
- POST /classify            — Root cause classification
- POST /predict-recovery    — Sale recovery prediction
"""

import logging

from fastapi import APIRouter, HTTPException, status

from src.api.circuit_breaker import CircuitBreaker, CircuitBreakerError
from src.api.schemas import (
    ClassifyRequest,
    ClassifyResponse,
    RecoveryPredictionRequest,
    RecoveryPredictionResponse,
    PredictionFeaturesResponse,
)
from src.ml.root_cause_classifier import RootCauseClassifier
from src.ml.sale_recovery_predictor import SaleRecoveryPredictor

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton predictor instance (initialized once on import)
_predictor = SaleRecoveryPredictor(model_path=None)

# Circuit breaker for OpenAI API calls
# Trips after 5 consecutive failures, cooldown 30 seconds
openai_circuit_breaker = CircuitBreaker(
    failure_threshold=5,
    cooldown_seconds=30.0,
    name="openai-classifier",
)

# Singleton classifier instance
_classifier: RootCauseClassifier | None = None


def get_classifier() -> RootCauseClassifier:
    """Get or create the singleton RootCauseClassifier instance."""
    global _classifier
    if _classifier is None:
        _classifier = RootCauseClassifier()
    return _classifier


@router.get("/health")
async def health_check():
    """System health check endpoint."""
    return {
        "status": "healthy",
        "service": "rto-reallocation-ml-service",
        "circuit_breaker": {
            "openai": {
                "state": openai_circuit_breaker.state.value,
                "consecutive_failures": openai_circuit_breaker.consecutive_failures,
            }
        },
    }


@router.get("/models/status")
async def models_status():
    """Model health and version info."""
    return {
        "root_cause_classifier": {"status": "ready", "version": "1.0.0"},
        "sale_recovery_predictor": {"status": "ready", "version": "1.0.0"},
    }


@router.post(
    "/classify",
    response_model=ClassifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Root cause classification",
    description="Classify the root cause of a delivery failure using normalized evidence.",
)
async def classify_root_cause(request: ClassifyRequest) -> ClassifyResponse:
    """Classify the root cause of a delivery failure.

    Accepts normalized evidence from the Evidence Collection Engine and
    returns a ClassificationResult with scores, primary category, and sub-cause.

    Uses a circuit breaker to protect against cascading failures from the
    OpenAI API. If the circuit breaker is open, returns HTTP 503.

    Requirement 3.1: Produce customer/courier/system scores each in [0.0, 1.0],
    independent, within 10 seconds of receiving the evidence.
    """
    classifier = get_classifier()

    # Build evidence dict from the request payload
    evidence = {
        "rto_event_id": request.rto_event_id,
        "delivery_attempt": request.delivery_attempt,
        "gps_data": request.gps_data,
        "call_logs": request.call_logs,
        "delivery_scans": request.delivery_scans,
        "order_history": request.order_history,
        "support_tickets": request.support_tickets,
        "address_validation": request.address_validation,
        "hub_events": request.hub_events,
        "completeness": request.completeness.model_dump(),
    }

    try:
        # Execute classification through the circuit breaker
        result = await openai_circuit_breaker.call(classifier.classify, evidence)
    except CircuitBreakerError as e:
        logger.error("Classification blocked by circuit breaker: %s", e.message)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "service_unavailable",
                "message": "Classification service temporarily unavailable due to upstream failures.",
                "circuit_breaker_state": openai_circuit_breaker.state.value,
            },
        )
    except Exception as e:
        logger.error("Classification failed unexpectedly: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "classification_failed",
                "message": f"Classification failed: {str(e)}",
            },
        )

    # Map ClassificationResult to response model
    return ClassifyResponse(
        customer_score=result.customer_score,
        courier_score=result.courier_score,
        system_score=result.system_score,
        primary_category=result.primary_category.value if result.primary_category else None,
        sub_cause=result.sub_cause,
        sub_cause_confidence=result.sub_cause_confidence,
        confidence_threshold=result.confidence_threshold,
        requires_manual_review=result.requires_manual_review,
        classification_timestamp=result.classification_timestamp,
    )


@router.post("/predict-recovery", response_model=RecoveryPredictionResponse)
async def predict_recovery(request: RecoveryPredictionRequest):
    """
    Predict the probability of successful redelivery to the original customer.

    Accepts classification result, customer data, and order data.
    Returns a RecoveryPrediction with probability, features used, and metadata.

    Requirements:
    - 4.1: Must complete within 5 seconds
    - 4.2: Same prediction for courier/system issues (underlying issue resolved)
    """
    try:
        # Convert Pydantic models to dicts for the predictor
        # Use model_dump and exclude None values so the predictor can apply imputation
        classification_dict = request.classification.model_dump(exclude_none=True)
        customer_dict = request.customer_data.model_dump(exclude_none=True)
        order_dict = request.order_data.model_dump(exclude_none=True)

        prediction = await _predictor.predict(
            classification=classification_dict,
            customer_data=customer_dict,
            order_data=order_dict,
        )

        return RecoveryPredictionResponse(
            recovery_probability=prediction.recovery_probability,
            features_used=PredictionFeaturesResponse(
                prior_orders=prediction.features_used.prior_orders,
                return_rate=prediction.features_used.return_rate,
                avg_order_value=prediction.features_used.avg_order_value,
                hours_since_order=prediction.features_used.hours_since_order,
                product_category=prediction.features_used.product_category,
                price_tier=prediction.features_used.price_tier,
                responded_to_notifications=prediction.features_used.responded_to_notifications,
                initiated_support=prediction.features_used.initiated_support,
                updated_preferences=prediction.features_used.updated_preferences,
                imputed_features=prediction.features_used.imputed_features,
            ),
            partially_imputed=prediction.partially_imputed,
            model_version=prediction.model_version,
            predicted_at=prediction.predicted_at,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
