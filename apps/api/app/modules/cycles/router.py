from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


# ============ Pydantic Models ============

class AssignSubjectCycleIn(BaseModel):
    cycle_id: str | None = None


class SetTeacherCyclesIn(BaseModel):
    cycle_ids: list[str]


# ============ Helpers ============

def _teacher_display_name(row: dict) -> str:
    name = (row.get("full_name") or "").strip()
    if name:
        return name
    return (row.get("username") or "").strip() or "---"


# ============ Cycles CRUD ============

@router.get("/cycles")
def list_cycles(user: dict = require_role("admin", "manager", "teacher")):
    """Список всех циклов"""
    sb = get_supabase()
    resp = sb.table("cycles").select("*").order("code").execute()
    return {"cycles": resp.data or []}


@router.get("/cycles/{cycle_id}")
def get_cycle_detail(cycle_id: str, user: dict = require_role("admin", "manager")):
    """Детали цикла с предметами и учителями"""
    sb = get_supabase()
    
    # Get cycle
    cycle = sb.table("cycles").select("*").eq("id", cycle_id).limit(1).execute().data
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    cycle = cycle[0]
    
    # Get subjects in this cycle
    subjects = (
        sb.table("subjects")
        .select("id,name,photo_url")
        .eq("cycle_id", cycle_id)
        .is_("archived_at", "null")
        .order("name")
        .execute()
        .data or []
    )
    
    # Get teachers assigned to this cycle
    teacher_links = (
        sb.table("teacher_cycles")
        .select("teacher_id")
        .eq("cycle_id", cycle_id)
        .execute()
        .data or []
    )
    
    teacher_ids = [r.get("teacher_id") for r in teacher_links if r.get("teacher_id")]
    teachers = []
    if teacher_ids:
        teacher_rows = (
            sb.table("users")
            .select("id,username,full_name,photo_data_url")
            .in_("id", teacher_ids)
            .eq("role", "teacher")
            .eq("is_active", True)
            .is_("archived_at", "null")
            .order("full_name")
            .execute()
            .data or []
        )
        teachers = [
            {"id": t["id"], "name": _teacher_display_name(t), "photo_url": t.get("photo_data_url")}
            for t in teacher_rows
        ]
    
    return {
        "cycle": cycle,
        "subjects": subjects,
        "teachers": teachers,
    }


# ============ Subject-Cycle Assignment ============

@router.put("/subjects/{subject_id}/cycle")
def assign_subject_to_cycle(subject_id: str, payload: AssignSubjectCycleIn, user: dict = require_role("admin", "manager")):
    """Назначить предмет на цикл (или убрать из цикла если cycle_id=null)"""
    sb = get_supabase()
    
    # Check subject exists
    subject = sb.table("subjects").select("id").eq("id", subject_id).limit(1).execute().data
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Validate cycle if provided
    if payload.cycle_id:
        cycle = sb.table("cycles").select("id").eq("id", payload.cycle_id).limit(1).execute().data
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
    
    # Update subject
    sb.table("subjects").update({"cycle_id": payload.cycle_id}).eq("id", subject_id).execute()
    
    return {"ok": True}


# ============ Teacher-Cycle Assignment ============

@router.get("/teachers/{teacher_id}/cycles")
def get_teacher_cycles(teacher_id: str, user: dict = require_role("admin", "manager", "teacher")):
    """Получить циклы учителя"""
    sb = get_supabase()
    
    # Check user has access (teacher can only see their own cycles)
    if user.get("role") == "teacher" and str(user.get("id")) != teacher_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    links = (
        sb.table("teacher_cycles")
        .select("cycle_id, cycles(id,code,name)")
        .eq("teacher_id", teacher_id)
        .execute()
        .data or []
    )
    
    cycles = []
    for link in links:
        if link.get("cycles"):
            cycles.append(link["cycles"])
    
    return {"cycles": cycles}


@router.put("/teachers/{teacher_id}/cycles")
def set_teacher_cycles(teacher_id: str, payload: SetTeacherCyclesIn, user: dict = require_role("admin", "manager")):
    """Назначить учителя на циклы (заменяет существующие)"""
    sb = get_supabase()
    
    # Check teacher exists
    teacher = sb.table("users").select("id,role").eq("id", teacher_id).limit(1).execute().data
    if not teacher or teacher[0].get("role") != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    cycle_ids = list(dict.fromkeys([c.strip() for c in (payload.cycle_ids or []) if c.strip()]))
    
    # Validate cycles exist
    if cycle_ids:
        existing = sb.table("cycles").select("id").in_("id", cycle_ids).execute().data or []
        if len(existing) != len(cycle_ids):
            raise HTTPException(status_code=404, detail="One or more cycles not found")
    
    # Delete existing links
    sb.table("teacher_cycles").delete().eq("teacher_id", teacher_id).execute()
    
    # Insert new links
    for cid in cycle_ids:
        sb.table("teacher_cycles").insert({"teacher_id": teacher_id, "cycle_id": cid}).execute()
    
    return {"ok": True, "cycle_ids": cycle_ids}


@router.post("/cycles/{cycle_id}/teachers/{teacher_id}")
def add_teacher_to_cycle(cycle_id: str, teacher_id: str, user: dict = require_role("admin", "manager")):
    """Добавить учителя в цикл"""
    sb = get_supabase()
    
    # Check cycle exists
    cycle = sb.table("cycles").select("id").eq("id", cycle_id).limit(1).execute().data
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    
    # Check teacher exists
    teacher = sb.table("users").select("id,role").eq("id", teacher_id).limit(1).execute().data
    if not teacher or teacher[0].get("role") != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    # Check if already exists
    existing = (
        sb.table("teacher_cycles")
        .select("teacher_id")
        .eq("teacher_id", teacher_id)
        .eq("cycle_id", cycle_id)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return {"ok": True, "message": "Already assigned"}
    
    # Create link
    sb.table("teacher_cycles").insert({"teacher_id": teacher_id, "cycle_id": cycle_id}).execute()
    
    return {"ok": True}


@router.delete("/cycles/{cycle_id}/teachers/{teacher_id}")
def remove_teacher_from_cycle(cycle_id: str, teacher_id: str, user: dict = require_role("admin", "manager")):
    """Убрать учителя из цикла"""
    sb = get_supabase()
    sb.table("teacher_cycles").delete().eq("teacher_id", teacher_id).eq("cycle_id", cycle_id).execute()
    return {"ok": True}


@router.get("/teachers/busy")
def list_busy_teachers(user: dict = require_role("admin", "manager")):
    """Возвращает список всех учителей с их циклами"""
    sb = get_supabase()
    
    # Get all active teachers
    teachers_resp = (
        sb.table("users")
        .select("id,full_name,username,photo_data_url")
        .eq("role", "teacher")
        .eq("is_active", True)
        .is_("archived_at", "null")
        .order("full_name")
        .execute()
    )
    all_teachers = teachers_resp.data or []
    
    # Get all assignments
    assignments = sb.table("teacher_cycles").select("teacher_id,cycle_id").execute().data or []
    busy_map = {} # teacher_id -> [cycle_id]
    for a in assignments:
        tid = a.get("teacher_id")
        cid = a.get("cycle_id")
        if tid and cid:
            if tid not in busy_map:
                busy_map[tid] = []
            busy_map[tid].append(cid)
            
    result = []
    for t in all_teachers:
        busy_cycles = busy_map.get(t["id"], [])
        result.append({
            "id": t["id"],
            "name": _teacher_display_name(t),
            "photo_url": t.get("photo_data_url"),
            "cycle_ids": busy_cycles
        })
        
    return {"teachers": result}
