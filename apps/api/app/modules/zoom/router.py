from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.core.security import decrypt_text, encrypt_text
from app.core.settings import settings
from app.db.supabase_client import get_supabase

router = APIRouter()

ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize"
ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"
ZOOM_API_BASE = "https://api.zoom.us/v2"


def _require_zoom_config():
    if not settings.zoom_client_id or not settings.zoom_client_secret or not settings.zoom_redirect_uri:
        raise HTTPException(status_code=500, detail="Zoom OAuth is not configured")


@router.get("/oauth/start")
def oauth_start(user: dict = require_role("teacher", "admin")):
    _require_zoom_config()

    state = secrets.token_urlsafe(24)
    sb = get_supabase()
    sb.table("zoom_oauth_states").insert({"user_id": user["id"], "state": state}).execute()

    params = {
        "response_type": "code",
        "client_id": settings.zoom_client_id,
        "redirect_uri": settings.zoom_redirect_uri,
        "state": state,
    }
    return {"authUrl": f"{ZOOM_AUTH_URL}?{urlencode(params)}"}


@router.get("/oauth/callback")
def oauth_callback(code: str, state: str, request: Request):
    _require_zoom_config()

    sb = get_supabase()
    st = sb.table("zoom_oauth_states").select("user_id").eq("state", state).single().execute().data
    if not st:
        raise HTTPException(status_code=400, detail="Invalid state")

    user_id = st["user_id"]

    # Exchange code for tokens
    basic = httpx.BasicAuth(settings.zoom_client_id, settings.zoom_client_secret)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.zoom_redirect_uri,
    }

    with httpx.Client(timeout=20) as client:
        token_resp = client.post(ZOOM_TOKEN_URL, data=data, auth=basic)

    if token_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail="Zoom token exchange failed")

    token_json = token_resp.json()
    access_token = token_json["access_token"]
    refresh_token = token_json["refresh_token"]
    expires_in = int(token_json.get("expires_in", 3600))
    expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=expires_in)

    # Get Zoom user info
    with httpx.Client(timeout=20) as client:
        me_resp = client.get(f"{ZOOM_API_BASE}/users/me", headers={"Authorization": f"Bearer {access_token}"})
    if me_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail="Zoom user fetch failed")
    me = me_resp.json()

    zoom_user_id = me.get("id")

    sb.table("zoom_oauth_tokens").upsert(
        {
            "teacher_id": user_id,
            "access_token_enc": encrypt_text(access_token),
            "refresh_token_enc": encrypt_text(refresh_token),
            "expires_at": expires_at.isoformat(),
            "scopes": token_json.get("scope"),
            "zoom_user_id": zoom_user_id,
        },
        on_conflict="teacher_id",
    ).execute()

    sb.table("zoom_oauth_states").delete().eq("state", state).execute()

    return RedirectResponse(url=f"{settings.app_frontend_base}/app?zoom=connected")


@router.get("/status")
def status(user: dict = require_role("teacher", "admin")):
    sb = get_supabase()
    resp = (
        sb.table("zoom_oauth_tokens")
        .select("teacher_id, expires_at, zoom_user_id")
        .eq("teacher_id", user["id"])
        .execute()
    )
    rows = resp.data or []
    row = rows[0] if isinstance(rows, list) and rows else None
    return {"connected": bool(row), "zoom_user_id": (row or {}).get("zoom_user_id")}


def _get_valid_access_token(teacher_id: str) -> str:
    _require_zoom_config()

    sb = get_supabase()
    row = sb.table("zoom_oauth_tokens").select("access_token_enc, refresh_token_enc, expires_at").eq("teacher_id", teacher_id).single().execute().data
    if not row:
        raise HTTPException(status_code=400, detail="Zoom not connected")

    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if expires_at - datetime.now(tz=timezone.utc) > timedelta(seconds=30):
        return decrypt_text(row["access_token_enc"])

    refresh_token = decrypt_text(row["refresh_token_enc"])
    basic = httpx.BasicAuth(settings.zoom_client_id, settings.zoom_client_secret)
    data = {"grant_type": "refresh_token", "refresh_token": refresh_token}

    with httpx.Client(timeout=20) as client:
        token_resp = client.post(ZOOM_TOKEN_URL, data=data, auth=basic)
    if token_resp.status_code >= 400:
        raise HTTPException(status_code=400, detail="Zoom refresh failed")

    token_json = token_resp.json()
    access_token = token_json["access_token"]
    new_refresh = token_json.get("refresh_token", refresh_token)
    expires_in = int(token_json.get("expires_in", 3600))
    new_expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=expires_in)

    sb.table("zoom_oauth_tokens").update(
        {
            "access_token_enc": encrypt_text(access_token),
            "refresh_token_enc": encrypt_text(new_refresh),
            "expires_at": new_expires_at.isoformat(),
            "scopes": token_json.get("scope"),
        }
    ).eq("teacher_id", teacher_id).execute()

    return access_token


class ZoomMeetingCreateIn(BaseModel):
    timetableEntryId: str
    startsAt: str


@router.post("/meetings")
def create_meeting(payload_in: ZoomMeetingCreateIn, user: dict = require_role("teacher", "admin")):
    """Create a Zoom meeting for a timetable entry"""
    # startsAt: local ISO datetime (e.g. 2025-12-22T09:00:00) interpreted in settings.app_timezone
    access_token = _get_valid_access_token(user["id"])

    timetableEntryId = payload_in.timetableEntryId
    startsAt = payload_in.startsAt

    sb = get_supabase()
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,teacher_id,subject,start_time,end_time, classes(name)")
        .eq("id", timetableEntryId)
        .single()
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    if user["role"] == "teacher" and entry.get("teacher_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    class_name = (entry.get("classes") or {}).get("name")
    topic = f"{class_name} - {entry.get('subject')}" if class_name else str(entry.get("subject") or "Lesson")

    # duration in minutes from start/end times
    def _to_minutes(t: str) -> int:
        hh, mm, *_ = t.split(":")
        return int(hh) * 60 + int(mm)

    duration = max(15, _to_minutes(entry["end_time"]) - _to_minutes(entry["start_time"]))

    payload = {
        "topic": topic,
        "type": 2,
        "start_time": startsAt,
        "duration": duration,
        "timezone": settings.app_timezone,
        "settings": {
            "join_before_host": False,
            "waiting_room": True,
        },
    }

    with httpx.Client(timeout=20) as client:
        resp = client.post(
            f"{ZOOM_API_BASE}/users/me/meetings",
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )

    if resp.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Zoom meeting create failed: {resp.text}")

    m = resp.json()
    zoom_meeting_id = str(m.get("id"))
    join_url = m.get("join_url")

    db_resp = sb.table("zoom_meetings").insert(
        {
            "timetable_entry_id": timetableEntryId,
            "starts_at": startsAt,
            "zoom_meeting_id": zoom_meeting_id,
            "join_url": join_url,
            "start_url": m.get("start_url"),
            "created_by": user["id"],
        }
    ).execute()

    meeting = db_resp.data[0] if isinstance(db_resp.data, list) and db_resp.data else db_resp.data
    return {"meeting": meeting}


@router.get("/meetings")
def list_meetings(user: dict = require_role("teacher", "admin", "student")):
    """List all upcoming Zoom meetings for the user"""
    sb = get_supabase()
    
    # Get current time in UTC
    now = datetime.now(tz=timezone.utc)
    
    if user["role"] == "teacher":
        # Get meetings created by this teacher
        resp = (
            sb.table("zoom_meetings")
            .select("id,timetable_entry_id,starts_at,zoom_meeting_id,join_url,start_url,created_at,timetable_entries(subject,start_time,end_time,classes(name))")
            .eq("created_by", user["id"])
            .gte("starts_at", now.isoformat())
            .order("starts_at", desc=False)
            .limit(50)
            .execute()
        )
    elif user["role"] == "student":
        # Get meetings for classes the student is enrolled in
        # First get student's classes
        enrollments = sb.table("class_enrollments").select("class_id").eq("legacy_student_id", user["id"]).execute()
        class_ids = [e["class_id"] for e in (enrollments.data or [])]
        
        if not class_ids:
            return {"meetings": []}
        
        # Get timetable entries for those classes
        timetable_resp = sb.table("timetable_entries").select("id").in_("class_id", class_ids).execute()
        timetable_ids = [t["id"] for t in (timetable_resp.data or [])]
        
        if not timetable_ids:
            return {"meetings": []}
        
        # Get meetings for those timetable entries
        resp = (
            sb.table("zoom_meetings")
            .select("id,timetable_entry_id,starts_at,zoom_meeting_id,join_url,created_at,timetable_entries(subject,start_time,end_time,classes(name))")
            .in_("timetable_entry_id", timetable_ids)
            .gte("starts_at", now.isoformat())
            .order("starts_at", desc=False)
            .limit(50)
            .execute()
        )
    else:  # admin
        # Get all meetings
        resp = (
            sb.table("zoom_meetings")
            .select("id,timetable_entry_id,starts_at,zoom_meeting_id,join_url,start_url,created_at,timetable_entries(subject,start_time,end_time,classes(name))")
            .gte("starts_at", now.isoformat())
            .order("starts_at", desc=False)
            .limit(50)
            .execute()
        )
    
    return {"meetings": resp.data or []}


@router.delete("/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, user: dict = require_role("teacher", "admin")):
    """Delete a Zoom meeting"""
    sb = get_supabase()
    
    # Get meeting info
    resp = sb.table("zoom_meetings").select("zoom_meeting_id,created_by,timetable_entries(teacher_id)").eq("id", meeting_id).single().execute()
    meeting = resp.data
    
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Check permissions: teacher can only delete own meetings
    timetable_teacher_id = (meeting.get("timetable_entries") or {}).get("teacher_id")
    if user["role"] == "teacher" and meeting.get("created_by") != user["id"] and timetable_teacher_id != user["id"]:
        raise HTTPException(status_code=403, detail="Permission denied")
    
    # Try to delete from Zoom (best effort)
    try:
        access_token = _get_valid_access_token(user["id"])
        with httpx.Client(timeout=20) as client:
            client.delete(
                f"{ZOOM_API_BASE}/meetings/{meeting['zoom_meeting_id']}",
                headers={"Authorization": f"Bearer {access_token}"}
            )
    except Exception as e:
        print(f"Warning: Failed to delete Zoom meeting: {e}")
    
    # Delete from database
    sb.table("zoom_meetings").delete().eq("id", meeting_id).execute()
    
    return {"ok": True}
