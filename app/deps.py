from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from .db import get_session
from .config import JWT_SECRET
from .auth import COOKIE_NAME

class Authed:
    def __init__(self, user_id: str, org_id: str, role: str):
        self.user_id = user_id
        self.org_id = org_id
        self.role = role

async def authed(req: Request, db: AsyncSession = Depends(get_session)) -> Authed:
    token = req.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No session")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return Authed(payload["sub"], payload["org"], payload.get("role", "viewer"))
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
