from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


class CreateLibraryItemIn(BaseModel):
    title: str
    description: str | None = None
    class_id: str | None = None
    storage_bucket: str = "library"
    storage_path: str


@router.post("")
def create_item(payload: CreateLibraryItemIn, user: dict = require_role("teacher", "admin")):
    sb = get_supabase()
    resp = sb.table("library_items").insert({**payload.model_dump(), "uploaded_by": user["id"]}).execute()
    return {"item": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}


@router.get("")
def list_items(classId: str | None = None, user: dict = require_role("admin", "teacher", "student")):
    sb = get_supabase()
    q = sb.table("library_items").select("id,title,description,class_id,storage_bucket,storage_path,created_at")
    if classId:
        q = q.eq("class_id", classId)
    resp = q.order("created_at", desc=True).execute()
    return {"items": resp.data or []}
