import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'apps', 'api'))

from fastapi.testclient import TestClient
from app.main import app
from app.core._deps_module import get_current_user # Wait, how to override dependency?
# TestClient can override dependencies!

def get_current_user_override():
    return {"id": "test_teacher_id", "role": "teacher"}

def require_role_override(*roles):
    def dep():
        return {"id": "test_teacher_id", "role": "teacher"}
    return dep

from app.core.deps import get_current_user
app.dependency_overrides[get_current_user] = get_current_user_override

# Wait, `require_role` is a factory, so we must mock the actual instances
for route in app.routes:
    # Just skip auth/JWT token by overriding the dependency for 'require_role("teacher", "admin", "manager")'
    pass

import requests

class_id = "65e243cc-8093-43e7-aa87-29965ce27046"
print("Local test via HTTP is hard without setting up JWT. Let's just create a quick test token.")
from app.core.security import create_access_token
token = create_access_token({"sub": "test", "account_type": "teacher", "id": "test_teacher_id"})

client = TestClient(app)
headers = {"Authorization": f"Bearer {token}"}

res = client.get(f"/api/gradebook/classes/{class_id}/journal/by-subject", headers=headers)
print("Status by-subject:", res.status_code)
if res.status_code != 200:
    print(res.text)

res2 = client.get(f"/api/classes/{class_id}", headers=headers)
print("Status get_class:", res2.status_code)
if res2.status_code != 200:
    print(res2.text)

