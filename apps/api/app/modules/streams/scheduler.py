"""
Auto-Scheduler Module for Streams
Generates optimal timetables considering:
- Curriculum template (hours per subject per week)
- Teacher availability (no conflicts)
- Room availability (no conflicts)
- Lunch break (13:20-14:20)
- Saturdays = subbotnik (no lessons)
- Existing schedules of other streams
- Multiple classes (2-4 vzvodы) on same lesson
"""

from datetime import date, datetime, time, timedelta
from typing import List, Dict, Any, Optional, Set, Tuple
from uuid import UUID
from collections import defaultdict
import random
from calendar import monthrange
    # For each timetable entry, generate journal entries for all dates in range.
    # IMPORTANT: do not overwrite existing marks/attendance. We insert only missing rows.
from fastapi import HTTPException


# ============================================================================
# CONSTANTS
# ============================================================================

TIME_SLOTS = [
    {"slot": 1, "start_time": "09:00", "end_time": "10:20"},
    {"slot": 2, "start_time": "10:30", "end_time": "11:50"},
    {"slot": 3, "start_time": "12:00", "end_time": "13:20"},
    # Lunch break: 13:20 - 14:20
    {"slot": 4, "start_time": "14:20", "end_time": "15:40"},
    {"slot": 5, "start_time": "15:50", "end_time": "17:10"},
]

WEEKDAYS = [0, 1, 2, 3, 4]  # Monday to Friday (Saturday=5 is subbotnik)
LUNCH_START = time(13, 20)
LUNCH_END = time(14, 20)

# How many classes can attend one lesson (2-4 vzvodы)
# Это означает, что на одной паре могут сидеть от 2 до 4 классов вместе
# Например: если в потоке 2 класса - они будут вместе на всех парах
#           если в потоке 4 класса - все 4 вместе на каждой паре
#           если в потоке 5 классов - будет группа из 3 и группа из 2
MIN_CLASSES_PER_LESSON = 2
MAX_CLASSES_PER_LESSON = 4


# ============================================================================
# DATA STRUCTURES
# ============================================================================

class LessonSlot:
    """Represents a time slot for a lesson"""
    def __init__(self, weekday: int, start_time: str, end_time: str, slot_number: int):
        self.weekday = weekday
        self.start_time = start_time
        self.end_time = end_time
        self.slot_number = slot_number
    
    def __repr__(self):
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        return f"{days[self.weekday]} {self.start_time}-{self.end_time}"
    
    def __hash__(self):
        return hash((self.weekday, self.start_time, self.end_time))
    
    def __eq__(self, other):
        return (self.weekday == other.weekday and 
                self.start_time == other.start_time and 
                self.end_time == other.end_time)


class SubjectRequirement:
    """Subject with required hours per week"""
    def __init__(self, subject_id: str, subject_name: str, hours_per_week: float, lesson_type: str):
        self.subject_id = subject_id
        self.subject_name = subject_name
        self.hours_per_week = hours_per_week
        self.lesson_type = lesson_type
        self.lessons_needed = self._calculate_lessons_needed(hours_per_week)
    
    def _calculate_lessons_needed(self, hours: float) -> int:
        """Convert hours to number of lessons (each lesson = 1.5 hours)"""
        # 1 lesson = 80 minutes = 1.333 hours, round to 1.5 for simplicity
        return int(round(hours / 1.5))


class ScheduleConstraints:
    """Tracks what's already scheduled to detect conflicts"""
    def __init__(self):
        # teacher_id -> set of (weekday, start_time, end_time)
        self.teacher_slots: Dict[str, Set[Tuple]] = defaultdict(set)
        # room -> set of (weekday, start_time, end_time)
        self.room_slots: Dict[str, Set[Tuple]] = defaultdict(set)
        # class_id -> set of (weekday, start_time, end_time)
        self.class_slots: Dict[str, Set[Tuple]] = defaultdict(set)
    
    def is_teacher_available(self, teacher_id: str, weekday: int, start_time: str, end_time: str) -> bool:
        """Check if teacher is free at this time"""
        if not teacher_id:
            return True
        return (weekday, start_time, end_time) not in self.teacher_slots[teacher_id]
    
    def is_room_available(self, room: str, weekday: int, start_time: str, end_time: str) -> bool:
        """Check if room is free"""
        if not room:
            return True
        return (weekday, start_time, end_time) not in self.room_slots[room]
    
    def is_class_available(self, class_id: str, weekday: int, start_time: str, end_time: str) -> bool:
        """Check if class is free"""
        return (weekday, start_time, end_time) not in self.class_slots[class_id]
    
    def are_classes_available(self, class_ids: List[str], weekday: int, start_time: str, end_time: str) -> bool:
        """Check if all classes in group are free"""
        return all(self.is_class_available(cid, weekday, start_time, end_time) for cid in class_ids)
    
    def book_slot(self, teacher_id: Optional[str], room: Optional[str], class_ids: List[str], 
                  weekday: int, start_time: str, end_time: str):
        """Mark slot as occupied"""
        slot = (weekday, start_time, end_time)
        if teacher_id:
            self.teacher_slots[teacher_id].add(slot)
        if room:
            self.room_slots[room].add(slot)
        for class_id in class_ids:
            self.class_slots[class_id].add(slot)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_available_slots() -> List[LessonSlot]:
    """Get all available time slots (Mon-Fri, excluding lunch)"""
    slots = []
    for weekday in WEEKDAYS:
        for time_slot in TIME_SLOTS:
            slots.append(LessonSlot(
                weekday=weekday,
                start_time=time_slot["start_time"],
                end_time=time_slot["end_time"],
                slot_number=time_slot["slot"],
            ))
    return slots


def load_existing_constraints(sb, stream_id: Optional[str] = None) -> ScheduleConstraints:
    """Load existing timetable entries to detect conflicts"""
    constraints = ScheduleConstraints()
    
    # Get all active timetable entries
    query = sb.table("timetable_entries").select("*").eq("active", True)
    
    # Optionally exclude current stream (if regenerating)
    if stream_id:
        query = query.neq("stream_id", stream_id)
    
    result = query.execute()
    
    for entry in result.data:
        teacher_id = entry.get("teacher_id")
        room = entry.get("room")
        class_id = entry.get("class_id")
        class_ids = entry.get("class_ids") or ([class_id] if class_id else [])
        weekday = entry["weekday"]
        start_time = entry["start_time"]
        end_time = entry["end_time"]
        
        constraints.book_slot(teacher_id, room, class_ids, weekday, start_time, end_time)
    
    return constraints


def get_teacher_for_subject(sb, subject_id: str) -> Optional[str]:
    """Find a teacher for a subject.

    Legacy: try teacher_subjects mapping first.
    New behavior: if no mapping exists, fall back to any active teacher.
    """
    try:
        result = (
            sb.table("teacher_subjects")
            .select("teacher_id")
            .eq("subject_id", subject_id)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["teacher_id"]
    except Exception:
        pass

    # Fallback: any active teacher
    try:
        t = (
            sb.table("users")
            .select("id")
            .eq("role", "teacher")
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception:
        t = sb.table("users").select("id").eq("role", "teacher").limit(1).execute()

    if t.data:
        return t.data[0]["id"]
    return None


def get_available_rooms(sb) -> List[str]:
    """Get list of available rooms from existing timetable entries"""
    result = sb.table("timetable_entries").select("room").not_.is_("room", "null").execute()
    
    rooms = set()
    for entry in result.data:
        if entry.get("room"):
            rooms.add(entry["room"])
    
    # If no rooms found, generate default rooms
    if not rooms:
        rooms = {f"Аудитория {i}" for i in range(1, 21)}  # 20 default rooms
    
    return list(rooms)


def generate_journal_entries_for_stream(
    sb,
    stream_id: str,
    start_date: date,
    end_date: date,
    created_by_id: str,
) -> int:
    """
    Generate lesson_journal entries for all lessons in stream for 3 months
    Returns number of entries created
    """
    # Get all timetable entries for this stream
    timetable_result = (
        sb.table("timetable_entries")
        .select("id,weekday,class_id,class_ids")
        .eq("stream_id", stream_id)
        .eq("active", True)
        .execute()
    )
    
    if not timetable_result.data:
        return 0
    
    # Precompute lesson dates for each weekday in range (skip Saturday)
    dates_by_weekday: Dict[int, List[date]] = {i: [] for i in range(7)}
    current = start_date
    while current <= end_date:
        wd = current.weekday()  # Mon=0 .. Sun=6
        if wd != 5:  # Skip Saturday
            dates_by_weekday[wd].append(current)
        current += timedelta(days=1)

    # Load all students for all classes involved in this stream in one query
    all_class_ids: Set[str] = set()
    normalized_entries: List[Dict[str, Any]] = []
    for entry in timetable_result.data:
        class_ids = entry.get("class_ids") or ([entry.get("class_id")] if entry.get("class_id") else [])
        class_ids = [cid for cid in class_ids if cid]
        if not class_ids:
            continue
        normalized_entries.append(
            {
                "id": entry["id"],
                "weekday": entry["weekday"],
                "class_ids": class_ids,
            }
        )
        for cid in class_ids:
            all_class_ids.add(str(cid))

    class_to_students: Dict[str, List[str]] = {cid: [] for cid in all_class_ids}
    if all_class_ids:
        enrollments = (
            sb.table("class_enrollments")
            .select("class_id,legacy_student_id")
            .in_("class_id", list(all_class_ids))
            .execute()
        )
        for row in enrollments.data or []:
            if row.get("legacy_student_id"):
                class_to_students[str(row["class_id"])].append(str(row["legacy_student_id"]))

    # IMPORTANT: do not overwrite existing marks/attendance. Insert only missing rows.
    inserted = 0
    batch_size = 500
    batch: List[Dict[str, Any]] = []

    for entry in normalized_entries:
        weekday = int(entry["weekday"])
        timetable_entry_id = entry["id"]
        lesson_dates = dates_by_weekday.get(weekday) or []
        if not lesson_dates:
            continue

        for lesson_date in lesson_dates:
            lesson_date_str = lesson_date.isoformat()
            for class_id in entry["class_ids"]:
                for student_id in class_to_students.get(str(class_id), []):
                    batch.append(
                        {
                            "timetable_entry_id": timetable_entry_id,
                            "lesson_date": lesson_date_str,
                            "student_id": student_id,
                            "created_by": created_by_id,
                        }
                    )
                    if len(batch) >= batch_size:
                        sb.table("lesson_journal").upsert(
                            batch,
                            on_conflict="timetable_entry_id,lesson_date,student_id",
                            ignore_duplicates=True,
                        ).execute()
                        inserted += len(batch)
                        batch = []

    if batch:
        sb.table("lesson_journal").upsert(
            batch,
            on_conflict="timetable_entry_id,lesson_date,student_id",
            ignore_duplicates=True,
        ).execute()
        inserted += len(batch)

    return inserted


def group_classes_optimally(class_ids: List[str], min_group: int = 2, max_group: int = 4) -> List[List[str]]:
    """
    Group classes for shared lessons (2-4 vzvodы per lesson)
    Returns list of class groups
    """
    groups = []
    remaining = class_ids.copy()
    
    while remaining:
        # Try to take max_group classes
        group_size = min(max_group, len(remaining))
        # But ensure last group isn't too small
        if len(remaining) - group_size > 0 and len(remaining) - group_size < min_group:
            group_size = len(remaining) - min_group
        
        if group_size >= min_group:
            group = remaining[:group_size]
            groups.append(group)
            remaining = remaining[group_size:]
        else:
            # Last small group, add to previous or make single
            if groups and len(groups[-1]) < max_group:
                groups[-1].extend(remaining)
            else:
                groups.append(remaining)
            remaining = []
    
    return groups


# ============================================================================
# MAIN AUTO-SCHEDULER
# ============================================================================

async def generate_schedule(
    sb,
    stream_id: str,
    template_id: Optional[str] = None,
    force: bool = False,
    user_id: str = None,  # User who triggered the generation
) -> Dict[str, Any]:
    """
    Generate auto-schedule for a stream based on curriculum template
    
    Algorithm:
    1. Load stream and classes
    2. Load curriculum template (subjects + hours per week)
    3. Load existing constraints (other streams' schedules)
    4. Group classes (2-4 vzvodы per lesson)
    5. For each subject:
       - Calculate number of lessons needed per week
       - Find available teacher
       - Allocate time slots avoiding conflicts
       - Assign room
    6. Insert timetable entries
    7. Return summary
    """
    
    warnings: List[str] = []

    # ========================================================================
    # 1. LOAD STREAM AND VALIDATE
    # ========================================================================
    stream_result = sb.table("streams").select("*").eq("id", stream_id).execute()
    if not stream_result.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    stream = stream_result.data[0]

    # Check if stream already has timetable entries
    existing_entries = (
        sb.table("timetable_entries")
        .select("id", count="exact")
        .eq("stream_id", stream_id)
        .eq("active", True)
        .execute()
    )

    if existing_entries.data and not force:
        # Stream already has schedule, don't regenerate but do fill journal for 3 months
        journal_entries_created = generate_journal_entries_for_stream(
            sb,
            stream_id,
            datetime.fromisoformat(stream["start_date"]).date(),
            datetime.fromisoformat(stream["end_date"]).date(),
            user_id or stream["created_by"],
        )
        return {
            "stream_id": stream_id,
            "entries_created": 0,
            "journal_entries_created": journal_entries_created,
            "message": "Расписание уже существует. Журнал успешно обновлён.",
            "warnings": warnings,
        }

    if force and existing_entries.data:
        # Deactivate old entries instead of deleting (preserve history)
        sb.table("timetable_entries").update({"active": False}).eq("stream_id", stream_id).execute()

    # ========================================================================
    # 2. LOAD CLASSES
    # ========================================================================
    classes_result = sb.table("stream_classes").select("class_id").eq("stream_id", stream_id).execute()
    if not classes_result.data:
        raise HTTPException(status_code=400, detail="Stream has no classes. Add classes to the stream first.")

    class_ids = [c["class_id"] for c in classes_result.data]

    # ========================================================================
    # 3. LOAD CURRICULUM TEMPLATE
    # ========================================================================

    # If template_id not provided, try to find default
    if not template_id:
        stream_direction_id = stream.get("direction_id")

        # Try direction-specific default first
        if stream_direction_id:
            dir_default = (
                sb.table("curriculum_templates")
                .select("id")
                .eq("is_default", True)
                .eq("direction_id", stream_direction_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if dir_default.data:
                template_id = dir_default.data[0]["id"]

        # Fall back to global default
        if not template_id:
            global_default = (
                sb.table("curriculum_templates")
                .select("id")
                .eq("is_default", True)
                .is_("direction_id", "null")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if global_default.data:
                template_id = global_default.data[0]["id"]

        if not template_id:
            raise HTTPException(
                status_code=400,
                detail="Не найден учебный шаблон. Создайте шаблон по умолчанию или выберите существующий."
            )

    # Load selected template
    template_result = sb.table("curriculum_templates").select("*").eq("id", template_id).execute()
    if not template_result.data:
        raise HTTPException(status_code=404, detail="Curriculum template not found")

    selected_template = template_result.data[0]

    # Get template items (subjects with hours)
    items_result = (
        sb.table("curriculum_template_items")
        .select("*, subjects(id, name)")
        .eq("template_id", template_id)
        .execute()
    )

    # If selected template is empty, try to fall back to a default template
    if not items_result.data:
        stream_direction_id = stream.get("direction_id")

        def _template_has_items(tid: str) -> bool:
            check = (
                sb.table("curriculum_template_items")
                .select("id", count="exact")
                .eq("template_id", tid)
                .limit(1)
                .execute()
            )
            return bool(check.data)

        fallback_template = None

        if stream_direction_id:
            direction_defaults = (
                sb.table("curriculum_templates")
                .select("id, name")
                .eq("is_default", True)
                .eq("direction_id", stream_direction_id)
                .order("created_at", desc=True)
                .execute()
            )
            for t in direction_defaults.data or []:
                if _template_has_items(t["id"]):
                    fallback_template = t
                    break

        if not fallback_template:
            global_defaults = (
                sb.table("curriculum_templates")
                .select("id, name")
                .eq("is_default", True)
                .is_("direction_id", "null")
                .order("created_at", desc=True)
                .execute()
            )
            for t in global_defaults.data or []:
                if _template_has_items(t["id"]):
                    fallback_template = t
                    break

        if fallback_template:
            warnings.append(
                f"Выбранный шаблон был пуст. Использован шаблон '{fallback_template['name']}' по умолчанию."
            )
            template_id = fallback_template["id"]
            selected_template = {**selected_template, **fallback_template}
            items_result = (
                sb.table("curriculum_template_items")
                .select("*, subjects(id, name)")
                .eq("template_id", template_id)
                .execute()
            )

        if not items_result.data:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Curriculum template has no subjects. Add subjects (items) to the template "
                    "and try again."
                ),
            )
    
    subject_requirements = []
    for item in items_result.data:
        subject_requirements.append(SubjectRequirement(
            subject_id=item["subject_id"],
            subject_name=item["subjects"]["name"] if item.get("subjects") else "Unknown",
            hours_per_week=float(item["hours_per_week"]),
            lesson_type=item["lesson_type"],
        ))
    
    # ========================================================================
    # 3. LOAD EXISTING CONSTRAINTS
    # ========================================================================
    constraints = load_existing_constraints(sb, stream_id if force else None)
    available_slots = get_available_slots()
    rooms = get_available_rooms(sb)
    
    # ========================================================================
    # 4. GROUP CLASSES OPTIMALLY (2-4 groups per lesson)
    # ========================================================================
    class_groups = group_classes_optimally(class_ids, MIN_CLASSES_PER_LESSON, MAX_CLASSES_PER_LESSON)
    
    # ========================================================================
    # 5. SCHEDULE ALLOCATION - CREATE ONE ENTRY PER GROUP
    # ========================================================================
    # Группируем классы (2-4 на одну пару), но гарантируем, что каждый класс получит все занятия
    timetable_entries = []
    base_schedule = []  # [(subject_req, slot, teacher_id, room, group), ...]
    
    for subject_req in subject_requirements:
        # Find teacher for this subject
        teacher_id = get_teacher_for_subject(sb, subject_req.subject_id)
        if not teacher_id:
            warnings.append(
                f"Не найден преподаватель для предмета '{subject_req.subject_name}'. "
                "Предмет пропущен. Добавьте хотя бы одного активного учителя."
            )
            continue
        
        lessons_scheduled = 0
        
        # Try to distribute lessons across the week
        for attempt in range(subject_req.lessons_needed):
            scheduled = False
            
            # Shuffle slots for variety
            slot_candidates = available_slots.copy()
            random.shuffle(slot_candidates)
            
            for slot in slot_candidates:
                # Check teacher availability
                if teacher_id and not constraints.is_teacher_available(teacher_id, slot.weekday, slot.start_time, slot.end_time):
                    continue
                
                # Find available room
                room = None
                for r in rooms:
                    if constraints.is_room_available(r, slot.weekday, slot.start_time, slot.end_time):
                        room = r
                        break
                
                if not room:
                    continue  # No room available
                
                # Check if ALL classes can attend at this time
                all_classes_available = True
                for class_id in class_ids:
                    if not constraints.is_class_available(class_id, slot.weekday, slot.start_time, slot.end_time):
                        all_classes_available = False
                        break
                
                if not all_classes_available:
                    continue
                
                # SLOT IS AVAILABLE! Book it for all classes
                constraints.book_slot(teacher_id, room, class_ids, slot.weekday, slot.start_time, slot.end_time)
                
                # Save to base schedule (one entry per group, not per class)
                for group in class_groups:
                    base_schedule.append({
                        "subject_req": subject_req,
                        "slot": slot,
                        "teacher_id": teacher_id,
                        "room": room,
                        "group": group,
                    })
                
                lessons_scheduled += 1
                scheduled = True
                break
            
            if not scheduled:
                warnings.append(
                    f"Не удалось запланировать урок {attempt + 1}/{subject_req.lessons_needed} "
                    f"по предмету '{subject_req.subject_name}'. Нет доступных временных слотов."
                )
        
        if lessons_scheduled < subject_req.lessons_needed:
            warnings.append(
                f"'{subject_req.subject_name}': Запланировано только {lessons_scheduled} из {subject_req.lessons_needed} "
                f"занятий. Недостаточно времени в расписании."
            )
    
    # Создаем записи: одна запись на группу классов (2-4 класса сидят вместе)
    for lesson in base_schedule:
        subject_req = lesson["subject_req"]
        slot = lesson["slot"]
        teacher_id = lesson["teacher_id"]
        room = lesson["room"]
        group = lesson["group"]
        
        timetable_entries.append({
            "stream_id": stream_id,
            "class_id": group[0],  # Первый класс для обратной совместимости
            "class_ids": group,  # Все классы в этой группе (2-4 класса)
            "teacher_id": teacher_id,
            "subject": subject_req.subject_name,
            "subject_id": subject_req.subject_id,
            "weekday": slot.weekday,
            "start_time": slot.start_time,
            "end_time": slot.end_time,
            "room": room,
            "lesson_type": subject_req.lesson_type,
            "active": True,
            "auto_generated": True,
            "notes": f"Auto-generated for stream {stream['name']}. Группа: {len(group)} классов.",
        })
    
    # ========================================================================
    # 6. DEACTIVATE OLD ENTRIES IF FORCE=TRUE
    # ========================================================================
    if force:
        sb.table("timetable_entries").update({"active": False}).eq("stream_id", stream_id).execute()
    
    # ========================================================================
    # 7. INSERT NEW TIMETABLE ENTRIES
    # ========================================================================
    if timetable_entries:
        # Batch insert
        sb.table("timetable_entries").insert(timetable_entries).execute()
    
    # ========================================================================
    # 8. UPDATE STREAM STATUS
    # ========================================================================
    if stream["status"] == "draft" and timetable_entries:
        sb.table("streams").update({"status": "active"}).eq("id", stream_id).execute()
    
    # ========================================================================
    # 9. AUTO-GENERATE JOURNAL ENTRIES FOR 3 MONTHS
    # ========================================================================
    journal_entries_created = 0
    if timetable_entries and user_id:
        try:
            start_date = datetime.fromisoformat(stream["start_date"]).date()
            # Force at least 3 months duration for journal generation as requested
            min_end_date = start_date + timedelta(days=90)
            stream_end_date = datetime.fromisoformat(stream["end_date"]).date()
            end_date = max(stream_end_date, min_end_date)
            
            journal_entries_created = generate_journal_entries_for_stream(
                sb=sb,
                stream_id=stream_id,
                start_date=start_date,
                end_date=end_date,
                created_by_id=user_id,
            )
        except Exception as e:
            warnings.append(f"Ошибка при создании журнала: {str(e)}")
    
    # ========================================================================
    # 10. RETURN SUMMARY
    # ========================================================================
    total_lessons = len(base_schedule) // len(class_groups) if class_groups else 0
    return {
        "stream_id": stream_id,
        "entries_created": len(timetable_entries),
        "journal_entries_created": journal_entries_created,
        "message": f"Расписание успешно создано: {total_lessons} занятий × {len(class_groups)} групп = {len(timetable_entries)} записей (по {len(class_groups[0]) if class_groups else 0}-{len(class_groups[-1]) if class_groups else 0} классов в группе). Журнал заполнен на 3 месяца ({journal_entries_created} записей).",
        "warnings": warnings,
        "details": {
            "classes_count": len(class_ids),
            "class_groups_count": len(class_groups),
            "lessons_scheduled": total_lessons,
            "subjects_scheduled": len(subject_requirements),
        }
    }
