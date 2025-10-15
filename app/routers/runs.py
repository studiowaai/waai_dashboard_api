from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/runs", tags=["runs"])

@router.get("/recent")
async def recent(limit: int = Query(10, ge=1, le=100),
                 user: Authed = Depends(authed),
                 db: AsyncSession = Depends(get_session)):
    q = text("""
        select wr.id, w.name, wr.started_at, wr.ended_at, wr.status,
               extract(epoch from (wr.ended_at - wr.started_at))*1000 as duration_ms
        from workflow_runs wr
        join workflows w on w.id = wr.workflow_id
        where wr.org_id = :org
        order by wr.started_at desc
        limit :lim
    """)
    rows = (await db.execute(q, {"org": user.org_id, "lim": limit})).mappings().all()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "name": r["name"],
            "startedAt": r["started_at"].isoformat(),
            "durationMs": int(r["duration_ms"]) if r["duration_ms"] is not None else None,
            "status": r["status"],
        })
    return out
