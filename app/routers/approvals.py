from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import httpx
import logging
import uuid
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, urlunparse

from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/approvals", tags=["approvals"])
logger = logging.getLogger(__name__)

# ============================================================================
# ERROR CLASSIFICATION
# ============================================================================

class UpstreamErrorKind(str, Enum):
    EXPIRED = "expired"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


def classify_upstream_error(status_code: int, body: Optional[str]) -> UpstreamErrorKind:
    """
    Classify upstream MinIO/S3 errors based on status code and response body.
    
    Args:
        status_code: HTTP status code from upstream
        body: Response body text (may be XML with error codes)
    
    Returns:
        UpstreamErrorKind indicating the type of error
    """
    # Try to parse XML error codes from MinIO/S3
    error_code = None
    if body:
        try:
            # Limit body parsing to first 10KB to avoid memory issues
            truncated_body = body[:10240] if len(body) > 10240 else body
            
            # Try to parse as XML
            root = ET.fromstring(truncated_body)
            # MinIO/S3 errors typically have <Error><Code>ErrorCode</Code></Error>
            code_elem = root.find(".//Code")
            if code_elem is not None and code_elem.text:
                error_code = code_elem.text
                logger.info(f"Parsed MinIO error code: {error_code}")
        except ET.ParseError:
            # Not XML, try regex fallback
            import re
            match = re.search(r'<Code>(\w+)</Code>', truncated_body)
            if match:
                error_code = match.group(1)
                logger.info(f"Extracted MinIO error code via regex: {error_code}")
        except Exception as e:
            logger.debug(f"Could not parse upstream error body: {e}")
    
    # Classify based on error code first (most reliable)
    if error_code in ("ExpiredToken", "RequestExpired", "TokenRefreshRequired"):
        return UpstreamErrorKind.EXPIRED
    elif error_code == "NoSuchKey":
        return UpstreamErrorKind.NOT_FOUND
    elif error_code in ("AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"):
        # AccessDenied without expired token means forbidden
        if error_code == "AccessDenied" and not body:
            # Fallback: could be expired, log uncertainty
            logger.warning("AccessDenied without body - may be expired URL but cannot confirm")
        return UpstreamErrorKind.FORBIDDEN
    
    # Fallback to status code classification
    if status_code == 404:
        return UpstreamErrorKind.NOT_FOUND
    elif status_code == 403:
        # Without body info, 403 could be expired or forbidden
        # Log this uncertainty
        logger.warning(f"403 without parseable error code - classifying as FORBIDDEN (may be expired)")
        return UpstreamErrorKind.FORBIDDEN
    elif 400 <= status_code < 500:
        return UpstreamErrorKind.FORBIDDEN
    elif 500 <= status_code < 600:
        return UpstreamErrorKind.UNAVAILABLE
    
    return UpstreamErrorKind.UNKNOWN


def render_error_html(
    kind: UpstreamErrorKind,
    approval_id: str,
    asset_id: str,
    request_id: str
) -> str:
    """
    Render a user-friendly HTML error page for upstream asset errors.
    
    Safe to display in iframes - no scripts, no external resources.
    Does not expose sensitive information like presigned URLs or bucket names.
    """
    
    # Map error kinds to user messages
    messages = {
        UpstreamErrorKind.EXPIRED: {
            "title": "Bijlage-link verlopen",
            "message": "De link naar deze bijlage is verlopen.",
            "actions": [
                "Vernieuw de pagina of open de approval opnieuw",
                "Als dit probleem blijft optreden, neem dan contact op met support"
            ]
        },
        UpstreamErrorKind.FORBIDDEN: {
            "title": "Geen toegang",
            "message": "Je hebt geen toegang tot deze bijlage.",
            "actions": [
                "Controleer of je de juiste rechten hebt",
                "Neem contact op met de eigenaar van deze approval"
            ]
        },
        UpstreamErrorKind.NOT_FOUND: {
            "title": "Bijlage niet gevonden",
            "message": "Deze bijlage is niet gevonden. Het bestand is mogelijk verwijderd.",
            "actions": [
                "Controleer of de bijlage nog beschikbaar is",
                "Neem contact op met de afzender"
            ]
        },
        UpstreamErrorKind.UNAVAILABLE: {
            "title": "Service tijdelijk niet beschikbaar",
            "message": "De bijlage-service is tijdelijk niet beschikbaar.",
            "actions": [
                "Probeer het over een paar minuten opnieuw",
                "Als dit probleem blijft optreden, neem dan contact op met support"
            ]
        },
        UpstreamErrorKind.UNKNOWN: {
            "title": "Onbekende fout",
            "message": "Er is een onbekende fout opgetreden bij het ophalen van de bijlage.",
            "actions": [
                "Vernieuw de pagina en probeer het opnieuw",
                "Neem contact op met support als dit blijft gebeuren"
            ]
        }
    }
    
    error_info = messages.get(kind, messages[UpstreamErrorKind.UNKNOWN])
    
    # Generate timestamp in user-friendly format
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    actions_html = "\n".join(f"<li>{action}</li>" for action in error_info["actions"])
    
    html = f"""<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{error_info["title"]}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }}
        .container {{
            max-width: 600px;
            margin: 40px auto;
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #d9534f;
            font-size: 24px;
            margin-top: 0;
            margin-bottom: 15px;
        }}
        p {{
            margin: 10px 0;
            font-size: 16px;
        }}
        .actions {{
            background-color: #f0f8ff;
            border-left: 4px solid #5bc0de;
            padding: 15px 20px;
            margin: 20px 0;
            border-radius: 4px;
        }}
        .actions h2 {{
            margin-top: 0;
            font-size: 18px;
            color: #31708f;
        }}
        .actions ul {{
            margin: 10px 0;
            padding-left: 20px;
        }}
        .actions li {{
            margin: 8px 0;
        }}
        .metadata {{
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
            font-size: 13px;
            color: #666;
        }}
        .metadata-item {{
            margin: 5px 0;
            font-family: "Courier New", monospace;
        }}
        .metadata-label {{
            font-weight: bold;
            display: inline-block;
            width: 120px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{error_info["title"]}</h1>
        <p>{error_info["message"]}</p>
        
        <div class="actions">
            <h2>Wat kun je doen?</h2>
            <ul>
                {actions_html}
            </ul>
        </div>
        
        <div class="metadata">
            <div class="metadata-item">
                <span class="metadata-label">Request ID:</span>
                <span>{request_id}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Approval ID:</span>
                <span>{approval_id}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Asset ID:</span>
                <span>{asset_id}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Timestamp:</span>
                <span>{timestamp}</span>
            </div>
        </div>
    </div>
</body>
</html>"""
    
    return html

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

def _adjust_url_for_proxy(request: Request, absolute_url: str) -> str:
    """Ensure generated absolute URLs use the external scheme/host from proxy headers.

    Fall back to the original absolute_url if headers are missing.
    """
    xf_proto = request.headers.get("x-forwarded-proto")
    xf_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not xf_proto and not xf_host:
        return absolute_url
    p = urlparse(absolute_url)
    scheme = xf_proto or p.scheme or "https"
    netloc = xf_host or p.netloc
    return urlunparse((scheme, netloc, p.path, "", p.query, ""))

# ============================================================================
# ENDPOINTS
# ============================================================================

# Accept non-trailing-slash path to avoid 307 redirect on 
# GET /approvals (Starlette otherwise redirects to /approvals/)
@router.get("", response_model=List[ApprovalListItem])
async def list_approvals(
    status: Optional[str] = Query(None, description="Filter by status: pending, approved, rejected, sent, failed"),
    type: Optional[str] = Query(None, description="Filter by type: order, linkedin_post, gmail_reply, forward_gmail"),
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
        SELECT id,
               type,
               status,
               title,
               (data->'preview') AS preview,
               created_at
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
    request: Request,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Get detailed information about a specific approval including all assets.
    Logs a 'viewed' event.
    """
    # Fetch approval
    approval_query = text("""
        SELECT id,
               org_id,
               type,
               status,
               title,
               (data->'preview') AS preview,
               data,
               n8n_execute_webhook_url,
               created_at,
               updated_at,
               approved_at,
               approved_by_user_id
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
    
    assets = []
    for row in assets_rows:
        asset_id = str(row["id"])
        raw_url = str(request.url_for("view_approval_asset", approval_id=approval_id, asset_id=asset_id))
        proxied_url = _adjust_url_for_proxy(request, raw_url)
        assets.append(ApprovalAsset(
            id=asset_id,
            role=row["role"],
            url=proxied_url,
            filename=row["filename"],
            mime_type=row["mime_type"],
            size_bytes=row["size_bytes"]
        ))
    
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
        SELECT id, org_id, status, type, data, n8n_execute_webhook_url, title
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
    # First check approval-specific webhook, then fall back to org-level webhook
    webhook_url = approval_row["n8n_execute_webhook_url"]
    
    # If no approval-specific webhook, use org-level webhook
    if not webhook_url:
        org_webhook_query = text("""
            SELECT n8n_approval_webhook_url
            FROM organizations
            WHERE id = :org_id
        """)
        org_result = await db.execute(org_webhook_query, {"org_id": approval_row["org_id"]})
        org_row = org_result.fetchone()
        if org_row and org_row[0]:
            webhook_url = org_row[0]
            logger.info(f"Using organization-level webhook for approval {approval_id}")
    
    final_status = "approved"
    error_message = None

    if webhook_url:
        try:
            logger.info(f"Calling n8n webhook for approval {approval_id}: {webhook_url}")

            # Prepare payload: original data + assets with signed URLs and storage keys
            payload_data: Dict[str, Any]
            base_data = approval_row["data"] or {}
            if isinstance(base_data, dict):
                payload_data = dict(base_data)
            else:
                payload_data = {}

            # Add approval metadata
            payload_data["_approval_id"] = str(approval_id)
            payload_data["_approval_type"] = approval_row["type"]
            payload_data["_approval_title"] = approval_row["title"]

            # Fetch assets to include presigned URLs in the payload
            try:
                assets_rows = (await db.execute(
                    text(
                        """
                        SELECT id, role, storage_provider, storage_key, external_url, filename, mime_type, size_bytes
                        FROM approval_assets
                        WHERE approval_id = :approval_id
                        ORDER BY created_at
                        """
                    ),
                    {"approval_id": approval_id},
                )).mappings().all()

                assets_list: List[Dict[str, Any]] = []
                assets_by_role: Dict[str, List[Dict[str, Any]]] = {}

                for row in assets_rows:
                    asset_obj = {
                        "id": str(row["id"]),
                        "role": row["role"],
                        # Signed (presigned) URL provided at ingest time
                        "external_url": row["external_url"],
                        "filename": row["filename"],
                        "mime_type": row["mime_type"],
                        "size_bytes": row["size_bytes"],
                        # Include storage references in case workflows prefer direct S3/MinIO download
                        "storage_provider": row["storage_provider"],
                        "storage_key": row["storage_key"],
                    }
                    assets_list.append(asset_obj)
                    role = row["role"]
                    if role not in assets_by_role:
                        assets_by_role[role] = []
                    assets_by_role[role].append(asset_obj)

                payload_data["_assets"] = assets_list
                payload_data["_assets_by_role"] = assets_by_role
            except Exception as e:
                # Fallback to sending only the original data if asset preparation fails
                logger.warning(
                    f"Failed to prepare assets for webhook payload on approval {approval_id}: {e}"
                )

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    webhook_url,
                    json=payload_data,
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


@router.get("/{approval_id}/assets/{asset_id}/view")
async def view_approval_asset(
    approval_id: str,
    asset_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session),
):
    """
    Proxy an approval asset through the API so the browser can load it
    from the public API domain even when the stored external_url points
    to an internal host (e.g., srv-captain--minio).

    Access control: ensures the asset belongs to the user's org via join.
    
    Returns:
        - On success: streams the asset with appropriate Content-Type
        - On error: returns user-friendly HTML error page
    """
    # Generate request ID for correlation and debugging
    request_id = str(uuid.uuid4())
    
    # Fetch asset joined with approval to enforce org ownership
    asset_query = text(
        """
        SELECT aa.id,
               aa.approval_id,
               aa.external_url,
               aa.filename,
               aa.mime_type
        FROM approval_assets aa
        JOIN approvals a ON a.id = aa.approval_id
        WHERE aa.id = :asset_id
          AND aa.approval_id = :approval_id
          AND a.org_id = :org_id
        LIMIT 1
        """
    )

    asset_row = (
        await db.execute(
            asset_query,
            {"asset_id": asset_id, "approval_id": approval_id, "org_id": user.org_id},
        )
    ).mappings().first()

    if not asset_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    external_url = asset_row["external_url"]
    if not external_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset URL missing")

    # Fetch the asset content from the external URL
    upstream = None
    upstream_body = None
    
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            upstream = await client.get(external_url)
            
        # If not 200, read body for error classification (limit to 10KB)
        if upstream.status_code != 200:
            try:
                # Read limited amount of response body for error classification
                upstream_body = upstream.text[:10240]
            except Exception as body_err:
                logger.debug(f"Could not read upstream response body: {body_err}")
                
    except httpx.TimeoutException as e:
        logger.error(
            f"Asset fetch timeout for approval_id={approval_id} asset_id={asset_id} "
            f"request_id={request_id}: {e}"
        )
        error_html = render_error_html(
            UpstreamErrorKind.UNAVAILABLE,
            approval_id,
            asset_id,
            request_id
        )
        return HTMLResponse(
            content=error_html,
            status_code=504,
            headers={
                "Cache-Control": "no-store",
                "X-Request-Id": request_id
            }
        )
    except httpx.RequestError as e:
        logger.error(
            f"Asset fetch failed for approval_id={approval_id} asset_id={asset_id} "
            f"request_id={request_id}: {e}"
        )
        error_html = render_error_html(
            UpstreamErrorKind.UNAVAILABLE,
            approval_id,
            asset_id,
            request_id
        )
        return HTMLResponse(
            content=error_html,
            status_code=502,
            headers={
                "Cache-Control": "no-store",
                "X-Request-Id": request_id
            }
        )
    except Exception as e:
        logger.error(
            f"Unexpected error fetching asset approval_id={approval_id} asset_id={asset_id} "
            f"request_id={request_id}: {e}",
            exc_info=True
        )
        error_html = render_error_html(
            UpstreamErrorKind.UNKNOWN,
            approval_id,
            asset_id,
            request_id
        )
        return HTMLResponse(
            content=error_html,
            status_code=500,
            headers={
                "Cache-Control": "no-store",
                "X-Request-Id": request_id
            }
        )

    # Handle non-200 responses from upstream
    if upstream.status_code != 200:
        # Classify the error
        error_kind = classify_upstream_error(upstream.status_code, upstream_body)
        
        # Log with appropriate level
        log_level = logging.ERROR if upstream.status_code >= 500 else logging.WARNING
        logger.log(
            log_level,
            f"Upstream returned {upstream.status_code} for approval_id={approval_id} "
            f"asset_id={asset_id} request_id={request_id} error_kind={error_kind.value}"
        )
        
        # Render error page
        error_html = render_error_html(error_kind, approval_id, asset_id, request_id)
        
        # Map error kind to appropriate HTTP status
        status_map = {
            UpstreamErrorKind.EXPIRED: 403,
            UpstreamErrorKind.FORBIDDEN: 403,
            UpstreamErrorKind.NOT_FOUND: 404,
            UpstreamErrorKind.UNAVAILABLE: 503,
            UpstreamErrorKind.UNKNOWN: 500
        }
        
        return HTMLResponse(
            content=error_html,
            status_code=status_map.get(error_kind, 500),
            headers={
                "Cache-Control": "no-store",
                "X-Request-Id": request_id
            }
        )

    # Success: stream the asset
    content_type = (
        asset_row["mime_type"]
        or upstream.headers.get("content-type")
        or "application/octet-stream"
    )
    filename = asset_row["filename"] or "asset"

    headers = {
        "Content-Disposition": f"inline; filename=\"{filename}\"",
        "Cache-Control": "private, max-age=300",
        "X-Request-Id": request_id
    }

    return Response(content=upstream.content, media_type=content_type, headers=headers)
