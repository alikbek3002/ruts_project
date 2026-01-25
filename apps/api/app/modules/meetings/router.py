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
    class_ids: list[str] | None = None
    stream_id: str | None = None
    audience: str | None = None


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
        "audience": payload.audience,
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
    link = resp.data[0] if resp.data else None
    
    if link and payload.class_ids:
        audience_data = [{"meeting_link_id": link["id"], "class_id": cid} for cid in payload.class_ids]
        if audience_data:
            sb.table("meeting_link_audiences").insert(audience_data).execute()
            
    return {"link": link}


@router.get("/links")
def list_meeting_links(
    class_id: str | None = None,
    stream_id: str | None = None,
    audience: str | None = None,
    user: dict = require_role("teacher", "admin", "manager", "student")
):
    """Список ссылок на конференции"""
    sb = get_supabase()
    
    query = sb.table("meeting_links").select("*, classes(name), meeting_link_audiences(class_id, classes(name))")
    
    if class_id:
        # Find links directly assigned to class OR assigned via audience table
        # Because 'or' filter syntax with joins is tricky, we'll fetch IDs first
        
        # 1. Get IDs from audience table Make sure to select meeting_link_id
        audience_matches = sb.table("meeting_link_audiences").select("meeting_link_id").eq("class_id", class_id).execute()
        matched_ids = [row["meeting_link_id"] for row in (audience_matches.data or [])]
        
        if matched_ids:
            # query = query.or_(f"class_id.eq.{class_id},id.in.({','.join(matched_ids)})")
            # Supabase postgrest filter for IN is `id.in.(x,y,z)`
            # OR syntax: `or=(class_id.eq.X,id.in.(...))`
            ids_str = ",".join(matched_ids)
            query = query.or_(f"class_id.eq.{class_id},id.in.({ids_str})")
        else:
            query = query.eq("class_id", class_id)
    
    if stream_id:
        query = query.eq("stream_id", stream_id)

    if audience:
        query = query.eq("audience", audience)
        
    # If teacher, maybe they want to see only created by them?
    # The requirement says "teacher assigns... list...". 
    # Usually teachers see what they created. 
    # But if they are viewing for a specific group, they might want to see all links for that group.
    # Current logic lists all links matching filter.
    if user.get("role") == "teacher" and not class_id and not stream_id:
         query = query.eq("created_by", user.get("id"))
    
    query = query.order("created_at", desc=True).limit(50)
    resp = query.execute()
    
    links = []
    for r in (resp.data or []):
        # Flatten classes from single join
        if r.get("classes"):
            r["class_name"] = r["classes"]["name"]
            
        # Add class names from audience join
        audience_groups = []
        if r.get("meeting_link_audiences"):
            for aud in r["meeting_link_audiences"]:
                if aud.get("classes"):
                    audience_groups.append(aud["classes"]["name"])
        
        if audience_groups:
             r["audience_names"] = audience_groups
             
        # Cleanup
        if "classes" in r: del r["classes"]
        if "meeting_link_audiences" in r: del r["meeting_link_audiences"]
            
        links.append(r)
    
    return {"links": links}


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

