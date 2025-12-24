from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.core.deps import CurrentUser, get_refresh_cookie
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    verify_password,
)
from app.core.settings import settings
from app.db.supabase_client import get_supabase

router = APIRouter()


class LoginIn(BaseModel):
    username: str
    password: str


class LoginOut(BaseModel):
    accessToken: str
    user: dict


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, response: Response):
    sb = get_supabase()
    username = (payload.username or "").strip()
    resp = sb.table("users").select("*").ilike("username", username).limit(1).execute()
    rows = resp.data or []
    user = rows[0] if isinstance(rows, list) and rows else None
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access = create_access_token(subject=user["id"], role=user["role"])

    refresh = create_refresh_token()
    refresh_hash = hash_refresh_token(refresh)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(days=settings.app_jwt_refresh_days)

    sb.table("refresh_tokens").insert(
        {
            "user_id": user["id"],
            "token_hash": refresh_hash,
            "expires_at": expires_at.isoformat(),
        }
    ).execute()

    response.set_cookie(
        key="refresh_token",
        value=refresh,
        httponly=True,
        samesite="lax",
        secure=False,  # set True behind HTTPS
        max_age=settings.app_jwt_refresh_days * 24 * 60 * 60,
        path="/",
    )

    user_public = {
        "id": user["id"],
        "role": user["role"],
        "username": user["username"],
        "full_name": user.get("full_name"),
        "first_name": user.get("first_name"),
        "last_name": user.get("last_name"),
        "middle_name": user.get("middle_name"),
        "phone": user.get("phone"),
        "birth_date": user.get("birth_date"),
        "photo_data_url": user.get("photo_data_url"),
        "teacher_subject": user.get("teacher_subject"),
        "must_change_password": user.get("must_change_password", False),
    }
    return {"accessToken": access, "user": user_public}


@router.post("/logout")
def logout(response: Response, refresh_cookie: str | None = Depends(get_refresh_cookie)):
    if refresh_cookie:
        sb = get_supabase()
        sb.table("refresh_tokens").update({"revoked_at": datetime.now(tz=timezone.utc).isoformat()}).eq(
            "token_hash", hash_refresh_token(refresh_cookie)
        ).execute()

    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.post("/refresh")
def refresh(response: Response, refresh_cookie: str | None = Depends(get_refresh_cookie)):
    if not refresh_cookie:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    sb = get_supabase()
    token_hash = hash_refresh_token(refresh_cookie)
    tok_resp = (
        sb.table("refresh_tokens")
        .select("id,user_id,expires_at,revoked_at")
        .eq("token_hash", token_hash)
        .limit(1)
        .execute()
    )
    tok_rows = tok_resp.data or []
    row = tok_rows[0] if isinstance(tok_rows, list) and tok_rows else None
    if not row or row.get("revoked_at") is not None:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(tz=timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    u_resp = sb.table("users").select("*").eq("id", row["user_id"]).limit(1).execute()
    u_rows = u_resp.data or []
    user = u_rows[0] if isinstance(u_rows, list) and u_rows else None
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User disabled")

    # rotate refresh token
    new_refresh = create_refresh_token()
    new_refresh_hash = hash_refresh_token(new_refresh)
    new_expires_at = datetime.now(tz=timezone.utc) + timedelta(days=settings.app_jwt_refresh_days)

    sb.table("refresh_tokens").insert(
        {
            "user_id": user["id"],
            "token_hash": new_refresh_hash,
            "expires_at": new_expires_at.isoformat(),
        }
    ).execute()

    sb.table("refresh_tokens").update({"revoked_at": datetime.now(tz=timezone.utc).isoformat()}).eq("id", row["id"]).execute()

    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        samesite="lax",
        secure=False,  # set True behind HTTPS
        max_age=settings.app_jwt_refresh_days * 24 * 60 * 60,
        path="/",
    )

    access = create_access_token(subject=user["id"], role=user["role"])
    return {"accessToken": access}


@router.get("/me")
def me(user: CurrentUser):
    return {"user": user}


class ChangePasswordIn(BaseModel):
    oldPassword: str | None = None
    newPassword: str


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, user: CurrentUser):
    # For MVP: require login + oldPassword; later can allow "temp password" flow.
    if not payload.oldPassword:
        raise HTTPException(status_code=400, detail="oldPassword required")

    sb = get_supabase()
    resp = sb.table("users").select("id,password_hash").eq("id", user["id"]).limit(1).execute()
    rows = resp.data or []
    db_user = rows[0] if isinstance(rows, list) and rows else None
    if not db_user or not verify_password(payload.oldPassword, db_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Wrong password")

    from app.core.security import hash_password

    sb.table("users").update(
        {
            "password_hash": hash_password(payload.newPassword),
            "must_change_password": False,
        }
    ).eq("id", user["id"]).execute()

    return {"ok": True}
