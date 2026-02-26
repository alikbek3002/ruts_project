import sys
import os

# Add the 'apps/api' directory to the path so we can import 'app'
sys.path.append(os.path.join(os.getcwd(), 'apps', 'api'))

try:
    from app.db.supabase_client import get_supabase
    sb = get_supabase()
    print("Supabase client initialized")
except Exception as e:
    print("Init error:", e)
    sys.exit(1)

class_id = "65e243cc-8093-43e7-aa87-29965ce27046"

print("\n--- Testing get_class ---")
try:
    c = sb.table("classes").select("id,name,direction_id,curator_id").eq("id", class_id).single().execute().data
    print("Class:", c)
except Exception as e:
    print("get_class error:", type(e).__name__, e)

print("\n--- Testing class_enrollments (legacy_student_id) ---")
try:
    enr_rows = (
        sb.table("class_enrollments")
        .select("id,student_full_name,student_number,legacy_student_id")
        .eq("class_id", class_id)
        .execute()
        .data
    )
    print("Enrollments:", len(enr_rows) if enr_rows else 0)
except Exception as e:
    print("class_enrollments error:", type(e).__name__, e)

print("\n--- Testing timetable entries cs ---")
try:
    timetable = (
        sb.table("timetable_entries")
        .select("id,subject,teacher_id")
        .cs("class_ids", [class_id])
        .execute()
        .data
    )
    print("Timetable entries:", len(timetable) if timetable else 0)
except Exception as e:
    print("timetable_entries cs error:", type(e).__name__, e)

print("\n--- Testing lesson journal query ---")
try:
    journal_records = (
        sb.table("lesson_journal")
        .select("timetable_entry_id,lesson_date,student_id,grade")
        .limit(1)
        .not_.is_("grade", "null")
        .execute()
        .data
    )
    print("Journal records:", journal_records)
except Exception as e:
    print("lesson_journal error:", type(e).__name__, e)
