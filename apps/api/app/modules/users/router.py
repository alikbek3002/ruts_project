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
    try:
        logger.info(f"[/api/users/teachers] Request from user: {user.get('id')} (role: {user.get('role')})")
        sb = get_supabase()
        
        # Сначала получаем только базовые поля (которые точно существуют)
        resp = (
            sb.table("users")
            .select("id,username,full_name")
            .eq("role", "teacher")
            .eq("is_active", True)
            .order("full_name")
            .execute()
        )
        
        base_teachers = resp.data or []
        logger.info(f"[/api/users/teachers] Found {len(base_teachers)} teachers (base query)")
        
        # Теперь попробуем получить дополнительные поля
        try:
            resp_full = (
                sb.table("users")
                .select("id,username,full_name,photo_data_url,teacher_subject,phone")
                .eq("role", "teacher")
                .eq("is_active", True)
                .order("full_name")
                .execute()
            )
            teachers = resp_full.data or []
            logger.info(f"[/api/users/teachers] Full query successful, {len(teachers)} teachers")
        except Exception as e2:
            logger.warning(f"[/api/users/teachers] Full query failed, using base: {str(e2)}")
            # Если дополнительные поля не существуют, используем базовые
            teachers = base_teachers
        
        return {"teachers": teachers}
    except Exception as e:
        logger.error(f"[/api/users/teachers] Error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

