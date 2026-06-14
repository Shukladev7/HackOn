"""
Circuit Breaker pattern for external API calls (e.g., OpenAI).

Tracks consecutive failures and trips after N failures.
Once tripped, immediately rejects calls for a cooldown period.
After cooldown, allows a single probe call to determine recovery.

States:
- CLOSED: Normal operation, requests pass through
- OPEN: Circuit tripped, requests rejected immediately
- HALF_OPEN: Cooldown expired, one probe request allowed
"""

import asyncio
import logging
import time
from enum import Enum
from typing import Any, Callable, Coroutine, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerError(Exception):
    """Raised when the circuit breaker is open and rejecting calls."""

    def __init__(self, message: str = "Circuit breaker is open"):
        self.message = message
        super().__init__(self.message)


class CircuitBreaker:
    """Simple circuit breaker for protecting external API calls.

    Args:
        failure_threshold: Number of consecutive failures before tripping.
        cooldown_seconds: Time in seconds before allowing a probe after tripping.
        name: Human-readable name for logging.
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        cooldown_seconds: float = 30.0,
        name: str = "default",
    ):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.name = name

        self._state = CircuitState.CLOSED
        self._consecutive_failures = 0
        self._last_failure_time: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        """Current circuit breaker state."""
        if self._state == CircuitState.OPEN:
            # Check if cooldown has elapsed
            elapsed = time.time() - self._last_failure_time
            if elapsed >= self.cooldown_seconds:
                return CircuitState.HALF_OPEN
        return self._state

    @property
    def consecutive_failures(self) -> int:
        return self._consecutive_failures

    async def call(self, func: Callable[..., Coroutine[Any, Any, T]], *args, **kwargs) -> T:
        """Execute a function through the circuit breaker.

        Args:
            func: Async callable to execute.
            *args: Positional arguments for the callable.
            **kwargs: Keyword arguments for the callable.

        Returns:
            Result of the callable.

        Raises:
            CircuitBreakerError: If the circuit is open and not yet in cooldown.
        """
        async with self._lock:
            current_state = self.state

            if current_state == CircuitState.OPEN:
                logger.warning(
                    "Circuit breaker '%s' is OPEN. Rejecting call.",
                    self.name,
                )
                raise CircuitBreakerError(
                    f"Circuit breaker '{self.name}' is open. "
                    f"Consecutive failures: {self._consecutive_failures}. "
                    f"Cooldown remaining: {self.cooldown_seconds - (time.time() - self._last_failure_time):.1f}s"
                )

            if current_state == CircuitState.HALF_OPEN:
                logger.info(
                    "Circuit breaker '%s' is HALF_OPEN. Allowing probe call.",
                    self.name,
                )

        # Execute the call outside the lock
        try:
            result = await func(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as e:
            await self._on_failure()
            raise

    async def _on_success(self) -> None:
        """Handle a successful call: reset failure count and close circuit."""
        async with self._lock:
            self._consecutive_failures = 0
            if self._state != CircuitState.CLOSED:
                logger.info(
                    "Circuit breaker '%s' recovered. State: CLOSED.",
                    self.name,
                )
            self._state = CircuitState.CLOSED

    async def _on_failure(self) -> None:
        """Handle a failed call: increment failures and potentially trip."""
        async with self._lock:
            self._consecutive_failures += 1
            self._last_failure_time = time.time()

            if self._consecutive_failures >= self.failure_threshold:
                self._state = CircuitState.OPEN
                logger.error(
                    "Circuit breaker '%s' TRIPPED. Consecutive failures: %d. "
                    "Will cooldown for %ds.",
                    self.name,
                    self._consecutive_failures,
                    self.cooldown_seconds,
                )
            else:
                logger.warning(
                    "Circuit breaker '%s' failure %d/%d.",
                    self.name,
                    self._consecutive_failures,
                    self.failure_threshold,
                )

    def reset(self) -> None:
        """Manually reset the circuit breaker to closed state."""
        self._state = CircuitState.CLOSED
        self._consecutive_failures = 0
        self._last_failure_time = 0.0
