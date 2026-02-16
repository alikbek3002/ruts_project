from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()

# --- Models ---

class ArchiveActionResponse(BaseModel):
    ok: bool
    message: str

class ArchivedItem(BaseModel):
    id: str
    name: str # Teacher name, Subject name, Class name
    archived_at: str
    metadata: Optional[dict] = None # Extra info (e.g. subject for class)

class ArchivedListResponse(BaseModel):
    items: List[ArchivedItem]

# --- Subjects ---

@router.get("/subjects", response_model=ArchivedListResponse)
def list_archived_subjects(user: dict = require_role("admin", "manager")):
    sb = get_supabase()
    
    resp = (
        sb.table("subjects")
        .select("id, name, archived_at")
        .not_.is_("archived_at", "null")
        .order("archived_at", desc=True)
        .execute()
    )
    
    items = [
        ArchivedItem(
            id=item["id"],
            name=item["name"],
            archived_at=item["archived_at"]
        ) for item in (resp.data or [])
    ]
    return {"items": items}

@router.post("/subjects/{id}/restore", response_model=ArchiveActionResponse)
def restore_subject(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    sb.table("subjects").update({"archived_at": None}).eq("id", id).execute()
    return {"ok": True, "message": "Subject restored"}

@router.delete("/subjects/{id}", response_model=ArchiveActionResponse)
def archive_subject(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    now = datetime.now().isoformat()
    # Check if used in active Schedule? Maybe warn? For now soft delete.
    sb.table("subjects").update({"archived_at": now}).eq("id", id).execute()
    return {"ok": True, "message": "Subject archived"}


# --- Teachers ---

@router.get("/teachers", response_model=ArchivedListResponse)
def list_archived_teachers(user: dict = require_role("admin", "manager")):
    sb = get_supabase()
    
    # Teachers: users with role 'teacher'
    resp = (
        sb.table("users")
        .select("id, name:full_name, archived_at, email")
        .eq("role", "teacher")
        .not_.is_("archived_at", "null")
        .order("archived_at", desc=True)
        .execute()
    )
    
    items = []
    for item in (resp.data or []):
        name = item.get("name") or item.get("email") or "Unknown"
        items.append(ArchivedItem(
            id=item["id"],
            name=name,
            archived_at=item["archived_at"],
            metadata={"email": item.get("email")}
        ))
        
    return {"items": items}

@router.post("/teachers/{id}/restore", response_model=ArchiveActionResponse)
def restore_teacher(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    sb.table("users").update({"archived_at": None}).eq("id", id).execute()
    return {"ok": True, "message": "Teacher restored"}

@router.delete("/teachers/{id}", response_model=ArchiveActionResponse)
def archive_teacher(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    now = datetime.now().isoformat()
    sb.table("users").update({"archived_at": now}).eq("id", id).execute()
    return {"ok": True, "message": "Teacher archived"}


# --- Classes (Groups) ---

@router.get("/classes", response_model=ArchivedListResponse)
def list_archived_classes(user: dict = require_role("admin", "manager")):
    sb = get_supabase()
    
    resp = (
        sb.table("classes")
        .select("id, name, archived_at")
        .not_.is_("archived_at", "null")
        .order("archived_at", desc=True)
        .execute()
    )
    
    items = []
    for item in (resp.data or []):
        items.append(ArchivedItem(
            id=item["id"],
            name=item["name"],
            archived_at=item["archived_at"]
        ))
    return {"items": items}

@router.post("/classes/{id}/restore", response_model=ArchiveActionResponse)
def restore_class(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    sb.table("classes").update({"archived_at": None}).eq("id", id).execute()
    return {"ok": True, "message": "Class restored"}

@router.delete("/classes/{id}", response_model=ArchiveActionResponse)
def archive_class(id: str, user: dict = require_role("admin")):
    sb = get_supabase()
    now = datetime.now().isoformat()
    sb.table("classes").update({"archived_at": now}).eq("id", id).execute()
    return {"ok": True, "message": "Class archived"}
