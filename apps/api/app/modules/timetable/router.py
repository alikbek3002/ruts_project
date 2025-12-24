from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


def _infer_teacher_id_for_subject(sb, subject_id: str) -> str | None:
    rows = (
        sb.table("teacher_subjects")
        .select("teacher_id")
        .eq("subject_id", subject_id)
        .execute()
        .data
        or []
    )
    teacher_ids = [r.get("teacher_id") for r in rows if r.get("teacher_id")]
    teacher_ids = list(dict.fromkeys(teacher_ids))
    if len(teacher_ids) == 1:
        return str(teacher_ids[0])
    # If none (or multiple), do not block timetable creation: just leave teacher_id empty.
    return None


def _room_supported(sb) -> bool:
    try:
        sb.table("timetable_entries").select("room").limit(1).execute()
        return True
    except Exception:
        return False


class TimetableEntryIn(BaseModel):
    class_id: str
    teacher_id: str | None = None
    subject: str
    subject_id: str | None = None  # ID предмета из таблицы subjects
    weekday: int  # 0..6
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    room: str | None = None
    lesson_type: str = "lecture"  # lecture или credit (зачет)


@router.post("/entries")
def create_entry(payload: TimetableEntryIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        data = payload.model_dump(exclude_none=True)

        if not data.get("teacher_id"):
            subject_id = data.get("subject_id")
            if subject_id:
                inferred = _infer_teacher_id_for_subject(sb, str(subject_id))
                if inferred:
                    data["teacher_id"] = inferred
            else:
                raise HTTPException(status_code=400, detail="teacher_id or subject_id is required")
        room = data.get("room")
        if isinstance(room, str) and not room.strip():
            data.pop("room", None)
        if "room" in data and not _room_supported(sb):
            raise HTTPException(
                status_code=400,
                detail=(
                    "DB schema is missing timetable_entries.room. Apply migration "
                    "supabase/migrations/20251223_000003_timetable_room_and_crud.sql and restart the API."
                ),
            )

        resp = sb.table("timetable_entries").insert(data).execute()
        return {"entry": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to create timetable entry. If you recently updated the code, make sure DB migrations are applied "
                "(see supabase/migrations/20251223_000003_timetable_room_and_crud.sql) and restart the API."
            ),
        )


class TimetableEntryUpdateIn(BaseModel):
    teacher_id: str | None = None
    subject: str | None = None
    subject_id: str | None = None
    room: str | None = None
    lesson_type: str | None = None  # lecture или credit


@router.put("/entries/{entry_id}")
def update_entry(entry_id: str, payload: TimetableEntryUpdateIn, _: dict = require_role("admin", "manager")):
    update: dict[str, object] = {}
    # Allow explicitly clearing teacher_id by sending null.
    if "teacher_id" in payload.model_fields_set:
        update["teacher_id"] = payload.teacher_id
    if payload.subject is not None:
        update["subject"] = payload.subject
    if payload.subject_id is not None:
        update["subject_id"] = payload.subject_id if payload.subject_id else None
        # If subject is changed and teacher is not explicitly set, infer teacher.
        # If we cannot infer (none or multiple), clear teacher_id so UI shows "---".
        if payload.subject_id and ("teacher_id" not in payload.model_fields_set):
            inferred = _infer_teacher_id_for_subject(get_supabase(), str(payload.subject_id))
            update["teacher_id"] = inferred
    if payload.room is not None:
        update["room"] = payload.room
    if payload.lesson_type is not None:
        update["lesson_type"] = payload.lesson_type

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    sb = get_supabase()
    try:
        if "room" in update and isinstance(update.get("room"), str) and not str(update.get("room")).strip():
            update.pop("room", None)
        if "room" in update and not _room_supported(sb):
            raise HTTPException(
                status_code=400,
                detail=(
                    "DB schema is missing timetable_entries.room. Apply migration "
                    "supabase/migrations/20251223_000003_timetable_room_and_crud.sql and restart the API."
                ),
            )

        resp = sb.table("timetable_entries").update(update).eq("id", entry_id).execute()
        row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"entry": row}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to update timetable entry. If DB migrations are not applied yet, apply them "
                "(see supabase/migrations/20251223_000003_timetable_room_and_crud.sql) and restart the API."
            ),
        )


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: str, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        resp = sb.table("timetable_entries").update({"active": False}).eq("id", entry_id).execute()
        row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete timetable entry")


@router.get("/entries")
def list_entries(class_id: str | None = None, user: dict = require_role("admin", "manager", "teacher")):
    sb = get_supabase()
    q = sb.table("timetable_entries").select("*").eq("active", True)
    if class_id:
        q = q.eq("class_id", class_id)
    if user["role"] == "teacher":
        q = q.eq("teacher_id", user["id"])
    resp = q.order("weekday").order("start_time").execute()
    return {"entries": resp.data or []}


@router.get("/week")
def get_week(weekStart: str, user: CurrentUser):
    # weekStart is YYYY-MM-DD, Monday preferred.
    start = date.fromisoformat(weekStart)
    end = start + timedelta(days=7)

    sb = get_supabase()

    select_fields = "id,class_id,teacher_id,subject,weekday,start_time,end_time"
    if _room_supported(sb):
        select_fields += ",room"

    if user["role"] == "student":
        enr = sb.table("class_enrollments").select("class_id").eq("student_id", user["id"]).execute()
        class_ids = [r["class_id"] for r in (enr.data or [])]
        tt = (
            sb.table("timetable_entries")
            .select(select_fields)
            .in_("class_id", class_ids)
            .eq("active", True)
            .execute()
        )
    elif user["role"] == "teacher":
        tt = (
            sb.table("timetable_entries")
            .select(select_fields)
            .eq("teacher_id", user["id"])
            .eq("active", True)
            .execute()
        )
    else:
        tt = sb.table("timetable_entries").select(select_fields).eq("active", True).execute()

    # zoom meetings for this week (starts_at between)
    zm = (
        sb.table("zoom_meetings")
        .select("timetable_entry_id, starts_at, join_url")
        .gte("starts_at", datetime.combine(start, datetime.min.time()).isoformat())
        .lt("starts_at", datetime.combine(end, datetime.min.time()).isoformat())
        .execute()
    )

    entries = tt.data or []
    class_ids = sorted({e["class_id"] for e in entries if e.get("class_id")})
    teacher_ids = sorted({e["teacher_id"] for e in entries if e.get("teacher_id")})

    classes = {}
    if class_ids:
        c_rows = sb.table("classes").select("id,name").in_("id", class_ids).execute().data or []
        classes = {c["id"]: c for c in c_rows}

    teachers = {}
    if teacher_ids:
        t_rows = sb.table("users").select("id,full_name,username").in_("id", teacher_ids).execute().data or []
        teachers = {t["id"]: t for t in t_rows}

    zoom_rows = zm.data or []
    zoom_by_key: dict[str, dict] = {}
    for r in zoom_rows:
        zoom_by_key[f"{r.get('timetable_entry_id')}|{r.get('starts_at')}"] = r

    enriched = []
    for e in entries:
        weekday = int(e.get("weekday", 0))
        occ_date = start + timedelta(days=weekday)
        start_time = str(e.get("start_time"))[:5]
        starts_at = f"{occ_date.isoformat()}T{start_time}:00"
        z = zoom_by_key.get(f"{e.get('id')}|{starts_at}")
        cls = classes.get(e.get("class_id")) or {}
        tch = teachers.get(e.get("teacher_id")) or {}

        teacher_name = tch.get("full_name") or tch.get("username")
        if not teacher_name:
            teacher_name = "---"

        enriched.append(
            {
                "id": e.get("id"),
                "class_id": e.get("class_id"),
                "class_name": cls.get("name"),
                "teacher_id": e.get("teacher_id"),
                "teacher_name": teacher_name,
                "subject": e.get("subject"),
                "weekday": weekday,
                "start_time": start_time,
                "end_time": str(e.get("end_time"))[:5],
                "room": e.get("room"),
                "zoom": ({"join_url": z.get("join_url"), "starts_at": z.get("starts_at")} if z else None),
            }
        )

    enriched.sort(key=lambda r: (r.get("weekday") or 0, r.get("start_time") or ""))

    return {"weekStart": weekStart, "entries": enriched}
