"""
Create test user with known password
"""
from pathlib import Path
import sys

_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.core.provisioning import password_fingerprint
from app.core.security import hash_password
from app.db.supabase_client import get_supabase

def create_test_user():
    sb = get_supabase()
    
    username = "test_teacher"
    password = "test123"
    
    # Check if exists
    existing = sb.table("users").select("id").eq("username", username).execute().data
    if existing:
        print(f"User '{username}' already exists")
        # Update password
        pw_hash = hash_password(password)
        pw_fp = password_fingerprint(password)
        sb.table("users").update({
            "password_hash": pw_hash,
            "password_fingerprint": pw_fp,
            "must_change_password": False
        }).eq("username", username).execute()
        print(f"Password updated for '{username}'")
    else:
        # Create new
        pw_hash = hash_password(password)
        pw_fp = password_fingerprint(password)
        sb.table("users").insert({
            "role": "teacher",
            "username": username,
            "full_name": "Test Teacher",
            "password_hash": pw_hash,
            "password_fingerprint": pw_fp,
            "must_change_password": False,
            "is_active": True
        }).execute()
        print(f"User '{username}' created")
    
    print(f"\nCredentials:")
    print(f"  Username: {username}")
    print(f"  Password: {password}")

if __name__ == "__main__":
    create_test_user()
