from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


class SetMeetLinkIn(BaseModel):
    meet_url: str | None = None


class CreateMeetingLinkIn(BaseModel):
    meet_url: str
    title: str | None = None
    starts_at: str | None = None
    timetable_entry_id: str | None = None
    class_id: str | None = None
    stream_id: str | None = None


@router.put("/timetable/{entry_id}/meet")
def set_timetable_meet_link(entry_id: str, payload: SetMeetLinkIn, user: dict = require_role("teacher", "admin", "manager")):
    """Установить/убрать ссылку на Google Meet для записи расписания"""
    sb = get_supabase()
    
    # Проверяем что запись существует
    entry = sb.table("timetable_entries").select("id,teacher_id").eq("id", entry_id).limit(1).execute().data
    if not entry:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    
    # Учитель может менять только свои записи
    if user.get("role") == "teacher" and entry[0].get("teacher_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Permission denied")
    
    # Устанавливаем ссылку
    meet_url = (payload.meet_url or "").strip() or None
    sb.table("timetable_entries").update({"meet_url": meet_url}).eq("id", entry_id).execute()
    
    return {"ok": True, "meet_url": meet_url}


@router.get("/timetable/{entry_id}/meet")
def get_timetable_meet_link(entry_id: str, user: dict = require_role("teacher", "admin", "manager", "student")):
    """Получить ссылку на Google Meet для записи расписания"""
    sb = get_supabase()
    
    entry = sb.table("timetable_entries").select("id,meet_url").eq("id", entry_id).limit(1).execute().data
    if not entry:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    
    return {"meet_url": entry[0].get("meet_url")}


@router.post("/links")
def create_meeting_link(payload: CreateMeetingLinkIn, user: dict = require_role("teacher", "admin", "manager")):
    """Создать ссылку на конференцию (для группы или потока)"""
    sb = get_supabase()
    
    meet_url = (payload.meet_url or "").strip()
    if not meet_url:
        raise HTTPException(status_code=400, detail="meet_url is required")
    
    insert_data = {
        "meet_url": meet_url,
        "title": (payload.title or "").strip() or None,
        "created_by": user.get("id"),
    }
    
    if payload.starts_at:
        insert_data["starts_at"] = payload.starts_at
    
    if payload.timetable_entry_id:
        insert_data["timetable_entry_id"] = payload.timetable_entry_id
    
    if payload.class_id:
        insert_data["class_id"] = payload.class_id
    
    if payload.stream_id:
        insert_data["stream_id"] = payload.stream_id
    
    resp = sb.table("meeting_links").insert(insert_data).execute()
    
    return {"link": resp.data[0] if resp.data else None}


@router.get("/links")
def list_meeting_links(
    class_id: str | None = None,
    stream_id: str | None = None,
    user: dict = require_role("teacher", "admin", "manager", "student")
):
    """Список ссылок на конференции"""
    sb = get_supabase()
    
    query = sb.table("meeting_links").select("*")
    
    if class_id:
        query = query.eq("class_id", class_id)
    
    if stream_id:
        query = query.eq("stream_id", stream_id)
    
    query = query.order("created_at", desc=True).limit(50)
    resp = query.execute()
    
    return {"links": resp.data or []}


@router.delete("/links/{link_id}")
def delete_meeting_link(link_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """Удалить ссылку на конференцию"""
    sb = get_supabase()
    
    # Проверяем что ссылка существует и пользователь имеет право удалить
    link = sb.table("meeting_links").select("id,created_by").eq("id", link_id).limit(1).execute().data
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    
    # Учитель может удалять только свои ссылки
    if user.get("role") == "teacher" and link[0].get("created_by") != user.get("id"):
        raise HTTPException(status_code=403, detail="Permission denied")
    
    sb.table("meeting_links").delete().eq("id", link_id).execute()
    
    return {"ok": True}
