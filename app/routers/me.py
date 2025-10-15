from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/me", tags=["me"])

@router.get("")
async def get_me(user: Authed = Depends(authed), db: AsyncSession = Depends(get_session)):
    q = text("""
        select u.email, u.role, o.id as org_id, o.name as org_name
        from users u
        join organizations o on o.id = u.org_id
        where u.id = :uid
    """)
    row = (await db.execute(q, {"uid": user.user_id})).mappings().first()
    # If user was deleted but cookie exists, row may be None
    if not row:
        return {"user": {"id": user.user_id, "email": None, "role": user.role},
                "org": {"id": user.org_id, "name": None}}
    return {
        "user": {"id": user.user_id, "email": row["email"], "role": row["role"]},
        "org": {"id": str(row["org_id"]), "name": row["org_name"]},
    }
