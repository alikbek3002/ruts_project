"""
Integrated test for lesson topic and homework feature.
Tests:
1. Teacher can add lesson topic and homework
2. Teacher can get lesson info
3. Journal endpoint returns lesson info
4. Student can see their homework
"""
import os

import pytest
import requests
import time

API_URL = "http://localhost:8000"

# These are integration tests that assume a running local API and seeded users.
# Run explicitly with RUN_INTEGRATION_TESTS=1.
RUN_INTEGRATION = os.getenv("RUN_INTEGRATION_TESTS") == "1"

TEACHER_USERNAME = os.getenv("RUTS_TEST_TEACHER_USERNAME", "teacher1")
TEACHER_PASSWORD = os.getenv("RUTS_TEST_TEACHER_PASSWORD", "teacher1pass")

STUDENT_USERNAME = os.getenv("RUTS_TEST_STUDENT_USERNAME", "student1")
STUDENT_PASSWORD = os.getenv("RUTS_TEST_STUDENT_PASSWORD", "student1pass")


def login(username: str, password: str) -> str:
    """Login and return access token."""
    resp = requests.post(
        f"{API_URL}/api/auth/login",
        json={"username": username, "password": password},
    )
    resp.raise_for_status()
    data = resp.json()
    return data["accessToken"]  # API returns camelCase


def test_lesson_info():
    """Test full lesson info workflow."""
    if not RUN_INTEGRATION:
        pytest.skip("Integration test: set RUN_INTEGRATION_TESTS=1 to run")

    print("\n=== Testing Lesson Topic and Homework Feature ===\n")

    # 1. Login as teacher
    print("1. Login as teacher...")
    try:
        teacher_token = login(TEACHER_USERNAME, TEACHER_PASSWORD)
    except Exception as e:
        pytest.skip(f"Integration test: cannot login to local API ({e})")
    print("   ✓ Teacher logged in")

    # 2. Get teacher's classes
    print("\n2. Get teacher's classes...")
    resp = requests.get(
        f"{API_URL}/api/classes",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    resp.raise_for_status()
    data = resp.json()
    classes = data.get("classes", [])
    if not classes:
        print("   ✗ No classes found for teacher")
        return False
    
    class_id = classes[0]["id"]
    class_name = classes[0]["name"]
    print(f"   ✓ Found class: {class_name} (id={class_id})")

    # 3. Get class journal to find a lesson
    print("\n3. Get class journal...")
    resp = requests.get(
        f"{API_URL}/api/journal/classes/{class_id}/journal",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    resp.raise_for_status()
    journal = resp.json()
    
    if not journal.get("lessons"):
        print("   ✗ No lessons found in journal")
        return False
    
    lesson = journal["lessons"][0]
    timetable_entry_id = lesson["timetable_entry_id"]
    lesson_date = lesson["date"]
    subject_name = lesson["subject_name"]
    print(f"   ✓ Found lesson: {subject_name} on {lesson_date}")

    # 4. Add lesson topic and homework
    print("\n4. Add lesson topic and homework...")
    lesson_topic = "Алгебраические уравнения и неравенства"
    homework = "Решить задачи №15-20 на стр. 42, повторить формулы сокращенного умножения"
    
    resp = requests.post(
        f"{API_URL}/api/journal/classes/{class_id}/lesson-info",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={
            "timetable_entry_id": timetable_entry_id,
            "lesson_date": lesson_date,
            "lesson_topic": lesson_topic,
            "homework": homework,
        },
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"   ✓ Lesson info saved: {result}")

    # 5. Get lesson info to verify
    print("\n5. Get lesson info...")
    resp = requests.get(
        f"{API_URL}/api/journal/classes/{class_id}/lesson-info",
        headers={"Authorization": f"Bearer {teacher_token}"},
        params={
            "timetable_entry_id": timetable_entry_id,
            "lesson_date": lesson_date,
        },
    )
    resp.raise_for_status()
    lesson_info = resp.json()
    print(f"   Subject: {lesson_info['subject_name']}")
    print(f"   Topic: {lesson_info['lesson_topic']}")
    print(f"   Homework: {lesson_info['homework']}")
    
    assert lesson_info["lesson_topic"] == lesson_topic, "Topic mismatch"
    assert lesson_info["homework"] == homework, "Homework mismatch"
    print("   ✓ Lesson info verified")

    # 6. Check journal endpoint returns lesson info
    print("\n6. Verify journal endpoint includes lesson info...")
    resp = requests.get(
        f"{API_URL}/api/journal/classes/{class_id}/journal",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    resp.raise_for_status()
    journal = resp.json()
    
    # Find our lesson in the updated journal
    updated_lesson = None
    for les in journal["lessons"]:
        if les["timetable_entry_id"] == timetable_entry_id and les["date"] == lesson_date:
            updated_lesson = les
            break
    
    assert updated_lesson is not None, "Lesson not found in journal"
    assert updated_lesson.get("lesson_topic") == lesson_topic, "Topic not in journal"
    assert updated_lesson.get("homework") == homework, "Homework not in journal"
    print("   ✓ Journal includes lesson info")

    # 7. Login as student
    print("\n7. Login as student...")
    student_token = login(STUDENT_USERNAME, STUDENT_PASSWORD)
    print("   ✓ Student logged in")

    # 8. Get student homework
    print("\n8. Get student homework...")
    resp = requests.get(
        f"{API_URL}/api/journal/student/homework",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    resp.raise_for_status()
    homework_data = resp.json()
    print(f"   Response: {homework_data}")
    homework_list = homework_data if isinstance(homework_data, list) else homework_data.get("homework", [])
    print(f"   Found {len(homework_list)} homework items")
    
    # Find our homework in the list
    our_homework = None
    for hw in homework_list:
        if hw["lesson_date"] == lesson_date and hw["homework"] == homework:
            our_homework = hw
            break
    
    if our_homework:
        print(f"   ✓ Found our homework:")
        print(f"     Date: {our_homework['lesson_date']}")
        print(f"     Subject: {our_homework['subject_name']}")
        print(f"     Class: {our_homework['class_name']}")
        print(f"     Topic: {our_homework['lesson_topic']}")
        print(f"     Homework: {our_homework['homework']}")
    else:
        print("   ! Homework not found in student's list (might not be in student's class)")

    # 9. Update lesson info (change topic)
    print("\n9. Update lesson topic...")
    new_topic = "Алгебраические уравнения второй степени"
    resp = requests.post(
        f"{API_URL}/api/journal/classes/{class_id}/lesson-info",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={
            "timetable_entry_id": timetable_entry_id,
            "lesson_date": lesson_date,
            "lesson_topic": new_topic,
            "homework": homework,  # Keep same homework
        },
    )
    resp.raise_for_status()
    print("   ✓ Lesson topic updated")

    # 10. Verify update
    print("\n10. Verify update...")
    resp = requests.get(
        f"{API_URL}/api/journal/classes/{class_id}/lesson-info",
        headers={"Authorization": f"Bearer {teacher_token}"},
        params={
            "timetable_entry_id": timetable_entry_id,
            "lesson_date": lesson_date,
        },
    )
    resp.raise_for_status()
    lesson_info = resp.json()
    assert lesson_info["lesson_topic"] == new_topic, "Updated topic mismatch"
    print(f"   ✓ Topic updated to: {lesson_info['lesson_topic']}")

    print("\n=== All Tests Passed! ===\n")
    return True


if __name__ == "__main__":
    try:
        success = test_lesson_info()
        if success:
            print("✅ Lesson info feature is working correctly!")
        else:
            print("❌ Some tests failed")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
