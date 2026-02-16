from __future__ import annotations

import logging
from urllib.parse import urlparse
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.core.settings import settings

# Configure logging for production
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
from app.modules.auth.router import router as auth_router
from app.modules.admin.router import router as admin_router
from app.modules.classes.router import router as classes_router
from app.modules.timetable.router import router as timetable_router
from app.modules.gradebook.router import router as gradebook_router
from app.modules.journal.router import router as journal_router
from app.modules.subjects.router import router as subjects_router
from app.modules.directions.router import router as directions_router
from app.modules.library.router import router as library_router
from app.modules.zoom.router import router as zoom_router
from app.modules.profile.router import router as profile_router
from app.modules.notifications.router import router as notifications_router
from app.modules.streams.router import router as streams_router
from app.modules.courses.router import router as courses_router
from app.modules.syllabus.router import router as syllabus_router
from app.modules.subject_content.router import router as subject_content_router
from app.modules.users.router import router as users_router
from app.modules.curriculum.router import router as curriculum_router
from app.modules.cycles.router import router as cycles_router
from app.modules.meetings.router import router as meetings_router

app = FastAPI(title="RUTS Journal API", version="0.1.0")

logger.info(f"Starting app in {settings.app_env} mode")
logger.info(f"CORS origins: {settings.app_cors_origins}")

from typing import Optional

def _normalize_origin(value: Optional[str]) -> Optional[str]:
    v = (value or "").strip().strip('"').strip("'")
    if not v:
        return None
    # Some people paste full URLs with paths; Origin must be scheme://host[:port]
    if "://" in v:
        p = urlparse(v)
        if p.scheme and p.netloc:
            v = f"{p.scheme}://{p.netloc}"
    # Origin never has a trailing slash; remove it to avoid mismatches.
    v = v.rstrip("/")
    return v or None


origins_set: set[str] = set()
for raw in settings.app_cors_origins.split(","):
    norm = _normalize_origin(raw)
    if norm:
        origins_set.add(norm)

# Always include the configured frontend base (common source of truth)
frontend_origin = _normalize_origin(settings.app_frontend_base)
if frontend_origin:
    origins_set.add(frontend_origin)

# Explicitly add production domains
origins_set.add("https://ruts-edu.online")
origins_set.add("https://www.ruts-edu.online")

origins = sorted(origins_set)
# In dev, Vite may auto-bump the port (5173 -> 5174, etc). Allow any localhost port.
origin_regex = r"^http://(localhost|127\.0\.0\.1):\d+$" if settings.app_env == "dev" else None
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(classes_router, prefix="/api/classes", tags=["classes"])
app.include_router(timetable_router, prefix="/api/timetable", tags=["timetable"])
app.include_router(gradebook_router, prefix="/api/gradebook", tags=["gradebook"])
app.include_router(journal_router, prefix="/api/journal", tags=["journal"])
app.include_router(subjects_router, prefix="/api/subjects", tags=["subjects"])
app.include_router(directions_router, prefix="/api/directions", tags=["directions"])
app.include_router(library_router, prefix="/api/library", tags=["library"])
app.include_router(zoom_router, prefix="/api/zoom", tags=["zoom"])
app.include_router(profile_router, prefix="/api/profile", tags=["profile"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
app.include_router(streams_router, tags=["streams"])
app.include_router(courses_router, prefix="/api/courses", tags=["courses"])
app.include_router(syllabus_router, prefix="/api/syllabus", tags=["syllabus"])
app.include_router(subject_content_router, prefix="/api/subject-content", tags=["subject-content"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(curriculum_router, prefix="/api/directions", tags=["curriculum"])
app.include_router(cycles_router, prefix="/api/cycles", tags=["cycles"])
app.include_router(meetings_router, prefix="/api/meetings", tags=["meetings"])

from app.modules.archive.router import router as archive_router
app.include_router(archive_router, prefix="/api/archive", tags=["archive"])


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    return {"ok": True}
