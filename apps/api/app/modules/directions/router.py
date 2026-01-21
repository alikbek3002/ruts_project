from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


@router.get("")
def list_directions(user: dict = require_role("admin", "manager")):
    """Список всех направлений"""
    sb = get_supabase()
    resp = sb.table("directions").select("*").order("name").execute()
    return {"directions": resp.data or []}


class DirectionSubjectInput(BaseModel):
    subject_id: str
    lecture_hours: float = 0
    seminar_hours: float = 0
    practical_hours: float = 0
    exam_hours: float = 0
    total_hours: float = 0


@router.get("/{direction_id}/subjects")
def list_direction_subjects(direction_id: str, user: dict = require_role("admin", "manager")):
    """Список предметов в плане направления"""
    sb = get_supabase()
    
    # Get subjects linked to this direction
    resp = (
        sb.table("direction_subjects")
        .select("*, subjects(id,name)")
        .eq("direction_id", direction_id)
        .execute()
    )
    
    # Flatten structure
    results = []
    for item in resp.data or []:
        subj = item.get("subjects") or {}
        results.append({
            "id": item["id"],
            "direction_id": item["direction_id"],
            "subject_id": item["subject_id"],
            "subject_name": subj.get("name") or "???",
            "lecture_hours": item.get("lecture_hours", 0),
            "seminar_hours": item.get("seminar_hours", 0),
            "practical_hours": item.get("practical_hours", 0),
            "exam_hours": item.get("exam_hours", 0),
            "total_hours": item.get("total_hours", 0),
        })
        
    return {"subjects": results}


@router.post("/{direction_id}/subjects")
def add_direction_subject(direction_id: str, payload: DirectionSubjectInput, user: dict = require_role("admin", "manager")):
    """Добавить предмет в план направления"""
    sb = get_supabase()
    
    # Check if exists
    existing = (
        sb.table("direction_subjects")
        .select("id")
        .eq("direction_id", direction_id)
        .eq("subject_id", payload.subject_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=400, detail="Subject already in plan")

    data = {
        "direction_id": direction_id,
        "subject_id": payload.subject_id,
        "lecture_hours": payload.lecture_hours,
        "seminar_hours": payload.seminar_hours,
        "practical_hours": payload.practical_hours,
        "exam_hours": payload.exam_hours,
        "total_hours": payload.total_hours
    }
    
    resp = sb.table("direction_subjects").insert(data).execute()
    return {"subject": resp.data[0] if resp.data else None}


@router.put("/{direction_id}/subjects/{item_id}")
def update_direction_subject(direction_id: str, item_id: str, payload: DirectionSubjectInput, user: dict = require_role("admin", "manager")):
    """Обновить часы по предмету в направлении"""
    sb = get_supabase()
    
    data = {
        "lecture_hours": payload.lecture_hours,
        "seminar_hours": payload.seminar_hours,
        "practical_hours": payload.practical_hours,
        "exam_hours": payload.exam_hours,
        "total_hours": payload.total_hours
    }
    
    resp = sb.table("direction_subjects").update(data).eq("id", item_id).execute()
    return {"subject": resp.data[0] if resp.data else None}


@router.delete("/{direction_id}/subjects/{item_id}")
def delete_direction_subject(direction_id: str, item_id: str, user: dict = require_role("admin", "manager")):
    """Удалить предмет из плана направления"""
    sb = get_supabase()
    sb.table("direction_subjects").delete().eq("id", item_id).execute()
    return {"ok": True}

