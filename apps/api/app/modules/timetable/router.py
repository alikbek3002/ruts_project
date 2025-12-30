from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, time as dt_time
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser, require_role
from app.core.monitor import timed
from app.db.supabase_client import get_supabase
from .auto_scheduler import (
    AutoScheduler, 
    ScheduleConstraints, 
    Lesson, 
    ScheduleConflictError,
    calculate_schedule_quality
)

router = APIRouter()
logger = logging.getLogger(__name__)


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


# ============================================================================
# AUTO-GENERATION ENDPOINTS
# ============================================================================

class AutoGenerateScheduleRequest(BaseModel):
    """Request to auto-generate schedule for a class."""
    class_id: str
    stream_id: Optional[str] = None
    
    # Optional constraints (will use defaults from DB if not provided)
    max_lessons_per_day: Optional[int] = Field(None, ge=1, le=8)
    min_lessons_per_day: Optional[int] = Field(None, ge=1, le=8)
    allow_gaps: Optional[bool] = None
    working_days: Optional[List[int]] = Field(None, description="List of weekday numbers (0=Mon, ..., 6=Sun)")
    earliest_start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    latest_end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    lesson_duration_minutes: Optional[int] = Field(None, ge=30, le=180)
    break_duration_minutes: Optional[int] = Field(None, ge=0, le=60)
    
    # Generation options
    clear_existing: bool = Field(False, description="Clear existing schedule before generating")
    dry_run: bool = Field(False, description="Only validate, don't save to database")


class SubjectLessonPlanInput(BaseModel):
    """Input for configuring subject lessons in a stream."""
    subject_id: str
    theoretical_lessons_count: int = Field(ge=0, le=20)
    practical_lessons_count: int = Field(ge=0, le=20)
    max_per_week: int = Field(default=2, ge=1, le=7)
    preferred_teacher_id: Optional[str] = None


@router.post("/auto-generate")
def auto_generate_schedule(
    payload: AutoGenerateScheduleRequest, 
    _: dict = require_role("admin", "manager")
):
    """
    Auto-generate schedule for a class based on subject lesson plans.
    
    Algorithm:
    1. Load subject lesson plans for the stream/class
    2. Create lessons list (theory + practice)
    3. Apply constraint satisfaction algorithm
    4. Validate hard constraints (no conflicts, theory before practice)
    5. Save to database (if not dry_run)
    
    Returns:
        Generated schedule with quality metrics
    """
    sb = get_supabase()
    
    try:
        # 1. Load class info
        class_resp = sb.table("classes").select("*").eq("id", payload.class_id).execute()
        if not class_resp.data:
            raise HTTPException(status_code=404, detail="Class not found")
        class_data = class_resp.data[0]
        
        # 2. Load or create schedule constraints
        constraints = _load_or_create_constraints(sb, payload)
        
        # 3. Load subject lesson plans
        if payload.stream_id:
            lesson_plans = _load_lesson_plans_for_stream(sb, payload.stream_id)
        else:
            # If no stream, check if class has stream_id or use default subjects
            stream_id = class_data.get("stream_id")
            if stream_id:
                lesson_plans = _load_lesson_plans_for_stream(sb, stream_id)
            else:
                raise HTTPException(
                    status_code=400, 
                    detail="No stream_id provided and class is not assigned to a stream. Cannot determine subject lesson plans."
                )
        
        if not lesson_plans:
            raise HTTPException(
                status_code=400,
                detail="No subject lesson plans found. Please configure subject_lesson_plans first."
            )
        
        # 4. Convert lesson plans to lessons list
        lessons = _create_lessons_from_plans(sb, lesson_plans)
        
        logger.info(f"Generating schedule for class {payload.class_id} with {len(lessons)} lessons")
        
        # 5. Clear existing schedule if requested
        if payload.clear_existing:
            sb.table("timetable_entries").update({"active": False}).eq("class_id", payload.class_id).execute()
            logger.info(f"Cleared existing schedule for class {payload.class_id}")
        
        # 6. Run auto-scheduler
        scheduler = AutoScheduler(constraints)
        
        try:
            scheduled_lessons = scheduler.generate_schedule(
                class_id=payload.class_id,
                lessons=lessons
            )
        except ScheduleConflictError as e:
            raise HTTPException(status_code=409, detail=f"Schedule conflict: {str(e)}")
        
        # 7. Calculate quality metrics
        quality = calculate_schedule_quality(scheduled_lessons, constraints)
        
        # 8. Save to database (if not dry_run)
        saved_entries = []
        if not payload.dry_run:
            for scheduled in scheduled_lessons:
                entry_data = {
                    "class_id": scheduled.class_id,
                    "subject_id": scheduled.lesson.subject_id,
                    "subject": scheduled.lesson.subject_name,
                    "teacher_id": scheduled.lesson.teacher_id,
                    "lesson_type": scheduled.lesson.lesson_type,
                    "weekday": scheduled.time_slot.weekday,
                    "start_time": scheduled.time_slot.start_time.strftime("%H:%M"),
                    "end_time": scheduled.time_slot.end_time.strftime("%H:%M"),
                    "room": scheduled.room,
                    "active": True
                }
                
                result = sb.table("timetable_entries").insert(entry_data).execute()
                if result.data:
                    saved_entries.append(result.data[0])
            
            logger.info(f"Saved {len(saved_entries)} lessons to database")
        
        # 9. Log generation
        log_data = {
            "class_id": payload.class_id,
            "stream_id": payload.stream_id,
            "status": "success",
            "total_lessons_planned": len(lessons),
            "lessons_scheduled": len(scheduled_lessons),
            "completed_at": datetime.now().isoformat(),
            "config": {
                "constraints": constraints.__dict__,
                "quality": quality
            }
        }
        sb.table("schedule_generation_logs").insert(log_data).execute()
        
        return {
            "success": True,
            "class_id": payload.class_id,
            "lessons_scheduled": len(scheduled_lessons),
            "quality_metrics": quality,
            "dry_run": payload.dry_run,
            "schedule": [
                {
                    "subject": s.lesson.subject_name,
                    "lesson_type": s.lesson.lesson_type,
                    "weekday": s.time_slot.weekday,
                    "start_time": s.time_slot.start_time.strftime("%H:%M"),
                    "end_time": s.time_slot.end_time.strftime("%H:%M"),
                    "teacher_id": s.lesson.teacher_id,
                    "room": s.room
                }
                for s in scheduled_lessons
            ] if payload.dry_run else saved_entries
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating schedule: {e}", exc_info=True)
        
        # Log failed attempt
        try:
            sb.table("schedule_generation_logs").insert({
                "class_id": payload.class_id,
                "stream_id": payload.stream_id,
                "status": "failed",
                "error_message": str(e),
                "completed_at": datetime.now().isoformat()
            }).execute()
        except:
            pass
        
        raise HTTPException(status_code=500, detail=f"Failed to generate schedule: {str(e)}")


@router.post("/subject-lesson-plans")
def create_subject_lesson_plan(
    stream_id: str,
    plans: List[SubjectLessonPlanInput],
    _: dict = require_role("admin", "manager")
):
    """
    Configure subject lesson plans for a stream.
    
    This defines how many theory/practice lessons each subject should have.
    """
    sb = get_supabase()
    
    # Validate stream exists
    stream = sb.table("streams").select("id").eq("id", stream_id).execute()
    if not stream.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    created = []
    for plan in plans:
        # Validate subject exists
        subject = sb.table("subjects").select("id, name").eq("id", plan.subject_id).execute()
        if not subject.data:
            raise HTTPException(status_code=404, detail=f"Subject {plan.subject_id} not found")
        
        # Check if plan already exists
        existing = sb.table("subject_lesson_plans").select("id").eq("stream_id", stream_id).eq("subject_id", plan.subject_id).execute()
        
        data = {
            "stream_id": stream_id,
            "subject_id": plan.subject_id,
            "theoretical_lessons_count": plan.theoretical_lessons_count,
            "practical_lessons_count": plan.practical_lessons_count,
            "max_per_week": plan.max_per_week,
            "preferred_teacher_id": plan.preferred_teacher_id
        }
        
        if existing.data:
            # Update existing
            result = sb.table("subject_lesson_plans").update(data).eq("id", existing.data[0]["id"]).execute()
        else:
            # Insert new
            result = sb.table("subject_lesson_plans").insert(data).execute()
        
        if result.data:
            created.append(result.data[0])
    
    return {"plans": created, "count": len(created)}


@router.get("/subject-lesson-plans/{stream_id}")
def get_subject_lesson_plans(stream_id: str, _: dict = require_role("admin", "manager", "teacher")):
    """Get all subject lesson plans for a stream."""
    sb = get_supabase()
    
    plans = sb.table("subject_lesson_plans").select("*, subjects(name)").eq("stream_id", stream_id).execute()
    
    return {"plans": plans.data or []}


@router.get("/validate/{class_id}")
def validate_schedule(class_id: str, _: dict = require_role("admin", "manager")):
    """
    Validate schedule for a class against all constraints.
    
    Returns list of violations.
    """
    sb = get_supabase()
    
    # Use SQL function for validation
    result = sb.rpc("validate_schedule_constraints", {"p_class_id": class_id}).execute()
    
    violations = [r for r in result.data if r.get("violated")]
    
    return {
        "class_id": class_id,
        "valid": len(violations) == 0,
        "violations": violations
    }


@router.get("/generation-logs")
def get_generation_logs(
    limit: int = 20,
    stream_id: Optional[str] = None,
    _: dict = require_role("admin", "manager")
):
    """Get schedule generation history."""
    sb = get_supabase()
    
    query = sb.table("schedule_generation_logs").select("*").order("started_at", desc=True).limit(limit)
    
    if stream_id:
        query = query.eq("stream_id", stream_id)
    
    logs = query.execute()
    
    return {"logs": logs.data or []}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _load_or_create_constraints(sb, payload: AutoGenerateScheduleRequest) -> ScheduleConstraints:
    """Load constraints from DB or use payload values."""
    
    # Try to load from DB first
    db_constraints = None
    if payload.stream_id:
        result = sb.table("schedule_constraints").select("*").eq("stream_id", payload.stream_id).execute()
        if result.data:
            db_constraints = result.data[0]
    else:
        result = sb.table("schedule_constraints").select("*").eq("class_id", payload.class_id).execute()
        if result.data:
            db_constraints = result.data[0]
    
    # Build constraints object
    constraints = ScheduleConstraints()
    
    if db_constraints:
        constraints.max_lessons_per_day = db_constraints.get("max_lessons_per_day", 4)
        constraints.min_lessons_per_day = db_constraints.get("min_lessons_per_day", 3)
        constraints.allow_gaps = db_constraints.get("allow_gaps", False)
        constraints.working_days = db_constraints.get("working_days", [0, 1, 2, 3, 4])
        
        if db_constraints.get("earliest_start_time"):
            constraints.earliest_start = dt_time.fromisoformat(str(db_constraints["earliest_start_time"]))
        if db_constraints.get("latest_end_time"):
            constraints.latest_end = dt_time.fromisoformat(str(db_constraints["latest_end_time"]))
        
        constraints.lesson_duration_minutes = db_constraints.get("lesson_duration_minutes", 90)
        constraints.break_duration_minutes = db_constraints.get("break_duration_minutes", 15)
    
    # Override with payload values if provided
    if payload.max_lessons_per_day is not None:
        constraints.max_lessons_per_day = payload.max_lessons_per_day
    if payload.min_lessons_per_day is not None:
        constraints.min_lessons_per_day = payload.min_lessons_per_day
    if payload.allow_gaps is not None:
        constraints.allow_gaps = payload.allow_gaps
    if payload.working_days is not None:
        constraints.working_days = payload.working_days
    if payload.earliest_start_time:
        constraints.earliest_start = dt_time.fromisoformat(payload.earliest_start_time)
    if payload.latest_end_time:
        constraints.latest_end = dt_time.fromisoformat(payload.latest_end_time)
    if payload.lesson_duration_minutes is not None:
        constraints.lesson_duration_minutes = payload.lesson_duration_minutes
    if payload.break_duration_minutes is not None:
        constraints.break_duration_minutes = payload.break_duration_minutes
    
    return constraints


def _load_lesson_plans_for_stream(sb, stream_id: str) -> list:
    """Load subject lesson plans for a stream."""
    result = sb.table("subject_lesson_plans").select("*").eq("stream_id", stream_id).execute()
    return result.data or []


def _create_lessons_from_plans(sb, lesson_plans: list) -> List[Lesson]:
    """Convert lesson plans to list of individual lessons."""
    lessons = []
    
    for plan in lesson_plans:
        subject_id = plan["subject_id"]
        
        # Get subject info
        subject = sb.table("subjects").select("name").eq("id", subject_id).execute()
        subject_name = subject.data[0]["name"] if subject.data else f"Subject {subject_id}"
        
        # Get teacher
        teacher_id = plan.get("preferred_teacher_id")
        if not teacher_id:
            # Try to infer from teacher_subjects
            teacher_id = _infer_teacher_id_for_subject(sb, subject_id)
        
        # Create theoretical lessons
        for i in range(plan.get("theoretical_lessons_count", 0)):
            lessons.append(Lesson(
                subject_id=subject_id,
                subject_name=subject_name,
                lesson_type="theoretical",
                teacher_id=teacher_id
            ))
        
        # Create practical lessons
        for i in range(plan.get("practical_lessons_count", 0)):
            lessons.append(Lesson(
                subject_id=subject_id,
                subject_name=subject_name,
                lesson_type="practical",
                teacher_id=teacher_id
            ))
    
    return lessons

