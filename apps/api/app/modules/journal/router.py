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
    grade: int | None = None  # None = отсутствие
    present: bool = True  # False = отсутствие
    comment: str | None = None


@router.get("/teacher/classes")
@timed("get_teacher_classes")
def get_teacher_classes(user: dict = require_role("teacher")):
    """Получить все классы учителя"""
    sb = get_supabase()

    # Short cache per teacher
    from app.core.cache import cache
    cache_key = f"teacher_classes:{user['id']}"
    cached = cache.get(cache_key)
    if cached is not None:
        return {"classes": cached}
    
    # Получаем уникальные классы из расписания учителя.
    timetable = _timetable_entries_for_teacher(sb, user["id"], "id,class_id,subject,subject_id")
    
    class_ids = list({e.get("class_id") for e in timetable if e.get("class_id")})
    
    if not class_ids:
        return {"classes": []}
    
    classes = (
        sb.table("classes")
        .select("id,name")
        .in_("id", class_ids)
        .execute()
        .data
        or []
    )
    
    # Для каждого класса получаем предметы, которые ведет учитель
    result = []
    for cls in classes:
        subjects_map = {}
        for e in timetable:
            if e.get("class_id") == cls.get("id") and e.get("subject_id"):
                subjects_map[e.get("subject_id")] = {
                    "id": e.get("subject_id"),
                    "name": e.get("subject")
                }
        
        subjects = sorted(subjects_map.values(), key=lambda x: x["name"])
        
        result.append({
            "id": cls.get("id"),
            "name": cls.get("name"),
            "subjects": subjects
        })
    
    return {"classes": result}


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
    # Учитываем записи с teacher_id=NULL, если предмет закреплён за учителем.
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
    
    entry_data = entry[0]
    
    # Проверяем доступ для учителя
    if user["role"] == "teacher" and not _teacher_can_access_entry(sb, user["id"], entry_data):
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
        raise HTTPException(status_code=403, detail="Access denied")
    
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
                "homework": None
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
        .select("student_id,grade,present,comment,lesson_topic,homework")
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
    for record in journal_records:
        if record.get("lesson_topic") and not lesson_topic:
            lesson_topic = record["lesson_topic"]
        if record.get("homework") and not homework:
            homework = record["homework"]
    
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
            "comment": journal.get("comment")
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
            "homework": homework
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
    
    # Проверяем доступ
    query = sb.table("timetable_entries").select("id,subject,weekday,start_time,subject_id").eq("class_id", class_id)
    
    if user["role"] == "teacher":
        query = query.eq("teacher_id", user["id"])
        
    if subject_id:
        query = query.eq("subject_id", subject_id)
        
    timetable = query.execute().data or []
    
    if not timetable:
        if user["role"] == "teacher":
             # Если учитель, и нет уроков, возможно он не ведет этот предмет или класс
             # Но чтобы не падать с 403, просто вернем пустоту, если фильтр был
             pass
        else:
             pass
             
    if not timetable:
        return {"students": [], "lessons": [], "grades": {}}
    
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
        .select("timetable_entry_id,lesson_date,student_id,grade,present,comment,lesson_topic,homework")
        .in_("timetable_entry_id", entry_ids)
        .order("lesson_date", desc=False)
        .execute()
        .data
        or []
    )
    
    # Группируем уроки по датам и собираем темы/ДЗ
    lessons_by_date = {}
    
    # Генерируем сетку уроков на учебный год
    today = date.today()
    # Определяем учебный год (с 1 сентября)
    if today.month >= 9:
        start_date = date(today.year, 9, 1)
        end_date = date(today.year + 1, 5, 31)
    else:
        start_date = date(today.year - 1, 9, 1)
        end_date = date(today.year, 5, 31)
        
    current = start_date
    while current <= end_date:
        wd = current.isoweekday()
        day_entries = [e for e in timetable if e.get("weekday") == wd]
        for entry in day_entries:
            d_str = current.isoformat()
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
                "homework": None
            }
        
        # Собираем тему урока и ДЗ (берем первое непустое значение)
        if key not in lesson_info:
            lesson_info[key] = {"lesson_topic": None, "homework": None}
        
        if record.get("lesson_topic") and not lesson_info[key]["lesson_topic"]:
            lesson_info[key]["lesson_topic"] = record["lesson_topic"]
        if record.get("homework") and not lesson_info[key]["homework"]:
            lesson_info[key]["homework"] = record["homework"]
    
    # Сортируем уроки по дате и добавляем тему/ДЗ
    lessons = sorted(lessons_by_date.values(), key=lambda x: x["date"])
    for lesson in lessons:
        key = f"{lesson['date']}_{lesson['timetable_entry_id']}"
        info = lesson_info.get(key, {})
        if info.get("lesson_topic"):
            lesson["lesson_topic"] = info.get("lesson_topic")
        if info.get("homework"):
            lesson["homework"] = info.get("homework")
    
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
            for r in student_records:
                if r.get("present") is not None:
                    present = r.get("present")
                    break
            
            grades[sid][key] = {
                "grades": lesson_grades,
                "present": present
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
    
    if payload.grade is not None and (payload.grade < 1 or payload.grade > 5):
        raise HTTPException(status_code=400, detail="Grade must be between 1 and 5")
    
    # Проверяем урок
    entry = (
        sb.table("timetable_entries")
        .select("id,class_id,teacher_id,subject_id")
        .eq("id", payload.timetable_entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    if entry_data.get("class_id") != class_id:
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
    
    # Подготавливаем данные
    record_data = {
        "timetable_entry_id": payload.timetable_entry_id,
        "lesson_date": d.isoformat(),
        "student_id": payload.student_id,
        "grade": payload.grade,
        "present": payload.present,
        "comment": payload.comment,
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
            .eq("class_id", grade_data.get("class_id"))
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
        .select("id,class_id,teacher_id,subject_id")
        .eq("id", payload.timetable_entry_id)
        .eq("class_id", class_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
    
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
    if payload.lesson_topic is not None:
        update_data["lesson_topic"] = payload.lesson_topic
    if payload.homework is not None:
        update_data["homework"] = payload.homework
    
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
        .select("id,class_id,subject,teacher_id,subject_id,subjects(name)")
        .eq("id", timetable_entry_id)
        .eq("class_id", class_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    entry_data = entry[0]
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
        .select("lesson_topic,homework")
        .eq("timetable_entry_id", timetable_entry_id)
        .eq("lesson_date", lesson_date)
        .execute()
        .data
        or []
    )
    
    # Берем первую запись с непустыми полями
    lesson_topic = None
    homework = None
    
    for record in records:
        if record.get("lesson_topic") and not lesson_topic:
            lesson_topic = record["lesson_topic"]
        if record.get("homework") and not homework:
            homework = record["homework"]
    
    return {
        "lesson_topic": lesson_topic,
        "homework": homework,
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
