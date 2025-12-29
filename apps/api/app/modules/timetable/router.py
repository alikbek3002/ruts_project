from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.core.monitor import timed
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
@timed("get_week")
def get_week(weekStart: str, user: dict = require_role("admin", "manager", "teacher", "student")):
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

    # Use a short-lived cache to avoid repeated lookups for classes/teachers and zooms
    cache_key = f"timetable_week:{weekStart}:{user['role']}:{user.get('id') or ''}"
    from app.core.cache import cache
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

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

    result = {"weekStart": weekStart, "entries": enriched}
    cache.set(cache_key, result, ttl=20)  # short TTL
    return result


# ============================================================================
# TEACHER WORKLOAD TRACKING
# ============================================================================

from typing import Optional
from uuid import UUID


class TeacherWorkloadResponse(BaseModel):
    teacher_id: str
    teacher_name: str
    current_month_hours: float
    current_month_lessons: int
    three_month_hours: float
    three_month_lessons: int
    weekly_hours: float
    weekly_lessons: int
    active_streams: list[dict]


def _add_months(d: date, months: int) -> date:
    """Add months to a date, clamping day to month length."""
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    # clamp day
    last_day = 31
    if month in (4, 6, 9, 11):
        last_day = 30
    elif month == 2:
        is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
        last_day = 29 if is_leap else 28
    day = min(d.day, last_day)
    return date(year, month, day)


def _norm_time_str(value: object, default: str) -> str:
    s = str(value) if value is not None else default
    # supabase may return HH:MM:SS
    return s[:5] if len(s) >= 5 else default


def _calculate_lesson_duration_hours(start_time: str, end_time: str) -> float:
    """Calculate lesson duration in hours"""
    try:
        start_h, start_m = map(int, start_time.split(':'))
        end_h, end_m = map(int, end_time.split(':'))
        duration_minutes = (end_h * 60 + end_m) - (start_h * 60 + start_m)
        return duration_minutes / 60.0
    except Exception:
        return 1.5  # Default 1.5 hours


def _get_unique_lessons_count(entries: list) -> int:
    """
    Count unique lessons for teacher.
    If multiple classes (vzvodы) attend same lesson, it counts as 1 lesson.
    """
    unique_slots = set()
    for entry in entries:
        # Create unique key: weekday + start_time + end_time
        slot = (entry.get("weekday"), entry.get("start_time"), entry.get("end_time"))
        unique_slots.add(slot)
    return len(unique_slots)


def _calculate_total_hours(entries: list) -> float:
    """Calculate total hours from unique lesson slots"""
    unique_slots = {}
    for entry in entries:
        slot_key = (entry.get("weekday"), entry.get("start_time"), entry.get("end_time"))
        if slot_key not in unique_slots:
            duration = _calculate_lesson_duration_hours(
                entry.get("start_time", "09:00"),
                entry.get("end_time", "10:30")
            )
            unique_slots[slot_key] = duration
    return sum(unique_slots.values())


def _fetch_stream_bounds(sb, stream_ids: set[str]) -> dict[str, tuple[date, date]]:
    if not stream_ids:
        return {}
    rows = (
        sb.table("streams")
        .select("id,start_date,end_date")
        .in_("id", list(stream_ids))
        .execute()
        .data
        or []
    )
    bounds: dict[str, tuple[date, date]] = {}
    for r in rows:
        try:
            sid = str(r.get("id"))
            s = date.fromisoformat(str(r.get("start_date")))
            e = date.fromisoformat(str(r.get("end_date")))
            bounds[sid] = (s, e)
        except Exception:
            continue
    return bounds


def _entry_effective_range(
    entry: dict,
    period_start: date,
    period_end_excl: date,
    stream_bounds: dict[str, tuple[date, date]],
) -> tuple[date, date] | None:
    sid = entry.get("stream_id")
    if sid and str(sid) in stream_bounds:
        s_start, s_end = stream_bounds[str(sid)]
        eff_start = max(period_start, s_start)
        eff_end_excl = min(period_end_excl, s_end + timedelta(days=1))
        if eff_start >= eff_end_excl:
            return None
        return eff_start, eff_end_excl
    return period_start, period_end_excl


def _compute_period_totals(
    entries: list[dict],
    period_start: date,
    period_end_excl: date,
    stream_bounds: dict[str, tuple[date, date]],
) -> tuple[int, float]:
    """Count unique lesson slots per actual date in [start, end)."""
    date_slots: dict[date, set[tuple[int, str, str]]] = {}
    slot_duration: dict[tuple[int, str, str], float] = {}

    for entry in entries:
        eff = _entry_effective_range(entry, period_start, period_end_excl, stream_bounds)
        if not eff:
            continue
        eff_start, eff_end = eff

        weekday = int(entry.get("weekday", 0))
        start_time = _norm_time_str(entry.get("start_time"), "09:00")
        end_time = _norm_time_str(entry.get("end_time"), "10:30")
        slot = (weekday, start_time, end_time)
        if slot not in slot_duration:
            slot_duration[slot] = _calculate_lesson_duration_hours(start_time, end_time)

        # first occurrence in range
        delta = (weekday - eff_start.weekday()) % 7
        cur = eff_start + timedelta(days=delta)
        while cur < eff_end:
            date_slots.setdefault(cur, set()).add(slot)
            cur += timedelta(days=7)

    lessons = sum(len(s) for s in date_slots.values())
    hours = 0.0
    for slots in date_slots.values():
        for slot in slots:
            hours += float(slot_duration.get(slot, 0.0))
    return lessons, hours


def _entries_active_on_day(
    entries: list[dict],
    day: date,
    stream_bounds: dict[str, tuple[date, date]],
) -> list[dict]:
    active: list[dict] = []
    for e in entries:
        sid = e.get("stream_id")
        if sid and str(sid) in stream_bounds:
            s, end = stream_bounds[str(sid)]
            if not (s <= day <= end):
                continue
        active.append(e)
    return active


@router.get("/teachers/{teacher_id}/workload", response_model=TeacherWorkloadResponse)
async def get_teacher_workload(
    teacher_id: UUID,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """
    Get teacher's workload statistics:
    - Current month hours and lessons
    - Three-month period hours (for active streams)
    - Weekly hours
    """
    sb = get_supabase()

    if user.get("role") == "teacher" and str(user.get("id")) != str(teacher_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    
    # Check if teacher exists
    teacher_result = sb.table("users").select("id, full_name, username, role").eq("id", str(teacher_id)).execute()
    if not teacher_result.data:
        raise HTTPException(status_code=404, detail="Teacher not found")
    
    teacher = teacher_result.data[0]
    teacher_name = teacher.get("full_name") or teacher.get("username")
    
    # Get all active timetable entries for this teacher
    entries_result = sb.table("timetable_entries").select("*").eq("teacher_id", str(teacher_id)).eq("active", True).execute()
    
    if not entries_result.data:
        return TeacherWorkloadResponse(
            teacher_id=str(teacher_id),
            teacher_name=teacher_name,
            current_month_hours=0,
            current_month_lessons=0,
            three_month_hours=0,
            three_month_lessons=0,
            weekly_hours=0,
            weekly_lessons=0,
            active_streams=[],
        )
    
    entries = entries_result.data

    stream_ids = {str(e.get("stream_id")) for e in entries if e.get("stream_id")}
    stream_bounds = _fetch_stream_bounds(sb, stream_ids)

    today = date.today()
    month_start = today.replace(day=1)
    month_end_excl = _add_months(month_start, 1)
    three_end_excl = _add_months(month_start, 3)

    # Weekly stats: only entries active today
    weekly_entries = _entries_active_on_day(entries, today, stream_bounds)
    weekly_lessons = _get_unique_lessons_count(weekly_entries)
    weekly_hours = _calculate_total_hours(weekly_entries)

    # Calendar totals
    current_month_lessons, current_month_hours = _compute_period_totals(
        entries, month_start, month_end_excl, stream_bounds
    )
    three_month_lessons, three_month_hours = _compute_period_totals(
        entries, month_start, three_end_excl, stream_bounds
    )

    # Streams breakdown
    active_streams: list[dict] = []
    if stream_ids:
        streams_result = (
            sb.table("streams")
            .select("id,name,start_date,end_date,status")
            .in_("id", list(stream_ids))
            .execute()
        )
        for stream in streams_result.data or []:
            sid = str(stream.get("id"))
            stream_entries = [e for e in entries if str(e.get("stream_id")) == sid]

            stream_weekly_lessons = _get_unique_lessons_count(stream_entries)
            stream_weekly_hours = _calculate_total_hours(stream_entries)

            stream_total_lessons_3m, stream_total_hours_3m = _compute_period_totals(
                stream_entries, month_start, three_end_excl, stream_bounds
            )

            active_streams.append(
                {
                    "stream_id": sid,
                    "stream_name": stream.get("name"),
                    "start_date": stream.get("start_date"),
                    "end_date": stream.get("end_date"),
                    "status": stream.get("status"),
                    "weekly_lessons": stream_weekly_lessons,
                    "weekly_hours": round(stream_weekly_hours, 2),
                    "total_lessons_3months": stream_total_lessons_3m,
                    "total_hours_3months": round(stream_total_hours_3m, 2),
                }
            )
    
    return TeacherWorkloadResponse(
        teacher_id=str(teacher_id),
        teacher_name=teacher_name,
        current_month_hours=round(current_month_hours, 2),
        current_month_lessons=current_month_lessons,
        three_month_hours=round(three_month_hours, 2),
        three_month_lessons=three_month_lessons,
        weekly_hours=round(weekly_hours, 2),
        weekly_lessons=weekly_lessons,
        active_streams=active_streams,
    )


@router.get("/teachers/workload/all")
async def get_all_teachers_workload(
    user: dict = require_role("admin", "manager"),
):
    """Get workload summary for all teachers"""
    sb = get_supabase()
    
    # Get all teachers
    teachers_result = sb.table("users").select("id, full_name, username").eq("role", "teacher").execute()
    
    if not teachers_result.data:
        return {"teachers": []}
    
    today = date.today()
    month_start = today.replace(day=1)
    month_end_excl = _add_months(month_start, 1)
    three_end_excl = _add_months(month_start, 3)

    workloads = []
    for teacher in teachers_result.data:
        teacher_id = teacher["id"]
        teacher_name = teacher.get("full_name") or teacher.get("username")
        
        # Get entries
        entries_result = sb.table("timetable_entries").select("*").eq("teacher_id", teacher_id).eq("active", True).execute()
        
        if not entries_result.data:
            workloads.append({
                "teacher_id": teacher_id,
                "teacher_name": teacher_name,
                "weekly_hours": 0,
                "weekly_lessons": 0,
                "monthly_hours": 0,
                "three_month_hours": 0,
            })
            continue
        
        entries = entries_result.data

        stream_ids = {str(e.get("stream_id")) for e in entries if e.get("stream_id")}
        stream_bounds = _fetch_stream_bounds(sb, stream_ids)

        weekly_entries = _entries_active_on_day(entries, today, stream_bounds)
        weekly_lessons = _get_unique_lessons_count(weekly_entries)
        weekly_hours = _calculate_total_hours(weekly_entries)

        monthly_lessons, monthly_hours = _compute_period_totals(entries, month_start, month_end_excl, stream_bounds)
        three_month_lessons, three_month_hours = _compute_period_totals(
            entries, month_start, three_end_excl, stream_bounds
        )
        
        workloads.append({
            "teacher_id": teacher_id,
            "teacher_name": teacher_name,
            "weekly_hours": round(weekly_hours, 2),
            "weekly_lessons": weekly_lessons,
            "monthly_hours": round(monthly_hours, 2),
            "three_month_hours": round(three_month_hours, 2),
        })
    
    # Sort by weekly hours descending
    workloads.sort(key=lambda x: x["weekly_hours"], reverse=True)
    
    return {"teachers": workloads}
