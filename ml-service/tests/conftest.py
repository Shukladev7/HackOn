"""
Shared test configuration and fixtures for the ML service test suite.

Configures Hypothesis profiles:
- default: 100 examples, 5s deadline (development)
- ci: 200 examples, 10s deadline (CI pipeline)
- thorough: 500 examples, no deadline (pre-release)
"""

from hypothesis import HealthCheck, settings

# Default profile for local development
settings.register_profile(
    "default",
    max_examples=100,
    deadline=5000,
    suppress_health_check=[HealthCheck.too_slow],
)

# CI profile: more examples, generous deadline
settings.register_profile(
    "ci",
    max_examples=200,
    deadline=10000,
    suppress_health_check=[HealthCheck.too_slow],
)

# Thorough profile: many examples, no deadline (for pre-release validation)
settings.register_profile(
    "thorough",
    max_examples=500,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)

settings.load_profile("default")
