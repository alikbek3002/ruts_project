from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, time as dt_time
from typing import List, Optional

try:
    from postgrest.exceptions import APIError as PostgrestAPIError
except Exception:  # pragma: no cover
    PostgrestAPIError = None  # type: ignore

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
    calculate_schedule_quality,
    ScheduledLesson,
    TimeSlot,
    build_lessons_from_curriculum,
)

from io import BytesIO
from openpyxl import Workbook
from fastapi.responses import StreamingResponse

router = APIRouter()
logger = logging.getLogger(__name__)


# Fixed rooms list for manual scheduling (auditoria): 20, 22, 30..52
FIXED_ROOMS: list[str] = ["20", "22"] + [str(n) for n in range(30, 53)]


def _raise_db_http_exception(exc: Exception, *, fallback: str) -> None:
    msg = str(exc) or fallback
    code = getattr(exc, "code", None)
    details = getattr(exc, "details", None)
    hint = getattr(exc, "hint", None)
    message = getattr(exc, "message", None)

    if PostgrestAPIError is not None and isinstance(exc, PostgrestAPIError):
        msg = message or msg

    full = " ".join([str(x) for x in [msg, details, hint] if x]).strip() or fallback
    low = full.lower()

    if code in {"42501"} or "row-level security" in low or "rls" in low or "permission" in low:
        raise HTTPException(status_code=403, detail=f"Недостаточно прав для операции. {full}")
    if code == "23505" or "duplicate key" in low or "unique" in low:
        raise HTTPException(status_code=409, detail=f"Конфликт данных. {full}")
    if code in {"23502", "23503", "23514"} or "violates" in low or "foreign key" in low or "not-null" in low:
        raise HTTPException(status_code=400, detail=f"Некорректные данные. {full}")

    raise HTTPException(status_code=500, detail=fallback + f" ({full})")


def _norm_time_str(value: object, default: str) -> str:
    if value is None:
        return default
    s = str(value).strip()
    if not s:
        return default
    # TIME from DB may be HH:MM:SS
    return s[:5]


def _parse_hhmm(value: str) -> dt_time:
    s = _norm_time_str(value, "00:00")
    return dt_time.fromisoformat(s)


def _entry_class_ids(entry: dict) -> list[str]:
    cls = entry.get("class_ids")
    if isinstance(cls, list) and cls:
        return [str(x) for x in cls if x]
    cid = entry.get("class_id")
    return [str(cid)] if cid else []


def _subject_key(entry: dict) -> str:
    sid = entry.get("subject_id")
    if sid:
        return f"id:{sid}"
    return f"name:{(entry.get('subject') or '').strip().lower()}"


def _infer_stream_id_for_class(sb, class_id: str) -> str | None:
    # In current DB schema, class -> stream is stored in junction table stream_classes.
    resp = (
        sb.table("stream_classes")
        .select("stream_id")
        .eq("class_id", class_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    sid = resp.data[0].get("stream_id")
    return str(sid) if sid else None


def _validate_stream_and_classes(sb, *, class_id: str, stream_id: str | None, class_ids: list[str] | None) -> tuple[str, list[str]]:
    ids = [str(x) for x in (class_ids or [class_id]) if x]
    # Ensure class_id is included
    if class_id and class_id not in ids:
        ids.insert(0, class_id)
    # Unique, preserve order
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(status_code=400, detail="class_id/class_ids is required")

    sid = stream_id or _infer_stream_id_for_class(sb, ids[0])
    if not sid:
        raise HTTPException(status_code=400, detail="Class has no stream_id; select a stream")

    # Validate all classes belong to this stream.
    # DB schema uses junction table stream_classes(stream_id, class_id).
    rels = sb.table("stream_classes").select("stream_id,class_id").in_("class_id", ids).execute().data or []
    by_class: dict[str, list[str]] = {}
    for r in rels:
        cid = str(r.get("class_id"))
        sid_r = r.get("stream_id")
        if not cid or not sid_r:
            continue
        by_class.setdefault(cid, []).append(str(sid_r))

    # Ensure all selected classes exist
    classes = sb.table("classes").select("id").in_("id", ids).execute().data or []
    existing_ids = {str(c.get("id")) for c in classes if c.get("id")}
    missing = [cid for cid in ids if cid not in existing_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Class not found: {missing[0]}")

    for cid in ids:
        sids = list(dict.fromkeys(by_class.get(cid, [])))
        if not sids:
            raise HTTPException(status_code=400, detail=f"Группа не привязана к потоку: {cid}")
        if len(sids) > 1:
            raise HTTPException(status_code=409, detail=f"Группа привязана к нескольким потокам: {cid}")
        if str(sids[0]) != str(sid):
            raise HTTPException(status_code=409, detail="Нельзя смешивать группы из разных потоков в одной паре")

    return str(sid), ids


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


_WEEKDAY_RU: dict[int, str] = {
    0: "Пн",
    1: "Вт",
    2: "Ср",
    3: "Чт",
    4: "Пт",
    5: "Сб",
    6: "Вс",
}


def _weekday_label(weekday: int) -> str:
    return _WEEKDAY_RU.get(int(weekday), str(weekday))


def _fetch_class_names(sb, class_ids: list[str]) -> dict[str, str]:
    ids = [str(x) for x in class_ids if x]
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {}
    rows = sb.table("classes").select("id,name").in_("id", ids).execute().data or []
    out: dict[str, str] = {}
    for r in rows:
        cid = r.get("id")
        if not cid:
            continue
        out[str(cid)] = (r.get("name") or "").strip() or str(cid)
    return out


def _format_conflict_entry(entry: dict, class_name_by_id: dict[str, str]) -> dict:
    cids = _entry_class_ids(entry)
    cnames = [class_name_by_id.get(cid, cid) for cid in cids]
    return {
        "id": entry.get("id"),
        "weekday": int(entry.get("weekday", 0)),
        "weekday_label": _weekday_label(int(entry.get("weekday", 0))),
        "start_time": _norm_time_str(entry.get("start_time"), "00:00"),
        "end_time": _norm_time_str(entry.get("end_time"), "00:00"),
        "room": entry.get("room"),
        "subject": entry.get("subject"),
        "lesson_type": entry.get("lesson_type"),
        "teacher_id": entry.get("teacher_id"),
        "stream_id": entry.get("stream_id"),
        "class_ids": cids,
        "class_names": cnames,
    }


def _build_conflicts_payload(
    sb,
    *,
    overlapping: list[dict],
    proposed_weekday: int,
    proposed_start: str,
    proposed_end: str,
    proposed_class_ids: list[str],
    proposed_teacher_id: str | None,
    proposed_room: str | None,
) -> dict:
    all_class_ids: list[str] = []
    for e in overlapping:
        all_class_ids.extend(_entry_class_ids(e))
    all_class_ids.extend(proposed_class_ids)
    class_name_by_id = _fetch_class_names(sb, list(dict.fromkeys([str(x) for x in all_class_ids if x])))

    conflicts: list[dict] = []
    proposed_set = set([str(x) for x in proposed_class_ids if x])

    for e in overlapping:
        e_groups = set(_entry_class_ids(e))
        intersect = sorted(proposed_set.intersection(e_groups))
        if intersect:
            conflicts.append(
                {
                    "type": "CLASS_BUSY",
                    "title": "Конфликт: у группы уже есть пара",
                    "affected_class_ids": intersect,
                    "affected_class_names": [class_name_by_id.get(cid, cid) for cid in intersect],
                    "entry": _format_conflict_entry(e, class_name_by_id),
                }
            )

        if proposed_teacher_id and str(e.get("teacher_id") or "") == str(proposed_teacher_id):
            conflicts.append(
                {
                    "type": "TEACHER_BUSY",
                    "title": "Конфликт: преподаватель занят",
                    "entry": _format_conflict_entry(e, class_name_by_id),
                }
            )

        if proposed_room and str(e.get("room") or "") == str(proposed_room):
            conflicts.append(
                {
                    "type": "ROOM_BUSY",
                    "title": "Конфликт: аудитория занята",
                    "entry": _format_conflict_entry(e, class_name_by_id),
                }
            )

    # Dedupe by (type, entry.id, affected)
    seen: set[str] = set()
    uniq: list[dict] = []
    for c in conflicts:
        eid = (c.get("entry") or {}).get("id")
        aff = ",".join(c.get("affected_class_ids") or [])
        key = f"{c.get('type')}|{eid}|{aff}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)

    return {
        "message": "Конфликт расписания",
        "proposed": {
            "weekday": int(proposed_weekday),
            "weekday_label": _weekday_label(int(proposed_weekday)),
            "start_time": _norm_time_str(proposed_start, "00:00"),
            "end_time": _norm_time_str(proposed_end, "00:00"),
            "room": proposed_room,
            "teacher_id": proposed_teacher_id,
            "class_ids": [str(x) for x in proposed_class_ids if x],
            "class_names": [class_name_by_id.get(str(x), str(x)) for x in proposed_class_ids if x],
        },
        "conflicts": uniq,
    }


def _validate_hours_limit(sb, *, class_ids: list[str], subject_id: str, start_str: str, end_str: str, exclude_entry_id: str | None = None) -> None:
    """
    Проверяет, не превышает ли создание занятия лимит часов по учебному плану (direction_subjects).
    Расчет: (Сумма минут в неделю * 12 недель) / 60 <= План Часов
    """
    if not subject_id or not class_ids:
        return

    # 1. Calculate duration of the new/updated lesson
    t1 = _parse_hhmm(start_str)
    t2 = _parse_hhmm(end_str)
    new_dur_min = (t2.hour * 60 + t2.minute) - (t1.hour * 60 + t1.minute)
    if new_dur_min <= 0:
        return

    # 2. Check each class
    # Get directions
    try:
        classes = sb.table("classes").select("id,name,direction_id").in_("id", class_ids).execute().data or []
    except Exception:
        # If DB error (e.g. table missing? should not happen for classes), skip
        return

    for cls in classes:
        did = cls.get("direction_id")
        if not did:
            continue

        # Get Plan
        try:
            plan_res = sb.table("direction_subjects").select("total_hours").eq("direction_id", did).eq("subject_id", subject_id).execute()
            if not plan_res.data:
                # No plan -> Allow? Or Block? Let's allow but maybe warn? Assuming unlimited if not in plan.
                continue
            limit_hours = float(plan_res.data[0].get("total_hours", 0))
        except Exception:
            # Table likely missing or error. unexpected, but don't block basic flow if feature not ready.
            continue

        if limit_hours <= 0:
            # No hours allocated? Block?
            pass 

        # Get existing entries for this class+subject
        # We query by subject_id. 
        # Note: class_ids column is JSONB/array. We check if cls['id'] is in it.
        try:
            # Using current weekday logic? No, we sum ALL active entries for the week.
            q = sb.table("timetable_entries").select("id,start_time,end_time").eq("active", True).eq("subject_id", subject_id)
            # Filter by class using CS (contains)
            q = q.cs("class_ids", [cls["id"]])
            
            existing = q.execute().data or []
        except Exception:
            continue

        existing_weekly_min = 0
        for e in existing:
            if exclude_entry_id and str(e.get("id")) == str(exclude_entry_id):
                continue
            
            # If creating a conflict? No, existing entries are already in DB.
            # We assume conflict check passed or is separate.
            
            st = _parse_hhmm(e.get("start_time"))
            et = _parse_hhmm(e.get("end_time"))
            dur = (et.hour * 60 + et.minute) - (st.hour * 60 + st.minute)
            existing_weekly_min += max(0, dur)

        # Projection
        total_weekly_min = existing_weekly_min + new_dur_min
        # 12 weeks assumption
        projected_total_hours = (total_weekly_min / 60.0) * 12

        # Allow small margin? (e.g. 0.1h)
        if projected_total_hours > (limit_hours + 0.5):
            raise HTTPException(
                status_code=400,
                detail=f"Лимит часов превышен для {cls['name']}. План: {limit_hours}ч. Прогноз (12 нед): {projected_total_hours:.1f}ч"
            )



class TimetableEntryIn(BaseModel):
    class_id: str
    stream_id: str | None = None
    class_ids: list[str] | None = None
    teacher_id: str | None = None
    subject: str
    subject_id: str | None = None  # ID предметa из таблицы subjects
    weekday: int  # 0..6
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    room: str | None = None
    lesson_type: str = "lecture"  # lecture, seminar, exam, practical
    lesson_number: int | None = None  # Manual lesson number override
    meet_url: str | None = None
    lesson_date: date | None = None  # Specific date (YYYY-MM-DD)

class DuplicateWeekIn(BaseModel):
    source_week_start: date
    target_week_start: date
    class_id: str | None = None
    stream_id: str | None = None


@router.post("/entries")
def create_entry(payload: TimetableEntryIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        data = payload.model_dump(exclude_none=True)

        # Validate stream/classes (multi-group lecture)
        stream_id, class_ids = _validate_stream_and_classes(
            sb,
            class_id=str(payload.class_id),
            stream_id=payload.stream_id,
            class_ids=payload.class_ids,
        )

        lesson_type = (payload.lesson_type or "lecture").strip()
        if len(class_ids) > 1 and lesson_type != "lecture":
            raise HTTPException(status_code=400, detail="Несколько групп разрешены только для лекции")
        if lesson_type == "lecture" and len(class_ids) > 4:
            raise HTTPException(status_code=409, detail="Нельзя больше 4 групп на одной паре")

        # Persist multi-group fields
        data["stream_id"] = stream_id
        data["class_ids"] = class_ids
        data["class_id"] = class_ids[0]

        if not data.get("teacher_id"):
            subject_id = data.get("subject_id")
            if subject_id:
                inferred = _infer_teacher_id_for_subject(sb, str(subject_id))
                if inferred:
                    data["teacher_id"] = inferred
            else:
                raise HTTPException(status_code=400, detail="teacher_id or subject_id is required")

        # Conflict detection + lecture merge
        # Ensure weekday matches date if date provided
        if data.get("lesson_date"):
            d = data["lesson_date"]
            if isinstance(d, str):
                d = date.fromisoformat(d)
            data["lesson_date"] = d.isoformat()
            weekday = d.weekday() # 0=Mon
            data["weekday"] = weekday
            
            # Validate lesson_date is within stream date range
            if stream_id:
                stream_data = sb.table("streams").select("start_date,end_date").eq("id", stream_id).limit(1).execute().data
                if stream_data:
                    s = stream_data[0]
                    s_start = date.fromisoformat(s["start_date"]) if s.get("start_date") else None
                    s_end = date.fromisoformat(s["end_date"]) if s.get("end_date") else None
                    if s_start and d < s_start:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Дата урока ({d.isoformat()}) раньше начала потока ({s_start.isoformat()}). Нельзя ставить расписание до начала обучения."
                        )
                    if s_end and d > s_end:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Дата урока ({d.isoformat()}) позже окончания потока ({s_end.isoformat()})."
                        )
        else:
             weekday = int(data.get("weekday", 0))
        
        new_start = _norm_time_str(data.get("start_time"), "00:00")
        new_end = _norm_time_str(data.get("end_time"), "00:00")
        teacher_id = data.get("teacher_id")
        room = data.get("room")

        overlapping = (
            sb.table("timetable_entries")
            .select("id,stream_id,class_id,class_ids,teacher_id,subject,subject_id,lesson_type,weekday,start_time,end_time,room,lesson_date")
            .eq("active", True)
            .eq("weekday", weekday)
            .lt("start_time", new_end)
            .gt("end_time", new_start)
            .execute()
            .data
            or []
        )
        
        # Filter overlapping by date
        # Conflict if: 
        # (A.date is NULL AND B.date matches A.weekday) -- Recurring vs Dated (Conflict! Recurring claims the slot)
        # (A.date == B.date) -- Dated vs Dated (Conflict)
        # (A.date is NULL AND B.date is NULL) -- Recurring vs Recurring (Conflict)
        
        real_conflicts = []
        new_date_str = data.get("lesson_date") # ISO string or None
        
        for e in overlapping:
             e_date = e.get("lesson_date")
             # If both are dated and different dates -> No conflict
             if new_date_str and e_date and new_date_str != e_date:
                 continue
             real_conflicts.append(e)
             
        overlapping = real_conflicts

        # Try to merge into an existing lecture in the same stream/time/subject/teacher/room
        if lesson_type == "lecture" and len(class_ids) >= 1:
            new_subj_key = _subject_key(data)
            for e in overlapping:
                if str(e.get("stream_id") or "") != str(stream_id):
                    continue
                if (e.get("lesson_type") or "").strip() != "lecture":
                    continue
                if int(e.get("weekday", -1)) != weekday:
                    continue
                if _norm_time_str(e.get("start_time"), "") != new_start:
                    continue
                if _norm_time_str(e.get("end_time"), "") != new_end:
                    continue
                if str(e.get("teacher_id") or "") != str(teacher_id or ""):
                    continue
                if _subject_key(e) != new_subj_key:
                    continue
                # If room specified, it must match to be the same lecture.
                if room and str(e.get("room") or "") and str(e.get("room") or "") != str(room):
                    continue
                existing_groups = _entry_class_ids(e)
                merged = list(dict.fromkeys(existing_groups + class_ids))
                if len(merged) > 4:
                    raise HTTPException(status_code=409, detail="Нельзя больше 4 групп на одной паре")

                # Update the existing entry with merged class_ids (and set room if missing)
                patch: dict[str, object] = {"class_ids": merged}
                if room and not e.get("room"):
                    patch["room"] = room
                resp = sb.table("timetable_entries").update(patch).eq("id", e["id"]).execute()
                row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
                return {"entry": row, "merged": True}

        # Hard conflicts: class, teacher, room (with overlap)
        payload = _build_conflicts_payload(
            sb,
            overlapping=overlapping,
            proposed_weekday=weekday,
            proposed_start=new_start,
            proposed_end=new_end,
            proposed_class_ids=class_ids,
            proposed_teacher_id=str(teacher_id) if teacher_id else None,
            proposed_room=str(room) if room else None,
        )
        if payload.get("conflicts"):
            raise HTTPException(status_code=409, detail=payload)
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

        # Validate Curriculum limits
        if data.get("subject_id"):
             _validate_hours_limit(
                 sb, 
                 class_ids=class_ids, 
                 subject_id=str(data["subject_id"]), 
                 start_str=new_start, 
                 end_str=new_end
             )

        resp = sb.table("timetable_entries").insert(data).execute()
        from app.core.cache import cache
        cache.delete_pattern("timetable_entries:*")
        cache.delete_pattern("timetable_week:*")
        return {"entry": resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create timetable entry")
        _raise_db_http_exception(
            e,
            fallback=(
                "Не удалось создать занятие. "
                "Проверьте данные (преподаватель/предмет/группа/аудитория) и права доступа."
            ),
        )


class TimetableEntryUpdateIn(BaseModel):
    teacher_id: str | None = None
    subject: str | None = None
    subject_id: str | None = None
    room: str | None = None
    lesson_type: str | None = None
    stream_id: str | None = None
    class_ids: list[str] | None = None
    lesson_number: int | None = None
    meet_url: str | None = None
    lesson_date: date | None = None


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
    if payload.stream_id is not None:
        update["stream_id"] = payload.stream_id
    if payload.class_ids is not None:
        update["class_ids"] = payload.class_ids
    if "lesson_number" in payload.model_fields_set:
        update["lesson_number"] = payload.lesson_number
    if "meet_url" in payload.model_fields_set:
        update["meet_url"] = payload.meet_url
    if "lesson_date" in payload.model_fields_set:
        d = payload.lesson_date
        if d:
             update["lesson_date"] = d.isoformat()
             update["weekday"] = d.weekday()
        else:
             update["lesson_date"] = None

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    sb = get_supabase()
    try:
        # Load existing entry (needed for conflict validation)
        existing_resp = sb.table("timetable_entries").select("*").eq("id", entry_id).limit(1).execute()
        if not existing_resp.data:
            raise HTTPException(status_code=404, detail="Entry not found")
        existing = existing_resp.data[0]

        # Compute resulting fields
        result_weekday = int(update.get("weekday", existing.get("weekday", 0)))
        result_start = _norm_time_str(update.get("start_time", existing.get("start_time")), "00:00")
        result_end = _norm_time_str(update.get("end_time", existing.get("end_time")), "00:00")
        result_room = update.get("room", existing.get("room"))
        result_teacher_id = update.get("teacher_id", existing.get("teacher_id"))
        result_lesson_type = (update.get("lesson_type", existing.get("lesson_type")) or "lecture").strip()
        result_date_str = update.get("lesson_date", existing.get("lesson_date")) # ISO or None
        
        # Validate stream/classes (if class_ids/stream_id are being changed)
        # If class_ids not explicitly provided, keep existing class_ids/class_id.
        proposed_class_ids = None
        if "class_ids" in update:
            proposed_class_ids = update.get("class_ids") if isinstance(update.get("class_ids"), list) else None
        else:
            proposed_class_ids = existing.get("class_ids") if isinstance(existing.get("class_ids"), list) else [str(existing.get("class_id"))]

        proposed_stream_id = str(update.get("stream_id")) if "stream_id" in update else (str(existing.get("stream_id")) if existing.get("stream_id") else None)
        base_class_id = str(existing.get("class_id"))
        stream_id, class_ids = _validate_stream_and_classes(
            sb,
            class_id=base_class_id,
            stream_id=proposed_stream_id,
            class_ids=proposed_class_ids,
        )
        
        if len(class_ids) > 1 and result_lesson_type != "lecture":
            raise HTTPException(status_code=400, detail="Несколько групп разрешены только для лекции")
        if result_lesson_type == "lecture" and len(class_ids) > 4:
            raise HTTPException(status_code=409, detail="Нельзя больше 4 групп на одной паре")

        # Ensure stored compatibility fields
        update.setdefault("stream_id", stream_id)
        update.setdefault("class_ids", class_ids)
        update.setdefault("class_id", class_ids[0])

        # Conflict detection (exclude current entry)
        overlapping = (
            sb.table("timetable_entries")
            .select("id,stream_id,class_id,class_ids,teacher_id,subject,subject_id,lesson_type,weekday,start_time,end_time,room")
            .eq("active", True)
            .eq("weekday", result_weekday)
            .lt("start_time", result_end)
            .gt("end_time", result_start)
            .neq("id", entry_id)
            .execute()
            .data
            or []
        )

        for e in overlapping:
            # handled below via structured conflict payload
            pass

        # Filter overlapping by lesson_date (same logic as create_entry)
        real_conflicts = []
        result_date_iso = result_date_str if isinstance(result_date_str, str) else (
            result_date_str.isoformat() if result_date_str else None
        )
        for e in overlapping:
            e_date = e.get("lesson_date")
            # If both are dated and different dates -> No conflict
            if result_date_iso and e_date and result_date_iso != e_date:
                continue
            real_conflicts.append(e)
        overlapping = real_conflicts

        payload = _build_conflicts_payload(
            sb,
            overlapping=overlapping,
            proposed_weekday=result_weekday,
            proposed_start=result_start,
            proposed_end=result_end,
            proposed_class_ids=class_ids,
            proposed_teacher_id=str(result_teacher_id) if result_teacher_id else None,
            proposed_room=str(result_room) if result_room else None,
        )
        if payload.get("conflicts"):
            raise HTTPException(status_code=409, detail=payload)

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
        
        # Validate Curriculum limits (if time or subject changed)
        # We need subject_id. If updated, use new. If not, use existing.
        check_subject_id = update.get("subject_id") if "subject_id" in update else existing.get("subject_id")
        check_start = result_start
        check_end = result_end
        
        if check_subject_id:
            _validate_hours_limit(
                sb,
                class_ids=class_ids,
                subject_id=str(check_subject_id),
                start_str=check_start,
                end_str=check_end,
                exclude_entry_id=entry_id
            )

        resp = sb.table("timetable_entries").update(update).eq("id", entry_id).execute()
        row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        from app.core.cache import cache
        cache.delete_pattern("timetable_entries:*")
        cache.delete_pattern("timetable_week:*")
        return {"entry": row}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update timetable entry")
        _raise_db_http_exception(
            e,
            fallback=(
                "Не удалось обновить занятие. "
                "Проверьте данные (преподаватель/предмет/группа/аудитория) и права доступа."
            ),
        )


@router.delete("/entries/bulk-delete")
def bulk_delete_entries(
    class_id: str,
    stream_id: str | None = None,
    _: dict = require_role("admin", "manager"),
):
    """Soft-delete ALL active timetable entries for a given class (and optionally stream)."""
    sb = get_supabase()
    try:
        # Pass 1 – entries matched by class_id column
        q1 = sb.table("timetable_entries").update({"active": False}).eq("active", True).eq("class_id", class_id)
        if stream_id:
            q1 = q1.eq("stream_id", stream_id)
        resp1 = q1.execute()
        count1 = len(resp1.data) if isinstance(resp1.data, list) else 0

        # Pass 2 – entries matched by class_ids array containing this class
        q2 = sb.table("timetable_entries").update({"active": False}).eq("active", True).contains("class_ids", [class_id])
        if stream_id:
            q2 = q2.eq("stream_id", stream_id)
        resp2 = q2.execute()
        count2 = len(resp2.data) if isinstance(resp2.data, list) else 0

        total = count1 + count2
        from app.core.cache import cache
        cache.delete_pattern("timetable_entries:*")
        cache.delete_pattern("timetable_week:*")
        return {"ok": True, "deleted": total, "message": f"Удалено записей: {total}"}
    except Exception:
        raise HTTPException(status_code=500, detail="Не удалось удалить записи расписания")


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: str, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    try:
        resp = sb.table("timetable_entries").update({"active": False}).eq("id", entry_id).execute()
        row = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        from app.core.cache import cache
        cache.delete_pattern("timetable_entries:*")
        cache.delete_pattern("timetable_week:*")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete timetable entry")


@router.get("/rooms")
def list_rooms(_: dict = require_role("admin", "manager", "teacher")):
    return {"rooms": FIXED_ROOMS}


@router.get("/entries")
def list_entries(
    class_id: str | None = None, 
    start_date: date | None = None, 
    end_date: date | None = None,
    user: dict = require_role("admin", "manager", "teacher")
):
    from app.core.cache import cache
    cache_key = f"timetable_entries:{class_id or 'all'}:{start_date}:{end_date}:{user['role']}:{user.get('id','')}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    sb = get_supabase()
    q = sb.table("timetable_entries").select("*").eq("active", True)
    if user["role"] == "teacher":
        q = q.eq("teacher_id", user["id"])
        
    # Date filtering
    if start_date and end_date:
        q = q.or_(f"lesson_date.is.null,and(lesson_date.gte.{start_date},lesson_date.lte.{end_date})")
        
    resp = q.order("weekday").order("start_time").execute()
    rows = resp.data or []
    if class_id:
        cid = str(class_id)
        rows = [
            r
            for r in rows
            if str(r.get("class_id") or "") == cid or cid in _entry_class_ids(r)
        ]
    result = {"entries": rows}
    cache.set(cache_key, result, ttl=30)
    return result


@router.post("/duplicate")
def duplicate_week(payload: DuplicateWeekIn, user: dict = require_role("admin", "manager")):
    sb = get_supabase()
    
    # 1. Calculate source week dates
    src_start = payload.source_week_start
    src_end = src_start + timedelta(days=6)
    
    tgt_start = payload.target_week_start
    days_diff = (tgt_start - src_start).days
    
    if days_diff == 0:
        raise HTTPException(status_code=400, detail="Исходная и целевая недели совпадают")
        
    # 2. Fetch source entries (only DATED entries? Or recurring too? Assuming we duplicate DATED ones)
    # The user wants to copy "the schedule". 
    # If they are using dated schedule, we copy dated entries.
    q = sb.table("timetable_entries").select("*").eq("active", True)
    q = q.gte("lesson_date", src_start.isoformat()).lte("lesson_date", src_end.isoformat())
    
    if payload.class_id:
        q = q.cs("class_ids", [payload.class_id])
    if payload.stream_id:
        q = q.eq("stream_id", payload.stream_id)
        
    entries = q.execute().data or []
    
    if not entries:
        return {"count": 0, "message": "Нет занятий для копирования"}
        
    created_count = 0
    # 3. Copy entries
    for e in entries:
        # Calculate new date
        old_date = date.fromisoformat(e["lesson_date"])
        new_date = old_date + timedelta(days=days_diff)
        
        new_entry = e.copy()
        new_entry.pop("id", None)
        new_entry.pop("created_at", None)
        new_entry.pop("updated_at", None)
        new_entry["lesson_date"] = new_date.isoformat()
        new_entry["weekday"] = new_date.weekday()
        
        # Check conflicts? 
        # For bulk copy, we might skip conflict check or warn.
        # Let's try insert.
        sb.table("timetable_entries").insert(new_entry).execute()
        created_count += 1
        
    return {"count": created_count, "message": f"Скопировано {created_count} занятий"}


@router.get("/week")
@timed("get_week")
def get_week(weekStart: str, classId: str | None = None, user: dict = require_role("admin", "manager", "teacher", "student")):
    # weekStart is YYYY-MM-DD, Monday preferred.
    # classId: optional filter for students to select specific class/platoon
    start = date.fromisoformat(weekStart)
    end = start + timedelta(days=7)

    sb = get_supabase()

    select_fields = "id,class_id,class_ids,stream_id,teacher_id,subject,subject_id,lesson_type,weekday,start_time,end_time,meet_url"
    if _room_supported(sb):
        select_fields += ",room"

    else:
        tt = sb.table("timetable_entries").select(select_fields).eq("active", True)

    # Filter by date range (recurring OR specific date in range)
    # Using raw Postgrest filter string for OR logic
    # (lesson_date IS NULL) OR (lesson_date >= start AND lesson_date < end)
    # Note: 'end' is start + 7 days, so < end covers the week.
    
    # Supabase Python client .or_() accepts a comma-separated string of filters.
    # To combine OR with existing filters (like active=true), we chain .or_() to the query.
    # But .or_() in python client might replace previous filters if not careful? 
    # Actually .or_() adds an OR condition. The top-level filters are ANDed with this OR group.
    # Condition: lesson_date.is.null,and(lesson_date.gte.{start},lesson_date.lt.{end})
    
    # However, 'tt' variable logic above executes immediately in some branches?
    # No, 'tt' was assigned the query construction in lines 883, 890, 897.
    # Wait, line 883 has .execute(). Line 894 has .execute(). Line 897 has .execute().
    # I need to remove .execute() usage above and defer execution.
    
    # Let's rewrite the logic block to build query first.
    q = sb.table("timetable_entries").select(select_fields).eq("active", True)
    
    if user["role"] == "teacher":
        q = q.eq("teacher_id", user["id"])
    
    # Date filter
    q = q.or_(f"lesson_date.is.null,and(lesson_date.gte.{start},lesson_date.lt.{end})")
    
    result = q.execute()
    entries = result.data or []
    
    # Filter by stream dates: only show entries for classes in active streams within their date range
    stream_classes_resp = sb.table("stream_classes").select("class_id,stream_id,streams(start_date,end_date)").execute()
    stream_class_map = {}  # class_id -> {start_date, end_date}
    for sc in (stream_classes_resp.data or []):
        if sc.get("streams"):
            stream_class_map[sc["class_id"]] = {
                "start_date": date.fromisoformat(sc["streams"]["start_date"]) if sc["streams"].get("start_date") else None,
                "end_date": date.fromisoformat(sc["streams"]["end_date"]) if sc["streams"].get("end_date") else None
            }
    
    # Filter entries by stream dates
    filtered_entries = []
    for e in entries:
        class_id = e.get("class_id")
        if class_id and class_id in stream_class_map:
            stream_info = stream_class_map[class_id]
            start_date = stream_info.get("start_date")
            end_date = stream_info.get("end_date")
            # Only include if current week is within stream date range
            if start_date and start > end_date if end_date else False:
                continue  # Week is after stream ended
            if start_date and end < start_date:
                continue  # Week is before stream started
            filtered_entries.append(e)
        # Skip entries for classes not in any stream
    
    entries = filtered_entries
    
    if user["role"] == "student" and class_ids:
        # Filter entries by selected class
        enrolled = {str(x) for x in class_ids}
        entries = [e for e in entries if str(e.get("class_id") or "") in enrolled or enrolled.intersection(_entry_class_ids(e))]

    # Optional class filter for admin/manager/teacher
    if classId and user["role"] in ("admin", "manager", "teacher"):
        cid = str(classId)
        entries = [
            e
            for e in entries
            if str(e.get("class_id") or "") == cid or cid in _entry_class_ids(e)
        ]

    # Use a short-lived cache to avoid repeated lookups for classes/teachers
    # Include classId in cache key for student filtering
    cache_key = f"timetable_week:{weekStart}:{user['role']}:{user.get('id') or ''}:{classId or 'all'}"
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

    enriched = []
    for e in entries:
        weekday = int(e.get("weekday", 0))
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
                "subject_id": e.get("subject_id"),
                "weekday": weekday,
                "start_time": str(e.get("start_time"))[:5],
                "end_time": str(e.get("end_time"))[:5],
                "room": e.get("room"),
                "meet_url": e.get("meet_url"),
            }
        )


    enriched.sort(key=lambda r: (r.get("weekday") or 0, r.get("start_time") or ""))

    result = {"weekStart": weekStart, "entries": enriched}
    cache.set(cache_key, result, ttl=120)  # 2 minutes cache for better performance
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
    
    # Get all active teachers only
    teachers_result = sb.table("users").select("id, full_name, username").eq("role", "teacher").eq("is_active", True).execute()
    
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
        
        # Load context (other classes) to prevent conflicts and allow merging
        try:
            all_entries = sb.table("timetable_entries").select("*").eq("active", True).neq("class_id", payload.class_id).execute()
            if all_entries.data:
                context_lessons = []
                for entry in all_entries.data:
                    try:
                        # Parse times
                        start_t = dt_time.fromisoformat(str(entry["start_time"]))
                        end_t = dt_time.fromisoformat(str(entry["end_time"]))
                        
                        lesson = Lesson(
                            subject_id=entry.get("subject_id", "unknown"),
                            subject_name=entry.get("subject", "Unknown"),
                            lesson_type=entry.get("lesson_type", "theoretical"),
                            teacher_id=entry.get("teacher_id"),
                            preferred_room=entry.get("room")
                        )
                        
                        slot = TimeSlot(
                            weekday=entry["weekday"],
                            start_time=start_t,
                            end_time=end_t
                        )
                        
                        scheduled = ScheduledLesson(
                            lesson=lesson,
                            time_slot=slot,
                            class_id=entry["class_id"],
                            room=entry.get("room")
                        )
                        context_lessons.append(scheduled)
                    except Exception as e:
                        logger.warning(f"Skipping invalid entry {entry.get('id')}: {e}")
                        continue
                
                if context_lessons:
                    scheduler.load_context(context_lessons)
                    logger.info(f"Loaded {len(context_lessons)} existing lessons from other classes")
        except Exception as e:
            logger.error(f"Failed to load context schedule: {e}")
            # Continue without context (risk of conflicts)
        
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
            # Determine stream_id
            sid = payload.stream_id or _infer_stream_id_for_class(sb, payload.class_id)
            for scheduled in scheduled_lessons:
                entry_data = {
                    "class_id": scheduled.class_id,
                    "class_ids": [scheduled.class_id],
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
                if sid:
                    entry_data["stream_id"] = sid
                
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


# ============================================================================
# AUTO-GENERATE FROM CURRICULUM PLAN
# ============================================================================


class AutoGenerateFromCurriculumRequest(BaseModel):
    """Request to auto-generate schedule from curriculum plan (учебный план)."""
    class_id: str
    stream_id: Optional[str] = None
    weeks: int = Field(default=12, ge=1, le=52, description="Number of study weeks")
    
    # Optional constraints
    max_lessons_per_day: Optional[int] = Field(None, ge=1, le=8)
    min_lessons_per_day: Optional[int] = Field(None, ge=1, le=8)
    working_days: Optional[List[int]] = Field(None, description="Weekday numbers (0=Mon..6=Sun)")
    earliest_start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    latest_end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    lesson_duration_minutes: Optional[int] = Field(None, ge=30, le=180)
    break_duration_minutes: Optional[int] = Field(None, ge=0, le=60)
    
    clear_existing: bool = Field(False, description="Clear existing schedule before generating")
    dry_run: bool = Field(False, description="Only preview, don't save to database")


@router.post("/auto-generate-from-curriculum")
def auto_generate_from_curriculum(
    payload: AutoGenerateFromCurriculumRequest,
    _: dict = require_role("admin", "manager"),
):
    """
    Авторасписание из учебного плана (curriculum_plan).

    Алгоритм:
    1. Получить direction_id из class.direction_id
    2. Загрузить curriculum_plan для этого направления
    3. Конвертировать часы (л/з, с/з, пр/з) в кол-во пар в неделю
    4. Определить учителей через циклы (subject → cycle → teacher_cycles)
    5. Равномерно чередовать виды занятий (round-robin)
    6. Запустить AutoScheduler для генерации расписания
    7. Сохранить в timetable_entries
    """
    sb = get_supabase()

    try:
        # 1. Load class and get direction_id
        class_resp = sb.table("classes").select("id,name,direction_id").eq("id", payload.class_id).limit(1).execute()
        if not class_resp.data:
            raise HTTPException(status_code=404, detail="Взвод не найден")
        class_data = class_resp.data[0]
        direction_id = class_data.get("direction_id")
        if not direction_id:
            raise HTTPException(
                status_code=400,
                detail="У взвода не указано направление (direction_id). "
                       "Назначьте направление перед генерацией расписания.",
            )

        # 2. Build lessons from curriculum plan
        lessons, curriculum_details = build_lessons_from_curriculum(
            sb,
            direction_id=direction_id,
            weeks=payload.weeks,
            lesson_duration_hours=(payload.lesson_duration_minutes or 90) / 60,
        )

        if not lessons:
            raise HTTPException(
                status_code=400,
                detail="Учебный план пуст для данного направления. "
                       "Заполните учебный план (curriculum_plan) прежде чем генерировать расписание.",
            )

        logger.info(
            f"Generating curriculum-based schedule for class {payload.class_id} "
            f"({class_data.get('name')}): {len(lessons)} lessons from {len(curriculum_details)} subjects"
        )

        # 3. Build constraints
        constraints = ScheduleConstraints(
            max_lessons_per_day=payload.max_lessons_per_day or 4,
            min_lessons_per_day=payload.min_lessons_per_day or 3,
            allow_gaps=False,
            working_days=payload.working_days or [0, 1, 2, 3, 4],
            earliest_start=dt_time.fromisoformat(payload.earliest_start_time) if payload.earliest_start_time else dt_time(9, 0),
            latest_end=dt_time.fromisoformat(payload.latest_end_time) if payload.latest_end_time else dt_time(18, 0),
            lesson_duration_minutes=payload.lesson_duration_minutes or 90,
            break_duration_minutes=payload.break_duration_minutes or 15,
        )

        # 4. Clear existing schedule if requested
        if payload.clear_existing and not payload.dry_run:
            sb.table("timetable_entries").update({"active": False}).eq("class_id", payload.class_id).execute()
            logger.info(f"Cleared existing schedule for class {payload.class_id}")

        # 5. Run AutoScheduler
        scheduler = AutoScheduler(constraints)

        # Load context from other classes to prevent conflicts
        try:
            other_entries = (
                sb.table("timetable_entries")
                .select("*")
                .eq("active", True)
                .neq("class_id", payload.class_id)
                .execute()
            )
            if other_entries.data:
                context_lessons = []
                for entry in other_entries.data:
                    try:
                        start_t = dt_time.fromisoformat(str(entry["start_time"]))
                        end_t = dt_time.fromisoformat(str(entry["end_time"]))
                        context_lessons.append(ScheduledLesson(
                            lesson=Lesson(
                                subject_id=entry.get("subject_id", "unknown"),
                                subject_name=entry.get("subject", "Unknown"),
                                lesson_type=entry.get("lesson_type", "lecture"),
                                teacher_id=entry.get("teacher_id"),
                                preferred_room=entry.get("room"),
                            ),
                            time_slot=TimeSlot(
                                weekday=entry["weekday"],
                                start_time=start_t,
                                end_time=end_t,
                            ),
                            class_id=entry["class_id"],
                            room=entry.get("room"),
                        ))
                    except Exception:
                        continue
                if context_lessons:
                    scheduler.load_context(context_lessons)
                    logger.info(f"Loaded {len(context_lessons)} context lessons from other classes")
        except Exception as e:
            logger.warning(f"Could not load context schedule: {e}")

        try:
            scheduled_lessons = scheduler.generate_schedule(
                class_id=payload.class_id,
                lessons=lessons,
            )
        except ScheduleConflictError as e:
            raise HTTPException(
                status_code=409,
                detail=f"Конфликт при генерации расписания: {str(e)}",
            )

        # 6. Quality metrics
        quality = calculate_schedule_quality(scheduled_lessons, constraints)

        # 7. Save to DB
        saved_entries = []
        if not payload.dry_run:
            # Determine stream_id
            sid = payload.stream_id or _infer_stream_id_for_class(sb, payload.class_id)
            for sl in scheduled_lessons:
                entry_data = {
                    "class_id": sl.class_id,
                    "class_ids": [sl.class_id],
                    "subject_id": sl.lesson.subject_id,
                    "subject": sl.lesson.subject_name,
                    "teacher_id": sl.lesson.teacher_id,
                    "lesson_type": sl.lesson.lesson_type,
                    "weekday": sl.time_slot.weekday,
                    "start_time": sl.time_slot.start_time.strftime("%H:%M"),
                    "end_time": sl.time_slot.end_time.strftime("%H:%M"),
                    "room": sl.room,
                    "active": True,
                }
                if sid:
                    entry_data["stream_id"] = sid
                result = sb.table("timetable_entries").insert(entry_data).execute()
                if result.data:
                    saved_entries.append(result.data[0])
            logger.info(f"Saved {len(saved_entries)} lessons to database")

        # 8. Build response
        schedule_preview = [
            {
                "subject": sl.lesson.subject_name,
                "lesson_type": sl.lesson.lesson_type,
                "weekday": sl.time_slot.weekday,
                "start_time": sl.time_slot.start_time.strftime("%H:%M"),
                "end_time": sl.time_slot.end_time.strftime("%H:%M"),
                "teacher_id": sl.lesson.teacher_id,
                "room": sl.room,
            }
            for sl in scheduled_lessons
        ]

        return {
            "success": True,
            "class_id": payload.class_id,
            "class_name": class_data.get("name"),
            "direction_id": direction_id,
            "weeks": payload.weeks,
            "dry_run": payload.dry_run,
            "lessons_scheduled": len(scheduled_lessons),
            "quality_metrics": quality,
            "curriculum_details": curriculum_details,
            "schedule": schedule_preview if payload.dry_run else saved_entries,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in auto-generate-from-curriculum: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка генерации расписания: {str(e)}",
        )


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
        
        # Create theoretical lessons (Lecture)
        for i in range(plan.get("theoretical_lessons_count", 0)):
            lessons.append(Lesson(
                subject_id=subject_id,
                subject_name=subject_name,
                lesson_type="lecture",
                teacher_id=teacher_id
            ))
        
        # Create practical lessons (Seminar)
        for i in range(plan.get("practical_lessons_count", 0)):
            lessons.append(Lesson(
                subject_id=subject_id,
                subject_name=subject_name,
                lesson_type="seminar",
                teacher_id=teacher_id
            ))
    
    return lessons


@router.get("/exports/teachers-workload.xlsx")
def export_teachers_workload_excel(user: dict = require_role("admin", "manager")):
    """Export teachers workload to Excel"""
    sb = get_supabase()
    
    # Get all active teachers only
    teachers_result = sb.table("users").select("id, full_name, username").eq("role", "teacher").eq("is_active", True).execute()
    teachers = teachers_result.data or []
    
    today = date.today()
    month_start = today.replace(day=1)
    month_end_excl = _add_months(month_start, 1)
    three_end_excl = _add_months(month_start, 3)

    wb = Workbook()
    ws = wb.active
    ws.title = "Teachers Workload"
    
    # Headers
    headers = [
        "ФИО Преподавателя",
        "Часов в неделю",
        "Уроков в неделю",
        "Часов в месяц (текущий)",
        "Уроков в месяц (текущий)",
        "Часов за 3 месяца",
        "Уроков за 3 месяца"
    ]
    ws.append(headers)
    
    for teacher in teachers:
        teacher_id = teacher["id"]
        teacher_name = teacher.get("full_name") or teacher.get("username")
        
        # Get entries
        entries_result = sb.table("timetable_entries").select("*").eq("teacher_id", teacher_id).eq("active", True).execute()
        entries = entries_result.data or []
        
        if not entries:
            ws.append([teacher_name, 0, 0, 0, 0, 0, 0])
            continue

        stream_ids = {str(e.get("stream_id")) for e in entries if e.get("stream_id")}
        stream_bounds = _fetch_stream_bounds(sb, stream_ids)

        weekly_entries = _entries_active_on_day(entries, today, stream_bounds)
        weekly_lessons = _get_unique_lessons_count(weekly_entries)
        weekly_hours = _calculate_total_hours(weekly_entries)

        monthly_lessons, monthly_hours = _compute_period_totals(entries, month_start, month_end_excl, stream_bounds)
        three_month_lessons, three_month_hours = _compute_period_totals(
            entries, month_start, three_end_excl, stream_bounds
        )
        
        ws.append([
            teacher_name,
            round(weekly_hours, 2),
            weekly_lessons,
            round(monthly_hours, 2),
            monthly_lessons,
            round(three_month_hours, 2),
            three_month_lessons
        ])
        
    # Adjust column widths
    for col in ws.columns:
        max_length = 0
        column = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = (max_length + 2)
        ws.column_dimensions[column].width = adjusted_width

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    
    filename = f"teachers_workload_{today.isoformat()}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

