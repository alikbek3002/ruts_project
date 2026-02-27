from __future__ import annotations

from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
from app.core.monitor import timed
from app.core.provisioning import password_fingerprint
from app.core.security import hash_password
from app.db.supabase_client import get_supabase

router = APIRouter()


def _timetable_entries_for_teacher(sb, teacher_id: str, select_fields: str, weekday: int | None = None) -> list[dict]:
    q1 = sb.table("timetable_entries").select(select_fields).eq("active", True).eq("teacher_id", teacher_id)
    if weekday is not None:
        q1 = q1.eq("weekday", weekday)
    return q1.execute().data or []


def _timetable_entries_for_class(
    sb,
    class_id: str,
    select_fields: str,
    teacher_id: str | None = None,
) -> list[dict]:
    """
    Backward-compatible class timetable fetch:
    - new schema: class_ids contains class_id
    - legacy schema/rows: class_id equals class_id
    """
    q_multi = (
        sb.table("timetable_entries")
        .select(select_fields)
        .eq("active", True)
        .cs("class_ids", [class_id])
    )
    if teacher_id:
        q_multi = q_multi.eq("teacher_id", teacher_id)
    rows_multi = q_multi.execute().data or []

    q_legacy = (
        sb.table("timetable_entries")
        .select(select_fields)
        .eq("active", True)
        .eq("class_id", class_id)
    )
    if teacher_id:
        q_legacy = q_legacy.eq("teacher_id", teacher_id)
    rows_legacy = q_legacy.execute().data or []

    by_id: dict[str, dict] = {}
    for row in rows_multi + rows_legacy:
        rid = row.get("id")
        if not rid:
            continue
        by_id[str(rid)] = row
    return list(by_id.values())


def _normalize_lesson_date(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if "T" in s:
        s = s.split("T", 1)[0]
    return s[:10] if len(s) >= 10 else s


def _entry_matches_weekday(entry_weekday: object, target_weekday: int) -> bool:
    """
    Compatibility for both weekday conventions:
    - 0..6 (Mon..Sun) [current]
    - 1..7 (Mon..Sun) [legacy]
    """
    if entry_weekday is None:
        return False
    try:
        w = int(str(entry_weekday))
    except (ValueError, TypeError):
        return False
    if 0 <= w <= 6:
        return w == target_weekday
    if 1 <= w <= 7:
        return (w - 1) == target_weekday
    return False


def _ensure_legacy_student_id_for_enrollment(sb, class_id: str, enrollment: dict) -> str | None:
    """
    Ensure class enrollment has legacy_student_id.
    If missing, create a technical inactive student user and bind it.
    """
    legacy = enrollment.get("legacy_student_id")
    if legacy:
        return str(legacy)

    enrollment_id = enrollment.get("id")
    if not enrollment_id:
        return None
    enrollment_id = str(enrollment_id)

    username = f"enr-{enrollment_id}"
    full_name = (enrollment.get("student_full_name") or "").strip()
    if not full_name:
        num = enrollment.get("student_number")
        full_name = f"Student #{num}" if num is not None else f"Student {enrollment_id[:8]}"

    existing = (
        sb.table("users")
        .select("id")
        .eq("username", username)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        user_id = str(existing[0].get("id"))
    else:
        raw_password = f"enrollment:{enrollment_id}"
        payload = {
            "role": "student",
            "username": username,
            "full_name": full_name,
            "password_hash": hash_password(raw_password),
            "password_fingerprint": password_fingerprint(raw_password),
            "must_change_password": False,
            "is_active": False,
        }
        try:
            created = sb.table("users").insert(payload).execute().data or []
        except Exception:
            # Backward-compatible fallback if password_fingerprint column is absent.
            payload.pop("password_fingerprint", None)
            created = sb.table("users").insert(payload).execute().data or []
        if not created:
            raise HTTPException(status_code=500, detail="Failed to provision student account")
        user_id = str(created[0].get("id"))

    sb.table("class_enrollments").update({"legacy_student_id": user_id}).eq("class_id", class_id).eq("id", enrollment_id).execute()
    return user_id


def _resolve_legacy_student_id_for_class(sb, class_id: str, raw_student_id: str) -> str | None:
    sid = str(raw_student_id)

    by_legacy = (
        sb.table("class_enrollments")
        .select("id,legacy_student_id,student_full_name,student_number")
        .eq("class_id", class_id)
        .eq("legacy_student_id", sid)
        .limit(1)
        .execute()
        .data
        or []
    )
    if by_legacy and by_legacy[0].get("legacy_student_id"):
        return str(by_legacy[0]["legacy_student_id"])

    by_enrollment = (
        sb.table("class_enrollments")
        .select("id,legacy_student_id,student_full_name,student_number")
        .eq("class_id", class_id)
        .eq("id", sid)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not by_enrollment:
        return None

    enrollment = by_enrollment[0]
    if enrollment.get("legacy_student_id"):
        return str(enrollment["legacy_student_id"])

    return _ensure_legacy_student_id_for_enrollment(sb, class_id, enrollment)


def _teacher_can_access_entry(sb, teacher_id: str, entry_data: dict) -> bool:
    return entry_data.get("teacher_id") == teacher_id


class GradeEntry(BaseModel):
    subject: str
    grade: int
    comment: str | None = None


class SaveGradesIn(BaseModel):
    student_id: str
    grades: list[GradeEntry]


class AddGradeIn(BaseModel):
    student_id: str
    timetable_entry_id: str
    lesson_date: str  # YYYY-MM-DD
    grade: int | None = None  # None = no grade, 2-5 valid values
    present: bool = True  # False = РѕС‚СЃСѓС‚СЃС‚РІРёРµ
    comment: str | None = None
    attendance_type: str | None = None  # present, absent, duty (РљРµР·РјРµС‚), excused (РђСЂС‹Р·), sick (РћСЂСѓСѓ)


@router.get("/teacher/classes")
@timed("get_teacher_classes")
def get_teacher_classes(user: dict = require_role("teacher", "admin", "manager")):
    """РџРѕР»СѓС‡РёС‚СЊ РІСЃРµ РєР»Р°СЃСЃС‹ (РґР»СЏ РІС‹Р±РѕСЂР° Р¶СѓСЂРЅР°Р»Р°)"""
    sb = get_supabase()
    
    # Return all classes, sorted by name
    # We might want to optimize this if there are thousands, but for now it's fine.
    # We mark "my" classes (where teacher has schedule) for UI highlighting if needed.
    
    # 1. Get all classes
    all_classes = sb.table("classes").select("id,name").order("name").execute().data or []
    
    # 2. Get my classes (to highlight or sort to top?)
    # For now, just return all. The user asked for "just all classes".
    
    return {"classes": all_classes}


@router.get("/classes/{class_id}/subjects")
def get_class_subjects(class_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """Return class subjects from active timetable entries."""
    sb = get_supabase()
    rows = _timetable_entries_for_class(
        sb,
        class_id,
        "id,subject_id,subject,teacher_id",
        user["id"] if user.get("role") == "teacher" else None,
    )

    subject_ids = sorted({str(r.get("subject_id")) for r in rows if r.get("subject_id")})
    names_by_id: dict[str, str] = {}
    if subject_ids:
        subject_rows = (
            sb.table("subjects")
            .select("id,name")
            .in_("id", subject_ids)
            .is_("archived_at", "null")
            .execute()
            .data
            or []
        )
        names_by_id = {
            str(s.get("id")): str(s.get("name") or "").strip()
            for s in subject_rows
            if s.get("id")
        }

    subjects_map: dict[str, dict] = {}
    for r in rows:
        sid_raw = r.get("subject_id")
        if not sid_raw:
            continue
        sid = str(sid_raw)
        if sid in subjects_map:
            continue
        name = names_by_id.get(sid) or str(r.get("subject") or "").strip()
        if not name:
            continue
        subjects_map[sid] = {
            "id": sid,
            "name": name,
            "is_mine": bool(r.get("teacher_id") == user.get("id")),
        }

    sorted_subjects = sorted(
        subjects_map.values(),
        key=lambda x: (not x.get("is_mine", False), x.get("name") or ""),
    )

    return {"subjects": sorted_subjects}

@router.get("/teacher/schedule")
@timed("get_teacher_schedule")
def get_teacher_schedule(
    date_from: str,
    date_to: str,
    user: dict = require_role("teacher")
):
    """РџРѕР»СѓС‡РёС‚СЊ СЂР°СЃРїРёСЃР°РЅРёРµ СѓС‡РёС‚РµР»СЏ РЅР° РґРёР°РїР°Р·РѕРЅ РґР°С‚ СЃ СѓСЂРѕРєР°РјРё"""
    sb = get_supabase()
    
    # РџРѕР»СѓС‡Р°РµРј РІСЃРµ СѓСЂРѕРєРё СѓС‡РёС‚РµР»СЏ РёР· СЂР°СЃРїРёСЃР°РЅРёСЏ.
    timetable = _timetable_entries_for_teacher(
        sb,
        user["id"],
        "id,class_id,class_ids,subject,weekday,start_time,end_time,room,subject_id,subjects(name)",
    )
    
    if not timetable:
        return {"lessons": []}
    
    # РЎРѕР±РёСЂР°РµРј РІСЃРµ class_ids РґР»СЏ batch Р·Р°РїСЂРѕСЃР° РЅР°Р·РІР°РЅРёР№
    all_cids: list[str] = []
    for e in timetable:
        cids = e.get("class_ids") or []
        if cids:
            all_cids.extend([str(c) for c in cids if c])
        elif e.get("class_id"):
            all_cids.append(str(e["class_id"]))
    all_cids = list(dict.fromkeys(all_cids))
    class_names: dict[str, str] = {}
    if all_cids:
        cn_rows = sb.table("classes").select("id,name").in_("id", all_cids).execute().data or []
        class_names = {str(r["id"]): r.get("name", "") for r in cn_rows if r.get("id")}
    
    # Р“РµРЅРµСЂРёСЂСѓРµРј РґР°С‚С‹ РІ РґРёР°РїР°Р·РѕРЅРµ
    start_date = date.fromisoformat(date_from)
    end_date = date.fromisoformat(date_to)
    
    lessons = []
    current_date = start_date
    
    while current_date <= end_date:
        wd = current_date.weekday()  # 0=Mon, 6=Sun (matches timetable_entries)
        
        # РќР°С…РѕРґРёРј СѓСЂРѕРєРё РЅР° СЌС‚РѕС‚ РґРµРЅСЊ РЅРµРґРµР»Рё
        day_lessons = [e for e in timetable if e.get("weekday") == wd]
        
        for entry in day_lessons:
            subject_name = entry.get("subjects", {}).get("name") if entry.get("subjects") else entry.get("subject")
            cids = entry.get("class_ids") or []
            if not cids:
                cids = [entry.get("class_id")] if entry.get("class_id") else []
            
            # Р”Р»СЏ РєР°Р¶РґРѕР№ РіСЂСѓРїРїС‹ СЃРѕР·РґР°С‘Рј РѕС‚РґРµР»СЊРЅС‹Р№ СѓСЂРѕРє
            for cid in cids:
                cid_str = str(cid) if cid else ""
                lessons.append({
                    "timetable_entry_id": entry.get("id"),
                    "date": current_date.isoformat(),
                    "weekday": wd,
                    "start_time": entry.get("start_time"),
                    "end_time": entry.get("end_time"),
                    "subject": entry.get("subject"),
                    "subject_name": subject_name,
                    "class_id": cid_str,
                    "class_name": class_names.get(cid_str, ""),
                    "room": entry.get("room")
                })
        
        current_date += timedelta(days=1)
    
    # РЎРѕСЂС‚РёСЂСѓРµРј РїРѕ РґР°С‚Рµ Рё РІСЂРµРјРµРЅРё
    lessons.sort(key=lambda x: (x["date"], x["start_time"] or ""))
    
    return {"lessons": lessons}


@router.get("/teacher/lessons/{lesson_date}")
@timed("get_teacher_lessons_for_date")
def get_teacher_lessons_for_date(
    lesson_date: str,
    user: dict = require_role("teacher")
):
    """РџРѕР»СѓС‡РёС‚СЊ РІСЃРµ СѓСЂРѕРєРё СѓС‡РёС‚РµР»СЏ РЅР° РєРѕРЅРєСЂРµС‚РЅСѓСЋ РґР°С‚Сѓ"""
    sb = get_supabase()
    
    # РћРїСЂРµРґРµР»СЏРµРј РґРµРЅСЊ РЅРµРґРµР»Рё (0=Mon, 6=Sun вЂ” СЃРѕРІРїР°РґР°РµС‚ СЃ timetable_entries)
    lesson_date_obj = date.fromisoformat(lesson_date)
    wd = lesson_date_obj.weekday()
    
    # РџРѕР»СѓС‡Р°РµРј СЂР°СЃРїРёСЃР°РЅРёРµ РЅР° СЌС‚РѕС‚ РґРµРЅСЊ.
    timetable = _timetable_entries_for_teacher(
        sb,
        user["id"],
        "id,class_id,class_ids,subject,weekday,start_time,end_time,room,subject_id,subjects(name)",
        weekday=wd,
    )
    timetable.sort(key=lambda x: (x.get("start_time") or ""))
    
    if not timetable:
        return {"lessons": []}

    # РЎРѕР±РёСЂР°РµРј РІСЃРµ class_ids РґР»СЏ batch Р·Р°РїСЂРѕСЃР° РЅР°Р·РІР°РЅРёР№
    all_cids: list[str] = []
    for e in timetable:
        cids = e.get("class_ids") or []
        if cids:
            all_cids.extend([str(c) for c in cids if c])
        elif e.get("class_id"):
            all_cids.append(str(e["class_id"]))
    all_cids = list(dict.fromkeys(all_cids))
    class_names: dict[str, str] = {}
    if all_cids:
        cn_rows = sb.table("classes").select("id,name").in_("id", all_cids).execute().data or []
        class_names = {str(r["id"]): r.get("name", "") for r in cn_rows if r.get("id")}

    # РћРїС‚РёРјРёР·Р°С†РёСЏ: РїРѕР»СѓС‡Р°РµРј РІСЃРµ Р·Р°РїРёСЃРё Р¶СѓСЂРЅР°Р»Р° РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј
    entry_ids = [e["id"] for e in timetable]
    journal_entries = (
        sb.table("lesson_journal")
        .select("timetable_entry_id")
        .in_("timetable_entry_id", entry_ids)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # РЎРѕР·РґР°РµРј РјРЅРѕР¶РµСЃС‚РІРѕ ID СѓСЂРѕРєРѕРІ, РґР»СЏ РєРѕС‚РѕСЂС‹С… РµСЃС‚СЊ Р·Р°РїРёСЃРё РІ Р¶СѓСЂРЅР°Р»Рµ
    entries_with_journal = {e["timetable_entry_id"] for e in journal_entries}
    
    lessons = []
    for entry in timetable:
        subject_name = entry.get("subjects", {}).get("name") if entry.get("subjects") else entry.get("subject")
        cids = entry.get("class_ids") or []
        if not cids:
            cids = [entry.get("class_id")] if entry.get("class_id") else []
        
        # Р”Р»СЏ РєР°Р¶РґРѕР№ РіСЂСѓРїРїС‹ СЃРѕР·РґР°С‘Рј РѕС‚РґРµР»СЊРЅСѓСЋ Р·Р°РїРёСЃСЊ СѓСЂРѕРєР°
        for cid in cids:
            cid_str = str(cid) if cid else ""
            lessons.append({
                "timetable_entry_id": entry.get("id"),
                "date": lesson_date,
                "start_time": entry.get("start_time"),
                "end_time": entry.get("end_time"),
                "subject": entry.get("subject"),
                "subject_name": subject_name,
                "class_id": cid_str,
                "class_name": class_names.get(cid_str, ""),
                "room": entry.get("room"),
                "has_journal_entries": entry.get("id") in entries_with_journal
            })
    
    return {"lessons": lessons}


class BulkAttendanceIn(BaseModel):
    timetable_entry_id: str
    lesson_date: str
    student_ids: list[str]
    present: bool


@router.post("/bulk-attendance")
def bulk_mark_attendance(
    payload: BulkAttendanceIn,
    user: dict = require_role("teacher", "admin", "manager")
):
    """РњР°СЃСЃРѕРІР°СЏ РѕС‚РјРµС‚РєР° РїРѕСЃРµС‰Р°РµРјРѕСЃС‚Рё"""
    sb = get_supabase()
    
    # РџСЂРѕРІРµСЂСЏРµРј СѓСЂРѕРє
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,teacher_id")
        .eq("id", payload.timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    # Allow teacher to edit if they are the teacher OR if they have access to the class?
    # For now, strict check on teacher_id or being admin.
    # If "All groups" mode is on, we might want to relax this?
    # But usually you only grade your own lessons. Confirmed by user "Choice of subject".
    # Assuming if I pick a subject I teach, I can grade.
    
    entry_data = entry[0]
    
    # Relaxed check: if I am a teacher, I can grade any lesson? 
    # Or should I check if I am listed as teacher_id?
    # Existing logic:
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        # Allow if no teacher assigned?
        if not entry_data.get("teacher_id"):
            pass  # Allowed
        else:
            raise HTTPException(status_code=403, detail="Access denied")
    
    # РЎРѕР·РґР°РµРј/РѕР±РЅРѕРІР»СЏРµРј Р·Р°РїРёСЃРё РґР»СЏ РІСЃРµС… СЃС‚СѓРґРµРЅС‚РѕРІ
    records = []
    for student_id in payload.student_ids:
        records.append({
            "timetable_entry_id": payload.timetable_entry_id,
            "lesson_date": payload.lesson_date,
            "student_id": student_id,
            "present": payload.present,
            "created_by": user["id"],
            "updated_at": datetime.utcnow().isoformat()
        })
    
    if records:
        sb.table("lesson_journal").upsert(
            records,
            on_conflict="timetable_entry_id,lesson_date,student_id"
        ).execute()
    
    return {"ok": True, "updated": len(records)}


@router.get("/lesson-details")
def get_lesson_details(
    timetable_entry_id: str,
    lesson_date: str,
    user: dict = require_role("teacher", "admin", "manager")
):
    """РџРѕР»СѓС‡РёС‚СЊ РґРµС‚Р°Р»СЊРЅСѓСЋ РёРЅС„РѕСЂРјР°С†РёСЋ РѕР± СѓСЂРѕРєРµ СЃРѕ СЃРїРёСЃРєРѕРј СЃС‚СѓРґРµРЅС‚РѕРІ Рё РёС… РѕС†РµРЅРєР°РјРё"""
    sb = get_supabase()
    
    # РџРѕР»СѓС‡Р°РµРј РёРЅС„РѕСЂРјР°С†РёСЋ РѕР± СѓСЂРѕРєРµ
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,class_ids,subject,teacher_id,start_time,end_time,room,subject_id,subjects(name)")
        .eq("id", timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    
    # РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРї РґР»СЏ СѓС‡РёС‚РµР»СЏ
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Access denied")

    # РџРѕРґРґРµСЂР¶РєР° multi-group: РёСЃРїРѕР»СЊР·СѓРµРј class_ids (РјР°СЃСЃРёРІ) РІРјРµСЃС‚Рѕ class_id (РѕРґРЅРѕРіРѕ)
    class_ids_list = entry_data.get("class_ids") or []
    if not class_ids_list:
        class_ids_list = [entry_data.get("class_id")] if entry_data.get("class_id") else []
    class_ids_list = [str(c) for c in class_ids_list if c]
    
    subject_name = entry_data.get("subjects", {}).get("name") if entry_data.get("subjects") else entry_data.get("subject")
    
    # РџРѕР»СѓС‡Р°РµРј РЅР°Р·РІР°РЅРёСЏ РІСЃРµС… РєР»Р°СЃСЃРѕРІ
    class_name = ""
    if class_ids_list:
        cn_rows = sb.table("classes").select("id,name").in_("id", class_ids_list).execute().data or []
        cn_map = {str(r["id"]): r.get("name", "") for r in cn_rows if r.get("id")}
        class_name = ", ".join(cn_map.get(c, c) for c in class_ids_list)
    
    # РџРѕР»СѓС‡Р°РµРј СЃС‚СѓРґРµРЅС‚РѕРІ РёР· Р’РЎР•РҐ РєР»Р°СЃСЃРѕРІ (РґР»СЏ multi-group СѓСЂРѕРєРѕРІ)
    enrollments = []
    for cid in class_ids_list:
        enr = (
            sb.table("class_enrollments")
            .select("id,legacy_student_id,student_number,student_full_name,class_id")
            .eq("class_id", cid)
            .execute()
            .data
            or []
        )
        enrollments.extend(enr)
    
    student_ids = [e.get("legacy_student_id") for e in enrollments if e.get("legacy_student_id")]
    users_by_id: dict[str, dict] = {}
    
    if student_ids:
        students_resp = (
            sb.table("users")
            .select("id,username,full_name")
            .in_("id", student_ids)
            .execute()
            .data
            or []
        )
        users_by_id = {str(s.get("id")): s for s in students_resp if s.get("id")}
    
    # РџРѕР»СѓС‡Р°РµРј Р·Р°РїРёСЃРё РёР· Р¶СѓСЂРЅР°Р»Р° РґР»СЏ СЌС‚РѕРіРѕ СѓСЂРѕРєР°
    journal_records = (
        sb.table("lesson_journal")
        .select("student_id,grade,present,comment,lesson_topic,homework,attendance_type,subject_topic_id")
        .eq("timetable_entry_id", timetable_entry_id)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # РРЅРґРµРєСЃРёСЂСѓРµРј Р·Р°РїРёСЃРё РїРѕ student_id
    journal_by_student = {r.get("student_id"): r for r in journal_records}
    
    # РЎРѕР±РёСЂР°РµРј С‚РµРјСѓ Рё Р”Р— (Р±РµСЂРµРј РїРµСЂРІРѕРµ РЅРµРїСѓСЃС‚РѕРµ Р·РЅР°С‡РµРЅРёРµ)
    lesson_topic = None
    homework = None
    subject_topic_id = None
    for record in journal_records:
        if record.get("lesson_topic") and not lesson_topic:
            lesson_topic = record["lesson_topic"]
        if record.get("homework") and not homework:
            homework = record["homework"]
        if record.get("subject_topic_id") and not subject_topic_id:
            subject_topic_id = record["subject_topic_id"]
    
    # Р¤РѕСЂРјРёСЂСѓРµРј СЃРїРёСЃРѕРє СЃС‚СѓРґРµРЅС‚РѕРІ
    students = []
    for e in enrollments:
        legacy_id = e.get("legacy_student_id")
        enrollment_id = e.get("id")
        sid = str(legacy_id) if legacy_id else (str(enrollment_id) if enrollment_id else None)
        if not sid:
            continue

        user_row = users_by_id.get(str(legacy_id)) if legacy_id else None
        journal = journal_by_student.get(str(legacy_id), {}) if legacy_id else {}
        student_number = e.get("student_number")
        fallback_name = e.get("student_full_name") or (f"Student #{student_number}" if student_number is not None else "Student")
        display_name = (user_row.get("full_name") or user_row.get("username")) if user_row else fallback_name

        students.append({
            "id": sid,
            "name": display_name,
            "username": user_row.get("username") if user_row else None,
            "student_number": student_number,
            "grade": journal.get("grade"),
            "present": journal.get("present"),
            "comment": journal.get("comment"),
            "attendance_type": journal.get("attendance_type")
        })
    
    # РЎРѕСЂС‚РёСЂСѓРµРј РїРѕ РЅРѕРјРµСЂСѓ СЃС‚СѓРґРµРЅС‚Р°
    students.sort(key=lambda x: (x["student_number"] is None, x["student_number"] or 0, x["name"] or "", x["username"] or ""))
    
    return {
        "lesson": {
            "timetable_entry_id": timetable_entry_id,
            "date": lesson_date,
            "subject": entry_data.get("subject"),
            "subject_name": subject_name,
            "class_id": class_ids_list[0] if class_ids_list else None,
            "class_name": class_name,
            "start_time": entry_data.get("start_time"),
            "end_time": entry_data.get("end_time"),
            "room": entry_data.get("room"),
            "lesson_topic": lesson_topic,
            "homework": homework,
            "subject_topic_id": subject_topic_id
        },
        "students": students
    }


@router.get("/classes/{class_id}/journal")
def get_class_journal(
    class_id: str,
    subject_id: str | None = None,
    user: dict = require_role("teacher", "admin", "manager")
):
    """РџРѕР»СѓС‡РёС‚СЊ Р¶СѓСЂРЅР°Р» РєР»Р°СЃСЃР° СЃ РѕС†РµРЅРєР°РјРё РїРѕ РґР°С‚Р°Рј СѓСЂРѕРєРѕРІ"""
    sb = get_supabase()
    
    timetable = _timetable_entries_for_class(
        sb,
        class_id,
        "id,class_id,class_ids,subject,weekday,start_time,subject_id,teacher_id,stream_id,created_at,lesson_date",
        user["id"] if user["role"] == "teacher" else None,
    )

    # Filter in memory to handle cases where subject_id is missing in timetable but name matches
    if subject_id:
        target_subject_id = str(subject_id)
        # 1. Get the target subject name
        subj_data = sb.table("subjects").select("name").eq("id", subject_id).limit(1).execute().data
        target_name = str(subj_data[0]["name"]) if subj_data else ""
        target_name_norm = target_name.strip().casefold()
        
        # 2. Filter entries: match ID OR match Name
        filtered = []
        for t in timetable:
            # Match by ID
            if t.get("subject_id") and str(t.get("subject_id")) == target_subject_id:
                filtered.append(t)
                continue
            # Match by Name (loose match)
            t_name_norm = str(t.get("subject") or "").strip().casefold()
            if target_name_norm and (
                t_name_norm == target_name_norm
                or target_name_norm in t_name_norm
                or t_name_norm in target_name_norm
            ):
                filtered.append(t)
                continue
        
        timetable = filtered
    
    if not timetable:
         # РџСЂРѕСЃС‚Рѕ РІРµСЂРЅРµРј РїСѓСЃС‚РѕС‚Сѓ
        return {"students": [], "lessons": [], "grades": {}}
    
    # РџРѕР»СѓС‡Р°РµРј РґР°С‚С‹ РїРѕС‚РѕРєРѕРІ РґР»СЏ РїСЂРѕРІРµСЂРєРё (С‡С‚РѕР±С‹ РЅРµ РїРѕРєР°Р·С‹РІР°С‚СЊ СѓСЂРѕРєРё РІРЅРµ РґР°С‚ РїРѕС‚РѕРєР°)
    # РџРѕР»СѓС‡Р°РµРј РІСЃРµС… СѓС‡РµРЅРёРєРѕРІ РєР»Р°СЃСЃР°
    enrollments = (
        sb.table("class_enrollments")
        .select("legacy_student_id")
        .eq("class_id", class_id)
        .execute()
        .data
        or []
    )
    student_ids = [e.get("legacy_student_id") for e in enrollments if e.get("legacy_student_id")]
    
    students = []
    if student_ids:
        students = (
            sb.table("users")
            .select("id,username,full_name")
            .in_("id", student_ids)
            .order("full_name")
            .execute()
            .data
            or []
        )
    
    # РџРѕР»СѓС‡Р°РµРј Р·Р°РїРёСЃРё РёР· lesson_journal РґР»СЏ СЌС‚РёС… СѓСЂРѕРєРѕРІ
    entry_ids = [e.get("id") for e in timetable if e.get("id")]
    
    journal_records = (
        sb.table("lesson_journal")
        .select("timetable_entry_id,lesson_date,student_id,grade,present,comment,lesson_topic,homework,attendance_type,subject_topic_id,created_by")
        .in_("timetable_entry_id", entry_ids)
        .order("lesson_date", desc=False)
        .execute()
        .data
        or []
    )
    
    # Р“СЂСѓРїРїРёСЂСѓРµРј СѓСЂРѕРєРё РїРѕ РґР°С‚Р°Рј Рё СЃРѕР±РёСЂР°РµРј С‚РµРјС‹/Р”Р—
    creator_ids = sorted({str(r.get("created_by")) for r in journal_records if r.get("created_by")})
    creator_names: dict[str, str] = {}
    if creator_ids:
        creator_rows = (
            sb.table("users")
            .select("id,full_name,username")
            .in_("id", creator_ids)
            .execute()
            .data
            or []
        )
        for row in creator_rows:
            uid = row.get("id")
            if not uid:
                continue
            creator_names[str(uid)] = str(row.get("full_name") or row.get("username") or "РќРµ СѓРєР°Р·Р°РЅРѕ")

    lessons_by_date = {}
    
    # Р“РµРЅРµСЂРёСЂСѓРµРј СЃРµС‚РєСѓ СѓСЂРѕРєРѕРІ: РїСЂРѕС€Р»С‹Рµ/С‚РµРєСѓС‰РёРµ + Р±Р»РёР¶Р°Р№С€Р°СЏ РЅРµРґРµР»СЏ РІРїРµСЂРµРґ
    today = date.today()
    journal_future_days = 7
    
    # РСЃРїРѕР»СЊР·СѓРµРј РґР°С‚С‹ РїРѕС‚РѕРєРѕРІ РґР»СЏ РѕРїСЂРµРґРµР»РµРЅРёСЏ РЅР°С‡Р°Р»Р° Р¶СѓСЂРЅР°Р»Р°
    # Р‘РµСЂРµРј СЃР°РјСѓСЋ СЂР°РЅРЅСЋСЋ РґР°С‚Сѓ start РёР· РїРѕС‚РѕРєРѕРІ, РїСЂРёРІСЏР·Р°РЅРЅС‹С… Рє СЌС‚РёРј СѓСЂРѕРєР°Рј
    if today.month >= 9:
        start_date = date(today.year, 9, 1)
    else:
        start_date = date(today.year - 1, 9, 1)

    # Show lessons up to one week ahead.
    end_date = today + timedelta(days=journal_future_days)
        
    current = start_date
    while current <= end_date:
        wd = current.weekday()  # 0=Mon, 6=Sun (matches timetable_entries)
        d_str = current.isoformat()
        
        # Filter entries for this day
        day_entries = []
        for e in timetable:
            # If entry has specific date, it MUST match current date
            lesson_date = _normalize_lesson_date(e.get("lesson_date"))
            if lesson_date:
                if lesson_date == d_str:
                    day_entries.append(e)
            else:
                if _entry_matches_weekday(e.get("weekday"), wd):
                    day_entries.append(e)

        for entry in day_entries:
            key = f"{d_str}_{entry['id']}"
            lessons_by_date[key] = {
                "date": d_str,
                "timetable_entry_id": entry['id'],
                "subject_name": entry.get("subject", ""),
                "start_time": entry.get("start_time"),
                "lesson_topic": None,
                "homework": None
            }
        current += timedelta(days=1)
    
    lesson_info = {}  # РҐСЂР°РЅРёРј С‚РµРјСѓ Рё Р”Р— РґР»СЏ РєР°Р¶РґРѕРіРѕ СѓСЂРѕРєР°
    
    for record in journal_records:
        entry_id = record.get("timetable_entry_id")
        d_str = record.get("lesson_date")
        
        # РќР°С…РѕРґРёРј РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ СѓСЂРѕРєРµ
        entry = next((e for e in timetable if e.get("id") == entry_id), None)
        if not entry:
            continue
        
        key = f"{d_str}_{entry_id}"
        if key not in lessons_by_date:
            lessons_by_date[key] = {
                "date": d_str,
                "timetable_entry_id": entry_id,
                "subject_name": entry.get("subject", ""),
                "start_time": entry.get("start_time"),
                "lesson_topic": None,
                "homework": None,
                "subject_topic_id": None
            }
        
        # РЎРѕР±РёСЂР°РµРј С‚РµРјСѓ СѓСЂРѕРєР° Рё Р”Р— (Р±РµСЂРµРј РїРµСЂРІРѕРµ РЅРµРїСѓСЃС‚РѕРµ Р·РЅР°С‡РµРЅРёРµ)
        if key not in lesson_info:
            lesson_info[key] = {"lesson_topic": None, "homework": None, "subject_topic_id": None}
        
        if record.get("lesson_topic") and not lesson_info[key]["lesson_topic"]:
            lesson_info[key]["lesson_topic"] = record["lesson_topic"]
        if record.get("homework") and not lesson_info[key]["homework"]:
            lesson_info[key]["homework"] = record["homework"]
        if record.get("subject_topic_id") and not lesson_info[key]["subject_topic_id"]:
            lesson_info[key]["subject_topic_id"] = record["subject_topic_id"]
    
    # РЎРѕСЂС‚РёСЂСѓРµРј СѓСЂРѕРєРё РїРѕ РґР°С‚Рµ Рё РґРѕР±Р°РІР»СЏРµРј С‚РµРјСѓ/Р”Р—
    lessons = sorted(
        lessons_by_date.values(),
        key=lambda x: (
            x.get("date") or "",
            str(x.get("start_time") or ""),
            str(x.get("timetable_entry_id") or ""),
        ),
    )
    for lesson in lessons:
        key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
        info = lesson_info.get(key, {})
        if info.get("lesson_topic"):
            lesson["lesson_topic"] = info.get("lesson_topic")
        if info.get("homework"):
            lesson["homework"] = info.get("homework")
        if info.get("subject_topic_id"):
            lesson["subject_topic_id"] = info.get("subject_topic_id")
    
    # РЎС‚СЂСѓРєС‚СѓСЂР°: grades[student_id][lesson_key] = {grades: [...], present: bool|null}
    grades = {}
    for student in students:
        sid = student.get("id")
        grades[sid] = {}
        for lesson in lessons:
            key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
            
            # РќР°С…РѕРґРёРј РІСЃРµ Р·Р°РїРёСЃРё РґР»СЏ СЌС‚РѕРіРѕ СѓС‡РµРЅРёРєР°/СѓСЂРѕРєР°
            student_records = [
                r for r in journal_records
                if r.get("student_id") == sid 
                and r.get("timetable_entry_id") == lesson["timetable_entry_id"]
                and r.get("lesson_date") == lesson["date"]
            ]
            
            lesson_grades = [
                {
                    "grade": r.get("grade"),
                    "comment": r.get("comment"),
                    "created_by": r.get("created_by"),
                    "created_by_name": creator_names.get(str(r.get("created_by")), "РќРµ СѓРєР°Р·Р°РЅРѕ")
                    if r.get("created_by")
                    else "РќРµ СѓРєР°Р·Р°РЅРѕ"
                }
                for r in student_records
                if r.get("grade") is not None
            ]
            
            # РћРїСЂРµРґРµР»СЏРµРј СЃС‚Р°С‚СѓСЃ РїСЂРёСЃСѓС‚СЃС‚РІРёСЏ
            present = None
            attendance_type = None
            for r in student_records:
                if r.get("present") is not None:
                    present = r.get("present")
                if r.get("attendance_type"):
                    attendance_type = r.get("attendance_type")
                    
            grades[sid][key] = {
                "grades": lesson_grades,
                "present": present,
                "attendance_type": attendance_type
            }
    
    # Р¤РѕСЂРјР°С‚РёСЂСѓРµРј СЃС‚СѓРґРµРЅС‚РѕРІ
    students_list = [
        {
            "id": s.get("id"),
            "name": s.get("full_name") or s.get("username"),
            "username": s.get("username")
        }
        for s in students
    ]
    
    return {
        "students": students_list,
        "lessons": lessons,
        "grades": grades
    }


@router.post("/classes/{class_id}/grades")
def add_grade(
    class_id: str,
    payload: AddGradeIn,
    user: dict = require_role("teacher", "admin", "manager")
):
    """Р”РѕР±Р°РІРёС‚СЊ РѕС†РµРЅРєСѓ РёР»Рё РѕС‚РјРµС‚РєСѓ РѕС‚СЃСѓС‚СЃС‚РІРёСЏ СѓС‡РµРЅРёРєСѓ Р·Р° СѓСЂРѕРє"""
    sb = get_supabase()
    
    # РџСЂРѕРІРµСЂРєР° РѕС†РµРЅРєРё (2-5)
    if payload.grade is not None and (payload.grade < 2 or payload.grade > 5):
        raise HTTPException(status_code=400, detail="Grade must be between 2 and 5")
    
    # РџСЂРѕРІРµСЂРєР° С‚РёРїР° РїРѕСЃРµС‰Р°РµРјРѕСЃС‚Рё
    valid_attendance_types = ["present", "absent", "duty", "excused", "sick", None]
    if payload.attendance_type not in valid_attendance_types:
        raise HTTPException(status_code=400, detail=f"Invalid attendance_type. Must be one of: {valid_attendance_types}")
    
    # РџСЂРѕРІРµСЂСЏРµРј СѓСЂРѕРє
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,class_ids,teacher_id,subject_id")
        .eq("id", payload.timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    # Support both class_ids array (multi-group) and legacy class_id
    entry_class_ids = entry_data.get("class_ids") or []
    if class_id not in entry_class_ids and entry_data.get("class_id") != class_id:
        raise HTTPException(status_code=400, detail="Lesson does not belong to this class")
    
    # РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРї РґР»СЏ СѓС‡РёС‚РµР»СЏ
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Access denied")
    
    # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ СЃС‚СѓРґРµРЅС‚ РІ СЌС‚РѕРј РєР»Р°СЃСЃРµ
    resolved_student_id = _resolve_legacy_student_id_for_class(sb, class_id, payload.student_id)
    if not resolved_student_id:
        raise HTTPException(status_code=404, detail="Student not in this class")
    
    from datetime import date
    d = date.fromisoformat(payload.lesson_date)
    
    # РћРїСЂРµРґРµР»СЏРµРј present РЅР° РѕСЃРЅРѕРІРµ attendance_type
    is_present = payload.present
    if payload.attendance_type:
        # duty СЃС‡РёС‚Р°РµС‚СЃСЏ РїСЂРёСЃСѓС‚СЃС‚РІРёРµРј (РґРµР¶СѓСЂСЃС‚РІРѕ РїРѕ РґСЂСѓРіРёРј РґРµР»Р°Рј)
        is_present = payload.attendance_type in ["present", "duty"]
    
    # РџРѕРґРіРѕС‚Р°РІР»РёРІР°РµРј РґР°РЅРЅС‹Рµ
    record_data = {
        "timetable_entry_id": payload.timetable_entry_id,
        "lesson_date": d.isoformat(),
        "student_id": resolved_student_id,
        "grade": payload.grade,
        "present": is_present,
        "comment": payload.comment,
        "attendance_type": payload.attendance_type,
        "created_by": user["id"],
        "updated_at": datetime.utcnow().isoformat()
    }
    
    # РСЃРїРѕР»СЊР·СѓРµРј upsert РґР»СЏ РґРѕР±Р°РІР»РµРЅРёСЏ РёР»Рё РѕР±РЅРѕРІР»РµРЅРёСЏ Р·Р°РїРёСЃРё
    sb.table("lesson_journal").upsert(
        record_data,
        on_conflict="timetable_entry_id,lesson_date,student_id"
    ).execute()
    
    return {"ok": True}


@router.delete("/grades/{grade_id}")
def delete_grade(grade_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """РЈРґР°Р»РёС‚СЊ РѕС†РµРЅРєСѓ"""
    sb = get_supabase()
    
    # РџРѕР»СѓС‡Р°РµРј РѕС†РµРЅРєСѓ РґР»СЏ РїСЂРѕРІРµСЂРєРё РґРѕСЃС‚СѓРїР°
    grade = (
        sb.table("subject_grades")
        .select("class_id,subject,created_by")
        .eq("id", grade_id)
        .limit(1)
        .execute()
        .data
    )
    
    if not grade:
        raise HTTPException(status_code=404, detail="Grade not found")
    
    grade_data = grade[0]
    
    # РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРї
    if user["role"] == "teacher":
        # РЈС‡РёС‚РµР»СЊ РјРѕР¶РµС‚ СѓРґР°Р»РёС‚СЊ С‚РѕР»СЊРєРѕ СЃРІРѕРё РѕС†РµРЅРєРё РїРѕ СЃРІРѕРёРј РїСЂРµРґРјРµС‚Р°Рј
        timetable = (
            sb.table("timetable_entries")
            .select("id")
            .cs("class_ids", [grade_data.get("class_id")])
            .eq("teacher_id", user["id"])
            .eq("subject", grade_data.get("subject"))
            .limit(1)
            .execute()
            .data
        )
        if not timetable or grade_data.get("created_by") != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    
    sb.table("subject_grades").delete().eq("id", grade_id).execute()
    
    return {"ok": True}


@router.get("/classes/{class_id}/export")
def export_journal(class_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """Р­РєСЃРїРѕСЂС‚ Р¶СѓСЂРЅР°Р»Р° РІ Excel"""
    try:
        import openpyxl
        from openpyxl.utils import get_column_letter
        from openpyxl.styles import Font, PatternFill, Alignment
        from io import BytesIO
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")
    
    sb = get_supabase()
    
    # РџРѕР»СѓС‡Р°РµРј РґР°РЅРЅС‹Рµ Р¶СѓСЂРЅР°Р»Р°
    journal = get_class_journal(class_id=class_id, user=user)
    students = journal["students"]
    lessons = journal["lessons"]
    grades_data = journal["grades"]
    
    # РџРѕР»СѓС‡Р°РµРј РЅР°Р·РІР°РЅРёРµ РєР»Р°СЃСЃР°
    cls = sb.table("classes").select("name").eq("id", class_id).limit(1).execute().data
    class_name = cls[0].get("name") if cls else "Class"
    
    # РЎРѕР·РґР°РµРј Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    if ws is None:
        raise HTTPException(status_code=500, detail="Failed to create worksheet")
    ws.title = "Journal"
    
    # Р—Р°РіРѕР»РѕРІРєРё
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    
    ws.cell(1, 1, "РЈС‡РµРЅРёРє").fill = header_fill
    ws.cell(1, 1).font = header_font
    
    # Р”Р°С‚С‹ СѓСЂРѕРєРѕРІ
    for col_idx, lesson in enumerate(lessons, start=2):
        cell = ws.cell(1, col_idx, f"{lesson['date']}\n{lesson['subject_name']}")
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    
    # РЎСЂРµРґРЅРёР№ Р±Р°Р»Р»
    avg_col = len(lessons) + 2
    cell = ws.cell(1, avg_col, "РЎСЂРµРґРЅРёР№ Р±Р°Р»Р»")
    cell.fill = PatternFill(start_color="FFC000", end_color="FFC000", fill_type="solid")
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")
    
    # Р”Р°РЅРЅС‹Рµ
    for row_idx, student in enumerate(students, start=2):
        ws.cell(row_idx, 1, student["name"])
        
        sid = student["id"]
        all_grades = []
        
        for col_idx, lesson in enumerate(lessons, start=2):
            key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
            cell_data = grades_data.get(sid, {}).get(key, {})
            student_grades = cell_data.get("grades", []) if isinstance(cell_data, dict) else []
            if student_grades:
                # Р‘РµСЂРµРј РІСЃРµ РѕС†РµРЅРєРё
                grade_values = [g["grade"] for g in student_grades]
                # РџРѕРєР°Р·С‹РІР°РµРј РІСЃРµ РѕС†РµРЅРєРё С‡РµСЂРµР· Р·Р°РїСЏС‚СѓСЋ
                cell = ws.cell(row_idx, col_idx, ", ".join(map(str, grade_values)))
                all_grades.extend(grade_values)
        
        # РЎСЂРµРґРЅРёР№ Р±Р°Р»Р»
        if all_grades:
            avg = sum(all_grades) / len(all_grades)
            ws.cell(row_idx, avg_col, round(avg, 2))
    
    # РЁРёСЂРёРЅР° РєРѕР»РѕРЅРѕРє
    ws.column_dimensions["A"].width = 30
    for col_idx in range(2, len(lessons) + 3):
        ws.column_dimensions[get_column_letter(col_idx)].width = 15
    
    # РЎРѕС…СЂР°РЅСЏРµРј
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"{class_name}_zhurnal.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


class UpdateLessonInfoIn(BaseModel):
    timetable_entry_id: str
    lesson_date: str  # YYYY-MM-DD
    lesson_topic: str | None = None
    homework: str | None = None
    subject_topic_id: str | None = None


@router.post("/classes/{class_id}/lesson-info")
def update_lesson_info(
    class_id: str,
    payload: UpdateLessonInfoIn,
    user: dict = require_role("teacher", "admin", "manager")
):
    """РћР±РЅРѕРІРёС‚СЊ С‚РµРјСѓ СѓСЂРѕРєР° Рё РґРѕРјР°С€РЅРµРµ Р·Р°РґР°РЅРёРµ"""
    sb = get_supabase()
    
    # РџСЂРѕРІРµСЂСЏРµРј СѓСЂРѕРє
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,class_ids,teacher_id,subject_id")
        .eq("id", payload.timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    # Verify lesson belongs to this class (class_ids array or legacy class_id)
    entry_class_ids = entry_data.get("class_ids") or []
    if class_id not in entry_class_ids and entry_data.get("class_id") != class_id:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    
    
    # РџСЂРѕРІРµСЂСЏРµРј РїСЂР°РІР°
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Not your lesson")
    
    # РџСЂРѕРІРµСЂСЏРµРј РµСЃС‚СЊ Р»Рё СѓР¶Рµ Р·Р°РїРёСЃРё РґР»СЏ СЌС‚РѕРіРѕ СѓСЂРѕРєР°/РґР°С‚С‹
    existing = (
        sb.table("lesson_journal")
        .select("*")
        .eq("timetable_entry_id", payload.timetable_entry_id)
        .eq("lesson_date", payload.lesson_date)
        .execute()
        .data or []
    )
    
    update_data = {}
    if "lesson_topic" in payload.model_fields_set:
        update_data["lesson_topic"] = payload.lesson_topic
    if "homework" in payload.model_fields_set:
        update_data["homework"] = payload.homework
    if "subject_topic_id" in payload.model_fields_set:
        update_data["subject_topic_id"] = payload.subject_topic_id
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    if existing:
        # РћР±РЅРѕРІР»СЏРµРј РІСЃРµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ Р·Р°РїРёСЃРё РґР»СЏ СЌС‚РѕРіРѕ СѓСЂРѕРєР°
        sb.table("lesson_journal").update(update_data).eq("timetable_entry_id", payload.timetable_entry_id).eq("lesson_date", payload.lesson_date).execute()
    else:
        # If there are no rows yet, create rows for all class enrollments.
        # Provision missing legacy_student_id to keep lesson_journal consistent.
        enrollments_resp = (
            sb.table("class_enrollments")
            .select("id,legacy_student_id,student_full_name,student_number")
            .eq("class_id", class_id)
            .execute()
        )
        enrollments = enrollments_resp.data or []
        
        if enrollments:
            insert_records = []
            for enr in enrollments:
                student_id = enr.get("legacy_student_id")
                if not student_id:
                    student_id = _ensure_legacy_student_id_for_enrollment(sb, class_id, enr)
                if not student_id:
                    continue
                insert_records.append(
                    {
                        "timetable_entry_id": payload.timetable_entry_id,
                        "lesson_date": payload.lesson_date,
                        "student_id": student_id,
                        "created_by": user["id"],
                        **update_data,
                    }
                )
            if insert_records:
                sb.table("lesson_journal").insert(insert_records).execute()
    
    return {"success": True, "message": "Lesson info updated"}


@router.get("/classes/{class_id}/lesson-info")
def get_lesson_info(
    class_id: str,
    timetable_entry_id: str,
    lesson_date: str,
    user: dict = Depends(get_current_user),
):
    """РџРѕР»СѓС‡РёС‚СЊ С‚РµРјСѓ СѓСЂРѕРєР° Рё РґРѕРјР°С€РЅРµРµ Р·Р°РґР°РЅРёРµ РґР»СЏ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ СѓСЂРѕРєР°"""
    sb = get_supabase()
    
    # РџСЂРѕРІРµСЂСЏРµРј СѓСЂРѕРє
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,class_ids,subject,teacher_id,subject_id,subjects(name)")
        .eq("id", timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    # Verify lesson belongs to this class (class_ids array or legacy class_id)
    entry_class_ids = entry_data.get("class_ids") or []
    if class_id not in entry_class_ids and entry_data.get("class_id") != class_id:
        raise HTTPException(status_code=404, detail="Lesson not found")
    subject_name = entry_data.get("subjects", {}).get("name") if entry_data.get("subjects") else entry_data.get("subject")
    
    # РџСЂРѕРІРµСЂСЏРµРј РґРѕСЃС‚СѓРї
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Not your lesson")
    
    if user["role"] == "student":
        # РЎС‚СѓРґРµРЅС‚ РјРѕР¶РµС‚ РІРёРґРµС‚СЊ С‚РѕР»СЊРєРѕ РµСЃР»Рё РѕРЅ РІ СЌС‚РѕРј РєР»Р°СЃСЃРµ
        enrollment = (
            sb.table("class_enrollments")
            .select("id")
            .eq("class_id", class_id)
            .eq("student_id", user["id"])
            .limit(1)
            .execute()
            .data
        )
        if not enrollment:
            raise HTTPException(status_code=403, detail="Not in this class")
    
    # РџРѕР»СѓС‡Р°РµРј С‚РµРјСѓ Рё Р”Р—
    records = (
        sb.table("lesson_journal")
        .select("lesson_topic,homework,subject_topic_id")
        .eq("timetable_entry_id", timetable_entry_id)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # Р‘РµСЂРµРј РїРµСЂРІСѓСЋ Р·Р°РїРёСЃСЊ СЃ РЅРµРїСѓСЃС‚С‹РјРё РїРѕР»СЏРјРё
    lesson_topic = None
    homework = None
    subject_topic_id = None
    
    for record in records:
        if record.get("lesson_topic") and not lesson_topic:
            lesson_topic = record["lesson_topic"]
        if record.get("homework") and not homework:
            homework = record["homework"]
        if record.get("subject_topic_id") and not subject_topic_id:
            subject_topic_id = record["subject_topic_id"]
    
    return {
        "lesson_topic": lesson_topic,
        "homework": homework,
        "subject_topic_id": subject_topic_id,
        "subject": entry_data.get("subject"),
        "subject_name": subject_name,
        "lesson_date": lesson_date
    }


@router.get("/student/homework")
def get_student_homework(user: dict = require_role("student")):
    """РџРѕР»СѓС‡РёС‚СЊ РІСЃРµ РґРѕРјР°С€РЅРёРµ Р·Р°РґР°РЅРёСЏ РґР»СЏ СЃС‚СѓРґРµРЅС‚Р°"""
    sb = get_supabase()
    
    # РџРѕР»СѓС‡Р°РµРј РєР»Р°СЃСЃС‹ СЃС‚СѓРґРµРЅС‚Р°
    enrollments = (
        sb.table("class_enrollments")
        .select("class_id")
        .eq("student_id", user["id"])
        .execute()
        .data
        or []
    )
    
    class_ids = [e.get("class_id") for e in enrollments if e.get("class_id")]
    if not class_ids:
        return {"homework": []}
    
    # РџРѕР»СѓС‡Р°РµРј СЂР°СЃРїРёСЃР°РЅРёРµ СЌС‚РёС… РєР»Р°СЃСЃРѕРІ
    timetable = (
        sb.table("timetable_entries")
        .select("id,class_id,subject,weekday,start_time,subject_id,classes(name),subjects(name)")
        .in_("class_id", class_ids)
        .execute()
        .data
        or []
    )
    
    timetable_ids = [e.get("id") for e in timetable]
    if not timetable_ids:
        return {"homework": []}
    
    # РџРѕР»СѓС‡Р°РµРј РІСЃРµ Р”Р— Р·Р° РїРѕСЃР»РµРґРЅРёРµ 30 РґРЅРµР№
    from datetime import date, timedelta
    date_from = (date.today() - timedelta(days=30)).isoformat()
    
    homework_records = (
        sb.table("lesson_journal")
        .select("timetable_entry_id,lesson_date,homework,lesson_topic")
        .in_("timetable_entry_id", timetable_ids)
        .gte("lesson_date", date_from)
        .not_.is_("homework", "null")
        .order("lesson_date", desc=True)
        .execute()
        .data
        or []
    )
    
    # Р“СЂСѓРїРїРёСЂСѓРµРј Рё С„РѕСЂРјР°С‚РёСЂСѓРµРј
    result = []
    for record in homework_records:
        entry_id = record.get("timetable_entry_id")
        entry = next((e for e in timetable if e.get("id") == entry_id), None)
        if not entry:
            continue
        
        class_name = entry.get("classes", {}).get("name", "Unknown") if entry.get("classes") else "Unknown"
        subject_name = entry.get("subjects", {}).get("name") if entry.get("subjects") else entry.get("subject", "Unknown")
        
        result.append({
            "lesson_date": record.get("lesson_date"),
            "subject": entry.get("subject", "Unknown"),
            "subject_name": subject_name,
            "class_name": class_name,
            "lesson_topic": record.get("lesson_topic"),
            "homework": record.get("homework"),
            "timetable_entry_id": entry_id
        })
    
    return {"homework": result}

