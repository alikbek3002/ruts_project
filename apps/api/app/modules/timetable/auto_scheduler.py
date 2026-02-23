"""
Auto-scheduling algorithm for timetable generation.

Rules:
1. Three lesson types: theoretical, practical, credit
2. Max 1 theory + 1 practice per subject per week
3. Theory must come before practice
4. No gaps in daily schedule (consecutive lessons)
5. Hard constraints: no conflicts (teacher/room/class)
6. Soft constraints: balanced load (3-4 lessons/day)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import time, timedelta
from typing import List, Dict, Set, Optional, Tuple
from uuid import UUID

logger = logging.getLogger(__name__)

# Fixed time slots matching the frontend grid
FIXED_TIME_SLOTS = [
    (time(9, 0), time(10, 20)),
    (time(10, 30), time(11, 50)),
    (time(12, 0), time(13, 20)),
    (time(14, 20), time(15, 40)),
]


@dataclass
class TimeSlot:
    """Represents a time slot for a lesson."""
    weekday: int  # 0=Mon, 1=Tue, ..., 6=Sun
    start_time: time
    end_time: time
    
    def overlaps(self, other: TimeSlot) -> bool:
        """Check if this slot overlaps with another on same day."""
        if self.weekday != other.weekday:
            return False
        return not (self.end_time <= other.start_time or self.start_time >= other.end_time)
    
    def __hash__(self):
        return hash((self.weekday, self.start_time, self.end_time))
    
    def __eq__(self, other):
        return (self.weekday == other.weekday and 
                self.start_time == other.start_time and 
                self.end_time == other.end_time)


@dataclass
class Lesson:
    """Represents a lesson to be scheduled."""
    subject_id: str
    subject_name: str
    lesson_type: str  # 'theoretical', 'practical', 'credit'
    teacher_id: Optional[str]
    preferred_room: Optional[str] = None
    
    def __hash__(self):
        return hash((self.subject_id, self.lesson_type))


@dataclass
class ScheduledLesson:
    """A lesson assigned to a specific time slot."""
    lesson: Lesson
    time_slot: TimeSlot
    class_id: str
    room: Optional[str] = None


@dataclass
class ScheduleConstraints:
    """Configuration for schedule generation."""
    max_lessons_per_day: int = 4
    min_lessons_per_day: int = 3
    allow_gaps: bool = False
    working_days: List[int] = None  # [0,1,2,3,4] for Mon-Fri
    earliest_start: time = time(9, 0)
    latest_end: time = time(18, 0)
    lesson_duration_minutes: int = 90
    break_duration_minutes: int = 15
    
    def __post_init__(self):
        if self.working_days is None:
            self.working_days = [0, 1, 2, 3, 4]  # Mon-Fri


class ScheduleConflictError(Exception):
    """Raised when schedule cannot be generated due to conflicts."""
    pass


class AutoScheduler:
    """
    Automatic timetable generator with constraint satisfaction.
    
    Algorithm approach: Greedy with backtracking
    1. Sort lessons by priority (theory first, then practice)
    2. For each lesson, find first available slot that satisfies all constraints
    3. If no slot found, backtrack and try different arrangement
    """
    
    def __init__(self, constraints: ScheduleConstraints):
        self.constraints = constraints
        self.scheduled: List[ScheduledLesson] = []
        
        # Tracking for conflict detection
        self.teacher_slots: Dict[str, Set[TimeSlot]] = {}  # teacher_id -> occupied slots
        self.room_slots: Dict[str, Set[TimeSlot]] = {}     # room -> occupied slots
        self.class_slots: Dict[str, Set[TimeSlot]] = {}    # class_id -> occupied slots
        
        # Subject tracking (for theory before practice rule)
        self.subject_scheduled: Dict[Tuple[str, str], List[TimeSlot]] = {}  # (subject_id, type) -> slots
    
    def load_context(self, context_lessons: List[ScheduledLesson]):
        """Load existing lessons from OTHER classes to prevent conflicts."""
        for scheduled in context_lessons:
            self.scheduled.append(scheduled)
            self._mark_slots_occupied(scheduled)

    def generate_schedule(
        self,
        class_id: str,
        lessons: List[Lesson],
        existing_schedule: List[ScheduledLesson] = None
    ) -> List[ScheduledLesson]:
        """
        Generate schedule for a class.
        
        Args:
            class_id: ID of the class to schedule
            lessons: List of lessons to schedule
            existing_schedule: Already scheduled lessons (for updates)
            
        Returns:
            List of scheduled lessons (only for the target class)
            
        Raises:
            ScheduleConflictError: If schedule cannot be generated
        """
        logger.info(f"Generating schedule for class {class_id} with {len(lessons)} lessons")
        
        # Initialize with existing schedule
        if existing_schedule:
            self._load_existing_schedule(existing_schedule)
        
        # Sort lessons by priority: theory first, then practice, then credit
        sorted_lessons = self._prioritize_lessons(lessons)
        
        # Try to schedule each lesson
        scheduled_count = 0
        for lesson in sorted_lessons:
            try:
                slot = self._find_slot_for_lesson(class_id, lesson)
                if slot:
                    self._schedule_lesson(class_id, lesson, slot)
                    scheduled_count += 1
                else:
                    logger.warning(f"No slot found for {lesson.subject_name} ({lesson.lesson_type})")
            except Exception as e:
                logger.error(f"Error scheduling {lesson.subject_name}: {e}")
                raise ScheduleConflictError(f"Failed to schedule {lesson.subject_name}: {str(e)}")
        
        logger.info(f"Successfully scheduled {scheduled_count}/{len(lessons)} lessons")
        
        # Validate final schedule
        self._validate_schedule()
        
        # Return only lessons for this class
        return [s for s in self.scheduled if s.class_id == class_id]
    
    def _prioritize_lessons(self, lessons: List[Lesson]) -> List[Lesson]:
        """Sort lessons by priority: theory -> practice -> credit."""
        priority_map = {'theoretical': 1, 'practical': 2, 'credit': 3}
        # Sort by type priority, then by subject name to keep related lessons close
        return sorted(lessons, key=lambda l: (priority_map.get(l.lesson_type, 999), l.subject_name))
    
    def _find_slot_for_lesson(self, class_id: str, lesson: Lesson) -> Optional[TimeSlot]:
        """
        Find the first available time slot for a lesson.
        
        Considers:
        - Working days
        - No conflicts (teacher, room, class)
        - Theory before practice rule
        - Daily lesson limits
        - No gaps (strict rule: must be consecutive)
        """
        # Check theory before practice rule
        if lesson.lesson_type == 'practical':
            if not self._has_theory_scheduled(lesson.subject_id):
                logger.debug(f"Cannot schedule practice for {lesson.subject_name} - no theory yet")
                return None
        
        # Try each working day
        for weekday in self.constraints.working_days:
            # Check daily lesson count first (fast check)
            daily_count = sum(1 for s in self.scheduled 
                            if s.class_id == class_id and s.time_slot.weekday == weekday)
            
            if daily_count >= self.constraints.max_lessons_per_day:
                continue  # Skip this day
            
            # Get available slots for this day (optimized)
            day_slots = self._get_available_slots_for_day(class_id, weekday)
            
            for slot in day_slots:
                if self._can_schedule_at_slot(class_id, lesson, slot):
                    # Additional check for theory before practice on the SAME day
                    if lesson.lesson_type == 'practical':
                        # If theory is on the same day, practice must be AFTER theory
                        theory_slots = self.subject_scheduled.get((lesson.subject_id, 'theoretical'), [])
                        same_day_theory = [s for s in theory_slots if s.weekday == weekday]
                        if same_day_theory:
                            latest_theory_end = max(s.end_time for s in same_day_theory)
                            if slot.start_time < latest_theory_end:
                                continue # Practice cannot be before theory on same day

                    return slot
        
        return None
    
    def _get_available_slots_for_day(self, class_id: str, weekday: int) -> List[TimeSlot]:
        """Generate available time slots for a given day using FIXED_TIME_SLOTS grid."""
        # Get existing slots for this class on this day
        existing_slots = set(
            s for s in self.class_slots.get(class_id, []) if s.weekday == weekday
        )
        
        # Find which fixed slot indices are already occupied
        occupied_indices: set[int] = set()
        for es in existing_slots:
            for idx, (s_start, s_end) in enumerate(FIXED_TIME_SLOTS):
                if es.start_time == s_start and es.end_time == s_end:
                    occupied_indices.add(idx)
                    break
        
        # STRICT NO GAPS RULE:
        # Slots must be consecutive from the beginning.
        # Find the next available slot index.
        available: List[TimeSlot] = []
        
        if not existing_slots:
            # No lessons yet — all fixed slots are candidates (try first one first)
            for s_start, s_end in FIXED_TIME_SLOTS:
                available.append(TimeSlot(weekday, s_start, s_end))
        else:
            # Find the next consecutive slot after the last occupied one
            max_occupied_idx = max(occupied_indices) if occupied_indices else -1
            next_idx = max_occupied_idx + 1
            if next_idx < len(FIXED_TIME_SLOTS):
                s_start, s_end = FIXED_TIME_SLOTS[next_idx]
                available.append(TimeSlot(weekday, s_start, s_end))
        
        return available
    
    def _can_schedule_at_slot(self, class_id: str, lesson: Lesson, slot: TimeSlot) -> bool:
        """Check if lesson can be scheduled at given slot (no conflicts)."""
        # Check teacher availability (using set lookup - O(1))
        if lesson.teacher_id and lesson.teacher_id in self.teacher_slots:
            # Allow merging: if teacher is already teaching THIS subject (and type) at THIS slot, it's OK (merged class)
            # But we must ensure it's the SAME subject and type.
            
            teacher_slots_at_time = [s for s in self.teacher_slots[lesson.teacher_id] if s.overlaps(slot)]
            if teacher_slots_at_time:
                # Teacher is busy. Check if we can merge.
                # We need to find the lesson scheduled at this slot for this teacher.
                # Since self.teacher_slots only stores slots, we need to look up the scheduled lesson.
                
                can_merge = False
                for scheduled in self.scheduled:
                    if (scheduled.lesson.teacher_id == lesson.teacher_id and 
                        scheduled.time_slot.overlaps(slot)):
                        
                        # Check if same subject and type
                        if (scheduled.lesson.subject_id == lesson.subject_id and 
                            scheduled.lesson.lesson_type == lesson.lesson_type):
                            # Check if room capacity allows (optional, skipping for now as per request "two groups can sit")
                            # Also ensure it's a lecture/theory (usually practice is split, but user said "two groups can sit on one pair")
                            # Let's allow merging for all types if subject matches.
                            can_merge = True
                            # Use the same room as the existing lesson
                            lesson.preferred_room = scheduled.room 
                        break
                
                if not can_merge:
                    return False
        
        # Check room availability
        # If we are merging, we already set preferred_room to the existing room, so we share it.
        # If not merging, we must check if room is free.
        if lesson.preferred_room and lesson.preferred_room in self.room_slots:
             # If we are merging, the room slot is already taken by the teacher's other class.
             # We need to check if the room is taken by SOMEONE ELSE (not this teacher/subject).
             
             room_slots_at_time = [s for s in self.room_slots[lesson.preferred_room] if s.overlaps(slot)]
             if room_slots_at_time:
                 # Room is busy.
                 # If we are merging (teacher is same), then it's fine.
                 # If teacher is different, conflict.
                 
                 # Find who is occupying the room
                 for scheduled in self.scheduled:
                     if (scheduled.room == lesson.preferred_room and 
                         scheduled.time_slot.overlaps(slot)):
                         if scheduled.lesson.teacher_id != lesson.teacher_id:
                             return False # Room taken by another teacher
                         # If same teacher, it's the merge case we allowed above.
        
        # Class availability already checked in _get_available_slots_for_day
        return True
    
    def _schedule_lesson(self, class_id: str, lesson: Lesson, slot: TimeSlot):
        """Add lesson to schedule and update tracking structures."""
        scheduled = ScheduledLesson(
            lesson=lesson,
            time_slot=slot,
            class_id=class_id,
            room=lesson.preferred_room
        )
        
        self.scheduled.append(scheduled)
        
        # Update tracking
        if lesson.teacher_id:
            if lesson.teacher_id not in self.teacher_slots:
                self.teacher_slots[lesson.teacher_id] = set()
            self.teacher_slots[lesson.teacher_id].add(slot)
        
        if lesson.preferred_room:
            if lesson.preferred_room not in self.room_slots:
                self.room_slots[lesson.preferred_room] = set()
            self.room_slots[lesson.preferred_room].add(slot)
        
        if class_id not in self.class_slots:
            self.class_slots[class_id] = set()
        self.class_slots[class_id].add(slot)
        
        # Track subject scheduling
        key = (lesson.subject_id, lesson.lesson_type)
        if key not in self.subject_scheduled:
            self.subject_scheduled[key] = []
        self.subject_scheduled[key].append(slot)
        
        logger.debug(f"Scheduled {lesson.subject_name} ({lesson.lesson_type}) on {slot.weekday} at {slot.start_time}")
    
    def _has_theory_scheduled(self, subject_id: str) -> bool:
        """Check if theory lesson for subject is already scheduled."""
        key = (subject_id, 'theoretical')
        return key in self.subject_scheduled and len(self.subject_scheduled[key]) > 0
    
    def _load_existing_schedule(self, existing: List[ScheduledLesson]):
        """Load existing schedule into tracking structures."""
        for scheduled_lesson in existing:
            self.scheduled.append(scheduled_lesson)
            
            slot = scheduled_lesson.time_slot
            lesson = scheduled_lesson.lesson
            class_id = scheduled_lesson.class_id
            
            # Update tracking
            if lesson.teacher_id:
                if lesson.teacher_id not in self.teacher_slots:
                    self.teacher_slots[lesson.teacher_id] = set()
                self.teacher_slots[lesson.teacher_id].add(slot)
            
            if scheduled_lesson.room:
                if scheduled_lesson.room not in self.room_slots:
                    self.room_slots[scheduled_lesson.room] = set()
                self.room_slots[scheduled_lesson.room].add(slot)
            
            if class_id not in self.class_slots:
                self.class_slots[class_id] = set()
            self.class_slots[class_id].add(slot)
    
    def _validate_schedule(self):
        """Validate that final schedule satisfies all hard constraints."""
        errors = []
        
        # Check for overlaps
        for teacher_id, slots in self.teacher_slots.items():
            if self._has_overlaps(list(slots)):
                errors.append(f"Teacher {teacher_id} has overlapping lessons")
        
        for room, slots in self.room_slots.items():
            if self._has_overlaps(list(slots)):
                errors.append(f"Room {room} has overlapping bookings")
        
        for class_id, slots in self.class_slots.items():
            if self._has_overlaps(list(slots)):
                errors.append(f"Class {class_id} has overlapping lessons")
        
        # Check theory before practice
        for (subject_id, lesson_type), slots in self.subject_scheduled.items():
            if lesson_type == 'practical':
                theory_key = (subject_id, 'theoretical')
                if theory_key not in self.subject_scheduled:
                    errors.append(f"Practice lesson without theory for subject {subject_id}")
                else:
                    # Check that at least one theory comes before practice
                    theory_slots = self.subject_scheduled[theory_key]
                    practice_slots = slots
                    
                    earliest_theory = min(theory_slots, key=lambda s: (s.weekday, s.start_time))
                    earliest_practice = min(practice_slots, key=lambda s: (s.weekday, s.start_time))
                    
                    if (earliest_practice.weekday < earliest_theory.weekday or
                        (earliest_practice.weekday == earliest_theory.weekday and 
                         earliest_practice.start_time < earliest_theory.start_time)):
                        errors.append(f"Practice before theory for subject {subject_id}")
        
        if errors:
            raise ScheduleConflictError("; ".join(errors))
    
    def _has_overlaps(self, slots: List[TimeSlot]) -> bool:
        """Check if any slots in list overlap."""
        for i, slot1 in enumerate(slots):
            for slot2 in slots[i+1:]:
                if slot1.overlaps(slot2):
                    return True
        return False
    
    @staticmethod
    def _add_minutes(t: time, minutes: int) -> time:
        """Add minutes to time object."""
        dt = timedelta(hours=t.hour, minutes=t.minute, seconds=t.second)
        dt += timedelta(minutes=minutes)
        total_seconds = int(dt.total_seconds())
        hours = (total_seconds // 3600) % 24
        minutes = (total_seconds % 3600) // 60
        return time(hours, minutes)


def calculate_schedule_quality(scheduled: List[ScheduledLesson], constraints: ScheduleConstraints) -> Dict[str, float]:
    """
    Calculate quality metrics for generated schedule.
    
    Returns dict with scores (0-1, higher is better):
    - balance_score: How evenly lessons are distributed across days
    - gap_score: Penalty for gaps in schedule
    - load_score: How well daily lesson count matches target
    """
    if not scheduled:
        return {'balance_score': 0, 'gap_score': 0, 'load_score': 0, 'overall': 0}
    
    # Count lessons per day
    daily_counts = {}
    for lesson in scheduled:
        day = lesson.time_slot.weekday
        daily_counts[day] = daily_counts.get(day, 0) + 1
    
    # Balance score: lower std deviation is better
    counts = list(daily_counts.values())
    if len(counts) > 1:
        avg = sum(counts) / len(counts)
        variance = sum((c - avg) ** 2 for c in counts) / len(counts)
        std_dev = variance ** 0.5
        balance_score = max(0, 1 - (std_dev / avg))
    else:
        balance_score = 1.0
    
    # Gap score: check for gaps (only if not allowed)
    gap_score = 1.0
    if not constraints.allow_gaps:
        # Group by class and day
        by_class_day = {}
        for lesson in scheduled:
            key = (lesson.class_id, lesson.time_slot.weekday)
            if key not in by_class_day:
                by_class_day[key] = []
            by_class_day[key].append(lesson)
        
        # Check each day for gaps
        total_gap_time = 0
        for lessons in by_class_day.values():
            if len(lessons) < 2:
                continue
            sorted_lessons = sorted(lessons, key=lambda l: l.time_slot.start_time)
            for i in range(len(sorted_lessons) - 1):
                gap = (sorted_lessons[i+1].time_slot.start_time.hour * 60 + 
                      sorted_lessons[i+1].time_slot.start_time.minute) - \
                      (sorted_lessons[i].time_slot.end_time.hour * 60 + 
                       sorted_lessons[i].time_slot.end_time.minute)
                if gap > constraints.break_duration_minutes:
                    total_gap_time += gap - constraints.break_duration_minutes
        
        # Penalize gaps
        if total_gap_time > 0:
            gap_score = max(0, 1 - (total_gap_time / 180))  # 180 min = very bad
    
    # Load score: how well daily counts match target range
    load_penalties = 0
    for count in daily_counts.values():
        if count < constraints.min_lessons_per_day:
            load_penalties += (constraints.min_lessons_per_day - count)
        elif count > constraints.max_lessons_per_day:
            load_penalties += (count - constraints.max_lessons_per_day)
    
    load_score = max(0, 1 - (load_penalties / len(daily_counts) / 3))
    
    overall = (balance_score + gap_score + load_score) / 3
    
    return {
        'balance_score': round(balance_score, 3),
        'gap_score': round(gap_score, 3),
        'load_score': round(load_score, 3),
        'overall': round(overall, 3)
    }


# ============================================================================
# CURRICULUM-BASED LESSON GENERATION
# ============================================================================


def _find_teacher_via_cycle(
    sb,
    subject_id: str,
    teacher_load: Dict[str, int],
) -> Optional[str]:
    """
    Find most available teacher for a subject via cycle system.
    
    Chain: subject.cycle_id → teacher_cycles → pick least loaded teacher.
    
    Args:
        sb: Supabase client
        subject_id: Subject ID to find teacher for
        teacher_load: Dict of teacher_id → current assigned lesson count
    
    Returns:
        teacher_id or None
    """
    try:
        # 1. Get subject's cycle_id
        subj_resp = sb.table("subjects").select("cycle_id").eq("id", subject_id).limit(1).execute()
        if not subj_resp.data:
            return None
        cycle_id = subj_resp.data[0].get("cycle_id")
        if not cycle_id:
            return None

        # 2. Get all teachers assigned to this cycle
        links = (
            sb.table("teacher_cycles")
            .select("teacher_id")
            .eq("cycle_id", cycle_id)
            .execute()
            .data or []
        )
        teacher_ids = [r["teacher_id"] for r in links if r.get("teacher_id")]
        if not teacher_ids:
            return None

        # 3. Filter only active teachers
        active_teachers = (
            sb.table("users")
            .select("id")
            .in_("id", teacher_ids)
            .eq("role", "teacher")
            .eq("is_active", True)
            .execute()
            .data or []
        )
        active_ids = [t["id"] for t in active_teachers]
        if not active_ids:
            return None

        # 4. Pick least loaded teacher
        return min(active_ids, key=lambda tid: teacher_load.get(tid, 0))

    except Exception as e:
        logger.warning(f"Failed to find teacher via cycle for subject {subject_id}: {e}")
        return None


def _interleave_lesson_types(
    subject_id: str,
    subject_name: str,
    teacher_id: Optional[str],
    lecture_count: int,
    seminar_count: int,
    practical_count: int,
) -> List[Lesson]:
    """
    Distribute lesson types evenly using round-robin.
    
    Example: lecture=3, seminar=2, practical=1 →
        [lecture, seminar, practical, lecture, seminar, lecture]
    
    This ensures types alternate rather than cluster.
    """
    # Build pools by type
    pools: List[tuple] = []
    if lecture_count > 0:
        pools.append(("lecture", lecture_count))
    if seminar_count > 0:
        pools.append(("seminar", seminar_count))
    if practical_count > 0:
        pools.append(("practical", practical_count))

    if not pools:
        return []

    # Round-robin interleaving
    remaining = {lt: count for lt, count in pools}
    lessons: List[Lesson] = []
    type_order = [lt for lt, _ in pools]  # preserve original order

    while any(remaining.get(lt, 0) > 0 for lt in type_order):
        for lt in type_order:
            if remaining.get(lt, 0) > 0:
                lessons.append(Lesson(
                    subject_id=subject_id,
                    subject_name=subject_name,
                    lesson_type=lt,
                    teacher_id=teacher_id,
                ))
                remaining[lt] -= 1

    return lessons


import math


def build_lessons_from_curriculum(
    sb,
    direction_id: str,
    weeks: int = 12,
    lesson_duration_hours: float = 1.5,
) -> tuple[List[Lesson], list[dict]]:
    """
    Build lesson list from curriculum_plan for a direction.
    
    Reads curriculum_plan → converts hours to weekly lesson counts →
    resolves teachers via cycles → interleaves lesson types evenly.
    
    Args:
        sb: Supabase client
        direction_id: Direction ID to load curriculum for
        weeks: Number of study weeks (default 12)
        lesson_duration_hours: Duration of one lesson in hours (default 1.5)
    
    Returns:
        Tuple of (lessons list, details list for reporting)
    """
    # 1. Load curriculum plan for direction
    resp = (
        sb.table("curriculum_plan")
        .select("*, subjects(id,name,cycle_id)")
        .eq("direction_id", direction_id)
        .execute()
    )
    items = resp.data or []

    if not items:
        return [], []

    # 2. Track teacher load for balanced assignment
    teacher_load: Dict[str, int] = {}

    # Pre-load existing timetable teacher loads
    try:
        all_entries = (
            sb.table("timetable_entries")
            .select("teacher_id")
            .eq("active", True)
            .execute()
            .data or []
        )
        for entry in all_entries:
            tid = entry.get("teacher_id")
            if tid:
                teacher_load[tid] = teacher_load.get(tid, 0) + 1
    except Exception:
        pass

    # 3. Process each curriculum item
    all_lessons: List[Lesson] = []
    details: list[dict] = []

    for item in items:
        subject_data = item.get("subjects") or {}
        subject_id = item.get("subject_id", "")
        subject_name = subject_data.get("name") or "???"

        # Get hours
        lecture_hours = float(item.get("lecture_hours", 0) or 0)
        seminar_hours = float(item.get("seminar_hours", 0) or 0)
        practical_hours = float(item.get("practical_hours", 0) or 0)

        total_type_hours = lecture_hours + seminar_hours + practical_hours
        if total_type_hours <= 0:
            continue

        # Convert hours to WEEKLY lesson counts
        # Formula: lessons_per_week = hours / lesson_duration / weeks, rounded up
        lecture_per_week = math.ceil(lecture_hours / lesson_duration_hours / weeks) if lecture_hours > 0 else 0
        seminar_per_week = math.ceil(seminar_hours / lesson_duration_hours / weeks) if seminar_hours > 0 else 0
        practical_per_week = math.ceil(practical_hours / lesson_duration_hours / weeks) if practical_hours > 0 else 0

        # Ensure at least 1 lesson per week if hours are specified
        total_per_week = lecture_per_week + seminar_per_week + practical_per_week
        if total_per_week == 0 and total_type_hours > 0:
            # Distribute 1 lesson to the type with most hours
            if lecture_hours >= seminar_hours and lecture_hours >= practical_hours:
                lecture_per_week = 1
            elif seminar_hours >= practical_hours:
                seminar_per_week = 1
            else:
                practical_per_week = 1

        # Find teacher via cycle system
        teacher_id = _find_teacher_via_cycle(sb, subject_id, teacher_load)

        # Fallback: try teacher_subjects table
        if not teacher_id:
            try:
                ts_rows = (
                    sb.table("teacher_subjects")
                    .select("teacher_id")
                    .eq("subject_id", subject_id)
                    .limit(1)
                    .execute()
                    .data or []
                )
                if ts_rows:
                    teacher_id = ts_rows[0].get("teacher_id")
            except Exception:
                pass

        # Update teacher load tracking
        total_lessons = lecture_per_week + seminar_per_week + practical_per_week
        if teacher_id:
            teacher_load[teacher_id] = teacher_load.get(teacher_id, 0) + total_lessons

        # Build interleaved lesson list for this subject
        subject_lessons = _interleave_lesson_types(
            subject_id=subject_id,
            subject_name=subject_name,
            teacher_id=teacher_id,
            lecture_count=lecture_per_week,
            seminar_count=seminar_per_week,
            practical_count=practical_per_week,
        )

        all_lessons.extend(subject_lessons)

        details.append({
            "subject_id": subject_id,
            "subject_name": subject_name,
            "teacher_id": teacher_id,
            "lecture_hours": lecture_hours,
            "seminar_hours": seminar_hours,
            "practical_hours": practical_hours,
            "lecture_per_week": lecture_per_week,
            "seminar_per_week": seminar_per_week,
            "practical_per_week": practical_per_week,
            "total_lessons_per_week": total_lessons,
        })

    logger.info(
        f"Built {len(all_lessons)} weekly lessons from curriculum "
        f"(direction={direction_id}, {len(details)} subjects, {weeks} weeks)"
    )

    return all_lessons, details
