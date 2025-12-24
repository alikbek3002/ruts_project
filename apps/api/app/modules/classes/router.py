from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.core.security import verify_password
from app.db.supabase_client import get_supabase

router = APIRouter()


class CreateClassIn(BaseModel):
    name: str
    direction_id: str | None = None
    curator_id: str | None = None


class UpdateClassIn(BaseModel):
    name: str | None = None
    direction_id: str | None = None
    curator_id: str | None = None


@router.post("")
def create_class(payload: CreateClassIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        data = {"name": payload.name}
        if payload.direction_id:
            data["direction_id"] = payload.direction_id
        if payload.curator_id:
            data["curator_id"] = payload.curator_id
        resp = sb.table("classes").insert(data).execute()
        return {"class": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to create class. Ensure the base DB schema is applied "
                "(see supabase/migrations/20251222_000001_mvp.sql) and restart the API."
            ),
        )


@router.put("/{class_id}")
def update_class(class_id: str, payload: UpdateClassIn, _: dict = require_role("admin", "manager")):
    """Обновить группу (название и/или направление)"""
    sb = get_supabase()
    update_data: dict = {}
    if payload.name is not None:
        update_data["name"] = payload.name
    if payload.direction_id is not None:
        update_data["direction_id"] = payload.direction_id if payload.direction_id else None
    if payload.curator_id is not None:
        update_data["curator_id"] = payload.curator_id if payload.curator_id else None
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    try:
        resp = sb.table("classes").update(update_data).eq("id", class_id).execute()
        row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
        if not row:
            raise HTTPException(status_code=404, detail="Class not found")
        return {"class": row}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to update class")


@router.delete("/{class_id}")
def delete_class(class_id: str, _: dict = require_role("admin", "manager")):
    # Force password confirmation to avoid accidental deletions.
    raise HTTPException(status_code=400, detail="Password confirmation required. Use POST /classes/{class_id}/delete")


class DeleteClassIn(BaseModel):
    actor_password: str


@router.post("/{class_id}/delete")
def delete_class_with_password(
    class_id: str,
    payload: DeleteClassIn,
    actor: dict = require_role("admin", "manager"),
):
    """Удалить группу/взвод (с подтверждением паролем админа/менеджера)."""
    sb = get_supabase()

    # Verify actor password
    a_rows = sb.table("users").select("id,password_hash").eq("id", actor["id"]).limit(1).execute().data or []
    a = a_rows[0] if isinstance(a_rows, list) and a_rows else None
    if not a or not verify_password(payload.actor_password, a["password_hash"]):
        raise HTTPException(status_code=400, detail="Wrong admin/manager password")

    try:
        existing = sb.table("classes").select("id").eq("id", class_id).limit(1).execute().data
        if not existing:
            raise HTTPException(status_code=404, detail="Class not found")
        sb.table("classes").delete().eq("id", class_id).execute()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete class")


@router.get("")
def list_classes(user: CurrentUser):
    sb = get_supabase()
    try:
        if user["role"] in ("admin", "manager"):
            # Получаем классы с направлениями
            resp = sb.table("classes").select("id,name,direction_id,curator_id,directions(id,name,code)").order("name").execute()
            classes = resp.data or []
            
            # Подсчитываем студентов для каждого класса
            for cls in classes:
                count_resp = sb.table("class_enrollments").select("student_id", count="exact").eq("class_id", cls["id"]).execute()
                cls["student_count"] = count_resp.count or 0
                # Flatten direction
                if cls.get("directions"):
                    cls["direction"] = cls["directions"]
                else:
                    cls["direction"] = None
                cls.pop("directions", None)
            
            return {"classes": classes}

        if user["role"] == "teacher":
            # teacher: list classes where teacher has timetable entries
            tt = (
                sb.table("timetable_entries")
                .select("class_id")
                .eq("teacher_id", user["id"])
                .execute()
                .data
                or []
            )
            class_ids = list({r.get("class_id") for r in tt if r.get("class_id")})
            if not class_ids:
                return {"classes": []}
            resp = sb.table("classes").select("id,name").in_("id", class_ids).order("name").execute()
            return {"classes": resp.data or []}

        if user["role"] == "student":
            enr = (
                sb.table("class_enrollments")
                .select("class_id")
                .eq("student_id", user["id"])
                .execute()
                .data
                or []
            )
            class_ids = [r.get("class_id") for r in enr if r.get("class_id")]
            if not class_ids:
                return {"classes": []}
            resp = sb.table("classes").select("id,name").in_("id", class_ids).order("name").execute()
            return {"classes": resp.data or []}

        # fallback
        return {"classes": []}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to list classes: {e}. "
                "Ensure DB migrations are applied (at minimum supabase/migrations/20251222_000001_mvp.sql, "
                "and for curator_id specifically supabase/migrations/20251224_000009_curators_and_student_numbers.sql), "
                "then restart the API."
            ),
        )


@router.get("/{class_id}")
def get_class(class_id: str, user: CurrentUser):
    sb = get_supabase()
    try:
        # basic access control: admin always; teacher if has timetable entry; student if enrolled
        if user["role"] == "teacher":
            allowed = False
            tt = (
                sb.table("timetable_entries")
                .select("id")
                .eq("class_id", class_id)
                .eq("teacher_id", user["id"])
                .limit(1)
                .execute()
                .data
            )
            if tt:
                allowed = True
            else:
                cls = sb.table("classes").select("id,curator_id").eq("id", class_id).limit(1).execute().data
                if cls and cls[0].get("curator_id") == user["id"]:
                    allowed = True
            if not allowed:
                return {"class": None, "students": []}

        if user["role"] == "student":
            enr = (
                sb.table("class_enrollments")
                .select("class_id")
                .eq("class_id", class_id)
                .eq("student_id", user["id"])
                .limit(1)
                .execute()
                .data
            )
            if not enr:
                return {"class": None, "students": []}

        c = sb.table("classes").select("id,name,direction_id,curator_id").eq("id", class_id).single().execute().data
        enr_rows = (
            sb.table("class_enrollments")
            .select("student_id,student_number")
            .eq("class_id", class_id)
            .execute()
            .data
            or []
        )
        student_ids = [r.get("student_id") for r in enr_rows if r.get("student_id")]
        if not student_ids:
            return {"class": c, "students": []}

        uresp = sb.table("users").select("id,username,full_name").in_("id", student_ids).execute()
        students = uresp.data or []
        num_by_id = {r.get("student_id"): r.get("student_number") for r in enr_rows if r.get("student_id")}
        for s in students:
            s["student_number"] = num_by_id.get(s.get("id"))
        students.sort(key=lambda s: (s.get("student_number") is None, s.get("student_number") or 0, s.get("full_name") or "", s.get("username") or ""))
        return {"class": c, "students": students}
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to load class details. Ensure the base DB schema is applied "
                "(see supabase/migrations/20251222_000001_mvp.sql) and restart the API."
            ),
        )


class EnrollIn(BaseModel):
    student_id: str


@router.post("/{class_id}/enroll")
def enroll_student(class_id: str, payload: EnrollIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        # Enforce max 35
        count_resp = sb.table("class_enrollments").select("student_id", count="exact").eq("class_id", class_id).execute()
        if (count_resp.count or 0) >= 35:
            raise HTTPException(status_code=400, detail="Class can have maximum 35 students")

        # Already enrolled?
        existing = (
            sb.table("class_enrollments")
            .select("student_id")
            .eq("class_id", class_id)
            .eq("student_id", payload.student_id)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            return {"ok": True}

        # Determine next student number
        max_row = (
            sb.table("class_enrollments")
            .select("student_number")
            .eq("class_id", class_id)
            .order("student_number", desc=True)
            .limit(1)
            .execute()
            .data
        )
        next_num = 1
        if max_row and max_row[0].get("student_number"):
            next_num = int(max_row[0]["student_number"]) + 1
        if next_num > 35:
            raise HTTPException(status_code=400, detail="Class can have maximum 35 students")

        sb.table("class_enrollments").insert({"class_id": class_id, "student_id": payload.student_id, "student_number": next_num}).execute()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to enroll student. Ensure the base DB schema is applied "
                "(see supabase/migrations/20251222_000001_mvp.sql) and restart the API."
            ),
        )


@router.get("/curated")
def list_curated_classes(user: dict = require_role("teacher")):
    """Список взводов, где текущий учитель назначен куратором."""
    sb = get_supabase()
    resp = (
        sb.table("classes")
        .select("id,name,direction_id,curator_id,directions(id,name,code)")
        .eq("curator_id", user["id"])
        .order("name")
        .execute()
    )
    classes = resp.data or []
    for cls in classes:
        count_resp = sb.table("class_enrollments").select("student_id", count="exact").eq("class_id", cls["id"]).execute()
        cls["student_count"] = count_resp.count or 0
        cls["direction"] = cls.get("directions") or None
        cls.pop("directions", None)
    return {"classes": classes}
