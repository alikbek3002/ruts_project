from __future__ import annotations

import logging

from fastapi import APIRouter

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/teachers")
def list_teachers(user: dict = require_role("admin", "manager", "teacher", "student")):
    """Публичный список учителей (доступен всем авторизованным пользователям)"""
    try:
        logger.info(f"[/api/users/teachers] Request from user: {user.get('id')} (role: {user.get('role')})")
        sb = get_supabase()
        
        # Получаем только активных учителей с основной информацией
        resp = (
            sb.table("users")
            .select("id,username,full_name,photo_data_url,teacher_subject,phone")
            .eq("role", "teacher")
            .eq("is_active", True)
            .order("full_name")
            .execute()
        )
        
        teachers = resp.data or []
        logger.info(f"[/api/users/teachers] Found {len(teachers)} teachers")
        
        # Логируем первого учителя для отладки (если есть)
        if teachers:
            sample = teachers[0]
            logger.info(f"[/api/users/teachers] Sample teacher: {sample.get('username')}, has photo: {bool(sample.get('photo_data_url'))}, has phone: {bool(sample.get('phone'))}")
        
        return {"teachers": teachers}
    except Exception as e:
        logger.error(f"[/api/users/teachers] Error: {str(e)}", exc_info=True)
        raise

