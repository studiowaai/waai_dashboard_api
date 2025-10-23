from fastapi import APIRouter, Depends, Query, HTTPException
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


@router.get("/{run_id}")
async def get_run_details(
    run_id: int,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """Get detailed information about a specific workflow run"""
    q = text("""
        SELECT 
            wr.id,
            wr.workflow_id,
            w.name as workflow_name,
            wr.started_at,
            wr.ended_at,
            wr.status,
            wr.duration_ms,
            wr.error_message,
            wr.external_run_id,
            wr.payload
        FROM workflow_runs wr
        JOIN workflows w ON w.id = wr.workflow_id
        WHERE wr.id = :run_id AND wr.org_id = :org_id
        LIMIT 1
    """)
    
    row = (await db.execute(q, {"run_id": run_id, "org_id": user.org_id})).mappings().first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    
    return {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "workflowName": row["workflow_name"],
        "startedAt": row["started_at"].isoformat(),
        "endedAt": row["ended_at"].isoformat() if row["ended_at"] else None,
        "status": row["status"],
        "durationMs": row["duration_ms"],
        "errorMessage": row["error_message"],
        "externalRunId": row["external_run_id"],
        "metadata": row["payload"] or {}
    }
