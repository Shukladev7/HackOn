"""
FastAPI application factory for the RTO Reallocation ML Service.

Configures CORS, routes, and health endpoints.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router as api_router
from src.config import settings


def create_app() -> FastAPI:
    """Application factory for the RTO Reallocation ML Service.

    Creates a configured FastAPI application with:
    - CORS middleware (allows all origins for development)
    - ML API routes under /ml/v1 prefix
    - Root health endpoint for container orchestration
    """
    app = FastAPI(
        title="RTO Reallocation ML Service",
        description="AI-powered root cause classification and sale recovery prediction",
        version="1.0.0",
    )

    _configure_cors(app)
    _register_routes(app)

    return app


def _configure_cors(app: FastAPI) -> None:
    """Configure CORS middleware for cross-origin requests from the frontend."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _register_routes(app: FastAPI) -> None:
    """Register all API routers."""
    app.include_router(api_router, prefix="/ml/v1")

    @app.get("/health")
    async def root_health():
        """Root-level health check for container orchestration and load balancers."""
        return {
            "status": "healthy",
            "service": "rto-reallocation-ml-service",
            "version": "1.0.0",
            "environment": settings.environment,
        }
