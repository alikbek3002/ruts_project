from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.deps import CurrentUser
from app.core.security import hash_password, verify_password
from app.db.supabase_client import get_supabase

router = APIRouter()


class UpdateProfileIn(BaseModel):
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    phone: str | None = None
    birth_date: str | None = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.get("")
def get_profile(user: CurrentUser):
    """Получить профиль текущего пользователя"""
    sb = get_supabase()
    
    # Получаем полные данные пользователя
    resp = sb.table("users").select("*").eq("id", user["id"]).limit(1).execute()
    user_data = resp.data[0] if resp.data else None
    
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Убираем чувствительные данные
    user_data.pop("password_hash", None)
    user_data.pop("password_fingerprint", None)
    
    # Если есть subject_id для учителя, получаем название предмета
    if user_data.get("teacher_subject"):
        subject_resp = sb.table("subjects").select("name").eq("id", user_data["teacher_subject"]).limit(1).execute()
        if subject_resp.data:
            user_data["teacher_subject_name"] = subject_resp.data[0]["name"]
    
    return {"profile": user_data}


@router.put("")
def update_profile(payload: UpdateProfileIn, user: CurrentUser):
    """Обновить профиль пользователя"""
    sb = get_supabase()
    
    # Студенты не могут менять фото и некоторые данные
    update_data = {}
    
    # Все могут менять эти поля
    if payload.full_name is not None:
        update_data["full_name"] = payload.full_name
    if payload.first_name is not None:
        update_data["first_name"] = payload.first_name
    if payload.last_name is not None:
        update_data["last_name"] = payload.last_name
    if payload.middle_name is not None:
        update_data["middle_name"] = payload.middle_name
    
    # Только не-студенты могут менять телефон
    if user["role"] != "student" and payload.phone is not None:
        update_data["phone"] = payload.phone
    
    # Birth date для всех
    if payload.birth_date is not None:
        update_data["birth_date"] = payload.birth_date
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    update_data["updated_at"] = datetime.now(tz=timezone.utc).isoformat()
    
    resp = sb.table("users").update(update_data).eq("id", user["id"]).execute()
    
    if not resp.data:
        raise HTTPException(status_code=400, detail="Update failed")
    
    updated_user = resp.data[0]
    updated_user.pop("password_hash", None)
    updated_user.pop("password_fingerprint", None)
    
    return {"profile": updated_user}


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, user: CurrentUser):
    """Сменить пароль пользователя"""
    sb = get_supabase()
    
    # Проверяем текущий пароль
    resp = sb.table("users").select("password_hash").eq("id", user["id"]).limit(1).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="User not found")
    
    current_hash = resp.data[0]["password_hash"]
    
    if not verify_password(payload.current_password, current_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    # Проверяем что новый пароль отличается
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")
    
    # Обновляем пароль
    new_hash = hash_password(payload.new_password)
    
    sb.table("users").update({
        "password_hash": new_hash,
        "must_change_password": False,
        "updated_at": datetime.now(tz=timezone.utc).isoformat()
    }).eq("id", user["id"]).execute()
    
    return {"success": True, "message": "Password changed successfully"}


@router.post("/upload-photo")
async def upload_photo(
    photo: UploadFile = File(...),
    user: CurrentUser = None
):
    """Загрузить фото профиля"""
    sb = get_supabase()
    
    # Студенты не могут менять фото
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="Students cannot upload photos")
    
    # Проверяем тип файла
    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only images are allowed")
    
    # Проверяем размер (макс 5MB)
    content = await photo.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 5MB")
    
    # Генерируем имя файла
    import uuid
    file_ext = photo.filename.split(".")[-1] if "." in photo.filename else "jpg"
    file_name = f"avatars/{user['id']}/{uuid.uuid4().hex}.{file_ext}"
    
    # Загружаем в Supabase Storage
    try:
        storage = sb.storage.from_("profiles")
        storage.upload(file_name, content, {"content-type": photo.content_type})
        
        # Получаем публичный URL
        public_url = storage.get_public_url(file_name)
        
        # Обновляем профиль
        sb.table("users").update({
            "photo_data_url": public_url,
            "updated_at": datetime.now(tz=timezone.utc).isoformat()
        }).eq("id", user["id"]).execute()
        
        return {"photo_url": public_url}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.delete("/photo")
def delete_photo(user: CurrentUser):
    """Удалить фото профиля"""
    sb = get_supabase()
    
    if user["role"] == "student":
        raise HTTPException(status_code=403, detail="Students cannot delete photos")
    
    # Обновляем профиль
    sb.table("users").update({
        "photo_data_url": None,
        "updated_at": datetime.now(tz=timezone.utc).isoformat()
    }).eq("id", user["id"]).execute()
    
    return {"success": True, "message": "Photo deleted"}
