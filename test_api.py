import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'apps', 'api'))

from fastapi.testclient import TestClient
from app.main import app
from app.core.deps import get_current_user, require_role

# Mock user
def mock_get_current_user():
    return {"id": "test_teacher_id", "role": "teacher"}

def mock_require_role(*roles):
    def dependency():
        return {"id": "test_teacher_id", "role": "teacher"}
    return dependency

app.dependency_overrides[get_current_user] = mock_get_current_user
# We need to override require_role calls. Actually it's a function returning a dependency:
import app.modules.gradebook.router as gb_router
gb_router.require_role = mock_require_role

# Reload the router in app? It's already included, the dependencies are baked in.
# It's better to just pass a mock JWT if we can't override easily, or we can just call the router functions directly!

from app.modules.gradebook.router import class_journal_by_subject, class_journal_by_dates, export_grades_excel, _lesson_journal_supported

class_id = "65e243cc-8093-43e7-aa87-29965ce27046"
user = {"id": "test_teacher_id", "role": "teacher"}

try:
    print("Testing class_journal_by_dates")
    res1 = class_journal_by_dates(class_id, user)
    print("OK", list(res1.keys()))
except Exception as e:
    import traceback
    traceback.print_exc()

try:
    print("\nTesting class_journal_by_subject")
    res2 = class_journal_by_subject(class_id, user)
    print("OK", list(res2.keys()))
except Exception as e:
    import traceback
    traceback.print_exc()

try:
    print("\nTesting export_grades_excel")
    res3 = export_grades_excel(class_id, user)
    print("OK export")
except Exception as e:
    import traceback
    traceback.print_exc()

