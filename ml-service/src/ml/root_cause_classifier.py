"""
Root Cause Classifier for the RTO Reallocation Engine.

Uses OpenAI API to classify delivery failure root causes into
customer/courier/system categories with independent confidence scores.

Requirements:
- 3.1: Produce customer/courier/system scores each in [0.0, 1.0], independent, within 10 seconds
- 3.2: Assign primary category based on highest score above threshold; tie-breaking: Courier > System > Customer
- 3.3: Route to manual review if no score exceeds threshold
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from src.config import settings

logger = logging.getLogger(__name__)


class RootCauseCategory(Enum):
    CUSTOMER_ISSUE = "customer_issue"
    COURIER_ISSUE = "courier_issue"
    SYSTEM_ISSUE = "system_issue"


class CustomerSubCause(Enum):
    UNAVAILABLE = "customer_unavailable"
    WRONG_ADDRESS = "wrong_address"
    REFUSED_DELIVERY = "refused_delivery"
    CANCELLATION = "cancellation"
    NOT_INTERESTED = "not_interested"


class CourierSubCause(Enum):
    FAKE_ATTEMPT = "fake_delivery_attempt"
    NO_CONTACT = "courier_never_contacted"
    GPS_ANOMALY = "gps_anomaly"
    ROUTE_DEVIATION = "route_deviation"
    INCORRECT_STATUS = "incorrect_status_update"
    FAILED_DESPITE_AVAILABLE = "failed_despite_availability"


class SystemSubCause(Enum):
    ADDRESS_MAPPING = "address_mapping_error"
    ROUTING_ENGINE = "routing_engine_issue"
    ORDER_SYNC = "order_synchronization_failure"
    WRONG_LOGISTICS = "wrong_logistics_assignment"
    PLATFORM_BUG = "platform_bug"


@dataclass
class ClassificationResult:
    """Result of root cause classification."""

    customer_score: float  # 0.0 to 1.0
    courier_score: float  # 0.0 to 1.0
    system_score: float  # 0.0 to 1.0
    primary_category: Optional[RootCauseCategory]
    sub_cause: Optional[str]
    sub_cause_confidence: float
    confidence_threshold: float
    requires_manual_review: bool
    classification_timestamp: str


class RootCauseClassifier:
    """AI-powered root cause classifier using OpenAI API.

    Analyzes normalized evidence to determine the primary cause of delivery failure.
    Produces independent scores for customer, courier, and system categories.

    Priority order for tie-breaking: Courier > System > Customer
    """

    # Priority order for tie-breaking (highest priority first)
    _PRIORITY_ORDER = [
        RootCauseCategory.COURIER_ISSUE,
        RootCauseCategory.SYSTEM_ISSUE,
        RootCauseCategory.CUSTOMER_ISSUE,
    ]

    _CATEGORY_SCORE_KEYS = {
        RootCauseCategory.CUSTOMER_ISSUE: "customer_score",
        RootCauseCategory.COURIER_ISSUE: "courier_score",
        RootCauseCategory.SYSTEM_ISSUE: "system_score",
    }

    # Mapping from primary category to valid sub-cause enums
    _CATEGORY_SUB_CAUSES = {
        RootCauseCategory.CUSTOMER_ISSUE: CustomerSubCause,
        RootCauseCategory.COURIER_ISSUE: CourierSubCause,
        RootCauseCategory.SYSTEM_ISSUE: SystemSubCause,
    }

    def __init__(
        self,
        confidence_threshold: float = None,
        sub_cause_threshold: float = None,
        openai_client=None,
        timeout_seconds: float = 10.0,
    ):
        """Initialize the classifier.

        Args:
            confidence_threshold: Minimum score to assign a primary category.
                                  Defaults to config value (0.6).
            sub_cause_threshold: Minimum confidence to assign a sub-cause.
                                 Defaults to config value (0.5).
            openai_client: Optional OpenAI async client (for dependency injection/testing).
            timeout_seconds: Maximum time for classification (default: 10s).
        """
        self.confidence_threshold = (
            confidence_threshold
            if confidence_threshold is not None
            else settings.confidence_threshold
        )
        self.sub_cause_threshold = (
            sub_cause_threshold
            if sub_cause_threshold is not None
            else settings.sub_cause_confidence_threshold
        )
        self.timeout_seconds = timeout_seconds
        self._client = openai_client

    @property
    def client(self):
        """Lazy-load OpenAI client to avoid import issues in tests."""
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        return self._client

    async def classify(self, evidence: dict) -> ClassificationResult:
        """Analyze normalized evidence to produce root cause classification.

        Builds a structured prompt from the evidence, sends to OpenAI API,
        and parses the response to extract scores and sub-cause.

        Must complete within configured timeout (default: 10 seconds).

        Args:
            evidence: Normalized evidence dictionary containing delivery failure data.

        Returns:
            ClassificationResult with scores, primary category, and sub-cause.
        """
        try:
            result = await asyncio.wait_for(
                self._classify_impl(evidence),
                timeout=self.timeout_seconds,
            )
            return result
        except asyncio.TimeoutError:
            logger.warning("Classification timed out after %s seconds", self.timeout_seconds)
            # Return manual review result on timeout
            return ClassificationResult(
                customer_score=0.0,
                courier_score=0.0,
                system_score=0.0,
                primary_category=None,
                sub_cause=None,
                sub_cause_confidence=0.0,
                confidence_threshold=self.confidence_threshold,
                requires_manual_review=True,
                classification_timestamp=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as e:
            logger.error("Classification failed: %s", str(e))
            # Return manual review result on error
            return ClassificationResult(
                customer_score=0.0,
                courier_score=0.0,
                system_score=0.0,
                primary_category=None,
                sub_cause=None,
                sub_cause_confidence=0.0,
                confidence_threshold=self.confidence_threshold,
                requires_manual_review=True,
                classification_timestamp=datetime.now(timezone.utc).isoformat(),
            )

    async def _classify_impl(self, evidence: dict) -> ClassificationResult:
        """Internal classification implementation."""
        prompt = self._build_classification_prompt(evidence)

        response = await self.client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert logistics analyst specializing in delivery failure root cause analysis. "
                        "Analyze the provided evidence and classify the root cause. "
                        "Respond ONLY with valid JSON matching the specified schema."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        raw_content = response.choices[0].message.content
        parsed = json.loads(raw_content)

        # Extract and clamp scores to [0.0, 1.0]
        scores = {
            "customer_score": self._clamp_score(parsed.get("customer_score", 0.0)),
            "courier_score": self._clamp_score(parsed.get("courier_score", 0.0)),
            "system_score": self._clamp_score(parsed.get("system_score", 0.0)),
        }

        # Determine primary category
        primary_category = self._determine_primary_category(scores)

        # Extract sub-cause
        sub_cause = parsed.get("sub_cause")
        sub_cause_confidence = self._clamp_score(parsed.get("sub_cause_confidence", 0.0))

        # If sub-cause confidence is below threshold, set to "unspecified"
        if sub_cause_confidence < self.sub_cause_threshold:
            sub_cause = "unspecified"
        else:
            # Validate sub-cause against the valid enum values for the primary category
            sub_cause = self._validate_sub_cause(sub_cause, primary_category)

        # Determine if manual review is needed
        requires_manual_review = primary_category is None

        return ClassificationResult(
            customer_score=scores["customer_score"],
            courier_score=scores["courier_score"],
            system_score=scores["system_score"],
            primary_category=primary_category,
            sub_cause=sub_cause,
            sub_cause_confidence=sub_cause_confidence,
            confidence_threshold=self.confidence_threshold,
            requires_manual_review=requires_manual_review,
            classification_timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _build_classification_prompt(self, evidence: dict) -> str:
        """Construct the LLM prompt with structured evidence.

        Formats the normalized evidence into a structured prompt that
        guides the model to produce consistent classification output.

        Args:
            evidence: Normalized evidence dictionary.

        Returns:
            Formatted prompt string for the OpenAI API.
        """
        # Extract key evidence sections
        delivery_attempt = evidence.get("delivery_attempt", {})
        gps_data = evidence.get("gps_data", {})
        call_logs = evidence.get("call_logs", [])
        delivery_scans = evidence.get("delivery_scans", [])
        order_history = evidence.get("order_history", {})
        support_tickets = evidence.get("support_tickets", [])
        address_validation = evidence.get("address_validation", {})
        hub_events = evidence.get("hub_events", [])
        completeness = evidence.get("completeness", {})

        prompt = f"""Analyze the following delivery failure evidence and classify the root cause.

## Evidence

### Delivery Attempt
{json.dumps(delivery_attempt, indent=2, default=str)}

### GPS Data
{json.dumps(gps_data, indent=2, default=str)}

### Call Logs
{json.dumps(call_logs, indent=2, default=str)}

### Delivery Scans
{json.dumps(delivery_scans, indent=2, default=str)}

### Order History
{json.dumps(order_history, indent=2, default=str)}

### Support Tickets
{json.dumps(support_tickets, indent=2, default=str)}

### Address Validation
{json.dumps(address_validation, indent=2, default=str)}

### Hub Events
{json.dumps(hub_events, indent=2, default=str)}

### Evidence Completeness
{json.dumps(completeness, indent=2, default=str)}

## Classification Instructions

Produce INDEPENDENT scores (each 0.0-1.0, they do NOT need to sum to 1.0) for each category:
- customer_score: Likelihood the failure was caused by the customer (unavailable, wrong address, refused delivery, cancellation, not interested)
- courier_score: Likelihood the failure was caused by the courier (fake attempt, no contact, GPS anomaly, route deviation, incorrect status, failed despite availability)
- system_score: Likelihood the failure was caused by a system issue (address mapping error, routing engine issue, order sync failure, wrong logistics assignment, platform bug)

Also identify the most likely sub-cause and your confidence in that sub-cause.

Valid sub-causes per category:
- Customer: customer_unavailable, wrong_address, refused_delivery, cancellation, not_interested
- Courier: fake_delivery_attempt, courier_never_contacted, gps_anomaly, route_deviation, incorrect_status_update, failed_despite_availability
- System: address_mapping_error, routing_engine_issue, order_synchronization_failure, wrong_logistics_assignment, platform_bug

## Response Format (JSON)

{{
  "customer_score": <float 0.0-1.0>,
  "courier_score": <float 0.0-1.0>,
  "system_score": <float 0.0-1.0>,
  "sub_cause": "<one of the valid sub-causes above or null>",
  "sub_cause_confidence": <float 0.0-1.0>
}}"""

        return prompt

    def _determine_primary_category(self, scores: dict) -> Optional[RootCauseCategory]:
        """Select primary category based on threshold and priority rules.

        Rules:
        1. Only scores above the confidence threshold are considered.
        2. The category with the highest score is selected.
        3. In case of ties, priority order applies: Courier > System > Customer.
        4. If no score exceeds the threshold, returns None (triggers manual review).

        Args:
            scores: Dictionary with 'customer_score', 'courier_score', 'system_score'.

        Returns:
            The primary RootCauseCategory or None if manual review is needed.
        """
        # Filter scores above threshold
        above_threshold = {}
        for category in self._PRIORITY_ORDER:
            score_key = self._CATEGORY_SCORE_KEYS[category]
            score = scores.get(score_key, 0.0)
            if score > self.confidence_threshold:
                above_threshold[category] = score

        if not above_threshold:
            return None

        # Find the maximum score among those above threshold
        max_score = max(above_threshold.values())

        # Among categories with the max score, pick by priority order
        for category in self._PRIORITY_ORDER:
            if category in above_threshold and above_threshold[category] == max_score:
                return category

        return None

    def _validate_sub_cause(
        self, sub_cause: Optional[str], primary_category: Optional[RootCauseCategory]
    ) -> str:
        """Validate a sub-cause against the valid enum values for the given category.

        If the primary category is None (manual review) or the sub_cause doesn't match
        any valid enum value for the category, returns "unspecified".

        Args:
            sub_cause: The raw sub-cause string from the LLM response.
            primary_category: The determined primary root cause category.

        Returns:
            The validated sub-cause string, or "unspecified" if invalid.
        """
        if primary_category is None:
            return "unspecified"

        if sub_cause is None:
            return "unspecified"

        # Get the enum class for this category
        sub_cause_enum = self._CATEGORY_SUB_CAUSES.get(primary_category)
        if sub_cause_enum is None:
            return "unspecified"

        # Check if the sub_cause matches any valid enum value
        valid_values = {member.value for member in sub_cause_enum}
        if sub_cause in valid_values:
            return sub_cause

        return "unspecified"

    @staticmethod
    def _clamp_score(value) -> float:
        """Clamp a value to [0.0, 1.0] range.

        Args:
            value: Numeric value to clamp.

        Returns:
            Float clamped to [0.0, 1.0].
        """
        try:
            v = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, min(1.0, v))
