from datetime import datetime, timedelta, timezone
import bcrypt, jwt
from fastapi import Response
from .config import JWT_SECRET, JWT_EXPIRE_MIN, CORS_ORIGINS

COOKIE_NAME = "session"

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_jwt(user_id: str, org_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MIN)
    payload = {"sub": user_id, "org": org_id, "role": role, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def set_cookie(resp: Response, token: str):
    # Check if any of the CORS origins contains localhost
    has_localhost = any("localhost" in origin or "127.0.0.1" in origin for origin in CORS_ORIGINS)
    
    # For production cross-subdomain, use domain=".apps.studiowaai.nl"
    # For localhost, no domain restriction
    cookie_domain = None if has_localhost else ".apps.studiowaai.nl"
    
    resp.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,              # Always True (works with https API)
        samesite="none",          # Always "none" for cross-origin requests
        domain=cookie_domain,     # ".apps.studiowaai.nl" in prod, None for localhost
        path="/",
    )

def clear_cookie(resp: Response):
    resp.delete_cookie(COOKIE_NAME, path="/")
