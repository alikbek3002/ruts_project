from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


@router.get("")
def list_directions(user: dict = require_role("admin", "manager")):
    """Список всех направлений"""
    sb = get_supabase()
    resp = sb.table("directions").select("*").order("name").execute()
    return {"directions": resp.data or []}
