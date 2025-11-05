from fastapi import FastAPI, Depends, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from contextlib import asynccontextmanager

from .config import API_NAME, CORS_ORIGINS, CORS_ORIGIN_REGEX
from .db import get_session, engine
from .auth import verify_password, create_jwt, set_cookie, clear_cookie
from .routers import me as me_router
from .routers import stats as stats_router
from .routers import runs as runs_router
from .routers import admin as admin_router
from .routers import approvals as approvals_router
from .routers import prompts as prompts_router

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"🚀 Starting {API_NAME}")
    logger.info(f"🌐 CORS Origins configured: {CORS_ORIGINS}")
    try:
        # Test database connection
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("✅ Database connection successful")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        # Don't crash - let the app start anyway
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down application")
    await engine.dispose()

app = FastAPI(title=API_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"ok": True}

@app.get("/debug/cors")
async def debug_cors():
    """Debug endpoint to check CORS configuration"""
    import os
    return {
        "CORS_ORIGIN_env": os.getenv("CORS_ORIGIN", "NOT SET"),
        "CORS_ORIGIN_REGEX_env": os.getenv("CORS_ORIGIN_REGEX", "NOT SET"),
        "CORS_ORIGINS_config": CORS_ORIGINS,
        "CORS_ORIGIN_REGEX_config": CORS_ORIGIN_REGEX,
        "all_env_vars": {k: v for k, v in os.environ.items() if "CORS" in k or "DATABASE" in k or "JWT" in k}
    }

# --- Auth endpoints ---

from pydantic import BaseModel

class LoginIn(BaseModel):
    email: str
    password: str

@app.post("/auth/login")
async def login(body: LoginIn, resp: Response, db: AsyncSession = Depends(get_session)):
    row = (await db.execute(
        text("select id, org_id, role, password_hash from users where email=:e"),
        {"e": body.email}
    )).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # SQLAlchemy row tuple access
    user_id, org_id, role, password_hash = row
    if not verify_password(body.password, password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_jwt(str(user_id), str(org_id), role)
    set_cookie(resp, token)
    return {"ok": True}

@app.post("/auth/logout")
async def logout(resp: Response):
    clear_cookie(resp)
    return {"ok": True}

# Register routers
app.include_router(me_router.router)
app.include_router(stats_router.router)
app.include_router(runs_router.router)
app.include_router(admin_router.router)
app.include_router(approvals_router.router)
app.include_router(prompts_router.router)
