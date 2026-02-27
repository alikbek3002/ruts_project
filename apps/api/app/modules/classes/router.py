from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
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
        
        # Очищаем кеш после создания
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"class": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to create class: {str(e)}. "
                "Ensure all DB migrations are applied "
                "(see supabase/migrations/) and restart the API."
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
        
        # Очищаем кеш после обновления
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
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
        
        # Очищаем кеш после удаления
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete class")


@router.get("")
def list_classes(user: dict = Depends(get_current_user)):
    from app.core.cache import cache
    
    # Cache list of classes for better performance
    cache_key = f"classes_list:{user['role']}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    
    sb = get_supabase()
    try:
        if user["role"] in ("admin", "manager"):
            # Получаем классы с направлениями
            resp = sb.table("classes").select("id,name,direction_id,curator_id,directions(id,name,code)").is_("archived_at", "null").order("name").execute()
            classes = resp.data or []
            
            # Оптимизация: один запрос для подсчёта студентов всех классов
            class_ids = [c["id"] for c in classes if c.get("id")]
            student_counts: dict[str, int] = {}
            if class_ids:
                all_enrollments = (
                    sb.table("class_enrollments")
                    .select("class_id")
                    .in_("class_id", class_ids)
                    .execute()
                    .data
                    or []
                )
                for enr in all_enrollments:
                    cid = enr.get("class_id")
                    if cid:
                        student_counts[cid] = student_counts.get(cid, 0) + 1
            
            for cls in classes:
                cls["student_count"] = student_counts.get(cls["id"], 0)
                # Flatten direction
                if cls.get("directions"):
                    cls["direction"] = cls["directions"]
                else:
                    cls["direction"] = None
                cls.pop("directions", None)
            
            result = {"classes": classes}
            cache.set(cache_key, result, ttl=60)  # Cache for 1 minute
            return result

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
                result = {"classes": []}
                cache.set(cache_key, result, ttl=60)
                return result
            resp = sb.table("classes").select("id,name").in_("id", class_ids).order("name").execute()
            result = {"classes": resp.data or []}
            cache.set(cache_key, result, ttl=60)
            return result

        if user["role"] == "student":
            # For shared student account: return ALL classes
            # Students will filter in UI by selecting their class
            resp = sb.table("classes").select("id,name").order("name").execute()
            result = {"classes": resp.data or []}
            cache.set(cache_key, result, ttl=60)
            return result

        # fallback
        return {"classes": []}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to list classes: {e}. "
                "Ensure DB migrations are applied (at minimum supabase/migrations/20251222_000001_mvp.sql, "
                "and for curator_id specifically supabase/migrations/20251224_000009_curators_and_student_numbers.sql), "
                "then restart the API."
            ),
        )


@router.get("/curated")
def list_curated_classes(user: dict = require_role("teacher")):
    """Список взводов, где текущий учитель назначен куратором."""
    sb = get_supabase()
    try:
        # Ensure user_id is a valid UUID string
        user_id = str(user["id"])
        resp = (
            sb.table("classes")
            .select("id,name,direction_id,curator_id,directions(id,name,code)")
            .eq("curator_id", user_id)
            .order("name")
            .execute()
        )
        classes = resp.data or []
        for cls in classes:
            count_resp = sb.table("class_enrollments").select("id", count="exact").eq("class_id", cls["id"]).execute()
            cls["student_count"] = count_resp.count or 0
            cls["direction"] = cls.get("directions") or None
            cls.pop("directions", None)
        return {"classes": classes}
    except Exception as e:
        # Log the actual error for debugging
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load curated classes: {str(e)}"
        )


@router.get("/{class_id}")
def get_class(class_id: str, user: dict = Depends(get_current_user)):
    sb = get_supabase()
    try:
        # basic access control: admin always; teacher if has timetable entry; student if enrolled
        if user["role"] == "teacher":
            allowed = False
            # Check legacy class_id field
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
                # Check new class_ids array field (for streams/multi-class entries)
                tt_multi = (
                    sb.table("timetable_entries")
                    .select("id")
                    .cs("class_ids", [class_id])
                    .eq("teacher_id", user["id"])
                    .limit(1)
                    .execute()
                    .data
                )
                if tt_multi:
                    allowed = True
                else:
                    cls = sb.table("classes").select("id,curator_id").eq("id", class_id).limit(1).execute().data
                    if cls and cls[0].get("curator_id") == user["id"]:
                        allowed = True
            if not allowed:
                return {"class": None, "students": []}

        if user["role"] == "student":
            # Students see all classes (shared account)
            pass

        # Используем limit(1) вместо single() — single() бросает exception при 0 или 2+ результатов
        c_rows = sb.table("classes").select("id,name,direction_id,curator_id").eq("id", class_id).limit(1).execute().data or []
        c = c_rows[0] if c_rows else None
        if not c:
            raise HTTPException(status_code=404, detail="Class not found")
        
        enr_rows = (
            sb.table("class_enrollments")
            .select("id,student_full_name,student_number,legacy_student_id")
            .eq("class_id", class_id)
            .execute()
            .data
            or []
        )
        
        # Students are now stored by name, not as users
        students = []
        for enr in enr_rows:
            student = {
                "id": enr.get("id"),
                "full_name": enr.get("student_full_name"),
                "student_number": enr.get("student_number"),
                "legacy_student_id": enr.get("legacy_student_id"),  # Нужно для проверки принадлежности к группе
            }
            students.append(student)
        
        students.sort(key=lambda s: (s.get("student_number") is None, s.get("student_number") or 0, s.get("full_name") or ""))
        return {"class": c, "students": students}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to load class details: {str(e)}. Ensure the base DB schema is applied "
                "(see supabase/migrations/20251222_000001_mvp.sql) and restart the API."
            ),
        )


class EnrollIn(BaseModel):
    student_full_name: str
    student_number: int | None = None


@router.post("/{class_id}/enroll")
def enroll_student(class_id: str, payload: EnrollIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        # Enforce max 35
        count_resp = sb.table("class_enrollments").select("id", count="exact").eq("class_id", class_id).execute()
        if (count_resp.count or 0) >= 35:
            raise HTTPException(status_code=400, detail="Class can have maximum 35 students")

        # Determine next student number if not provided
        student_num = payload.student_number
        if student_num is None:
            max_row = (
                sb.table("class_enrollments")
                .select("student_number")
                .eq("class_id", class_id)
                .order("student_number", desc=True)
                .limit(1)
                .execute()
                .data
            )
            student_num = 1
            if max_row and max_row[0].get("student_number"):
                student_num = int(max_row[0]["student_number"]) + 1
        
        if student_num > 35:
            raise HTTPException(status_code=400, detail="Student number must be between 1 and 35")

        sb.table("class_enrollments").insert({
            "class_id": class_id, 
            "student_full_name": payload.student_full_name, 
            "student_number": student_num
        }).execute()
        
        # Очищаем кеш после добавления студента
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enroll student: {str(e)}"
        )


class BulkEnrollIn(BaseModel):
    students: list[str]  # Список ФИО учеников


@router.post("/{class_id}/enroll-bulk")
def bulk_enroll_students(class_id: str, payload: BulkEnrollIn, _: dict = require_role("admin", "manager")):
    """Массовая запись учеников по списку ФИО"""
    sb = get_supabase()
    try:
        # Проверяем текущее количество учеников
        count_resp = sb.table("class_enrollments").select("id", count="exact").eq("class_id", class_id).execute()
        current_count = count_resp.count or 0
        
        # Фильтруем пустые строки
        students_to_add = [s.strip() for s in payload.students if s.strip()]
        
        if current_count + len(students_to_add) > 35:
            raise HTTPException(
                status_code=400, 
                detail=f"Превышен лимит 35 учеников. Текущий: {current_count}, добавляется: {len(students_to_add)}"
            )
        
        # Получаем максимальный номер
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
        
        # Добавляем учеников
        added_count = 0
        for full_name in students_to_add:
            if next_num > 35:
                break
            sb.table("class_enrollments").insert({
                "class_id": class_id,
                "student_full_name": full_name,
                "student_number": next_num
            }).execute()
            next_num += 1
            added_count += 1
        
        # Очищаем кеш
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"ok": True, "count": added_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to bulk enroll students: {str(e)}"
        )


@router.delete("/{class_id}/students/{enrollment_id}")
def remove_student(class_id: str, enrollment_id: str, _: dict = require_role("admin", "manager")):
    """Удалить студента из группы"""
    sb = get_supabase()
    try:
        sb.table("class_enrollments").delete().eq("id", enrollment_id).eq("class_id", class_id).execute()
        
        # Очищаем кеш после удаления студента
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove student: {str(e)}")


@router.patch("/{class_id}/students/{enrollment_id}")
def update_student(class_id: str, enrollment_id: str, payload: EnrollIn, _: dict = require_role("admin", "manager")):
    """Обновить данные студента"""
    sb = get_supabase()
    try:
        update_data = {}
        if payload.student_full_name:
            update_data["student_full_name"] = payload.student_full_name
        if payload.student_number is not None:
            if payload.student_number < 1 or payload.student_number > 35:
                raise HTTPException(status_code=400, detail="Student number must be between 1 and 35")
            update_data["student_number"] = payload.student_number
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        sb.table("class_enrollments").update(update_data).eq("id", enrollment_id).eq("class_id", class_id).execute()
        
        # Очищаем кеш после обновления студента
        from app.core.cache import cache
        cache.delete_pattern("classes_list:*")
        
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update student: {str(e)}")
