from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from postgrest.exceptions import APIError

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


def _is_missing_table_api_error(err: Exception, table: str) -> bool:
    try:
        payload = err.args[0] if getattr(err, "args", None) else None
        if isinstance(payload, dict):
            if payload.get("code") == "PGRST205" and table in (payload.get("message") or ""):
                return True
        msg = str(err)
        return ("PGRST205" in msg) and (table in msg)
    except Exception:
        return False


def _is_missing_column_api_error(err: Exception, column: str) -> bool:
    try:
        payload = err.args[0] if getattr(err, "args", None) else None
        if isinstance(payload, dict):
            if payload.get("code") == "42703" and column in (payload.get("message") or ""):
                return True
        msg = str(err)
        return ("42703" in msg) and (column in msg)
    except Exception:
        return False


class CreateLibraryItemIn(BaseModel):
    title: str
    description: str | None = None
    class_id: str | None = None
    storage_bucket: str = "library"
    storage_path: str
    topic_id: str | None = None


class LibraryTopicOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    class_id: str | None = None
    created_at: str
    items: list[dict]


@router.post("")
def create_item(payload: CreateLibraryItemIn, user: dict = require_role("teacher", "admin")):
    sb = get_supabase()
    row = {**payload.model_dump(), "uploaded_by": user["id"]}
    try:
        resp = sb.table("library_items").insert(row).execute()
    except APIError as e:
        if _is_missing_column_api_error(e, "library_items.topic_id"):
            row.pop("topic_id", None)
            resp = sb.table("library_items").insert(row).execute()
        else:
            raise
    return {"item": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}


@router.get("")
def list_items(classId: str | None = None, user: dict = require_role("admin", "teacher", "student")):
    sb = get_supabase()
    try:
        q = sb.table("library_items").select(
            "id,title,description,class_id,storage_bucket,storage_path,created_at,uploaded_by,topic_id"
        )
        if classId:
            q = q.eq("class_id", classId)
        resp = q.order("created_at", desc=True).execute()
    except APIError as e:
        if _is_missing_column_api_error(e, "library_items.topic_id"):
            q = sb.table("library_items").select(
                "id,title,description,class_id,storage_bucket,storage_path,created_at,uploaded_by"
            )
            if classId:
                q = q.eq("class_id", classId)
            resp = q.order("created_at", desc=True).execute()
        else:
            raise

    items = resp.data or []
    if isinstance(items, list):
        is_admin = user.get("role") == "admin"
        user_id = user.get("id")
        for it in items:
            try:
                it["can_delete"] = bool(is_admin or (user_id and it.get("uploaded_by") == user_id))
            except Exception:
                # best-effort enrichment
                pass

    return {"items": items}


@router.get("/topics")
def list_topics(classId: str | None = None, user: dict = require_role("admin", "teacher", "student")):
    """List library topics (themes) with their files."""
    sb = get_supabase()

    try:
        tq = sb.table("library_topics").select("id,title,description,class_id,created_by,created_at")
        if classId:
            tq = tq.eq("class_id", classId)
        topics_resp = tq.order("created_at", desc=True).execute()
        topics = topics_resp.data or []
    except APIError as e:
        if _is_missing_table_api_error(e, "public.library_topics"):
            # Migration not applied yet; don't crash the whole app.
            return {"topics": [], "schema_missing": True, "missing": "library_topics"}
        raise
    if not isinstance(topics, list):
        topics = []

    topic_ids = [t.get("id") for t in topics if t.get("id")]
    items_by_topic: dict[str, list[dict]] = {tid: [] for tid in topic_ids}

    if topic_ids:
        iq = (
            sb.table("library_items")
            .select("id,title,description,class_id,storage_bucket,storage_path,created_at,uploaded_by,topic_id")
            .in_("topic_id", topic_ids)
            .order("created_at", desc=True)
        )
        items_resp = iq.execute()
        items = items_resp.data or []
        if isinstance(items, list):
            is_admin = user.get("role") == "admin"
            user_id = user.get("id")
            for it in items:
                tid = it.get("topic_id")
                if not tid:
                    continue
                it["can_delete"] = bool(is_admin or (user_id and it.get("uploaded_by") == user_id))
                items_by_topic.setdefault(tid, []).append(it)

    out = []
    for t in topics:
        tid = t.get("id")
        out.append(
            {
                "id": tid,
                "title": t.get("title"),
                "description": t.get("description"),
                "class_id": t.get("class_id"),
                "created_at": t.get("created_at"),
                "items": items_by_topic.get(tid, []),
            }
        )

    return {"topics": out}


@router.post("/topics")
async def create_topic_with_file(
    file: UploadFile | None = File(None),
    title: str = Form(...),
    description: str | None = Form(None),
    class_id: str | None = Form(None),
    user: dict = require_role("teacher", "admin"),
):
    """Create a topic (theme). If file is provided, upload it as the first file in the topic."""
    sb = get_supabase()

    try:
        topic_resp = (
            sb.table("library_topics")
            .insert(
                {
                    "title": title,
                    "description": description,
                    "class_id": class_id,
                    "created_by": user["id"],
                }
            )
            .execute()
        )
    except APIError as e:
        if _is_missing_table_api_error(e, "public.library_topics"):
            raise HTTPException(
                status_code=500,
                detail="Library topics schema is missing. Apply migration supabase/migrations/20251225_000012_library_topics.sql",
            )
        raise
    topic = topic_resp.data[0] if isinstance(topic_resp.data, list) and topic_resp.data else topic_resp.data
    topic_id = topic.get("id") if isinstance(topic, dict) else None
    if not topic_id:
        raise HTTPException(status_code=500, detail="Failed to create topic")

    if file is None:
        return {"topic": topic, "item": None, "originalFilename": None}

    # Upload file
    file_ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else ""
    unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
    storage_path = f"topics/{topic_id}/{unique_filename}"
    file_content = await file.read()
    try:
        sb.storage.from_("library").upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    # Create library item for the uploaded file
    item_title = file.filename or "Файл"
    item_resp = (
        sb.table("library_items")
        .insert(
            {
                "title": item_title,
                "description": None,
                "class_id": class_id,
                "storage_bucket": "library",
                "storage_path": storage_path,
                "uploaded_by": user["id"],
                "topic_id": topic_id,
            }
        )
        .execute()
    )
    item = item_resp.data[0] if isinstance(item_resp.data, list) and item_resp.data else item_resp.data
    return {"topic": topic, "item": item, "originalFilename": file.filename}


@router.post("/topics/{topic_id}/upload")
async def upload_file_to_topic(
    topic_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    description: str | None = Form(None),
    user: dict = require_role("teacher", "admin"),
):
    """Upload file into an existing topic."""
    sb = get_supabase()
    try:
        topic_resp = (
            sb.table("library_topics")
            .select("id,class_id,created_by")
            .eq("id", topic_id)
            .single()
            .execute()
        )
    except APIError as e:
        if _is_missing_table_api_error(e, "public.library_topics"):
            raise HTTPException(
                status_code=500,
                detail="Library topics schema is missing. Apply migration supabase/migrations/20251225_000012_library_topics.sql",
            )
        raise
    topic = topic_resp.data
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    if user["role"] != "admin" and topic.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="Permission denied")

    file_ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else ""
    unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
    storage_path = f"topics/{topic_id}/{unique_filename}"
    file_content = await file.read()
    try:
        sb.storage.from_("library").upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    item_title = (title or "").strip() or (file.filename or "Файл")
    item_resp = (
        sb.table("library_items")
        .insert(
            {
                "title": item_title,
                "description": description,
                "class_id": topic.get("class_id"),
                "storage_bucket": "library",
                "storage_path": storage_path,
                "uploaded_by": user["id"],
                "topic_id": topic_id,
            }
        )
        .execute()
    )
    item = item_resp.data[0] if isinstance(item_resp.data, list) and item_resp.data else item_resp.data
    return {"item": item, "originalFilename": file.filename}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str | None = Form(None),
    class_id: str | None = Form(None),
    topic_id: str | None = Form(None),
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
    item_row = {
        "title": title,
        "description": description,
        "class_id": class_id,
        "storage_bucket": "library",
        "storage_path": storage_path,
        "uploaded_by": user["id"],
    }
    if topic_id:
        item_row["topic_id"] = topic_id

    try:
        resp = sb.table("library_items").insert(item_row).execute()
    except APIError as e:
        if _is_missing_column_api_error(e, "library_items.topic_id"):
            item_row.pop("topic_id", None)
            resp = sb.table("library_items").insert(item_row).execute()
        else:
            raise

    item = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
    return {"item": item, "originalFilename": file.filename}
    
    # Create library item record
    resp = sb.table("library_items").insert({
        "title": title,
        "description": description,
        "class_id": class_id,
        "storage_bucket": "library",
        "storage_path": storage_path,
        "uploaded_by": user["id"],
        "topic_id": topic_id,
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
