from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


@router.get("/teachers")
def list_teachers(user: dict = require_role("admin", "manager", "teacher", "student")):
    """Публичный список учителей (доступен всем авторизованным пользователям)"""
    sb = get_supabase()
    
    # Получаем только активных учителей с основной информацией
    resp = (
        sb.table("users")
        .select("id,username,full_name,photo_data_url,teacher_subject,phone,email")
        .eq("role", "teacher")
        .eq("is_active", True)
        .order("full_name")
        .execute()
    )
    
    teachers = resp.data or []
    
    return {"teachers": teachers}
