from __future__ import annotations

from supabase import Client, create_client

from app.core.settings import settings


def get_supabase() -> Client:
    """Create a new Supabase client for each request to avoid HTTP/2 connection issues"""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
