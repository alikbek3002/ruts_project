from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/teachers")
def list_teachers(user: dict = require_role("admin", "manager", "teacher", "student")):
    """Публичный список учителей (доступен всем авторизованным пользователям)"""
    logger.info(f"[/api/users/teachers] START - Request from user: {user.get('id')} (role: {user.get('role')})")
    
    try:
        sb = get_supabase()
        logger.info("[/api/users/teachers] Got supabase client")
        
        # Сначала пробуем только базовые поля
        resp = (
            sb.table("users")
            .select("id,username,full_name")
            .eq("role", "teacher")
            .eq("is_active", True)
            .is_("archived_at", "null")
            .order("full_name")
            .execute()
        )
        
        teachers = resp.data or []
        logger.info(f"[/api/users/teachers] Base query SUCCESS - Found {len(teachers)} teachers")
        
        # Теперь пробуем добавить дополнительные поля по одному
        if teachers:
            try:
                resp_full = (
                    sb.table("users")
                    .select("id,username,full_name,photo_data_url,teacher_subject,phone")
                    .eq("role", "teacher")
                    .eq("is_active", True)
                    .is_("archived_at", "null")
                    .order("full_name")
                    .execute()
                )
                teachers = resp_full.data or teachers
                logger.info(f"[/api/users/teachers] Full query SUCCESS with extra fields")
            except Exception as e2:
                logger.warning(f"[/api/users/teachers] Extra fields failed: {str(e2)}")
        
        return {"teachers": teachers}
        
    except Exception as e:
        logger.error(f"[/api/users/teachers] ERROR: {str(e)}", exc_info=True)
        # Возвращаем детальную ошибку
        return {"teachers": [], "error": str(e)}

