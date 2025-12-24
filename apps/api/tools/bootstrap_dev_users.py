from __future__ import annotations

import secrets
import sys
from pathlib import Path

# Allow running from repo root or anywhere
_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.core.provisioning import password_fingerprint
from app.core.security import hash_password
from app.core.settings import settings
from app.db.supabase_client import get_supabase


def _is_placeholder(value: str | None) -> bool:
    if not value:
        return True
    v = value.strip()
    return (
        v.startswith("https://YOUR_PROJECT")
        or v == "YOUR_SERVICE_ROLE_KEY"
        or v.startswith("YOUR_")
        or "xxxx" in v.lower()
    )


def ensure_user(
    *,
    role: str,
    username: str,
    full_name: str,
    password: str | None = None,
    must_change_password: bool = True,
) -> dict:
    sb = get_supabase()

    existing = sb.table("users").select("id,role,username,full_name").eq("username", username).execute().data
    if existing and isinstance(existing, list):
        return {"created": False, "user": existing[0], "password": None}

    pw = password or secrets.token_urlsafe(12)
    fp = password_fingerprint(pw)
    row = (
        sb.table("users")
        .insert(
            {
                "role": role,
                "username": username,
                "full_name": full_name,
                "password_hash": hash_password(pw),
                "password_fingerprint": fp,
                "must_change_password": must_change_password,
                "is_active": True,
            }
        )
        .execute()
        .data
    )
    user = row[0] if isinstance(row, list) and row else row
    return {"created": True, "user": user, "password": pw}


def main() -> None:
    # settings loads apps/api/.env automatically
    if _is_placeholder(settings.supabase_url) or _is_placeholder(settings.supabase_service_role_key):
        raise SystemExit(
            "Supabase env is not set. Fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env first."
        )

    created = []
    created.append(
        ensure_user(role="manager", username="Alikbek", full_name="Alikbek", password="alikbek", must_change_password=False)
    )
    created.append(ensure_user(role="admin", username="admin1", full_name="Admin 1"))
    created.append(ensure_user(role="teacher", username="teacher1", full_name="Teacher 1"))
    created.append(ensure_user(role="student", username="student1", full_name="Student 1"))

    print("\n=== DEV USERS ===")
    for item in created:
        u = item["user"]
        if item["created"]:
            print(f"{u['role']}: {u['username']}  password={item['password']}")
        else:
            print(f"{u['role']}: {u['username']}  (already exists)")

    print("\nNote: first login forces password change (must_change_password=true).")


if __name__ == "__main__":
    main()
