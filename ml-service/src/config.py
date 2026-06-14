"""
Configuration module for the RTO Reallocation ML Service.
Reads from environment variables with sensible defaults.
"""

import os
from dataclasses import dataclass, field


def _env_int(key: str, default: int) -> int:
    value = os.environ.get(key, "")
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(key: str, default: float) -> float:
    value = os.environ.get(key, "")
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _env_str(key: str, default: str) -> str:
    return os.environ.get(key, default)


@dataclass(frozen=True)
class RankingWeights:
    distance: float = 0.25
    conversion: float = 0.35
    speed: float = 0.20
    margin: float = 0.20


@dataclass(frozen=True)
class Config:
    """Central configuration for the ML service."""

    # Server
    port: int = field(default_factory=lambda: _env_int("ML_SERVICE_PORT", 8000))
    environment: str = field(default_factory=lambda: _env_str("ENVIRONMENT", "development"))
    backend_url: str = field(default_factory=lambda: _env_str("BACKEND_URL", "http://localhost:3000"))

    # Database
    mongodb_uri: str = field(
        default_factory=lambda: _env_str("MONGODB_URI", "mongodb://localhost:27017/rto-reallocation")
    )
    redis_url: str = field(default_factory=lambda: _env_str("REDIS_URL", "redis://localhost:6379"))

    # OpenAI
    openai_api_key: str = field(default_factory=lambda: _env_str("OPENAI_API_KEY", ""))
    openai_model: str = field(default_factory=lambda: _env_str("OPENAI_MODEL", "gpt-4"))

    # Root Cause Classifier (Requirement 3.2)
    confidence_threshold: float = field(
        default_factory=lambda: _env_float("CONFIDENCE_THRESHOLD", 0.6)
    )
    sub_cause_confidence_threshold: float = field(
        default_factory=lambda: _env_float("SUB_CAUSE_CONFIDENCE_THRESHOLD", 0.5)
    )

    # Sale Recovery Predictor (Requirement 4.1)
    recovery_probability_threshold: float = field(
        default_factory=lambda: _env_float("RECOVERY_PROBABILITY_THRESHOLD", 0.3)
    )
    courier_redelivery_recovery_threshold: float = field(
        default_factory=lambda: _env_float("COURIER_REDELIVERY_RECOVERY_THRESHOLD", 0.5)
    )

    # Demand Matching (Requirement 5.1)
    search_radius_km: int = field(default_factory=lambda: _env_int("SEARCH_RADIUS_KM", 50))
    cart_recency_days: int = field(default_factory=lambda: _env_int("CART_RECENCY_DAYS", 7))
    intent_threshold: float = field(default_factory=lambda: _env_float("INTENT_THRESHOLD", 0.6))
    refusal_lookback_days: int = field(
        default_factory=lambda: _env_int("REFUSAL_LOOKBACK_DAYS", 90)
    )

    # Buyer Ranking (Requirements 6.2, 6.4)
    ranking_weights: RankingWeights = field(
        default_factory=lambda: RankingWeights(
            distance=_env_float("RANKING_WEIGHT_DISTANCE", 0.25),
            conversion=_env_float("RANKING_WEIGHT_CONVERSION", 0.35),
            speed=_env_float("RANKING_WEIGHT_SPEED", 0.20),
            margin=_env_float("RANKING_WEIGHT_MARGIN", 0.20),
        )
    )
    min_buyer_score: float = field(default_factory=lambda: _env_float("MIN_BUYER_SCORE", 0.4))
    max_ranked_buyers: int = field(default_factory=lambda: _env_int("MAX_RANKED_BUYERS", 10))

    # Fraud Detection (Requirement 12.6)
    fraud_rto_count_threshold: int = field(
        default_factory=lambda: _env_int("FRAUD_RTO_COUNT_THRESHOLD", 5)
    )
    fraud_time_window_days: int = field(
        default_factory=lambda: _env_int("FRAUD_TIME_WINDOW_DAYS", 30)
    )

    # Courier Escalation (Requirement 9.2)
    courier_escalation_window_days: int = field(
        default_factory=lambda: _env_int("COURIER_ESCALATION_WINDOW_DAYS", 7)
    )
    courier_escalation_threshold: int = field(
        default_factory=lambda: _env_int("COURIER_ESCALATION_THRESHOLD", 3)
    )

    # Event Buffering (Requirement 11.3)
    event_buffer_capacity: int = field(
        default_factory=lambda: _env_int("EVENT_BUFFER_CAPACITY", 500000)
    )

    # Retry Policy (Requirement 11.4)
    retry_max_attempts: int = field(default_factory=lambda: _env_int("RETRY_MAX_ATTEMPTS", 3))
    retry_initial_delay_ms: int = field(
        default_factory=lambda: _env_int("RETRY_INITIAL_DELAY_MS", 1000)
    )

    # Evidence Collection (Requirements 2.1, 2.2)
    evidence_source_timeout_ms: int = field(
        default_factory=lambda: _env_int("EVIDENCE_SOURCE_TIMEOUT_MS", 5000)
    )
    min_evidence_sources: int = field(
        default_factory=lambda: _env_int("MIN_EVIDENCE_SOURCES", 3)
    )
    evidence_lookback_hours: int = field(
        default_factory=lambda: _env_int("EVIDENCE_LOOKBACK_HOURS", 72)
    )

    # Data Retention
    evidence_retention_days: int = field(
        default_factory=lambda: _env_int("EVIDENCE_RETENTION_DAYS", 90)
    )
    event_retention_days: int = field(
        default_factory=lambda: _env_int("EVENT_RETENTION_DAYS", 365)
    )
    audit_retention_years: int = field(
        default_factory=lambda: _env_int("AUDIT_RETENTION_YEARS", 7)
    )


# Singleton instance — import this from other modules
settings = Config()
