import sys
import os

sys.path.append("/Users/alikbekmukanbetov/Desktop/ruts_project/apps/api")
from app.db.supabase_client import get_supabase

def check():
    sb = get_supabase()
    res = sb.table("lesson_journal").select("*").limit(1).execute()
    if res.data:
        print("Columns in lesson_journal:", list(res.data[0].keys()))
    else:
        print("No data in lesson_journal")

if __name__ == "__main__":
    check()
