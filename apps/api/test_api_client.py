import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'apps', 'api'))

from fastapi.testclient import TestClient
from app.main import app
from app.core.deps import get_current_user

class_id = "65e243cc-8093-43e7-aa87-29965ce27046"

app.dependency_overrides[get_current_user] = lambda: {"id": "test_admin", "role": "admin"}

client = TestClient(app)
headers = {}

print("Testing by-subject")
try:
    res = client.get(f"/api/gradebook/classes/{class_id}/journal/by-subject", headers=headers)
    print("Status by-subject:", res.status_code)
    if res.status_code != 200:
        print("Response:", res.text)
except Exception as e:
    import traceback
    traceback.print_exc()

print("\nTesting export_grades_excel")
try:
    res = client.get(f"/api/gradebook/classes/{class_id}/journal/export/grades", headers=headers)
    print("Status export grades:", res.status_code)
    if res.status_code != 200:
        print("Response:", res.text)
except Exception as e:
    import traceback
    traceback.print_exc()

print("\nTesting get_class")
try:
    res2 = client.get(f"/api/classes/{class_id}", headers=headers)
    print("Status get_class:", res2.status_code)
    if res2.status_code != 200:
        print("Response:", res2.text)
except Exception as e:
    import traceback
    traceback.print_exc()
