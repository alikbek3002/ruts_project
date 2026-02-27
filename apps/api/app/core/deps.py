from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from jose import JWTError, jwt

from app.core.cache import cache
from app.core.settings import settings
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
        raise HTTPException(status_code=401, detail="Missing access token")

    try:
        payload = jwt.decode(token, settings.app_jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        if not (len(user_id) == 36 and user_id.count("-") == 4):
            raise HTTPException(status_code=401, detail="Invalid token format")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    cache_key = f"auth_user:{user_id}"
    cached_user = cache.get(cache_key)
    if cached_user is not None:
        return cached_user

    sb = get_supabase()
    resp = (
        sb.table("users")
        .select(
            "id,role,username,full_name,first_name,last_name,middle_name,phone,birth_date,"
            "photo_data_url,teacher_subject,must_change_password,is_active"
        )
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    user = rows[0] if isinstance(rows, list) and rows else None
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User is disabled")

    cache.set(cache_key, user, ttl=30)
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Access denied")
        return user

    return Depends(_dep)


def get_refresh_cookie(refresh_token: Annotated[str | None, Cookie(alias="refresh_token")] = None) -> str | None:
    return refresh_token
