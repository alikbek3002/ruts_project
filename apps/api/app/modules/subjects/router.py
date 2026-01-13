from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


def _teacher_display_name(row: dict) -> str:
    name = (row.get("full_name") or "").strip()
    if name:
        return name
    return (row.get("username") or "").strip() or "---"


class CreateSubjectIn(BaseModel):
    name: str
    photo_url: str | None = None


class UpdateSubjectIn(BaseModel):
    name: str
    photo_url: str | None = None


class AssignSubjectIn(BaseModel):
    teacher_id: str
    subject_id: str


class ReplaceTeacherSubjectsIn(BaseModel):
    subject_ids: list[str]


@router.get("/subjects")
def list_subjects(user: dict = require_role("admin", "manager", "teacher")):
    """Список всех предметов"""
    sb = get_supabase()
    resp = sb.table("subjects").select("*").order("name").execute()
    return {"subjects": resp.data or []}


@router.get("/subjects-with-teachers")
def list_subjects_with_teachers(user: dict = require_role("admin", "manager")):
    """Список предметов + учителя, которым назначен предмет.

    Нужен для админ-страницы "Предметы", чтобы отображать учителей на карточках.
    """
    sb = get_supabase()

    subjects = sb.table("subjects").select("*").order("name").execute().data or []
    links = sb.table("teacher_subjects").select("teacher_id,subject_id").execute().data or []

    teacher_ids: list[str] = []
    for r in links:
        tid = r.get("teacher_id")
        if tid:
            teacher_ids.append(str(tid))
    teacher_ids = list(dict.fromkeys(teacher_ids))

    teachers_by_id: dict[str, dict] = {}
    if teacher_ids:
        teacher_rows = (
            sb.table("users")
            .select("id,role,full_name,username")
            .in_("id", teacher_ids)
            .execute()
            .data
            or []
        )
        for t in teacher_rows:
            if t.get("id"):
                teachers_by_id[str(t["id"])] = t

    teachers_for_subject: dict[str, list[dict]] = {}
    for link in links:
        sid = link.get("subject_id")
        tid = link.get("teacher_id")
        if not sid or not tid:
            continue
        t = teachers_by_id.get(str(tid))
        if not t or t.get("role") != "teacher":
            continue
        teachers_for_subject.setdefault(str(sid), []).append(
            {"id": str(tid), "name": _teacher_display_name(t)}
        )

    enriched = []
    for s in subjects:
        sid = str(s.get("id")) if s.get("id") else ""
        enriched.append({**s, "teachers": teachers_for_subject.get(sid, [])})

    return {"subjects": enriched}


@router.post("/subjects")
def create_subject(payload: CreateSubjectIn, user: dict = require_role("admin", "manager")):
    """Создать предмет (только админ/менеджер)"""
    sb = get_supabase()
    
    name = payload.name.strip()
    photo_url = payload.photo_url.strip() if isinstance(payload.photo_url, str) and payload.photo_url.strip() else None

    # Проверяем что предмет с таким именем не существует
    existing = sb.table("subjects").select("id").eq("name", name).limit(1).execute().data
    if existing:
        raise HTTPException(status_code=400, detail="Subject already exists")
    
    insert_data = {"name": name}
    if photo_url:
        insert_data["photo_url"] = photo_url

    resp = sb.table("subjects").insert(insert_data).execute()
    return {"subject": resp.data[0] if resp.data else None}


@router.put("/subjects/{subject_id}")
def update_subject(subject_id: str, payload: UpdateSubjectIn, user: dict = require_role("admin", "manager")):
    """Обновить предмет (только админ/менеджер)"""
    sb = get_supabase()
    
    # Проверяем что предмет существует
    existing = sb.table("subjects").select("id,name").eq("id", subject_id).limit(1).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    name = payload.name.strip()
    photo_url = payload.photo_url.strip() if isinstance(payload.photo_url, str) and payload.photo_url.strip() else None
    
    # Проверяем что другой предмет с таким именем не существует
    if name != existing[0].get("name"):
        name_check = sb.table("subjects").select("id").eq("name", name).limit(1).execute().data
        if name_check:
            raise HTTPException(status_code=400, detail="Subject with this name already exists")
    
    update_data = {"name": name}
    if photo_url:
        update_data["photo_url"] = photo_url
    else:
        update_data["photo_url"] = None

    resp = sb.table("subjects").update(update_data).eq("id", subject_id).execute()
    return {"subject": resp.data[0] if resp.data else None}


@router.delete("/subjects/{subject_id}")
def delete_subject(subject_id: str, user: dict = require_role("admin", "manager")):
    """Удалить предмет"""
    sb = get_supabase()
    sb.table("subjects").delete().eq("id", subject_id).execute()
    return {"ok": True}


@router.get("/teachers/{teacher_id}/subjects")
def get_teacher_subjects(teacher_id: str, user: dict = require_role("admin", "manager")):
    """Получить предметы учителя"""
    sb = get_supabase()
    
    resp = (
        sb.table("teacher_subjects")
        .select("subject_id, subjects(id,name)")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    
    subjects = []
    for row in resp.data or []:
        if row.get("subjects"):
            subjects.append(row["subjects"])
    
    return {"subjects": subjects}


@router.post("/teachers/assign-subject")
def assign_subject_to_teacher(payload: AssignSubjectIn, user: dict = require_role("admin", "manager")):
    """Присвоить предмет учителю (максимум 2)"""
    sb = get_supabase()
    
    # Проверяем что учитель существует
    teacher = sb.table("users").select("id,role").eq("id", payload.teacher_id).limit(1).execute().data
    if not teacher or teacher[0].get("role") != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    # Проверяем что предмет существует
    subject = sb.table("subjects").select("id").eq("id", payload.subject_id).limit(1).execute().data
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Проверяем количество предметов у учителя
    count = sb.table("teacher_subjects").select("subject_id", count="exact").eq("teacher_id", payload.teacher_id).execute()
    if count.count and count.count >= 3:
        raise HTTPException(status_code=400, detail="Teacher can have maximum 3 subjects")
    
    # Проверяем что связь не существует
    existing = (
        sb.table("teacher_subjects")
        .select("teacher_id")
        .eq("teacher_id", payload.teacher_id)
        .eq("subject_id", payload.subject_id)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(status_code=400, detail="Teacher already has this subject")
    
    # Создаем связь
    sb.table("teacher_subjects").insert({
        "teacher_id": payload.teacher_id,
        "subject_id": payload.subject_id
    }).execute()
    
    return {"ok": True}


@router.delete("/teachers/{teacher_id}/subjects/{subject_id}")
def remove_subject_from_teacher(teacher_id: str, subject_id: str, user: dict = require_role("admin", "manager")):
    """Убрать предмет у учителя"""
    sb = get_supabase()
    sb.table("teacher_subjects").delete().eq("teacher_id", teacher_id).eq("subject_id", subject_id).execute()
    return {"ok": True}


@router.put("/teachers/{teacher_id}/subjects")
def replace_teacher_subjects(teacher_id: str, payload: ReplaceTeacherSubjectsIn, user: dict = require_role("admin", "manager")):
    """Заменить предметы учителя (назначается при создании/редактировании учителя; максимум 2)."""
    sb = get_supabase()

    # Validate teacher
    teacher = sb.table("users").select("id,role").eq("id", teacher_id).limit(1).execute().data
    if not teacher or teacher[0].get("role") != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")

    subject_ids = [s.strip() for s in (payload.subject_ids or []) if isinstance(s, str) and s.strip()]
    # unique preserve order
    subject_ids = list(dict.fromkeys(subject_ids))
    if len(subject_ids) < 1:
        raise HTTPException(status_code=400, detail="At least one subject is required")
    if len(subject_ids) > 3:
        raise HTTPException(status_code=400, detail="Teacher can have maximum 3 subjects")

    # Validate subjects exist and collect names
    subj_rows = sb.table("subjects").select("id,name").in_("id", subject_ids).execute().data or []
    found = {r.get("id") for r in subj_rows}
    if len(found) != len(subject_ids):
        raise HTTPException(status_code=404, detail="Subject not found")

    names_by_id = {r.get("id"): (r.get("name") or "") for r in subj_rows}
    subject_names = [str(names_by_id.get(sid, "")).strip() for sid in subject_ids]
    subject_names = [n for n in subject_names if n]

    # Replace links
    sb.table("teacher_subjects").delete().eq("teacher_id", teacher_id).execute()
    for sid in subject_ids:
        sb.table("teacher_subjects").insert({"teacher_id": teacher_id, "subject_id": sid}).execute()

    # Keep legacy display field in users
    sb.table("users").update({"teacher_subject": ", ".join(subject_names[:2]) if subject_names else None}).eq("id", teacher_id).execute()

    return {"ok": True, "subject_ids": subject_ids}
