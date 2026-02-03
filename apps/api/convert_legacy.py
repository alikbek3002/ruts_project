
import os
import sys
from datetime import date, timedelta, datetime
import asyncio

# Ensure strict boolean for dry_run
DRY_RUN = False

# Add current directory to path so we can import app
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from app.db.supabase_client import get_supabase
except ImportError:
    # Try adding local path if running from apps/api
    sys.path.append(os.path.join(os.getcwd()))
    from app.db.supabase_client import get_supabase

def migrate():
    print(f"Starting migration (DRY_RUN={DRY_RUN})...")
    sb = get_supabase()

    # 1. Fetch recurring entries
    print("Fetching legacy entries...")
    entries = sb.table("timetable_entries").select("*").eq("active", True).is_("lesson_date", "null").execute().data or []
    print(f"Found {len(entries)} legacy entries.")
    
    if not entries:
        print("Nothing to migrate.")
        return

    # 2. Fetch streams
    streams = sb.table("streams").select("*").eq("status", "active").execute().data or []
    s_map = {s["id"]: s for s in streams}
    print(f"Loaded {len(streams)} active streams.")

    today = date.today()
    # Range: Today to +4 months (end of semester roughly)
    default_end = today + timedelta(days=120)

    new_entries = []
    to_deactivate = []

    for e in entries:
        s_id = e.get("stream_id")
        start_d = today
        end_d = default_end

        if s_id and s_id in s_map:
            s = s_map[s_id]
            if s.get("end_date"):
                s_end = date.fromisoformat(s["end_date"])
                if s_end < today:
                    print(f"Skipping entry {e['id']} (stream ended {s_end})")
                    # Optionally deactivate old valid entries? 
                    # Let's deactivate them so they don't clutter (since they are old)
                    # But maybe they are needed for history?
                    # If we don't convert them, they remain recurring.
                    # Let's leave them alone or deactivate? User complained about "delete everywhere".
                    # If we deactivate, history is lost/hidden.
                    # Let's SKIP strictly.
                    continue
                end_d = s_end
            if s.get("start_date"):
                 s_start = date.fromisoformat(s["start_date"])
                 if s_start > start_d:
                     start_d = s_start
        
        # Generate
        curr = start_d
        wd = int(e["weekday"]) if e.get("weekday") is not None else 0
        
        # Adjust curr to match weekday
        days_ahead = (wd - curr.weekday() + 7) % 7
        curr += timedelta(days=days_ahead)
        
        entry_generated_count = 0
        while curr <= end_d:
            ne = e.copy()
            ne.pop("id", None)
            ne.pop("created_at", None)
            ne.pop("updated_at", None)
            ne.pop("duration_minutes", None)
            ne["lesson_date"] = curr.isoformat()
            ne["active"] = True
            new_entries.append(ne)
            curr += timedelta(days=7)
            entry_generated_count += 1
            
        if entry_generated_count > 0:
            to_deactivate.append(e["id"])

    print(f"Generated {len(new_entries)} specific lessons.")
    print(f"Will deactivate {len(to_deactivate)} recurring templates.")

    if not DRY_RUN:
        # Insert new
        batch_size = 50
        for i in range(0, len(new_entries), batch_size):
            chunk = new_entries[i:i+batch_size]
            if chunk:
                sb.table("timetable_entries").insert(chunk).execute()
                print(f"Inserted batch {i}...")
        
        # Deactivate old
        if to_deactivate:
            for i in range(0, len(to_deactivate), batch_size):
                chunk = to_deactivate[i:i+batch_size]
                sb.table("timetable_entries").update({"active": False}).in_("id", chunk).execute()
                print(f"Deactivated batch {i}...")
        print("Migration committed.")
    else:
        print("Dry run completed. No changes made.")

if __name__ == "__main__":
    migrate()
