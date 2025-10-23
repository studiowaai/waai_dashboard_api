from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import httpx
import logging

from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/approvals", tags=["approvals"])
logger = logging.getLogger(__name__)

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class ApprovalListItem(BaseModel):
    id: str
    type: str
    status: str
    title: str
    created_at: datetime
    preview: Dict[str, Any]

class ApprovalAsset(BaseModel):
    id: str
    role: str
    url: str  # Presigned or external URL
    filename: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None

class ApprovalDetail(BaseModel):
    id: str
    type: str
    status: str
    title: str
    preview: Dict[str, Any]
    data: Dict[str, Any]
    assets: List[ApprovalAsset]
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime] = None
    approved_by_user_id: Optional[str] = None
    n8n_execute_webhook_url: Optional[str] = None

class ApprovalActionResponse(BaseModel):
    ok: bool
    message: str
    approval_id: str
    status: str

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

async def log_approval_event(
    db: AsyncSession,
    approval_id: str,
    event: str,
    user_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """Log an approval event to approval_events table"""
    import json
    query = text("""
        INSERT INTO approval_events (approval_id, event, by_user_id, metadata)
        VALUES (:approval_id, :event, :user_id, :metadata)
    """)
    await db.execute(query, {
        "approval_id": approval_id,
        "event": event,
        "user_id": user_id,
        "metadata": json.dumps(metadata or {})
    })

# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/", response_model=List[ApprovalListItem])
async def list_approvals(
    status: Optional[str] = Query(None, description="Filter by status: pending, approved, rejected, sent, failed"),
    type: Optional[str] = Query(None, description="Filter by type: order, linkedin_post, gmail_reply"),
    limit: int = Query(50, ge=1, le=200),
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    List approvals for the user's organization.
    Supports filtering by status and type.
    """
    # Build dynamic query
    where_clauses = ["org_id = :org_id"]
    params = {"org_id": user.org_id, "limit": limit}
    
    if status:
        where_clauses.append("status = :status")
        params["status"] = status
    
    if type:
        where_clauses.append("type = :type")
        params["type"] = type
    
    where_sql = " AND ".join(where_clauses)
    
    query = text(f"""
        SELECT id, type, status, title, preview, created_at
        FROM approvals
        WHERE {where_sql}
        ORDER BY created_at DESC
        LIMIT :limit
    """)
    
    rows = (await db.execute(query, params)).mappings().all()
    
    return [
        ApprovalListItem(
            id=str(row["id"]),
            type=row["type"],
            status=row["status"],
            title=row["title"],
            preview=row["preview"] or {},
            created_at=row["created_at"]
        )
        for row in rows
    ]


@router.get("/{approval_id}", response_model=ApprovalDetail)
async def get_approval_detail(
    approval_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Get detailed information about a specific approval including all assets.
    Logs a 'viewed' event.
    """
    # Fetch approval
    approval_query = text("""
        SELECT id, org_id, type, status, title, preview, data,
               n8n_execute_webhook_url, created_at, updated_at,
               approved_at, approved_by_user_id
        FROM approvals
        WHERE id = :approval_id AND org_id = :org_id
    """)
    
    approval_row = (await db.execute(
        approval_query,
        {"approval_id": approval_id, "org_id": user.org_id}
    )).mappings().first()
    
    if not approval_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found"
        )
    
    # Fetch assets
    assets_query = text("""
        SELECT id, role, external_url, filename, mime_type, size_bytes
        FROM approval_assets
        WHERE approval_id = :approval_id
        ORDER BY created_at
    """)
    
    assets_rows = (await db.execute(
        assets_query,
        {"approval_id": approval_id}
    )).mappings().all()
    
    assets = [
        ApprovalAsset(
            id=str(row["id"]),
            role=row["role"],
            url=row["external_url"],
            filename=row["filename"],
            mime_type=row["mime_type"],
            size_bytes=row["size_bytes"]
        )
        for row in assets_rows
    ]
    
    # Log 'viewed' event
    await log_approval_event(
        db,
        approval_id=approval_id,
        event="viewed",
        user_id=user.user_id
    )
    await db.commit()
    
    return ApprovalDetail(
        id=str(approval_row["id"]),
        type=approval_row["type"],
        status=approval_row["status"],
        title=approval_row["title"],
        preview=approval_row["preview"] or {},
        data=approval_row["data"] or {},
        assets=assets,
        created_at=approval_row["created_at"],
        updated_at=approval_row["updated_at"],
        approved_at=approval_row["approved_at"],
        approved_by_user_id=str(approval_row["approved_by_user_id"]) if approval_row["approved_by_user_id"] else None,
        n8n_execute_webhook_url=approval_row["n8n_execute_webhook_url"]
    )


@router.post("/{approval_id}/approve", response_model=ApprovalActionResponse)
async def approve_approval(
    approval_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Approve an item and trigger n8n execution.
    
    Flow:
    1. Lock row (SELECT FOR UPDATE WHERE status='pending')
    2. Update status='approved', set approved_by_user_id, approved_at
    3. Log 'approved' event
    4. Call n8n webhook with data payload
    5. On success: update status='sent', log 'sent' event
    6. On failure: update status='failed', log 'failed' event
    
    Idempotent: cannot approve twice (must be pending)
    """
    
    # Step 1: Lock and fetch approval (idempotent check)
    lock_query = text("""
        SELECT id, org_id, status, data, n8n_execute_webhook_url, title
        FROM approvals
        WHERE id = :approval_id AND org_id = :org_id
        FOR UPDATE
    """)
    
    approval_row = (await db.execute(
        lock_query,
        {"approval_id": approval_id, "org_id": user.org_id}
    )).mappings().first()
    
    if not approval_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found"
        )
    
    if approval_row["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve: approval is already '{approval_row['status']}'"
        )
    
    # Step 2: Update to 'approved' status
    update_query = text("""
        UPDATE approvals
        SET status = 'approved',
            approved_by_user_id = :user_id,
            approved_at = NOW()
        WHERE id = :approval_id
    """)
    
    await db.execute(update_query, {
        "approval_id": approval_id,
        "user_id": user.user_id
    })
    
    # Step 3: Log 'approved' event
    await log_approval_event(
        db,
        approval_id=approval_id,
        event="approved",
        user_id=user.user_id
    )
    
    await db.commit()
    
    # Step 4: Call n8n webhook (if URL provided)
    webhook_url = approval_row["n8n_execute_webhook_url"]
    final_status = "approved"
    error_message = None
    
    if webhook_url:
        try:
            logger.info(f"Calling n8n webhook for approval {approval_id}: {webhook_url}")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    webhook_url,
                    json=approval_row["data"] or {},
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    logger.info(f"Webhook success for approval {approval_id}")
                    final_status = "sent"
                    
                    # Update to 'sent' status
                    await db.execute(
                        text("UPDATE approvals SET status = 'sent' WHERE id = :id"),
                        {"id": approval_id}
                    )
                    
                    # Log 'sent' event
                    await log_approval_event(
                        db,
                        approval_id=approval_id,
                        event="sent",
                        user_id=user.user_id,
                        metadata={"webhook_status": response.status_code}
                    )
                else:
                    logger.error(f"Webhook failed for approval {approval_id}: {response.status_code}")
                    final_status = "failed"
                    error_message = f"Webhook returned status {response.status_code}"
                    
                    # Update to 'failed' status
                    await db.execute(
                        text("UPDATE approvals SET status = 'failed' WHERE id = :id"),
                        {"id": approval_id}
                    )
                    
                    # Log 'failed' event
                    await log_approval_event(
                        db,
                        approval_id=approval_id,
                        event="failed",
                        user_id=user.user_id,
                        metadata={
                            "error": error_message,
                            "webhook_status": response.status_code
                        }
                    )
                    
        except Exception as e:
            logger.error(f"Webhook exception for approval {approval_id}: {str(e)}")
            final_status = "failed"
            error_message = str(e)
            
            # Update to 'failed' status
            await db.execute(
                text("UPDATE approvals SET status = 'failed' WHERE id = :id"),
                {"id": approval_id}
            )
            
            # Log 'failed' event
            await log_approval_event(
                db,
                approval_id=approval_id,
                event="failed",
                user_id=user.user_id,
                metadata={"error": error_message}
            )
        
        await db.commit()
    
    return ApprovalActionResponse(
        ok=True,
        message=f"Approval {final_status}" + (f": {error_message}" if error_message else ""),
        approval_id=approval_id,
        status=final_status
    )


@router.post("/{approval_id}/reject", response_model=ApprovalActionResponse)
async def reject_approval(
    approval_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Reject an approval. No webhook is called.
    
    Idempotent: cannot reject if not pending.
    """
    
    # Lock and fetch approval
    lock_query = text("""
        SELECT id, org_id, status, title
        FROM approvals
        WHERE id = :approval_id AND org_id = :org_id
        FOR UPDATE
    """)
    
    approval_row = (await db.execute(
        lock_query,
        {"approval_id": approval_id, "org_id": user.org_id}
    )).mappings().first()
    
    if not approval_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found"
        )
    
    if approval_row["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject: approval is already '{approval_row['status']}'"
        )
    
    # Update to 'rejected' status
    update_query = text("""
        UPDATE approvals
        SET status = 'rejected',
            approved_by_user_id = :user_id,
            approved_at = NOW()
        WHERE id = :approval_id
    """)
    
    await db.execute(update_query, {
        "approval_id": approval_id,
        "user_id": user.user_id
    })
    
    # Log 'rejected' event
    await log_approval_event(
        db,
        approval_id=approval_id,
        event="rejected",
        user_id=user.user_id
    )
    
    await db.commit()
    
    return ApprovalActionResponse(
        ok=True,
        message="Approval rejected",
        approval_id=approval_id,
        status="rejected"
    )
