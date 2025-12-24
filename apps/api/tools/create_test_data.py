"""
Create test data (class, subject, direction) for testing
"""
from pathlib import Path
import sys

_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.db.supabase_client import get_supabase

def create_test_data():
    sb = get_supabase()
    
    # 1. Create direction
    print("Creating direction...")
    direction_data = {
        "name": "Информатика",
        "code": "IT"
    }
    
    existing_direction = sb.table("directions").select("id").eq("name", direction_data["name"]).execute().data
    if existing_direction:
        direction_id = existing_direction[0]["id"]
        print(f"  Direction already exists: {direction_id}")
    else:
        direction_result = sb.table("directions").insert(direction_data).execute()
        direction_id = direction_result.data[0]["id"]
        print(f"  Created direction: {direction_id}")
    
    # 2. Use existing subject
    print("Getting existing subject...")
    existing_subjects = sb.table("subjects").select("id, name").limit(1).execute().data
    if existing_subjects:
        subject_id = existing_subjects[0]["id"]
        print(f"  Using existing subject: {existing_subjects[0]['name']} ({subject_id})")
    else:
        print("  No subjects found, creating one...")
        subject_data = {"name": "Python Programming"}
        subject_result = sb.table("subjects").insert(subject_data).execute()
        subject_id = subject_result.data[0]["id"]
        print(f"  Created subject: {subject_id}")
    
    # 3. Create class
    print("Creating class...")
    class_data = {
        "name": "Test Class 1A",
        "direction_id": direction_id
    }
    
    existing_class = sb.table("classes").select("id").eq("name", class_data["name"]).execute().data
    if existing_class:
        class_id = existing_class[0]["id"]
        print(f"  Class already exists: {class_id}")
    else:
        class_result = sb.table("classes").insert(class_data).execute()
        class_id = class_result.data[0]["id"]
        print(f"  Created class: {class_id}")
    
    # 4. Link test_teacher to class (optional)
    print("Linking test_teacher to class...")
    test_teacher = sb.table("users").select("id").eq("username", "test_teacher").execute().data
    if test_teacher:
        teacher_id = test_teacher[0]["id"]
        
        # Update teacher's subject
        sb.table("users").update({"teacher_subject": subject_id}).eq("id", teacher_id).execute()
        print(f"  Updated test_teacher subject to {subject_id}")
        
        # Create timetable entry so teacher can see this class
        print("Creating timetable entry...")
        timetable_data = {
            "class_id": class_id,
            "teacher_id": teacher_id,
            "subject": "Test Subject",
            "subject_id": subject_id,
            "weekday": 1,  # Monday
            "start_time": "10:00:00",
            "end_time": "11:30:00",
            "room": "Room 101"
        }
        
        # Check if timetable entry exists
        existing_tt = sb.table("timetable_entries").select("id").eq("class_id", class_id).eq("teacher_id", teacher_id).execute().data
        if not existing_tt:
            sb.table("timetable_entries").insert(timetable_data).execute()
            print(f"  Created timetable entry for test_teacher")
        else:
            print(f"  Timetable entry already exists")
    
    print("\n✓ Test data created successfully!")
    print(f"  Direction ID: {direction_id}")
    print(f"  Subject ID: {subject_id}")
    print(f"  Class ID: {class_id}")

if __name__ == "__main__":
    create_test_data()
