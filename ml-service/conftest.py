"""
Root conftest for the RTO Reallocation ML Service test suite.

Provides shared fixtures for FastAPI app testing.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from src.app import create_app


@pytest.fixture
def app():
    """Create a fresh app instance for testing."""
    return create_app()


@pytest.fixture
async def client(app):
    """Async HTTP client for testing FastAPI endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
