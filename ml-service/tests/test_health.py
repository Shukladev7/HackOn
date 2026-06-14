"""Tests for health and status endpoints."""

import pytest


@pytest.mark.unit
class TestHealthEndpoints:
    """Test health check and model status endpoints."""

    async def test_root_health_check(self, client):
        """Root health endpoint returns healthy status with version info."""
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "rto-reallocation-ml-service"
        assert data["version"] == "1.0.0"
        assert "environment" in data

    async def test_ml_health_check_returns_healthy(self, client):
        """ML API health endpoint returns healthy status."""
        response = await client.get("/ml/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "rto-reallocation-ml-service"

    async def test_models_status_returns_ready(self, client):
        """Models status endpoint reports all models as ready."""
        response = await client.get("/ml/v1/models/status")
        assert response.status_code == 200
        data = response.json()
        assert "root_cause_classifier" in data
        assert data["root_cause_classifier"]["status"] == "ready"
        assert "sale_recovery_predictor" in data
        assert data["sale_recovery_predictor"]["status"] == "ready"
