from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


class NotificationCreateIn(BaseModel):
    title: str
    message: str
    type: Literal["info", "success", "warning", "error", "announcement"] = "info"
    target_role: Literal["teacher", "student", "admin", "manager", "all"] | None = None
    target_user_id: str | None = None
    expires_at: str | None = None  # ISO datetime


@router.post("")
def create_notification(
    payload: NotificationCreateIn,
    user: dict = require_role("admin", "manager")
):
    """Create a new notification (admin/manager only)"""
    sb = get_supabase()
    
    data = {
        "title": payload.title,
        "message": payload.message,
        "type": payload.type,
        "target_role": payload.target_role,
        "target_user_id": payload.target_user_id,
        "created_by": user["id"],
        "expires_at": payload.expires_at,
        "is_active": True
    }
    
    resp = sb.table("notifications").insert(data).execute()
    notification = resp.data[0] if resp.data else None
    
    return {"notification": notification}


@router.get("")
from app.core.monitor import timed

@timed("list_notifications")
def list_notifications(user: CurrentUser, limit: int = 30, offset: int = 0):
    """Get notifications for current user (supports pagination)."""
    sb = get_supabase()

    from app.core.cache import cache
    cache_key = f"notifications:{user['id']}:{limit}:{offset}"
    cached = cache.get(cache_key)
    if cached is not None:
        return {"notifications": cached}

    # Build query: push filtering to DB using OR-combination
    now = datetime.utcnow().isoformat()

    q = sb.table("notifications").select(
        "id,title,message,type,created_at,expires_at,target_role,target_user_id"
    )
    q = q.eq("is_active", True)
    q = q.or_(f"expires_at.is.null,expires_at.gt.{now}")

    # Construct OR that matches user's role / all / specific user / no target
    # Supabase supports or_(<condition1>,<condition2>,...)
    # conditions are like: "target_role.eq.{role}" or "target_user_id.eq.{id}" or "target_role.is.null,target_user_id.is.null"
    role_cond = f"target_role.eq.{user['role']}"
    all_cond = "target_role.eq.all"
    user_cond = f"target_user_id.eq.{user['id']}"
    null_cond = "target_role.is.null,target_user_id.is.null"

    # Combine with or_, then order and paginate
    q = q.or_(f"{role_cond},{all_cond},{user_cond},{null_cond}")

    resp = q.order("created_at", desc=True).limit(limit).offset(offset).execute()
    visible = resp.data or []

    # Get read status for these notifications in one call
    notification_ids = [n["id"] for n in visible]
    read_ids = set()
    if notification_ids:
        reads_resp = (
            sb.table("user_notification_reads")
            .select("notification_id")
            .eq("user_id", user["id"])
            .in_("notification_id", notification_ids)
            .execute()
        )
        read_ids = {r["notification_id"] for r in (reads_resp.data or [])}

    for notif in visible:
        notif["is_read"] = notif["id"] in read_ids

    # cache briefly
    cache.set(cache_key, visible, ttl=10)

    return {"notifications": visible}


@router.get("/unread-count")
def get_unread_count(user: CurrentUser):
    """Get count of unread notifications"""
    sb = get_supabase()
    
    # Get all active notifications for user
    query = sb.table("notifications").select("id,target_role,target_user_id")
    query = query.eq("is_active", True)
    
    now = datetime.utcnow().isoformat()
    query = query.or_(f"expires_at.is.null,expires_at.gt.{now}")
    
    resp = query.execute()
    all_notifications = resp.data or []
    
    # Filter for user
    filtered_ids = []
    for notif in all_notifications:
        target_role = notif.get("target_role")
        target_user = notif.get("target_user_id")
        
        if (
            target_role == "all"
            or target_role == user["role"]
            or target_user == user["id"]
            or (target_role is None and target_user is None)
        ):
            filtered_ids.append(notif["id"])
    
    if not filtered_ids:
        return {"count": 0}
    
    # Get read notifications
    reads_resp = (
        sb.table("user_notification_reads")
        .select("notification_id")
        .eq("user_id", user["id"])
        .in_("notification_id", filtered_ids)
        .execute()
    )
    read_ids = {r["notification_id"] for r in (reads_resp.data or [])}
    
    unread_count = len(filtered_ids) - len(read_ids)
    
    return {"count": unread_count}


@router.post("/{notification_id}/read")
def mark_notification_read(notification_id: str, user: CurrentUser):
    """Mark notification as read"""
    sb = get_supabase()
    
    # Check if notification exists and user can see it
    notif_resp = (
        sb.table("notifications")
        .select("id,target_role,target_user_id")
        .eq("id", notification_id)
        .single()
        .execute()
    )
    
    if not notif_resp.data:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    notif = notif_resp.data
    target_role = notif.get("target_role")
    target_user = notif.get("target_user_id")
    
    # Verify user can see this notification
    if not (
        target_role == "all"
        or target_role == user["role"]
        or target_user == user["id"]
        or (target_role is None and target_user is None)
    ):
        raise HTTPException(status_code=403, detail="Cannot access this notification")
    
    # Insert or update read status
    sb.table("user_notification_reads").upsert(
        {
            "user_id": user["id"],
            "notification_id": notification_id,
            "read_at": datetime.utcnow().isoformat()
        },
        on_conflict="user_id,notification_id"
    ).execute()
    
    return {"success": True}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: str,
    user: dict = require_role("admin", "manager")
):
    """Delete/deactivate a notification (admin/manager only)"""
    sb = get_supabase()
    
    # Soft delete by setting is_active to false
    sb.table("notifications").update({"is_active": False}).eq("id", notification_id).execute()
    
    return {"success": True}
