"""Tests for the FastAPI application factory configuration."""

import pytest
from fastapi.middleware.cors import CORSMiddleware

from src.app import create_app


@pytest.mark.unit
class TestAppFactory:
    """Verify application factory creates properly configured app."""

    def test_create_app_returns_fastapi_instance(self):
        """Application factory returns a configured FastAPI instance."""
        app = create_app()
        assert app.title == "RTO Reallocation ML Service"
        assert app.version == "1.0.0"

    def test_cors_middleware_configured(self):
        """CORS middleware is added to the application."""
        app = create_app()
        cors_middlewares = [
            m for m in app.user_middleware if m.cls is CORSMiddleware
        ]
        assert len(cors_middlewares) == 1

    def test_ml_routes_registered_under_prefix(self):
        """ML API routes are registered under /ml/v1 prefix."""
        app = create_app()
        routes = [route.path for route in app.routes]
        assert "/ml/v1/health" in routes
        assert "/ml/v1/models/status" in routes

    def test_root_health_endpoint_registered(self):
        """Root health endpoint is registered at /health."""
        app = create_app()
        routes = [route.path for route in app.routes]
        assert "/health" in routes
