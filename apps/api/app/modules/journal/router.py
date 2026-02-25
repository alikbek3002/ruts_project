from __future__ import annotations

from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user, require_role
from app.core.monitor import timed
from app.db.supabase_client import get_supabase
from app.core.monitor import timed

router = APIRouter()


def _timetable_entries_for_teacher(sb, teacher_id: str, select_fields: str, weekday: int | None = None) -> list[dict]:
    q1 = sb.table("timetable_entries").select(select_fields).eq("active", True).eq("teacher_id", teacher_id)
    if weekday is not None:
        q1 = q1.eq("weekday", weekday)
    return q1.execute().data or []


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
    present: bool = True  # False = отсутствие
    comment: str | None = None
    attendance_type: str | None = None  # present, absent, duty (Кезмет), excused (Арыз), sick (Оруу)


@router.get("/teacher/classes")
@timed("get_teacher_classes")
def get_teacher_classes(user: dict = require_role("teacher", "admin", "manager")):
    """Получить все классы (для выбора журнала)"""
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
    """Получить предметы для этого класса - из циклов учителя + из расписания"""
    sb = get_supabase()
    
    subjects_map = {}
    
    # 1. Для учителя - получаем предметы из его циклов
    if user.get("role") == "teacher":
        # Получаем циклы учителя
        teacher_cycles_data = (
            sb.table("teacher_cycles")
            .select("cycle_id")
            .eq("teacher_id", user["id"])
            .execute()
            .data or []
        )
        cycle_ids = [tc.get("cycle_id") for tc in teacher_cycles_data if tc.get("cycle_id")]
        
        if cycle_ids:
            # Получаем предметы из этих циклов
            cycle_subjects = (
                sb.table("subjects")
                .select("id,name,cycle_id")
                .in_("cycle_id", cycle_ids)
                .is_("archived_at", "null")
                .order("name")
                .execute()
                .data or []
            )
            
            for s in cycle_subjects:
                key = s.get("id")
                if key and key not in subjects_map:
                    subjects_map[key] = {
                        "id": s.get("id"),
                        "name": s.get("name"),
                        "is_mine": True  # Из цикла учителя = мой
                    }
    
    # 2. Также добавляем предметы из расписания для этого класса
    q = sb.table("timetable_entries").select("subject_id,subject,teacher_id").eq("active", True).cs("class_ids", [class_id])
    rows = q.execute().data or []
    
    for r in rows:
        key = r.get("subject_id")
        if not key:
            continue
        
        if key not in subjects_map:
            # Получаем название предмета из таблицы subjects
            subj = sb.table("subjects").select("id,name").eq("id", key).limit(1).execute().data
            name = subj[0].get("name") if subj else r.get("subject")
            
            subjects_map[key] = {
                "id": key,
                "name": name,
                "is_mine": r.get("teacher_id") == user["id"]
            }
        else:
            # Если это мой урок в расписании - помечаем как мой
            if r.get("teacher_id") == user["id"]:
                subjects_map[key]["is_mine"] = True
    
    # Для админа/менеджера - показываем ВСЕ предметы если из циклов ничего нет
    if user.get("role") in ("admin", "manager") and not subjects_map:
        all_subjects = (
            sb.table("subjects")
            .select("id,name")
            .is_("archived_at", "null")
            .order("name")
            .execute()
            .data or []
        )
        for s in all_subjects:
            subjects_map[s["id"]] = {
                "id": s["id"],
                "name": s["name"],
                "is_mine": False
            }
    
    sorted_subjects = sorted(subjects_map.values(), key=lambda x: (not x.get("is_mine", False), x["name"] or ""))
    
    return {"subjects": sorted_subjects}


@router.get("/teacher/schedule")
@timed("get_teacher_schedule")
def get_teacher_schedule(
    date_from: str,
    date_to: str,
    user: dict = require_role("teacher")
):
    """Получить расписание учителя на диапазон дат с уроками"""
    sb = get_supabase()
    
    # Получаем все уроки учителя из расписания.
    timetable = _timetable_entries_for_teacher(
        sb,
        user["id"],
        "id,class_id,subject,weekday,start_time,end_time,room,subject_id,classes(name),subjects(name)",
    )
    
    if not timetable:
        return {"lessons": []}
    
    # Генерируем даты в диапазоне
    start_date = date.fromisoformat(date_from)
    end_date = date.fromisoformat(date_to)
    
    lessons = []
    current_date = start_date
    
    while current_date <= end_date:
        weekday = current_date.isoweekday()  # 1=Mon, 7=Sun
        
        # Находим уроки на этот день недели
        day_lessons = [e for e in timetable if e.get("weekday") == weekday]
        
        for entry in day_lessons:
            subject_name = entry.get("subjects", {}).get("name") if entry.get("subjects") else entry.get("subject")
            class_name = entry.get("classes", {}).get("name") if entry.get("classes") else ""
            
            lessons.append({
                "timetable_entry_id": entry.get("id"),
                "date": current_date.isoformat(),
                "weekday": weekday,
                "start_time": entry.get("start_time"),
                "end_time": entry.get("end_time"),
                "subject": entry.get("subject"),
                "subject_name": subject_name,
                "class_id": entry.get("class_id"),
                "class_name": class_name,
                "room": entry.get("room")
            })
        
        current_date += timedelta(days=1)
    
    # Сортируем по дате и времени
    lessons.sort(key=lambda x: (x["date"], x["start_time"] or ""))
    
    return {"lessons": lessons}


@router.get("/teacher/lessons/{lesson_date}")
@timed("get_teacher_lessons_for_date")
def get_teacher_lessons_for_date(
    lesson_date: str,
    user: dict = require_role("teacher")
):
    """Получить все уроки учителя на конкретную дату"""
    sb = get_supabase()
    
    # Определяем день недели
    lesson_date_obj = date.fromisoformat(lesson_date)
    weekday = lesson_date_obj.isoweekday()
    
    # Получаем расписание на этот день.
    timetable = _timetable_entries_for_teacher(
        sb,
        user["id"],
        "id,class_id,subject,weekday,start_time,end_time,room,subject_id,classes(name),subjects(name)",
        weekday=weekday,
    )
    timetable.sort(key=lambda x: (x.get("start_time") or ""))
    
    if not timetable:
        return {"lessons": []}

    # Оптимизация: получаем все записи журнала одним запросом
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
    
    # Создаем множество ID уроков, для которых есть записи в журнале
    entries_with_journal = {e["timetable_entry_id"] for e in journal_entries}
    
    lessons = []
    for entry in timetable:
        subject_name = entry.get("subjects", {}).get("name") if entry.get("subjects") else entry.get("subject")
        class_name = entry.get("classes", {}).get("name") if entry.get("classes") else ""
        
        lessons.append({
            "timetable_entry_id": entry.get("id"),
            "date": lesson_date,
            "start_time": entry.get("start_time"),
            "end_time": entry.get("end_time"),
            "subject": entry.get("subject"),
            "subject_name": subject_name,
            "class_id": entry.get("class_id"),
            "class_name": class_name,
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
    """Массовая отметка посещаемости"""
    sb = get_supabase()
    
    # Проверяем урок
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
             pass # Allowed
        else:
             raise HTTPException(status_code=403, detail="Access denied")
    
    # Создаем/обновляем записи для всех студентов
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
    """Получить детальную информацию об уроке со списком студентов и их оценками"""
    sb = get_supabase()
    
    # Получаем информацию об уроке
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,subject,teacher_id,start_time,end_time,room,subject_id,classes(name),subjects(name)")
        .eq("id", timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    
    # Проверяем доступ для учителя
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
         # Allow viewing even if not my lesson?
         # "Make it like school journal". School journal is open.
         pass 

    class_id = entry_data.get("class_id")
    subject_name = entry_data.get("subjects", {}).get("name") if entry_data.get("subjects") else entry_data.get("subject")
    class_name = entry_data.get("classes", {}).get("name") if entry_data.get("classes") else ""
    
    # Получаем студентов класса с их номерами
    enrollments = (
        sb.table("class_enrollments")
        .select("legacy_student_id,student_number")
        .eq("class_id", class_id)
        .execute()
        .data
        or []
    )
    
    student_ids = [e.get("legacy_student_id") for e in enrollments if e.get("legacy_student_id")]
    student_numbers = {e.get("legacy_student_id"): e.get("student_number") for e in enrollments}
    
    if not student_ids:
        return {
            "lesson": {
                "timetable_entry_id": timetable_entry_id,
                "date": lesson_date,
                "subject": entry_data.get("subject"),
                "subject_name": subject_name,
                "class_name": class_name,
                "start_time": entry_data.get("start_time"),
                "end_time": entry_data.get("end_time"),
                "room": entry_data.get("room"),
                "lesson_topic": None,
                "homework": None,
                "subject_topic_id": None
            },
            "students": []
        }
    
    # Получаем информацию о студентах
    students_resp = (
        sb.table("users")
        .select("id,username,full_name")
        .in_("id", student_ids)
        .execute()
        .data
        or []
    )
    
    # Получаем записи из журнала для этого урока
    journal_records = (
        sb.table("lesson_journal")
        .select("student_id,grade,present,comment,lesson_topic,homework,attendance_type,subject_topic_id")
        .eq("timetable_entry_id", timetable_entry_id)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # Индексируем записи по student_id
    journal_by_student = {r.get("student_id"): r for r in journal_records}
    
    # Собираем тему и ДЗ (берем первое непустое значение)
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
    
    # Формируем список студентов
    students = []
    for s in students_resp:
        sid = s.get("id")
        journal = journal_by_student.get(sid, {})
        
        students.append({
            "id": sid,
            "name": s.get("full_name") or s.get("username"),
            "username": s.get("username"),
            "student_number": student_numbers.get(sid),
            "grade": journal.get("grade"),
            "present": journal.get("present"),
            "comment": journal.get("comment"),
            "attendance_type": journal.get("attendance_type")
        })
    
    # Сортируем по номеру студента
    students.sort(key=lambda x: (x["student_number"] is None, x["student_number"] or 0, x["name"] or "", x["username"] or ""))
    
    return {
        "lesson": {
            "timetable_entry_id": timetable_entry_id,
            "date": lesson_date,
            "subject": entry_data.get("subject"),
            "subject_name": subject_name,
            "class_id": class_id,
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
    """Получить журнал класса с оценками по датам уроков"""
    sb = get_supabase()
    
    # Получаем расписание
    # Используем contains (cs) для class_ids, чтобы найти уроки где этот класс целевой (даже если он не первый в списке)
    query = sb.table("timetable_entries").select("id,subject,weekday,start_time,subject_id,teacher_id,stream_id,created_at,class_ids,lesson_date").eq("active", True)
    query = query.cs("class_ids", [class_id])
    
    # If teacher, we normally filter by teacher_id.
    # BUT user requested "School Journal" view (all groups).
    # If they selected a subject_id, show lessons for that subject regardless of teacher?
    # This matches "School Journal" metaphor.
    
    if user["role"] == "teacher":
        if subject_id:
             # If subject selected, show all lessons for that subject, don't filter by teacher_id
             # This allows seeing lessons where maybe teacher wasn't assigned properly
             pass
        else:
             # Если предмет не выбран, показываем только уроки учителя для этого класса
             query = query.eq("teacher_id", user["id"])
        
    timetable = query.execute().data or []

    # Filter in memory to handle cases where subject_id is missing in timetable but name matches
    if subject_id:
        # 1. Get the target subject name
        subj_data = sb.table("subjects").select("name").eq("id", subject_id).limit(1).execute().data
        target_name = subj_data[0]["name"] if subj_data else ""
        
        # 2. Filter entries: match ID OR match Name
        filtered = []
        for t in timetable:
            # Match by ID
            if t.get("subject_id") == subject_id:
                filtered.append(t)
                continue
            # Match by Name (loose match)
            if target_name and t.get("subject") == target_name:
                filtered.append(t)
                continue
        
        timetable = filtered
    
    if not timetable:
         # Просто вернем пустоту
        return {"students": [], "lessons": [], "grades": {}}
    
    # Получаем даты потоков для проверки (чтобы не показывать уроки вне дат потока)
    stream_ids = {t.get("stream_id") for t in timetable if t.get("stream_id")}
    streams_map = {}
    if stream_ids:
        s_data = sb.table("streams").select("id,start_date,end_date").in_("id", list(stream_ids)).execute().data or []
        for s in s_data:
            streams_map[s["id"]] = {
                "start": date.fromisoformat(s["start_date"]) if s.get("start_date") else None,
                "end": date.fromisoformat(s["end_date"]) if s.get("end_date") else None
            }

    # Получаем всех учеников класса
    enrollments = (
        sb.table("class_enrollments")
        .select("legacy_student_id")
        .eq("class_id", class_id)
        .execute()
        .data
        or []
    )
    student_ids = [e.get("legacy_student_id") for e in enrollments if e.get("legacy_student_id")]
    
    if not student_ids:
        return {"students": [], "lessons": [], "grades": {}}
    
    students = (
        sb.table("users")
        .select("id,username,full_name")
        .in_("id", student_ids)
        .order("full_name")
        .execute()
        .data
        or []
    )
    
    # Получаем записи из lesson_journal для этих уроков
    entry_ids = [e.get("id") for e in timetable if e.get("id")]
    
    journal_records = (
        sb.table("lesson_journal")
        .select("timetable_entry_id,lesson_date,student_id,grade,present,comment,lesson_topic,homework,attendance_type,subject_topic_id")
        .in_("timetable_entry_id", entry_ids)
        .order("lesson_date", desc=False)
        .execute()
        .data
        or []
    )
    
    # Группируем уроки по датам и собираем темы/ДЗ
    lessons_by_date = {}
    
    # Генерируем сетку уроков - только до сегодняшнего дня (включительно)
    today = date.today()
    
    # Используем даты потоков для определения начала журнала
    # Берем самую раннюю дату start из потоков, привязанных к этим урокам
    start_date = None
    if streams_map:
        stream_starts = [s["start"] for s in streams_map.values() if s.get("start")]
        if stream_starts:
            start_date = min(stream_starts)
    
    # Fallback: если потоков нет, используем самую раннюю дату создания записей расписания
    if not start_date:
        for t in timetable:
            created_at_str = t.get("created_at")
            if created_at_str:
                try:
                    c_date = datetime.fromisoformat(created_at_str.replace("Z", "+00:00")).date()
                    if start_date is None or c_date < start_date:
                        start_date = c_date
                except Exception:
                    pass
    
    # Последний fallback: учебный год
    if not start_date:
        if today.month >= 9:
            start_date = date(today.year, 9, 1)
        else:
            start_date = date(today.year - 1, 9, 1)
    
    # Показываем уроки только до сегодняшнего дня (не весь учебный год)
    end_date = today
        
    current = start_date
    while current <= end_date:
        wd = current.isoweekday()
        d_str = current.isoformat()
        
        # Filter entries for this day
        day_entries = []
        for e in timetable:
            # If entry has specific date, it MUST match current date
            if e.get("lesson_date"):
                if e["lesson_date"] == d_str:
                    day_entries.append(e)
            else:
                # If recurring, it must match weekday AND not conflict with specific logic?
                # Simpler: just match weekday.
                if e.get("weekday") == wd:
                    day_entries.append(e)

        for entry in day_entries:
            # 1. Проверяем даты потока (если урок привязан к потоку)
            s_id = entry.get("stream_id")
            if s_id and s_id in streams_map:
                s_dates = streams_map[s_id]
                if s_dates["start"] and current < s_dates["start"]:
                    continue
                if s_dates["end"] and current > s_dates["end"]:
                    continue
            
            # 2. Проверяем дату создания урока (чтобы не бакфиллить уроки созданные сегодня на сентябрь)
            created_at_str = entry.get("created_at")
            if created_at_str:
                try:
                    c_date = datetime.fromisoformat(created_at_str.replace("Z", "+00:00")).date()
                    if current < c_date:
                         continue
                except Exception:
                    pass

            key = f"{d_str}_{entry['id']}"
            lessons_by_date[key] = {
                "date": d_str,
                "timetable_entry_id": entry['id'],
                "subject_name": entry.get("subject", ""),
                "lesson_topic": None,
                "homework": None
            }
        current += timedelta(days=1)
    
    lesson_info = {}  # Храним тему и ДЗ для каждого урока
    
    for record in journal_records:
        entry_id = record.get("timetable_entry_id")
        d_str = record.get("lesson_date")
        
        # Находим информацию о уроке
        entry = next((e for e in timetable if e.get("id") == entry_id), None)
        if not entry:
            continue
        
        key = f"{d_str}_{entry_id}"
        if key not in lessons_by_date:
            lessons_by_date[key] = {
                "date": d_str,
                "timetable_entry_id": entry_id,
                "subject_name": entry.get("subject", ""),
                "lesson_topic": None,
                "homework": None,
                "subject_topic_id": None
            }
        
        # Собираем тему урока и ДЗ (берем первое непустое значение)
        if key not in lesson_info:
            lesson_info[key] = {"lesson_topic": None, "homework": None, "subject_topic_id": None}
        
        if record.get("lesson_topic") and not lesson_info[key]["lesson_topic"]:
            lesson_info[key]["lesson_topic"] = record["lesson_topic"]
        if record.get("homework") and not lesson_info[key]["homework"]:
            lesson_info[key]["homework"] = record["homework"]
        if record.get("subject_topic_id") and not lesson_info[key]["subject_topic_id"]:
            lesson_info[key]["subject_topic_id"] = record["subject_topic_id"]
    
    # Сортируем уроки по дате и добавляем тему/ДЗ
    lessons = sorted(lessons_by_date.values(), key=lambda x: x["date"])
    for lesson in lessons:
        key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
        info = lesson_info.get(key, {})
        if info.get("lesson_topic"):
            lesson["lesson_topic"] = info.get("lesson_topic")
        if info.get("homework"):
            lesson["homework"] = info.get("homework")
        if info.get("subject_topic_id"):
            lesson["subject_topic_id"] = info.get("subject_topic_id")
    
    # Структура: grades[student_id][lesson_key] = {grades: [...], present: bool|null}
    grades = {}
    for student in students:
        sid = student.get("id")
        grades[sid] = {}
        for lesson in lessons:
            key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
            
            # Находим все записи для этого ученика/урока
            student_records = [
                r for r in journal_records
                if r.get("student_id") == sid 
                and r.get("timetable_entry_id") == lesson["timetable_entry_id"]
                and r.get("lesson_date") == lesson["date"]
            ]
            
            lesson_grades = [
                {
                    "grade": r.get("grade"),
                    "comment": r.get("comment")
                }
                for r in student_records
                if r.get("grade") is not None
            ]
            
            # Определяем статус присутствия
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
    
    # Форматируем студентов
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
    """Добавить оценку или отметку отсутствия ученику за урок"""
    sb = get_supabase()
    
    # Проверка оценки (2-5)
    if payload.grade is not None and (payload.grade < 2 or payload.grade > 5):
        raise HTTPException(status_code=400, detail="Grade must be between 2 and 5")
    
    # Проверка типа посещаемости
    valid_attendance_types = ["present", "absent", "duty", "excused", "sick", None]
    if payload.attendance_type not in valid_attendance_types:
        raise HTTPException(status_code=400, detail=f"Invalid attendance_type. Must be one of: {valid_attendance_types}")
    
    # Проверяем урок
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
    
    # Проверяем доступ для учителя
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Проверяем, что студент в этом классе
    enrollment = (
        sb.table("class_enrollments")
        .select("legacy_student_id")
        .eq("class_id", class_id)
        .eq("legacy_student_id", payload.student_id)
        .limit(1)
        .execute()
        .data
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Student not in this class")
    
    from datetime import date
    d = date.fromisoformat(payload.lesson_date)
    
    # Определяем present на основе attendance_type
    is_present = payload.present
    if payload.attendance_type:
        # duty считается присутствием (дежурство по другим делам)
        is_present = payload.attendance_type in ["present", "duty"]
    
    # Подготавливаем данные
    record_data = {
        "timetable_entry_id": payload.timetable_entry_id,
        "lesson_date": d.isoformat(),
        "student_id": payload.student_id,
        "grade": payload.grade,
        "present": is_present,
        "comment": payload.comment,
        "attendance_type": payload.attendance_type,
        "created_by": user["id"],
        "updated_at": datetime.utcnow().isoformat()
    }
    
    # Используем upsert для добавления или обновления записи
    sb.table("lesson_journal").upsert(
        record_data,
        on_conflict="timetable_entry_id,lesson_date,student_id"
    ).execute()
    
    return {"ok": True}


@router.delete("/grades/{grade_id}")
def delete_grade(grade_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """Удалить оценку"""
    sb = get_supabase()
    
    # Получаем оценку для проверки доступа
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
    
    # Проверяем доступ
    if user["role"] == "teacher":
        # Учитель может удалить только свои оценки по своим предметам
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
    """Экспорт журнала в Excel"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
        from io import BytesIO
        from fastapi.responses import StreamingResponse
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")
    
    sb = get_supabase()
    
    # Получаем данные журнала
    journal = get_class_journal(class_id, user)
    students = journal["students"]
    lessons = journal["lessons"]
    grades_data = journal["grades"]
    
    # Получаем название класса
    cls = sb.table("classes").select("name").eq("id", class_id).limit(1).execute().data
    class_name = cls[0].get("name") if cls else "Class"
    
    # Создаем Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Журнал"
    
    # Заголовки
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    
    ws.cell(1, 1, "Ученик").fill = header_fill
    ws.cell(1, 1).font = header_font
    
    # Даты уроков
    for col_idx, lesson in enumerate(lessons, start=2):
        cell = ws.cell(1, col_idx, f"{lesson['date']}\n{lesson['subject_name']}")
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    
    # Средний балл
    avg_col = len(lessons) + 2
    cell = ws.cell(1, avg_col, "Средний балл")
    cell.fill = PatternFill(start_color="FFC000", end_color="FFC000", fill_type="solid")
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")
    
    # Данные
    for row_idx, student in enumerate(students, start=2):
        ws.cell(row_idx, 1, student["name"])
        
        sid = student["id"]
        all_grades = []
        
        for col_idx, lesson in enumerate(lessons, start=2):
            key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
            student_grades = grades_data.get(sid, {}).get(key, [])
            if student_grades:
                # Берем все оценки
                grade_values = [g["grade"] for g in student_grades]
                # Показываем все оценки через запятую
                cell = ws.cell(row_idx, col_idx, ", ".join(map(str, grade_values)))
                all_grades.extend(grade_values)
        
        # Средний балл
        if all_grades:
            avg = sum(all_grades) / len(all_grades)
            ws.cell(row_idx, avg_col, round(avg, 2))
    
    # Ширина колонок
    ws.column_dimensions["A"].width = 30
    for col_idx in range(2, len(lessons) + 3):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = 15
    
    # Сохраняем
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
    """Обновить тему урока и домашнее задание"""
    sb = get_supabase()
    
    # Проверяем урок
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
    
    
    
    # Проверяем права
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Not your lesson")
    
    # Проверяем есть ли уже записи для этого урока/даты
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
        # Обновляем все существующие записи для этого урока
        sb.table("lesson_journal").update(update_data).eq("timetable_entry_id", payload.timetable_entry_id).eq("lesson_date", payload.lesson_date).execute()
    else:
        # Если нет записей, создаем их для всех студентов класса
        students_resp = (
            sb.table("class_enrollments")
            .select("legacy_student_id")
            .eq("class_id", class_id)
            .execute()
        )
        students = students_resp.data or []
        
        if students:
            insert_records = [
                {
                    "timetable_entry_id": payload.timetable_entry_id,
                    "lesson_date": payload.lesson_date,
                    "student_id": s["legacy_student_id"],
                    "created_by": user["id"],
                    **update_data
                }
                for s in students
                if s.get("legacy_student_id")
            ]
            sb.table("lesson_journal").insert(insert_records).execute()
    
    return {"success": True, "message": "Lesson info updated"}


@router.get("/classes/{class_id}/lesson-info")
def get_lesson_info(
    class_id: str,
    timetable_entry_id: str,
    lesson_date: str,
    user: dict = Depends(get_current_user),
):
    """Получить тему урока и домашнее задание для конкретного урока"""
    sb = get_supabase()
    
    # Проверяем урок
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
    
    # Проверяем доступ
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
        raise HTTPException(status_code=403, detail="Not your lesson")
    
    if user["role"] == "student":
        # Студент может видеть только если он в этом классе
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
    
    # Получаем тему и ДЗ
    records = (
        sb.table("lesson_journal")
        .select("lesson_topic,homework,subject_topic_id")
        .eq("timetable_entry_id", timetable_entry_id)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # Берем первую запись с непустыми полями
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
    """Получить все домашние задания для студента"""
    sb = get_supabase()
    
    # Получаем классы студента
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
    
    # Получаем расписание этих классов
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
    
    # Получаем все ДЗ за последние 30 дней
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
    
    # Группируем и форматируем
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
