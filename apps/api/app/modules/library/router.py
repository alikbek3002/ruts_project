from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
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


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str | None = Form(None),
    class_id: str | None = Form(None),
    user: dict = require_role("teacher", "admin"),
):
    """Upload file to Supabase Storage and create library item"""
    sb = get_supabase()
    
    # Generate unique filename to avoid collisions
    file_ext = file.filename.split(".")[-1] if "." in file.filename else ""
    unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
    storage_path = f"files/{unique_filename}"
    
    # Read file content
    file_content = await file.read()
    
    # Upload to Supabase Storage
    try:
        sb.storage.from_("library").upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": file.content_type or "application/octet-stream"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")
    
    # Create library item record
    resp = sb.table("library_items").insert({
        "title": title,
        "description": description,
        "class_id": class_id,
        "storage_bucket": "library",
        "storage_path": storage_path,
        "uploaded_by": user["id"],
    }).execute()
    
    item = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
    return {"item": item, "originalFilename": file.filename}


@router.get("/{item_id}/download-url")
def get_download_url(item_id: str, user: dict = require_role("admin", "teacher", "student")):
    """Get signed URL for downloading file"""
    sb = get_supabase()
    
    # Get library item
    resp = sb.table("library_items").select("storage_bucket,storage_path").eq("id", item_id).single().execute()
    item = resp.data
    
    if not item:
        raise HTTPException(status_code=404, detail="Library item not found")
    
    # Generate signed URL (valid for 1 hour)
    try:
        signed_url = sb.storage.from_(item["storage_bucket"]).create_signed_url(
            path=item["storage_path"],
            expires_in=3600  # 1 hour
        )
        return {"url": signed_url["signedURL"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {str(e)}")


@router.delete("/{item_id}")
def delete_item(item_id: str, user: dict = require_role("teacher", "admin")):
    """Delete library item and associated file from storage"""
    sb = get_supabase()
    
    # Get library item to check ownership and get storage path
    resp = sb.table("library_items").select("uploaded_by,storage_bucket,storage_path").eq("id", item_id).single().execute()
    item = resp.data
    
    if not item:
        raise HTTPException(status_code=404, detail="Library item not found")
    
    # Only admin or the uploader can delete
    if user["role"] != "admin" and item["uploaded_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Permission denied")
    
    # Delete file from storage
    try:
        sb.storage.from_(item["storage_bucket"]).remove([item["storage_path"]])
    except Exception as e:
        # Log error but continue with DB deletion
        print(f"Warning: Failed to delete file from storage: {e}")
    
    # Delete database record
    sb.table("library_items").delete().eq("id", item_id).execute()
    
    return {"ok": True}
