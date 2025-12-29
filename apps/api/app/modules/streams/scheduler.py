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
    """Find a teacher who teaches this subject"""
    result = sb.table("teacher_subjects").select("teacher_id").eq("subject_id", subject_id).limit(1).execute()
    
    if result.data:
        return result.data[0]["teacher_id"]
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
    timetable_result = sb.table("timetable_entries").select("*").eq("stream_id", stream_id).eq("active", True).execute()
    
    if not timetable_result.data:
        return 0
    
    # For each timetable entry, generate journal entries for all dates in range
    journal_entries = []
    
    for entry in timetable_result.data:
        weekday = entry["weekday"]  # 0=Mon, 1=Tue, etc.
        timetable_entry_id = entry["id"]
        
        # Get all class IDs (support both single class_id and class_ids array)
        class_ids = entry.get("class_ids") or ([entry["class_id"]] if entry.get("class_id") else [])
        
        if not class_ids:
            continue
        
        # Find all dates matching this weekday in the date range
        current = start_date
        lesson_dates = []
        
        while current <= end_date:
            # Skip Saturdays (weekday=5 in Python, but in DB we use 0-6 where 0=Mon)
            # Python: Mon=0, Sat=5, Sun=6
            # Our DB: Mon=0, Sat=5, Sun=6 (same)
            if current.weekday() == weekday and current.weekday() != 5:  # Not Saturday
                lesson_dates.append(current)
            current += timedelta(days=1)
        
        # For each lesson date, create journal entries for all students in all classes
        for lesson_date in lesson_dates:
            for class_id in class_ids:
                # Get all students in this class
                students_result = sb.table("class_enrollments").select("student_id").eq("class_id", class_id).execute()
                
                for student_row in students_result.data:
                    student_id = student_row["student_id"]
                    
                    # Check if entry already exists
                    existing = sb.table("lesson_journal").select("student_id").eq("timetable_entry_id", timetable_entry_id).eq("lesson_date", lesson_date.isoformat()).eq("student_id", student_id).execute()
                    
                    if not existing.data:
                        journal_entries.append({
                            "timetable_entry_id": timetable_entry_id,
                            "lesson_date": lesson_date.isoformat(),
                            "student_id": student_id,
                            "present": None,  # Not marked yet
                            "grade": None,
                            "comment": None,
                            "lesson_topic": None,
                            "homework": None,
                            "created_by": created_by_id,
                        })
    
    # Batch insert journal entries
    if journal_entries:
        # Insert in batches of 1000 to avoid payload limits
        batch_size = 1000
        for i in range(0, len(journal_entries), batch_size):
            batch = journal_entries[i:i+batch_size]
            sb.table("lesson_journal").insert(batch).execute()
    
    return len(journal_entries)


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
    template_id: str,
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
    
    # ========================================================================
    # 1. LOAD STREAM AND VALIDATE
    # ========================================================================
    stream_result = sb.table("streams").select("*").eq("id", stream_id).execute()
    if not stream_result.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    stream = stream_result.data[0]
    
    # Check if already has schedule
    if not force:
        existing_entries = sb.table("timetable_entries").select("id", count="exact").eq("stream_id", stream_id).eq("active", True).execute()
        if existing_entries.count and existing_entries.count > 0:
            raise HTTPException(
                status_code=400, 
                detail=f"Stream already has {existing_entries.count} timetable entries. Use force=true to regenerate."
            )
    
    # Get classes in stream
    stream_classes_result = sb.table("stream_classes").select("class_id").eq("stream_id", stream_id).execute()
    if not stream_classes_result.data:
        raise HTTPException(status_code=400, detail="Stream has no classes. Add classes first.")
    
    class_ids = [sc["class_id"] for sc in stream_classes_result.data]
    
    # ========================================================================
    # 2. LOAD CURRICULUM TEMPLATE
    # ========================================================================
    template_result = sb.table("curriculum_templates").select("*").eq("id", template_id).execute()
    if not template_result.data:
        raise HTTPException(status_code=404, detail="Curriculum template not found")
    
    # Get template items (subjects with hours)
    items_result = sb.table("curriculum_template_items").select("*, subjects(id, name)").eq("template_id", template_id).execute()
    
    if not items_result.data:
        raise HTTPException(status_code=400, detail="Curriculum template has no subjects")
    
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
    # 4. GROUP CLASSES FOR SHARED LESSONS
    # ========================================================================
    class_groups = group_classes_optimally(class_ids, MIN_CLASSES_PER_LESSON, MAX_CLASSES_PER_LESSON)
    
    # ========================================================================
    # 5. SCHEDULE ALLOCATION
    # ========================================================================
    timetable_entries = []
    warnings = []
    
    for subject_req in subject_requirements:
        # Find teacher for this subject
        teacher_id = get_teacher_for_subject(sb, subject_req.subject_id)
        if not teacher_id:
            warnings.append(f"No teacher found for {subject_req.subject_name}. Schedule created without teacher.")
        
        # Schedule lessons for each class group
        for group in class_groups:
            lessons_scheduled = 0
            
            # Try to distribute lessons across the week
            for attempt in range(subject_req.lessons_needed):
                scheduled = False
                
                # Shuffle slots for variety
                slot_candidates = available_slots.copy()
                random.shuffle(slot_candidates)
                
                for slot in slot_candidates:
                    # Check all constraints
                    if not constraints.are_classes_available(group, slot.weekday, slot.start_time, slot.end_time):
                        continue
                    
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
                    
                    # SLOT IS AVAILABLE! Book it
                    constraints.book_slot(teacher_id, room, group, slot.weekday, slot.start_time, slot.end_time)
                    
                    # Create timetable entry
                    # Note: class_id will be first in group for backward compatibility
                    # class_ids array contains all classes
                    timetable_entries.append({
                        "stream_id": stream_id,
                        "class_id": group[0],  # Primary class for backward compat
                        "class_ids": group,  # All classes in this lesson
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
                        "notes": f"Auto-generated for stream {stream['name']}. Classes: {len(group)} vzvodы.",
                    })
                    
                    lessons_scheduled += 1
                    scheduled = True
                    break
                
                if not scheduled:
                    warnings.append(
                        f"Could not schedule lesson {attempt + 1}/{subject_req.lessons_needed} "
                        f"for {subject_req.subject_name} (group {len(timetable_entries) % len(class_groups) + 1}). "
                        f"No available slots found."
                    )
            
            if lessons_scheduled < subject_req.lessons_needed:
                warnings.append(
                    f"{subject_req.subject_name}: Only scheduled {lessons_scheduled}/{subject_req.lessons_needed} "
                    f"lessons for class group. Increase time slots or reduce curriculum."
                )
    
    # ========================================================================
    # 6. DELETE OLD ENTRIES IF FORCE=TRUE
    # ========================================================================
    if force:
        sb.table("timetable_entries").delete().eq("stream_id", stream_id).execute()
    
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
            end_date = datetime.fromisoformat(stream["end_date"]).date()
            
            journal_entries_created = generate_journal_entries_for_stream(
                sb=sb,
                stream_id=stream_id,
                start_date=start_date,
                end_date=end_date,
                created_by_id=user_id,
            )
        except Exception as e:
            warnings.append(f"Failed to auto-generate journal entries: {str(e)}")
    
    # ========================================================================
    # 10. RETURN SUMMARY
    # ========================================================================
    return {
        "stream_id": stream_id,
        "entries_created": len(timetable_entries),
        "journal_entries_created": journal_entries_created,
        "message": f"Successfully generated {len(timetable_entries)} timetable entries for {len(class_ids)} classes in {len(class_groups)} groups. Created {journal_entries_created} journal entries for 3-month period.",
        "warnings": warnings,
        "details": {
            "classes_count": len(class_ids),
            "class_groups": len(class_groups),
            "subjects_scheduled": len(subject_requirements),
        }
    }
