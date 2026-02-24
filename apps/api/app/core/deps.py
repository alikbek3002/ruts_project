from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from jose import JWTError, jwt

from app.core.settings import settings
from app.core.cache import cache
from app.db.supabase_client import get_supabase


def _get_bearer_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization")
    if not auth:
        return None
    if not auth.lower().startswith("bearer "):
        return None
    return auth.split(" ", 1)[1].strip()


def get_current_user(request: Request) -> dict:
    token = _get_bearer_token(request)
    if not token:
        # Check query param (for file downloads)
        token = request.query_params.get("token")
    
    if not token:
        raise HTTPException(status_code=401, detail="Отсутствует токен доступа")

    try:
        payload = jwt.decode(token, settings.app_jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Неверный токен")
        
        # Validate UUID format (36 chars with dashes)
        if not (len(user_id) == 36 and user_id.count("-") == 4):
            raise HTTPException(status_code=401, detail="Неверный формат токена - пожалуйста, войдите снова")
    except JWTError:
        raise HTTPException(status_code=401, detail="Неверный токен")

    # Check cache first (avoids DB hit on every API call)
    cache_key = f"auth_user:{user_id}"
    cached_user = cache.get(cache_key)
    if cached_user is not None:
        return cached_user

    sb = get_supabase()
    resp = sb.table("users").select("*").eq("id", user_id).limit(1).execute()
    rows = resp.data or []
    user = rows[0] if isinstance(rows, list) and rows else None
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Пользователь отключен")
    
    cache.set(cache_key, user, ttl=30)
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    """
    Returns Depends() that checks user role.
    Usage: user: dict = require_role("admin", "teacher")
    Note: Do NOT use with CurrentUser annotation, just use `dict` type hint.
    """
    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Доступ запрещен")
        return user

    return Depends(_dep)


def get_refresh_cookie(refresh_token: Annotated[str | None, Cookie(alias="refresh_token")] = None) -> str | None:
    return refresh_token
