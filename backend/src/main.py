# backend/src/main.py
"""
Chase Multi-Strategy Portfolio — FastAPI backend entry point.

Start with:
    cd chase-dashboard/backend
    python -m uvicorn src.main:app --reload --port 8000
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from src.routers import portfolio, reports, management

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

load_dotenv()

DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data"
)

# Origins that are allowed to call the API
# In production, replace "*" with your Netlify domain
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title       = "Chase Multi-Strategy Portfolio API",
    description = "Data API for the institutional reporting dashboard.",
    version     = "1.0.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)

# CORS — allows the React frontend (any origin in dev, specific in prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins     = CORS_ORIGINS,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ---------------------------------------------------------------------------
# Startup — generate demo data if needed
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    print(f"[main] Supabase backend active. DATA_DIR: {os.path.abspath(DATA_DIR)}")


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(portfolio.router)
app.include_router(reports.router)
app.include_router(management.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}