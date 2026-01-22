from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


class CurriculumItemInput(BaseModel):
    subject_id: str
    section: str  # 'general', 'special_legal', 'special'
    total_hours: float = 0
    lecture_hours: float = 0
    seminar_hours: float = 0
    practical_hours: float = 0
    credit_hours: float = 0
    exam_hours: float = 0
    test_hours: float = 0


@router.get("/{direction_id}/curriculum")
def list_curriculum(direction_id: str, user: dict = require_role("admin", "manager", "teacher", "student")):
    """Получить учебный план направления"""
    sb = get_supabase()
    
    resp = (
        sb.table("curriculum_plan")
        .select("*, subjects(id,name)")
        .eq("direction_id", direction_id)
        .execute()
    )
    
    # Flatten and group by section
    results = []
    for item in resp.data or []:
        subj = item.get("subjects") or {}
        results.append({
            "id": item["id"],
            "direction_id": item["direction_id"],
            "subject_id": item["subject_id"],
            "subject_name": subj.get("name") or "???",
            "section": item.get("section", "general"),
            "total_hours": item.get("total_hours", 0),
            "lecture_hours": item.get("lecture_hours", 0),
            "seminar_hours": item.get("seminar_hours", 0),
            "practical_hours": item.get("practical_hours", 0),
            "credit_hours": item.get("credit_hours", 0),
            "exam_hours": item.get("exam_hours", 0),
            "test_hours": item.get("test_hours", 0),
        })
    
    return {"items": results}


@router.post("/{direction_id}/curriculum")
def add_curriculum_item(direction_id: str, payload: CurriculumItemInput, user: dict = require_role("admin", "manager")):
    """Добавить предмет в учебный план"""
    sb = get_supabase()
    
    # Check if exists
    existing = (
        sb.table("curriculum_plan")
        .select("id")
        .eq("direction_id", direction_id)
        .eq("subject_id", payload.subject_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=400, detail="Subject already in curriculum")
    
    # Validate section
    if payload.section not in ['general', 'special_legal', 'special']:
        raise HTTPException(status_code=400, detail="Invalid section")
    
    data = {
        "direction_id": direction_id,
        "subject_id": payload.subject_id,
        "section": payload.section,
        "total_hours": payload.total_hours,
        "lecture_hours": payload.lecture_hours,
        "seminar_hours": payload.seminar_hours,
        "practical_hours": payload.practical_hours,
        "credit_hours": payload.credit_hours,
        "exam_hours": payload.exam_hours,
        "test_hours": payload.test_hours,
    }
    
    resp = sb.table("curriculum_plan").insert(data).execute()
    return {"item": resp.data[0] if resp.data else None}


@router.put("/{direction_id}/curriculum/{item_id}")
def update_curriculum_item(direction_id: str, item_id: str, payload: CurriculumItemInput, user: dict = require_role("admin", "manager")):
    """Обновить предмет в учебном плане"""
    sb = get_supabase()
    
    # Validate section
    if payload.section not in ['general', 'special_legal', 'special']:
        raise HTTPException(status_code=400, detail="Invalid section")
    
    data = {
        "subject_id": payload.subject_id,
        "section": payload.section,
        "total_hours": payload.total_hours,
        "lecture_hours": payload.lecture_hours,
        "seminar_hours": payload.seminar_hours,
        "practical_hours": payload.practical_hours,
        "credit_hours": payload.credit_hours,
        "exam_hours": payload.exam_hours,
        "test_hours": payload.test_hours,
    }
    
    resp = sb.table("curriculum_plan").update(data).eq("id", item_id).execute()
    return {"item": resp.data[0] if resp.data else None}


@router.delete("/{direction_id}/curriculum/{item_id}")
def delete_curriculum_item(direction_id: str, item_id: str, user: dict = require_role("admin", "manager")):
    """Удалить предмет из учебного плана"""
    sb = get_supabase()
    sb.table("curriculum_plan").delete().eq("id", item_id).execute()
    return {"ok": True}


@router.post("/{direction_id}/curriculum/duplicate")
def duplicate_curriculum(
    direction_id: str, 
    target_direction_id: str, 
    overwrite: bool = False,
    user: dict = require_role("admin", "manager")
):
    """Дублировать учебный план в другое направление
    
    Args:
        direction_id: ID исходного направления
        target_direction_id: ID целевого направления
        overwrite: Если True, удалить существующий учебный план в целевом направлении перед копированием
    """
    sb = get_supabase()
    
    # Get source curriculum
    source = (
        sb.table("curriculum_plan")
        .select("*")
        .eq("direction_id", direction_id)
        .execute()
    )
    
    if not source.data or len(source.data) == 0:
        raise HTTPException(status_code=400, detail="Source curriculum is empty")
    
    # Check if target already has curriculum
    existing = (
        sb.table("curriculum_plan")
        .select("id")
        .eq("direction_id", target_direction_id)
        .execute()
    )
    
    if existing.data and len(existing.data) > 0:
        if overwrite:
            # Delete existing curriculum items
            sb.table("curriculum_plan").delete().eq("direction_id", target_direction_id).execute()
        else:
            raise HTTPException(status_code=400, detail="Target direction already has curriculum items. Use overwrite=true to replace them.")
    
    # Copy items
    new_items = []
    for item in source.data:
        new_items.append({
            "direction_id": target_direction_id,
            "subject_id": item["subject_id"],
            "section": item.get("section", "general"),
            "total_hours": item.get("total_hours", 0),
            "lecture_hours": item.get("lecture_hours", 0),
            "seminar_hours": item.get("seminar_hours", 0),
            "practical_hours": item.get("practical_hours", 0),
            "credit_hours": item.get("credit_hours", 0),
            "exam_hours": item.get("exam_hours", 0),
            "test_hours": item.get("test_hours", 0),
        })
    
    if new_items:
        sb.table("curriculum_plan").insert(new_items).execute()
    
    return {"ok": True, "copied_count": len(new_items)}
