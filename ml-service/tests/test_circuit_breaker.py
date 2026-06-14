"""
Tests for the circuit breaker implementation.
"""

import asyncio
import time
from unittest.mock import AsyncMock

import pytest

from src.api.circuit_breaker import CircuitBreaker, CircuitBreakerError, CircuitState


@pytest.fixture
def breaker():
    """Create a circuit breaker with low thresholds for testing."""
    return CircuitBreaker(failure_threshold=3, cooldown_seconds=1.0, name="test")


class TestCircuitBreakerStates:
    """Test circuit breaker state transitions."""

    async def test_starts_closed(self, breaker):
        assert breaker.state == CircuitState.CLOSED

    async def test_stays_closed_on_success(self, breaker):
        func = AsyncMock(return_value="ok")
        result = await breaker.call(func)
        assert result == "ok"
        assert breaker.state == CircuitState.CLOSED
        assert breaker.consecutive_failures == 0

    async def test_increments_failures_on_error(self, breaker):
        func = AsyncMock(side_effect=RuntimeError("fail"))
        with pytest.raises(RuntimeError):
            await breaker.call(func)
        assert breaker.consecutive_failures == 1
        assert breaker.state == CircuitState.CLOSED

    async def test_trips_after_threshold_failures(self, breaker):
        func = AsyncMock(side_effect=RuntimeError("fail"))
        for _ in range(3):
            with pytest.raises(RuntimeError):
                await breaker.call(func)
        assert breaker.state == CircuitState.OPEN
        assert breaker.consecutive_failures == 3

    async def test_rejects_calls_when_open(self, breaker):
        func = AsyncMock(side_effect=RuntimeError("fail"))
        for _ in range(3):
            with pytest.raises(RuntimeError):
                await breaker.call(func)

        # Now should reject
        with pytest.raises(CircuitBreakerError):
            await breaker.call(func)

    async def test_transitions_to_half_open_after_cooldown(self, breaker):
        func = AsyncMock(side_effect=RuntimeError("fail"))
        for _ in range(3):
            with pytest.raises(RuntimeError):
                await breaker.call(func)

        assert breaker.state == CircuitState.OPEN

        # Wait for cooldown
        await asyncio.sleep(1.1)
        assert breaker.state == CircuitState.HALF_OPEN

    async def test_recovers_on_success_in_half_open(self, breaker):
        fail_func = AsyncMock(side_effect=RuntimeError("fail"))
        for _ in range(3):
            with pytest.raises(RuntimeError):
                await breaker.call(fail_func)

        # Wait for cooldown
        await asyncio.sleep(1.1)

        # Success should close the circuit
        success_func = AsyncMock(return_value="recovered")
        result = await breaker.call(success_func)
        assert result == "recovered"
        assert breaker.state == CircuitState.CLOSED
        assert breaker.consecutive_failures == 0

    async def test_resets_failures_on_success(self, breaker):
        fail_func = AsyncMock(side_effect=RuntimeError("fail"))
        # Two failures (below threshold)
        for _ in range(2):
            with pytest.raises(RuntimeError):
                await breaker.call(fail_func)
        assert breaker.consecutive_failures == 2

        # Success resets
        success_func = AsyncMock(return_value="ok")
        await breaker.call(success_func)
        assert breaker.consecutive_failures == 0

    async def test_manual_reset(self, breaker):
        func = AsyncMock(side_effect=RuntimeError("fail"))
        for _ in range(3):
            with pytest.raises(RuntimeError):
                await breaker.call(func)
        assert breaker.state == CircuitState.OPEN

        breaker.reset()
        assert breaker.state == CircuitState.CLOSED
        assert breaker.consecutive_failures == 0
