from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
import bcrypt

from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class OrganizationCreate(BaseModel):
    """Create a new organization"""
    name: str = Field(..., description="Organization name")


class OrganizationUpdate(BaseModel):
    """Update an organization"""
    name: str = Field(..., description="New organization name")


class OrganizationResponse(BaseModel):
    """Organization response"""
    id: str
    name: str


class UserCreate(BaseModel):
    """Create a new user"""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="User password (min 8 characters)")
    role: str = Field(default="viewer", description="User role: 'admin' or 'viewer'")
    org_id: str = Field(..., description="Organization UUID")


class UserUpdate(BaseModel):
    """Update a user"""
    email: Optional[EmailStr] = Field(None, description="New email address")
    password: Optional[str] = Field(None, min_length=8, description="New password")
    role: Optional[str] = Field(None, description="New role: 'admin' or 'viewer'")


class UserResponse(BaseModel):
    """User response"""
    id: str
    email: str
    role: str
    org_id: str
    org_name: str
    created_at: str


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def require_admin(user: Authed):
    """Ensure user is an admin"""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )


# ============================================================================
# ORGANIZATION ENDPOINTS
# ============================================================================

@router.get("/organizations", response_model=List[OrganizationResponse])
async def list_organizations(
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    List all organizations (admin only).
    """
    require_admin(user)
    
    query = text("SELECT id, name FROM organizations ORDER BY name")
    rows = (await db.execute(query)).mappings().all()
    
    return [
        OrganizationResponse(id=str(row["id"]), name=row["name"])
        for row in rows
    ]


@router.post("/organizations", response_model=OrganizationResponse)
async def create_organization(
    org: OrganizationCreate,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Create a new organization (admin only).
    """
    require_admin(user)
    
    query = text("""
        INSERT INTO organizations (name)
        VALUES (:name)
        RETURNING id, name
    """)
    
    result = await db.execute(query, {"name": org.name})
    row = result.first()
    await db.commit()
    
    return OrganizationResponse(id=str(row[0]), name=row[1])


@router.put("/organizations/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: str,
    org: OrganizationUpdate,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Update an organization (admin only).
    """
    require_admin(user)
    
    query = text("""
        UPDATE organizations
        SET name = :name
        WHERE id = :org_id
        RETURNING id, name
    """)
    
    result = await db.execute(query, {"org_id": org_id, "name": org.name})
    row = result.first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    await db.commit()
    return OrganizationResponse(id=str(row[0]), name=row[1])


@router.delete("/organizations/{org_id}")
async def delete_organization(
    org_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Delete an organization (admin only).
    WARNING: This will cascade delete all users, workflows, and workflow_runs!
    """
    require_admin(user)
    
    # Check if org exists
    check_query = text("SELECT id FROM organizations WHERE id = :org_id")
    row = (await db.execute(check_query, {"org_id": org_id})).first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    # Delete (will cascade)
    delete_query = text("DELETE FROM organizations WHERE id = :org_id")
    await db.execute(delete_query, {"org_id": org_id})
    await db.commit()
    
    return {"ok": True, "message": "Organization deleted successfully"}


# ============================================================================
# USER ENDPOINTS
# ============================================================================

@router.get("/users", response_model=List[UserResponse])
async def list_users(
    org_id: Optional[str] = None,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    List all users (admin only).
    Optionally filter by org_id.
    """
    require_admin(user)
    
    if org_id:
        query = text("""
            SELECT u.id, u.email, u.role, u.org_id, u.created_at, o.name as org_name
            FROM users u
            JOIN organizations o ON o.id = u.org_id
            WHERE u.org_id = :org_id
            ORDER BY u.email
        """)
        rows = (await db.execute(query, {"org_id": org_id})).mappings().all()
    else:
        query = text("""
            SELECT u.id, u.email, u.role, u.org_id, u.created_at, o.name as org_name
            FROM users u
            JOIN organizations o ON o.id = u.org_id
            ORDER BY o.name, u.email
        """)
        rows = (await db.execute(query)).mappings().all()
    
    return [
        UserResponse(
            id=str(row["id"]),
            email=row["email"],
            role=row["role"],
            org_id=str(row["org_id"]),
            org_name=row["org_name"],
            created_at=row["created_at"].isoformat()
        )
        for row in rows
    ]


@router.post("/users", response_model=UserResponse)
async def create_user(
    new_user: UserCreate,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Create a new user (admin only).
    """
    require_admin(user)
    
    # Validate role
    if new_user.role not in ["admin", "viewer"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'admin' or 'viewer'"
        )
    
    # Check if org exists
    org_check = text("SELECT id FROM organizations WHERE id = :org_id")
    org_row = (await db.execute(org_check, {"org_id": new_user.org_id})).first()
    
    if not org_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    # Check if email already exists
    email_check = text("SELECT id FROM users WHERE email = :email")
    existing = (await db.execute(email_check, {"email": new_user.email})).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists"
        )
    
    # Hash password
    password_hash = hash_password(new_user.password)
    
    # Create user
    query = text("""
        INSERT INTO users (org_id, email, password_hash, role)
        VALUES (:org_id, :email, :password_hash, :role)
        RETURNING id, email, role, org_id, created_at
    """)
    
    result = await db.execute(query, {
        "org_id": new_user.org_id,
        "email": new_user.email,
        "password_hash": password_hash,
        "role": new_user.role
    })
    row = result.mappings().first()
    await db.commit()
    
    # Get org name
    org_name_query = text("SELECT name FROM organizations WHERE id = :org_id")
    org_name = (await db.execute(org_name_query, {"org_id": new_user.org_id})).scalar()
    
    return UserResponse(
        id=str(row["id"]),
        email=row["email"],
        role=row["role"],
        org_id=str(row["org_id"]),
        org_name=org_name,
        created_at=row["created_at"].isoformat()
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    updated_user: UserUpdate,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Update a user (admin only).
    """
    require_admin(user)
    
    # Check if user exists
    check_query = text("SELECT id, org_id FROM users WHERE id = :user_id")
    existing = (await db.execute(check_query, {"user_id": user_id})).first()
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    org_id = existing[1]
    
    # Build update query dynamically
    updates = []
    params = {"user_id": user_id}
    
    if updated_user.email is not None:
        # Check if new email already exists
        email_check = text("SELECT id FROM users WHERE email = :email AND id != :user_id")
        existing_email = (await db.execute(email_check, {
            "email": updated_user.email,
            "user_id": user_id
        })).first()
        
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )
        
        updates.append("email = :email")
        params["email"] = updated_user.email
    
    if updated_user.password is not None:
        updates.append("password_hash = :password_hash")
        params["password_hash"] = hash_password(updated_user.password)
    
    if updated_user.role is not None:
        if updated_user.role not in ["admin", "viewer"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role must be 'admin' or 'viewer'"
            )
        updates.append("role = :role")
        params["role"] = updated_user.role
    
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    # Execute update
    query = text(f"""
        UPDATE users
        SET {', '.join(updates)}
        WHERE id = :user_id
        RETURNING id, email, role, org_id, created_at
    """)
    
    result = await db.execute(query, params)
    row = result.mappings().first()
    await db.commit()
    
    # Get org name
    org_name_query = text("SELECT name FROM organizations WHERE id = :org_id")
    org_name = (await db.execute(org_name_query, {"org_id": org_id})).scalar()
    
    return UserResponse(
        id=str(row["id"]),
        email=row["email"],
        role=row["role"],
        org_id=str(row["org_id"]),
        org_name=org_name,
        created_at=row["created_at"].isoformat()
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Delete a user (admin only).
    """
    require_admin(user)
    
    # Check if user exists
    check_query = text("SELECT id FROM users WHERE id = :user_id")
    row = (await db.execute(check_query, {"user_id": user_id})).first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent deleting yourself
    if user_id == user.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    # Delete user
    delete_query = text("DELETE FROM users WHERE id = :user_id")
    await db.execute(delete_query, {"user_id": user_id})
    await db.commit()
    
    return {"ok": True, "message": "User deleted successfully"}


# ============================================================================
# WORKFLOW RUNS ENDPOINTS
# ============================================================================

@router.get("/runs")
async def get_admin_runs(
    org_id: Optional[str] = Query(None, description="Filter by organization ID"),
    limit: int = Query(50, ge=1, le=500, description="Maximum number of runs to return"),
    user: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Get workflow runs for all organizations or filtered by organization (admin only).
    """
    require_admin(user)
    
    # Build query with optional org filter
    if org_id:
        query = text("""
            SELECT wr.id, w.name, wr.started_at, wr.ended_at, wr.status,
                   o.name as org_name, wr.org_id,
                   EXTRACT(EPOCH FROM (wr.ended_at - wr.started_at)) * 1000 as duration_ms
            FROM workflow_runs wr
            JOIN workflows w ON w.id = wr.workflow_id
            JOIN organizations o ON o.id = wr.org_id
            WHERE wr.org_id = :org_id
            ORDER BY wr.started_at DESC
            LIMIT :limit
        """)
        result = await db.execute(query, {"org_id": org_id, "limit": limit})
    else:
        query = text("""
            SELECT wr.id, w.name, wr.started_at, wr.ended_at, wr.status,
                   o.name as org_name, wr.org_id,
                   EXTRACT(EPOCH FROM (wr.ended_at - wr.started_at)) * 1000 as duration_ms
            FROM workflow_runs wr
            JOIN workflows w ON w.id = wr.workflow_id
            JOIN organizations o ON o.id = wr.org_id
            ORDER BY wr.started_at DESC
            LIMIT :limit
        """)
        result = await db.execute(query, {"limit": limit})
    
    rows = result.mappings().all()
    
    runs = []
    for row in rows:
        runs.append({
            "id": row["id"],
            "name": row["name"],
            "startedAt": row["started_at"].isoformat(),
            "durationMs": int(row["duration_ms"]) if row["duration_ms"] is not None else None,
            "status": row["status"],
            "orgName": row["org_name"],
            "orgId": str(row["org_id"])
        })
    
    return runs
