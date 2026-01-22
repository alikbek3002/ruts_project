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
        logger.info(f"[/api/users/teachers] SUCCESS - Found {len(teachers)} teachers")
        
        return {"teachers": teachers}
        
    except Exception as e:
        logger.error(f"[/api/users/teachers] ERROR: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

