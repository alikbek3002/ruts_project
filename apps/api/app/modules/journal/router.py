from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


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
def get_teacher_classes(user: dict = require_role("teacher")):
    """Получить все классы учителя"""
    sb = get_supabase()
    
    # Получаем уникальные классы из расписания учителя
    timetable = (
        sb.table("timetable_entries")
        .select("class_id,subject")
        .eq("teacher_id", user["id"])
        .execute()
        .data
        or []
    )
    
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
        subjects = sorted({
            e.get("subject") 
            for e in timetable 
            if e.get("class_id") == cls.get("id") and e.get("subject")
        })
        result.append({
            "id": cls.get("id"),
            "name": cls.get("name"),
            "subjects": subjects
        })
    
    return {"classes": result}


@router.get("/classes/{class_id}/journal")
def get_class_journal(class_id: str, user: dict = require_role("teacher", "admin", "manager")):
    """Получить журнал класса с оценками по датам уроков"""
    sb = get_supabase()
    
    # Проверяем доступ
    if user["role"] == "teacher":
        # Учитель видит только свои уроки
        timetable = (
            sb.table("timetable_entries")
            .select("id,subject,weekday,start_time")
            .eq("class_id", class_id)
            .eq("teacher_id", user["id"])
            .execute()
            .data
            or []
        )
        if not timetable:
            raise HTTPException(status_code=403, detail="No lessons found for this teacher in this class")
    else:
        # Админ видит все уроки класса
        timetable = (
            sb.table("timetable_entries")
            .select("id,subject,teacher_id,weekday,start_time")
            .eq("class_id", class_id)
            .execute()
            .data
            or []
        )
    
    if not timetable:
        return {"students": [], "lessons": [], "grades": {}}
    
    # Получаем всех учеников класса
    enrollments = (
        sb.table("class_enrollments")
        .select("student_id")
        .eq("class_id", class_id)
        .execute()
        .data
        or []
    )
    student_ids = [e.get("student_id") for e in enrollments if e.get("student_id")]
    
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
        .select("timetable_entry_id,lesson_date,student_id,grade,present,comment")
        .in_("timetable_entry_id", entry_ids)
        .order("lesson_date", desc=False)
        .execute()
        .data
        or []
    )
    
    # Группируем уроки по датам
    lessons_by_date = {}
    for record in journal_records:
        entry_id = record.get("timetable_entry_id")
        date = record.get("lesson_date")
        
        # Находим информацию о уроке
        entry = next((e for e in timetable if e.get("id") == entry_id), None)
        if not entry:
            continue
        
        key = f"{date}_{entry_id}"
        if key not in lessons_by_date:
            lessons_by_date[key] = {
                "date": date,
                "timetable_entry_id": entry_id,
                "subject_name": entry.get("subject", "")
            }
    
    # Сортируем уроки по дате
    lessons = sorted(lessons_by_date.values(), key=lambda x: x["date"])
    
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
        .select("id,class_id,teacher_id")
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
    if user["role"] == "teacher" and entry_data.get("teacher_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Проверяем, что студент в этом классе
    enrollment = (
        sb.table("class_enrollments")
        .select("student_id")
        .eq("class_id", class_id)
        .eq("student_id", payload.student_id)
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
