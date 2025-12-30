"""
Test script for auto-scheduling system.
Run this to verify the auto-scheduler works correctly.
"""

import sys
from datetime import time

# Add parent directory to path
sys.path.insert(0, '/Users/chyngyz/Desktop/ruts_project/apps/api')

from app.modules.timetable.auto_scheduler import (
    AutoScheduler,
    ScheduleConstraints,
    Lesson,
    TimeSlot,
    calculate_schedule_quality
)


def test_basic_scheduling():
    """Test basic schedule generation with simple lessons."""
    print("=" * 60)
    print("TEST 1: Basic scheduling (2 subjects, 1 theory + 1 practice each)")
    print("=" * 60)
    
    # Setup
    constraints = ScheduleConstraints(
        max_lessons_per_day=4,
        min_lessons_per_day=2,
        allow_gaps=False,
        working_days=[0, 1, 2, 3, 4],  # Mon-Fri
        earliest_start=time(9, 0),
        latest_end=time(18, 0),
        lesson_duration_minutes=90,
        break_duration_minutes=15
    )
    
    lessons = [
        # Math
        Lesson("math-1", "Математика", "theoretical", "teacher-1"),
        Lesson("math-1", "Математика", "practical", "teacher-1"),
        # Physics
        Lesson("phys-1", "Физика", "theoretical", "teacher-2"),
        Lesson("phys-1", "Физика", "practical", "teacher-2"),
    ]
    
    # Generate
    scheduler = AutoScheduler(constraints)
    try:
        scheduled = scheduler.generate_schedule("class-1", lessons)
        
        print(f"\n✅ Successfully scheduled {len(scheduled)}/{len(lessons)} lessons\n")
        
        # Print schedule
        weekday_names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
        for s in sorted(scheduled, key=lambda x: (x.time_slot.weekday, x.time_slot.start_time)):
            print(f"  {weekday_names[s.time_slot.weekday]} {s.time_slot.start_time.strftime('%H:%M')}-{s.time_slot.end_time.strftime('%H:%M')}: "
                  f"{s.lesson.subject_name} ({s.lesson.lesson_type})")
        
        # Quality metrics
        quality = calculate_schedule_quality(scheduled, constraints)
        print(f"\n📊 Quality metrics:")
        print(f"  Balance: {quality['balance_score']:.2f}")
        print(f"  Gaps: {quality['gap_score']:.2f}")
        print(f"  Load: {quality['load_score']:.2f}")
        print(f"  Overall: {quality['overall']:.2f}")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        return False


def test_theory_before_practice():
    """Test that theory must come before practice."""
    print("\n" + "=" * 60)
    print("TEST 2: Theory before practice rule")
    print("=" * 60)
    
    constraints = ScheduleConstraints(allow_gaps=False)
    
    # Try to schedule practice without theory (should succeed because algorithm handles it)
    lessons = [
        Lesson("subj-1", "Предмет А", "practical", "teacher-1"),  # Practice first
        Lesson("subj-1", "Предмет А", "theoretical", "teacher-1"),  # Theory
    ]
    
    scheduler = AutoScheduler(constraints)
    try:
        scheduled = scheduler.generate_schedule("class-1", lessons)
        
        # Check that theory comes before practice
        theory_slot = None
        practice_slot = None
        for s in scheduled:
            if s.lesson.lesson_type == "theoretical":
                theory_slot = s.time_slot
            elif s.lesson.lesson_type == "practical":
                practice_slot = s.time_slot
        
        if theory_slot and practice_slot:
            theory_time = (theory_slot.weekday, theory_slot.start_time)
            practice_time = (practice_slot.weekday, practice_slot.start_time)
            
            if theory_time < practice_time:
                print("\n✅ Theory correctly scheduled before practice")
                print(f"  Theory: {['Пн','Вт','Ср','Чт','Пт'][theory_slot.weekday]} {theory_slot.start_time}")
                print(f"  Practice: {['Пн','Вт','Ср','Чт','Пт'][practice_slot.weekday]} {practice_slot.start_time}")
                return True
            else:
                print("\n❌ Practice scheduled before theory!")
                return False
        else:
            print("\n⚠️  Could not find both theory and practice")
            return False
            
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        return False


def test_no_conflicts():
    """Test that no conflicts occur (teacher/room/class)."""
    print("\n" + "=" * 60)
    print("TEST 3: No conflicts (same teacher, different subjects)")
    print("=" * 60)
    
    constraints = ScheduleConstraints(allow_gaps=False)
    
    # Same teacher for two subjects
    lessons = [
        Lesson("math-1", "Математика", "theoretical", "teacher-1"),
        Lesson("phys-1", "Физика", "theoretical", "teacher-1"),  # Same teacher
        Lesson("chem-1", "Химия", "theoretical", "teacher-1"),    # Same teacher
    ]
    
    scheduler = AutoScheduler(constraints)
    try:
        scheduled = scheduler.generate_schedule("class-1", lessons)
        
        # Check no overlaps for teacher
        teacher_slots = {}
        for s in scheduled:
            tid = s.lesson.teacher_id
            if tid not in teacher_slots:
                teacher_slots[tid] = []
            teacher_slots[tid].append(s.time_slot)
        
        # Check overlaps
        has_overlap = False
        for tid, slots in teacher_slots.items():
            for i, slot1 in enumerate(slots):
                for slot2 in slots[i+1:]:
                    if slot1.overlaps(slot2):
                        has_overlap = True
                        print(f"\n❌ Overlap found for teacher {tid}")
                        print(f"  Slot 1: {slot1.weekday} {slot1.start_time}-{slot1.end_time}")
                        print(f"  Slot 2: {slot2.weekday} {slot2.start_time}-{slot2.end_time}")
        
        if not has_overlap:
            print(f"\n✅ No conflicts found! {len(scheduled)} lessons scheduled correctly")
            for s in scheduled:
                print(f"  {['Пн','Вт','Ср','Чт','Пт'][s.time_slot.weekday]} {s.time_slot.start_time.strftime('%H:%M')}: {s.lesson.subject_name}")
            return True
        else:
            return False
            
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        return False


def test_no_gaps():
    """Test that no gaps exist in schedule when allow_gaps=False."""
    print("\n" + "=" * 60)
    print("TEST 4: No gaps in schedule")
    print("=" * 60)
    
    constraints = ScheduleConstraints(
        allow_gaps=False,
        max_lessons_per_day=3
    )
    
    lessons = [
        Lesson("subj-1", "Предмет 1", "theoretical", "teacher-1"),
        Lesson("subj-2", "Предмет 2", "theoretical", "teacher-2"),
        Lesson("subj-3", "Предмет 3", "theoretical", "teacher-3"),
    ]
    
    scheduler = AutoScheduler(constraints)
    try:
        scheduled = scheduler.generate_schedule("class-1", lessons)
        
        # Group by day
        by_day = {}
        for s in scheduled:
            day = s.time_slot.weekday
            if day not in by_day:
                by_day[day] = []
            by_day[day].append(s)
        
        # Check gaps for each day
        has_gap = False
        for day, lessons_list in by_day.items():
            sorted_lessons = sorted(lessons_list, key=lambda l: l.time_slot.start_time)
            
            for i in range(len(sorted_lessons) - 1):
                current_end = sorted_lessons[i].time_slot.end_time
                next_start = sorted_lessons[i+1].time_slot.start_time
                
                # Calculate gap (in minutes)
                gap_minutes = (next_start.hour * 60 + next_start.minute) - (current_end.hour * 60 + current_end.minute)
                
                if gap_minutes > constraints.break_duration_minutes:
                    has_gap = True
                    print(f"\n⚠️  Gap found on day {day}")
                    print(f"  Between {current_end.strftime('%H:%M')} and {next_start.strftime('%H:%M')} (gap: {gap_minutes} min)")
        
        if not has_gap:
            print(f"\n✅ No gaps! All lessons are consecutive")
            quality = calculate_schedule_quality(scheduled, constraints)
            print(f"  Gap score: {quality['gap_score']:.2f}")
            return True
        else:
            print("\n❌ Gaps found in schedule")
            return False
            
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        return False


def test_realistic_scenario():
    """Test realistic 3-month program scenario."""
    print("\n" + "=" * 60)
    print("TEST 5: Realistic 3-month program (6 subjects)")
    print("=" * 60)
    
    constraints = ScheduleConstraints(
        max_lessons_per_day=4,
        min_lessons_per_day=3,
        allow_gaps=False
    )
    
    # 6 subjects, each with theory + practice
    subjects = [
        ("math", "Математика", "teacher-1"),
        ("phys", "Физика", "teacher-2"),
        ("chem", "Химия", "teacher-3"),
        ("prog", "Программирование", "teacher-4"),
        ("eng", "Английский", "teacher-5"),
        ("hist", "История", "teacher-6"),
    ]
    
    lessons = []
    for subj_id, subj_name, teacher in subjects:
        lessons.append(Lesson(subj_id, subj_name, "theoretical", teacher))
        lessons.append(Lesson(subj_id, subj_name, "practical", teacher))
    
    print(f"\nTotal lessons to schedule: {len(lessons)}")
    
    scheduler = AutoScheduler(constraints)
    try:
        scheduled = scheduler.generate_schedule("class-1", lessons)
        
        print(f"\n✅ Scheduled {len(scheduled)}/{len(lessons)} lessons")
        
        # Quality
        quality = calculate_schedule_quality(scheduled, constraints)
        print(f"\n📊 Quality metrics:")
        print(f"  Overall: {quality['overall']:.2f} {'✅' if quality['overall'] > 0.85 else '⚠️'}")
        print(f"  Balance: {quality['balance_score']:.2f}")
        print(f"  Gaps: {quality['gap_score']:.2f}")
        print(f"  Load: {quality['load_score']:.2f}")
        
        # Distribution by day
        by_day = {}
        for s in scheduled:
            day = s.time_slot.weekday
            by_day[day] = by_day.get(day, 0) + 1
        
        print(f"\n📅 Distribution by day:")
        for day in sorted(by_day.keys()):
            print(f"  {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][day]}: {by_day[day]} lessons")
        
        return quality['overall'] > 0.7
        
    except Exception as e:
        print(f"\n❌ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\n🧪 AUTO-SCHEDULER TEST SUITE\n")
    
    results = []
    
    # Run tests
    results.append(("Basic scheduling", test_basic_scheduling()))
    results.append(("Theory before practice", test_theory_before_practice()))
    results.append(("No conflicts", test_no_conflicts()))
    results.append(("No gaps", test_no_gaps()))
    results.append(("Realistic scenario", test_realistic_scenario()))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Auto-scheduler is working correctly.")
        sys.exit(0)
    else:
        print("\n⚠️  Some tests failed. Please review the output above.")
        sys.exit(1)
