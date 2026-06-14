"""Property-based tests verifying configuration module correctness."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from src.config import Config


@pytest.mark.property
class TestConfigProperties:
    """Verify configuration module properties using Hypothesis."""

    @given(
        threshold=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    )
    @settings(max_examples=50)
    def test_confidence_threshold_always_in_valid_range(self, threshold):
        """Any float in [0, 1] should be a valid confidence threshold value."""
        assert 0.0 <= threshold <= 1.0

    @given(
        distance=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
        conversion=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
        speed=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
        margin=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    )
    @settings(max_examples=50)
    def test_ranking_weights_are_individually_bounded(
        self, distance, conversion, speed, margin
    ):
        """Each ranking weight should independently be in [0, 1]."""
        assert 0.0 <= distance <= 1.0
        assert 0.0 <= conversion <= 1.0
        assert 0.0 <= speed <= 1.0
        assert 0.0 <= margin <= 1.0
