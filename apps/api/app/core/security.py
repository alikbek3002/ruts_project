from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet
from jose import jwt
from passlib.context import CryptContext

from app.core.settings import settings

# Support both bcrypt and argon2 for password hashing
# bcrypt for new passwords, argon2 for legacy compatibility
pwd_context = CryptContext(schemes=["bcrypt", "argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(*, subject: str, role: str) -> str:
    now = datetime.now(tz=timezone.utc)
    exp = now + timedelta(minutes=settings.app_jwt_access_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.app_jwt_secret, algorithm="HS256")


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _fernet() -> Fernet:
    # Accept either a real Fernet key (base64 urlsafe 32 bytes) OR any string.
    # If it's not a valid Fernet key, we derive one deterministically.
    try:
        return Fernet(settings.app_encryption_key.encode("utf-8"))
    except Exception:
        digest = hashlib.sha256(settings.app_encryption_key.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest)
        return Fernet(key)


def encrypt_text(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_text(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
