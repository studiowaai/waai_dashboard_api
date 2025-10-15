from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("/overview")
async def overview(range: str = Query("7d"), user: Authed = Depends(authed), db: AsyncSession = Depends(get_session)):
    days = 30 if range == "30d" else 7
    since = datetime.now(timezone.utc) - timedelta(days=days)
    params = {"org": user.org_id, "since": since}

    total_workflows = await db.scalar(text("select count(*) from workflows where org_id=:org and active"), params)
    total_exec = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and started_at >= :since
    """), params)
    successful = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and status='success' and started_at >= :since
    """), params)
    failed = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and status='failed' and started_at >= :since
    """), params)

    # (Optional) quick-and-dirty previous period deltas
    prev_params = {"org": user.org_id, "since": since - timedelta(days=days), "until": since}
    prev_exec = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and started_at >= :since and started_at < :until
    """), prev_params)
    prev_succ = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and status='success' and started_at >= :since and started_at < :until
    """), prev_params)
    prev_fail = await db.scalar(text("""
        select count(*) from workflow_runs where org_id=:org and status='failed' and started_at >= :since and started_at < :until
    """), prev_params)

    def pct(cur, prev):
        prev = prev or 0
        base = prev if prev > 0 else 1
        return round(((cur or 0) - prev) / base * 100, 1)

    return {
        "totalWorkflows": int(total_workflows or 0),
        "totalExecutions": int(total_exec or 0),
        "successful": int(successful or 0),
        "failed": int(failed or 0),
        "trends": {
            "workflowsPct": 0,  # left 0 (workflows total rarely changes per period)
            "executionsPct": pct(total_exec, prev_exec),
            "successPct": pct(successful, prev_succ),
            "failedPct": pct(failed, prev_fail),
        }
    }

@router.get("/trends")
async def trends(range: str = Query("7d"), user: Authed = Depends(authed), db: AsyncSession = Depends(get_session)):
    days = 30 if range == "30d" else 7
    q = text("""
        select date_trunc('day', started_at)::date as day,
               count(*) filter (where status='success') as success,
               count(*) filter (where status='failed')  as failed
        from workflow_runs
        where org_id = :org and started_at >= now() - (:days || ' days')::interval
        group by 1
        order by 1
    """)
    rows = (await db.execute(q, {"org": user.org_id, "days": str(days)})).mappings().all()
    return [{"date": str(r["day"]), "success": int(r["success"]), "failed": int(r["failed"])} for r in rows]
