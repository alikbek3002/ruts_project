import sys
import os
sys.path.append('apps/api')
from app.db.supabase_client import get_supabase

try:
    sb = get_supabase()
    print("Supabase client initialized")
    res = sb.table("timetable_entries").select("id").limit(1).execute()
    print("Test timetable_entries:", res.data)
except Exception as e:
    print("Error initializing:", e)

try:
    print("Testing not_.is_")
    res = sb.table("lesson_journal").select("id").not_.is_("grade", "null").execute()
    print("Ok", res.data)
except Exception as e:
    print("Error not_.is_:", type(e), e)

try:
    print("Testing cs on class_ids")
    res = sb.table("timetable_entries").select("id").cs("class_ids", ["65e243cc-8093-43e7-aa87-29965ce27046"]).execute()
    print("Ok", res.data)
except Exception as e:
    print("Error cs:", type(e), e)
