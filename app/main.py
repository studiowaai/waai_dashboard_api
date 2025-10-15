from fastapi import FastAPI, Depends, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import API_NAME, CORS_ORIGINS
from .db import get_session
from .auth import verify_password, create_jwt, set_cookie, clear_cookie
from .routers import me as me_router
from .routers import stats as stats_router
from .routers import runs as runs_router
from .routers import admin as admin_router

app = FastAPI(title=API_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"ok": True}

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
