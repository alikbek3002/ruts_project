from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from postgrest.exceptions import APIError

from app.core.deps import CurrentUser, require_role
from app.core.security import verify_password
from app.db.supabase_client import get_supabase

router = APIRouter()


def _is_missing_table_api_error(err: Exception, table: str) -> bool:
    try:
        payload = err.args[0] if getattr(err, "args", None) else None
        if isinstance(payload, dict):
            if payload.get("code") == "PGRST205" and table in (payload.get("message") or ""):
                return True
        msg = str(err)
        return ("PGRST205" in msg) and (table in msg)
    except Exception:
        return False


# ============================================================================
# COURSES
# ============================================================================

class CreateCourseIn(BaseModel):
    title: str
    description: str | None = None


class UpdateCourseIn(BaseModel):
    title: str | None = None
    description: str | None = None


class DeleteCourseIn(BaseModel):
    password: str  # Admin password confirmation


@router.get("")
def list_courses(user: dict = require_role("admin", "teacher", "student")):
    """Список всех курсов (видят админы и все ученики)"""
    sb = get_supabase()
    try:
        # Get courses with teacher info
        courses_resp = (
            sb.table("courses")
            .select("id,title,description,teacher_id,created_at,updated_at")
            .order("created_at", desc=True)
            .execute()
        )
        courses = courses_resp.data or []
        
        # Get teacher info
        teacher_ids = list(set([str(c.get("teacher_id", "")) for c in courses if c.get("teacher_id")]))
        teachers = {}
        if teacher_ids:
            teachers_resp = (
                sb.table("users")
                .select("id,full_name,first_name,last_name,middle_name")
                .in_("id", teacher_ids)
                .execute()
            )
            for t in (teachers_resp.data or []):
                tid = str(t.get("id", ""))
                full_name = t.get("full_name") or ""
                if not full_name:
                    parts = [t.get("last_name"), t.get("first_name"), t.get("middle_name")]
                    full_name = " ".join([p for p in parts if p]).strip() or t.get("username", "")
                teachers[tid] = {"id": tid, "full_name": full_name}
        
        # Enrich courses with teacher info
        enriched = []
        for course in courses:
            tid = str(course.get("teacher_id", ""))
            teacher_info = teachers.get(tid, {"id": tid, "full_name": "Неизвестно"})
            enriched.append({**course, "teacher": teacher_info})
        
        return {"courses": enriched}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.courses"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/{course_id}")
def get_course(course_id: str, user: dict = require_role("admin", "teacher", "student")):
    """Получить курс с темами"""
    sb = get_supabase()
    try:
        # Get course
        course_resp = (
            sb.table("courses")
            .select("id,title,description,teacher_id,created_at,updated_at")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if not course_resp.data:
            raise HTTPException(status_code=404, detail="Course not found")
        course = course_resp.data
        
        # Get teacher info
        teacher_id = course.get("teacher_id")
        if teacher_id:
            teacher_resp = (
                sb.table("users")
                .select("id,full_name,first_name,last_name,middle_name")
                .eq("id", teacher_id)
                .single()
                .execute()
            )
            teacher = teacher_resp.data or {}
            full_name = teacher.get("full_name") or ""
            if not full_name:
                parts = [teacher.get("last_name"), teacher.get("first_name"), teacher.get("middle_name")]
                full_name = " ".join([p for p in parts if p]).strip() or teacher.get("username", "")
            course["teacher"] = {"id": str(teacher_id), "full_name": full_name}
        
        # Get topics with tests
        topics_resp = (
            sb.table("course_topics")
            .select("id,title,description,presentation_storage_path,presentation_original_filename,order_index,created_at,updated_at")
            .eq("course_id", course_id)
            .order("order_index")
            .execute()
        )
        topics = topics_resp.data or []
        
        # Get tests for each topic
        topic_ids = [str(t.get("id", "")) for t in topics if t.get("id")]
        tests_by_topic = {}
        if topic_ids:
            tests_resp = (
                sb.table("course_tests")
                .select("id,topic_id,title,description,document_storage_path,document_original_filename,test_type,time_limit_minutes,created_at,updated_at")
                .in_("topic_id", topic_ids)
                .execute()
            )
            for test in (tests_resp.data or []):
                tid = str(test.get("topic_id", ""))
                if tid not in tests_by_topic:
                    tests_by_topic[tid] = []
                tests_by_topic[tid].append(test)
        
        # Enrich topics with tests
        for topic in topics:
            tid = str(topic.get("id", ""))
            topic["tests"] = tests_by_topic.get(tid, [])
        
        course["topics"] = topics
        return {"course": course}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.courses"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.post("")
def create_course(payload: CreateCourseIn, user: dict = require_role("teacher")):
    """Создать курс (только учитель, автор определяется автоматически)"""
    sb = get_supabase()
    try:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        
        course_resp = (
            sb.table("courses")
            .insert({
                "title": title,
                "description": payload.description.strip() if payload.description else None,
                "teacher_id": user["id"],  # Автор определяется автоматически
            })
            .execute()
        )
        course = course_resp.data[0] if isinstance(course_resp.data, list) and course_resp.data else course_resp.data
        return {"course": course}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.courses"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.put("/{course_id}")
def update_course(course_id: str, payload: UpdateCourseIn, user: dict = require_role("teacher")):
    """Обновить курс (только автор курса)"""
    sb = get_supabase()
    try:
        # Check ownership
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if not course_resp.data:
            raise HTTPException(status_code=404, detail="Course not found")
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit your own courses")
        
        update_data = {}
        if payload.title is not None:
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="Title cannot be empty")
            update_data["title"] = title
        if payload.description is not None:
            update_data["description"] = payload.description.strip() if payload.description else None
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        course_resp = (
            sb.table("courses")
            .update(update_data)
            .eq("id", course_id)
            .execute()
        )
        course = course_resp.data[0] if isinstance(course_resp.data, list) and course_resp.data else course_resp.data
        return {"course": course}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.courses"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.delete("/{course_id}")
def delete_course(course_id: str, payload: DeleteCourseIn, user: dict = require_role("admin", "teacher")):
    """Удалить курс (админ или автор курса, с подтверждением паролем)"""
    sb = get_supabase()
    try:
        # Verify password
        user_resp = (
            sb.table("users")
            .select("password_hash")
            .eq("id", user["id"])
            .single()
            .execute()
        )
        if not user_resp.data:
            raise HTTPException(status_code=404, detail="User not found")
        
        password_hash = user_resp.data.get("password_hash")
        if not password_hash:
            raise HTTPException(status_code=500, detail="Password hash not found")
        
        if not verify_password(payload.password, password_hash):
            raise HTTPException(status_code=403, detail="Incorrect password")
        
        # Check course exists and ownership
        course_resp = (
            sb.table("courses")
            .select("id, teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if not course_resp.data:
            raise HTTPException(status_code=404, detail="Course not found")
        
        course = course_resp.data
        
        # If user is teacher, check if they own the course
        if user["role"] == "teacher" and course.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete your own courses")
        
        # Delete course (cascade will delete topics, tests, etc.)
        sb.table("courses").delete().eq("id", course_id).execute()
        
        return {"ok": True}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.courses"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


# ============================================================================
# COURSE TOPICS
# ============================================================================

class CreateTopicIn(BaseModel):
    course_id: str
    title: str
    description: str | None = None
    order_index: int = 0


class UpdateTopicIn(BaseModel):
    title: str | None = None
    description: str | None = None
    order_index: int | None = None


@router.post("/topics")
async def create_topic(
    course_id: str = Form(...),
    title: str = Form(...),
    description: str | None = Form(None),
    order_index: int = Form(0),
    presentation: UploadFile | None = File(None),
    links: str | None = Form(None),
    user: dict = require_role("teacher"),
):
    """Создать тему в курсе (только автор курса)"""
    sb = get_supabase()
    try:
        # Check course ownership
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if not course_resp.data:
            raise HTTPException(status_code=404, detail="Course not found")
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only add topics to your own courses")
        
        title = title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        
        presentation_path = None
        presentation_filename = None
        
        if presentation:
            # Upload presentation to Supabase Storage
            file_ext = presentation.filename.split(".")[-1] if presentation.filename and "." in presentation.filename else ""
            unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
            storage_path = f"courses/{course_id}/topics/{unique_filename}"
            file_content = await presentation.read()
            
            try:
                sb.storage.from_("library").upload(
                    path=storage_path,
                    file=file_content,
                    file_options={"content-type": presentation.content_type or "application/octet-stream"},
                )
                presentation_path = storage_path
                presentation_filename = presentation.filename
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Presentation upload failed: {str(e)}")
        
        links_data = []
        if links:
            try:
                links_data = json.loads(links)
            except:
                pass

        topic_resp = (
            sb.table("course_topics")
            .insert({
                "course_id": course_id,
                "title": title,
                "description": description.strip() if description else None,
                "presentation_storage_path": presentation_path,
                "presentation_original_filename": presentation_filename,
                "order_index": order_index,
                "links": links_data,
            })
            .execute()
        )
        topic = topic_resp.data[0] if isinstance(topic_resp.data, list) and topic_resp.data else topic_resp.data
        return {"topic": topic}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_topics"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/topics/{topic_id}/presentation/download")
async def download_topic_presentation(
    topic_id: str,
    user: dict = require_role("teacher", "student", "admin")
):
    """Скачать презентацию темы"""
    sb = get_supabase()
    
    # Get topic
    topic_resp = sb.table("course_topics").select("presentation_storage_path").eq("id", topic_id).single().execute()
    if not topic_resp.data:
        raise HTTPException(status_code=404, detail="Topic not found")
        
    storage_path = topic_resp.data.get("presentation_storage_path")
    if not storage_path:
        raise HTTPException(status_code=404, detail="No presentation found for this topic")
        
    # Create signed URL (valid for 1 hour)
    try:
        signed_url_resp = sb.storage.from_("library").create_signed_url(storage_path, 3600)
        
        if isinstance(signed_url_resp, dict) and "signedURL" in signed_url_resp:
             return RedirectResponse(url=signed_url_resp["signedURL"])
        elif isinstance(signed_url_resp, str):
             if signed_url_resp.startswith("http"):
                 return RedirectResponse(url=signed_url_resp)
        
        raise HTTPException(status_code=500, detail="Could not generate download URL")
             
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download link: {str(e)}")


@router.put("/topics/{topic_id}")
async def update_topic(
    topic_id: str,
    title: str | None = Form(None),
    description: str | None = Form(None),
    order_index: int | None = Form(None),
    presentation: UploadFile | None = File(None),
    links: str | None = Form(None),
    user: dict = require_role("teacher"),
):
    """Обновить тему (только автор курса)"""
    sb = get_supabase()
    try:
        # Check topic ownership via course
        topic_resp = (
            sb.table("course_topics")
            .select("course_id, presentation_storage_path")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        if not topic_resp.data:
            raise HTTPException(status_code=404, detail="Topic not found")
        
        course_id = topic_resp.data.get("course_id")
        old_presentation_path = topic_resp.data.get("presentation_storage_path")

        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit topics in your own courses")
        
        update_data = {}
        if title is not None:
            title = title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="Title cannot be empty")
            update_data["title"] = title
        if description is not None:
            update_data["description"] = description.strip() if description else None
        if order_index is not None:
            update_data["order_index"] = order_index
        
        if links is not None:
            try:
                update_data["links"] = json.loads(links)
            except:
                pass

        if presentation:
            # Upload presentation to Supabase Storage
            file_ext = presentation.filename.split(".")[-1] if presentation.filename and "." in presentation.filename else ""
            unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
            storage_path = f"courses/{course_id}/topics/{unique_filename}"
            file_content = await presentation.read()
            
            try:
                if old_presentation_path:
                    sb.storage.from_("library").remove([old_presentation_path])

                sb.storage.from_("library").upload(
                    path=storage_path,
                    file=file_content,
                    file_options={"content-type": presentation.content_type or "application/octet-stream"},
                )
                update_data["presentation_storage_path"] = storage_path
                update_data["presentation_original_filename"] = presentation.filename
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Presentation upload failed: {str(e)}")
        
        if update_data:
            topic_resp = (
                sb.table("course_topics")
                .update(update_data)
                .eq("id", topic_id)
                .execute()
            )
        
        topic = topic_resp.data[0] if isinstance(topic_resp.data, list) and topic_resp.data else topic_resp.data
        return {"topic": topic}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_topics"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.delete("/topics/{topic_id}")
def delete_topic(topic_id: str, user: dict = require_role("teacher")):
    """Удалить тему (только автор курса)"""
    sb = get_supabase()
    try:
        # Check topic ownership via course
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        if not topic_resp.data:
            raise HTTPException(status_code=404, detail="Topic not found")
        
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete topics in your own courses")
        
        sb.table("course_topics").delete().eq("id", topic_id).execute()
        return {"ok": True}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_topics"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.post("/topics/{topic_id}/presentation")
async def upload_topic_presentation(
    topic_id: str,
    presentation: UploadFile = File(...),
    user: dict = require_role("teacher"),
):
    """Загрузить презентацию для темы (только автор курса)"""
    sb = get_supabase()
    try:
        # Check topic ownership via course
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        if not topic_resp.data:
            raise HTTPException(status_code=404, detail="Topic not found")
        
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only upload presentations to your own courses")
        
        # Upload presentation
        file_ext = presentation.filename.split(".")[-1] if presentation.filename and "." in presentation.filename else ""
        unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
        storage_path = f"courses/{course_id}/topics/{unique_filename}"
        file_content = await presentation.read()
        
        try:
            sb.storage.from_("library").upload(
                path=storage_path,
                file=file_content,
                file_options={"content-type": presentation.content_type or "application/octet-stream"},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Presentation upload failed: {str(e)}")
        
        # Update topic
        topic_resp = (
            sb.table("course_topics")
            .update({
                "presentation_storage_path": storage_path,
                "presentation_original_filename": presentation.filename,
            })
            .eq("id", topic_id)
            .execute()
        )
        topic = topic_resp.data[0] if isinstance(topic_resp.data, list) and topic_resp.data else topic_resp.data
        return {"topic": topic}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_topics"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


# ============================================================================
# COURSE TESTS
# ============================================================================

class CreateQuizTestIn(BaseModel):
    topic_id: str
    title: str
    description: str | None = None
    time_limit_minutes: int  # Required for quiz type


class CreateDocumentTestIn(BaseModel):
    topic_id: str
    title: str
    description: str | None = None


class UpdateTestIn(BaseModel):
    title: str | None = None
    description: str | None = None
    time_limit_minutes: int | None = None


@router.post("/tests/quiz")
def create_quiz_test(payload: CreateQuizTestIn, user: dict = require_role("teacher")):
    """Создать тест типа quiz (только автор курса)"""
    sb = get_supabase()
    try:
        # Check topic ownership via course
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", payload.topic_id)
            .single()
            .execute()
        )
        if not topic_resp.data:
            raise HTTPException(status_code=404, detail="Topic not found")
        
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only create tests in your own courses")
        
        if payload.time_limit_minutes <= 0:
            raise HTTPException(status_code=400, detail="Time limit must be greater than 0")
        
        test_resp = (
            sb.table("course_tests")
            .insert({
                "topic_id": payload.topic_id,
                "title": payload.title.strip(),
                "description": payload.description.strip() if payload.description else None,
                "test_type": "quiz",
                "time_limit_minutes": payload.time_limit_minutes,
            })
            .execute()
        )
        test = test_resp.data[0] if isinstance(test_resp.data, list) and test_resp.data else test_resp.data
        return {"test": test}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_tests"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.post("/tests/document")
async def create_document_test(
    topic_id: str = Form(...),
    title: str = Form(...),
    description: str | None = Form(None),
    document: UploadFile | None = File(None),
    user: dict = require_role("teacher"),
):
    """Создать тест типа document (только автор курса)"""
    sb = get_supabase()
    try:
        # Check topic ownership via course
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        if not topic_resp.data:
            raise HTTPException(status_code=404, detail="Topic not found")
        
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only create tests in your own courses")
        
        document_path = None
        document_filename = None
        
        if document:
            # Upload document to Supabase Storage
            file_ext = document.filename.split(".")[-1] if document.filename and "." in document.filename else ""
            unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
            storage_path = f"courses/{course_id}/tests/{unique_filename}"
            file_content = await document.read()
            
            try:
                sb.storage.from_("library").upload(
                    path=storage_path,
                    file=file_content,
                    file_options={"content-type": document.content_type or "application/octet-stream"},
                )
                document_path = storage_path
                document_filename = document.filename
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Document upload failed: {str(e)}")
        
        test_resp = (
            sb.table("course_tests")
            .insert({
                "topic_id": topic_id,
                "title": title.strip(),
                "description": description.strip() if description else None,
                "document_storage_path": document_path,
                "document_original_filename": document_filename,
                "test_type": "document",
                "time_limit_minutes": None,
            })
            .execute()
        )
        test = test_resp.data[0] if isinstance(test_resp.data, list) and test_resp.data else test_resp.data
        return {"test": test}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_tests"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.put("/tests/{test_id}")
def update_test(test_id: str, payload: UpdateTestIn, user: dict = require_role("teacher")):
    """Обновить тест (только автор курса)"""
    sb = get_supabase()
    try:
        # Check test ownership via topic -> course
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit tests in your own courses")
        
        update_data = {}
        if payload.title is not None:
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="Title cannot be empty")
            update_data["title"] = title
        if payload.description is not None:
            update_data["description"] = payload.description.strip() if payload.description else None
        if payload.time_limit_minutes is not None:
            if payload.time_limit_minutes <= 0:
                raise HTTPException(status_code=400, detail="Time limit must be greater than 0")
            update_data["time_limit_minutes"] = payload.time_limit_minutes
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        test_resp = (
            sb.table("course_tests")
            .update(update_data)
            .eq("id", test_id)
            .execute()
        )
        test = test_resp.data[0] if isinstance(test_resp.data, list) and test_resp.data else test_resp.data
        return {"test": test}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_tests"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.delete("/tests/{test_id}")
def delete_test(test_id: str, user: dict = require_role("admin", "teacher")):
    """Удалить тест (админ или автор курса)"""
    sb = get_supabase()
    try:
        # Check test ownership via topic -> course
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        
        # If user is teacher, check if they own the course
        if user["role"] == "teacher" and course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete tests in your own courses")
        
        sb.table("course_tests").delete().eq("id", test_id).execute()
        return {"ok": True}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.course_tests"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


# ============================================================================
# TEST QUESTIONS (for quiz tests)
# ============================================================================

class CreateQuestionIn(BaseModel):
    test_id: str
    question_text: str
    order_index: int = 0


class UpdateQuestionIn(BaseModel):
    question_text: str | None = None
    order_index: int | None = None


@router.post("/tests/{test_id}/questions")
def create_question(test_id: str, payload: CreateQuestionIn, user: dict = require_role("teacher")):
    """Создать вопрос для теста (только автор курса)"""
    sb = get_supabase()
    try:
        # Check test ownership via topic -> course
        test_resp = (
            sb.table("course_tests")
            .select("topic_id,test_type")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        if test_resp.data.get("test_type") != "quiz":
            raise HTTPException(status_code=400, detail="Questions can only be added to quiz tests")
        
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only add questions to tests in your own courses")
        
        question_text = payload.question_text.strip()
        if not question_text:
            raise HTTPException(status_code=400, detail="Question text is required")
        
        question_resp = (
            sb.table("test_questions")
            .insert({
                "test_id": test_id,
                "question_text": question_text,
                "order_index": payload.order_index,
            })
            .execute()
        )
        question = question_resp.data[0] if isinstance(question_resp.data, list) and question_resp.data else question_resp.data
        return {"question": question}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_questions"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/tests/{test_id}/questions")
def list_questions(test_id: str, user: dict = require_role("admin", "teacher", "student")):
    """Получить вопросы теста (для учителя - с правильными ответами, для ученика - без)"""
    sb = get_supabase()
    try:
        # Get test
        test_resp = (
            sb.table("course_tests")
            .select("id,test_type")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        if test_resp.data.get("test_type") != "quiz":
            raise HTTPException(status_code=400, detail="This endpoint is only for quiz tests")
        
        # Get questions
        questions_resp = (
            sb.table("test_questions")
            .select("id,question_text,order_index,created_at")
            .eq("test_id", test_id)
            .order("order_index")
            .execute()
        )
        questions = questions_resp.data or []
        
        # Get options for each question
        question_ids = [str(q.get("id", "")) for q in questions if q.get("id")]
        options_by_question = {}
        if question_ids:
            options_resp = (
                sb.table("test_question_options")
                .select("id,question_id,option_text,is_correct,order_index")
                .in_("question_id", question_ids)
                .order("order_index")
                .execute()
            )
            for option in (options_resp.data or []):
                qid = str(option.get("question_id", ""))
                if qid not in options_by_question:
                    options_by_question[qid] = []
                # Hide correct answer for students
                if user.get("role") == "student":
                    option_data = {
                        "id": option.get("id"),
                        "option_text": option.get("option_text"),
                        "order_index": option.get("order_index"),
                    }
                else:
                    option_data = {
                        "id": option.get("id"),
                        "option_text": option.get("option_text"),
                        "is_correct": option.get("is_correct"),
                        "order_index": option.get("order_index"),
                    }
                options_by_question[qid].append(option_data)
        
        # Enrich questions with options
        for question in questions:
            qid = str(question.get("id", ""))
            question["options"] = options_by_question.get(qid, [])
        
        return {"questions": questions}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_questions"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.put("/questions/{question_id}")
def update_question(question_id: str, payload: UpdateQuestionIn, user: dict = require_role("teacher")):
    """Обновить вопрос (только автор курса)"""
    sb = get_supabase()
    try:
        # Check question ownership via test -> topic -> course
        question_resp = (
            sb.table("test_questions")
            .select("test_id")
            .eq("id", question_id)
            .single()
            .execute()
        )
        if not question_resp.data:
            raise HTTPException(status_code=404, detail="Question not found")
        
        test_id = question_resp.data.get("test_id")
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit questions in your own courses")
        
        update_data = {}
        if payload.question_text is not None:
            question_text = payload.question_text.strip()
            if not question_text:
                raise HTTPException(status_code=400, detail="Question text cannot be empty")
            update_data["question_text"] = question_text
        if payload.order_index is not None:
            update_data["order_index"] = payload.order_index
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        question_resp = (
            sb.table("test_questions")
            .update(update_data)
            .eq("id", question_id)
            .execute()
        )
        question = question_resp.data[0] if isinstance(question_resp.data, list) and question_resp.data else question_resp.data
        return {"question": question}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_questions"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.delete("/questions/{question_id}")
def delete_question(question_id: str, user: dict = require_role("teacher")):
    """Удалить вопрос (только автор курса)"""
    sb = get_supabase()
    try:
        # Check question ownership via test -> topic -> course
        question_resp = (
            sb.table("test_questions")
            .select("test_id")
            .eq("id", question_id)
            .single()
            .execute()
        )
        if not question_resp.data:
            raise HTTPException(status_code=404, detail="Question not found")
        
        test_id = question_resp.data.get("test_id")
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete questions in your own courses")
        
        sb.table("test_questions").delete().eq("id", question_id).execute()
        return {"ok": True}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_questions"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


# ============================================================================
# TEST QUESTION OPTIONS
# ============================================================================

class CreateOptionIn(BaseModel):
    question_id: str
    option_text: str
    is_correct: bool = False
    order_index: int = 0


class UpdateOptionIn(BaseModel):
    option_text: str | None = None
    is_correct: bool | None = None
    order_index: int | None = None


@router.post("/questions/{question_id}/options")
def create_option(question_id: str, payload: CreateOptionIn, user: dict = require_role("teacher")):
    """Создать вариант ответа для вопроса (только автор курса)"""
    sb = get_supabase()
    try:
        # Check question ownership via test -> topic -> course
        question_resp = (
            sb.table("test_questions")
            .select("test_id")
            .eq("id", question_id)
            .single()
            .execute()
        )
        if not question_resp.data:
            raise HTTPException(status_code=404, detail="Question not found")
        
        test_id = question_resp.data.get("test_id")
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only add options to questions in your own courses")
        
        option_text = payload.option_text.strip()
        if not option_text:
            raise HTTPException(status_code=400, detail="Option text is required")
        
        option_resp = (
            sb.table("test_question_options")
            .insert({
                "question_id": question_id,
                "option_text": option_text,
                "is_correct": payload.is_correct,
                "order_index": payload.order_index,
            })
            .execute()
        )
        option = option_resp.data[0] if isinstance(option_resp.data, list) and option_resp.data else option_resp.data
        return {"option": option}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_question_options"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.put("/options/{option_id}")
def update_option(option_id: str, payload: UpdateOptionIn, user: dict = require_role("teacher")):
    """Обновить вариант ответа (только автор курса)"""
    sb = get_supabase()
    try:
        # Check option ownership via question -> test -> topic -> course
        option_resp = (
            sb.table("test_question_options")
            .select("question_id")
            .eq("id", option_id)
            .single()
            .execute()
        )
        if not option_resp.data:
            raise HTTPException(status_code=404, detail="Option not found")
        
        question_id = option_resp.data.get("question_id")
        question_resp = (
            sb.table("test_questions")
            .select("test_id")
            .eq("id", question_id)
            .single()
            .execute()
        )
        test_id = question_resp.data.get("test_id")
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only edit options in your own courses")
        
        update_data = {}
        if payload.option_text is not None:
            option_text = payload.option_text.strip()
            if not option_text:
                raise HTTPException(status_code=400, detail="Option text cannot be empty")
            update_data["option_text"] = option_text
        if payload.is_correct is not None:
            update_data["is_correct"] = payload.is_correct
        if payload.order_index is not None:
            update_data["order_index"] = payload.order_index
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        option_resp = (
            sb.table("test_question_options")
            .update(update_data)
            .eq("id", option_id)
            .execute()
        )
        option = option_resp.data[0] if isinstance(option_resp.data, list) and option_resp.data else option_resp.data
        return {"option": option}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_question_options"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.delete("/options/{option_id}")
def delete_option(option_id: str, user: dict = require_role("teacher")):
    """Удалить вариант ответа (только автор курса)"""
    sb = get_supabase()
    try:
        # Check option ownership via question -> test -> topic -> course
        option_resp = (
            sb.table("test_question_options")
            .select("question_id")
            .eq("id", option_id)
            .single()
            .execute()
        )
        if not option_resp.data:
            raise HTTPException(status_code=404, detail="Option not found")
        
        question_id = option_resp.data.get("question_id")
        question_resp = (
            sb.table("test_questions")
            .select("test_id")
            .eq("id", question_id)
            .single()
            .execute()
        )
        test_id = question_resp.data.get("test_id")
        test_resp = (
            sb.table("course_tests")
            .select("topic_id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        topic_id = test_resp.data.get("topic_id")
        topic_resp = (
            sb.table("course_topics")
            .select("course_id")
            .eq("id", topic_id)
            .single()
            .execute()
        )
        course_id = topic_resp.data.get("course_id")
        course_resp = (
            sb.table("courses")
            .select("teacher_id")
            .eq("id", course_id)
            .single()
            .execute()
        )
        if course_resp.data.get("teacher_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only delete options in your own courses")
        
        sb.table("test_question_options").delete().eq("id", option_id).execute()
        return {"ok": True}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_question_options"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


# ============================================================================
# TEST ATTEMPTS (Student taking tests)
# ============================================================================

class StartTestAttemptIn(BaseModel):
    test_id: str


class SubmitTestAttemptIn(BaseModel):
    attempt_id: str
    answers: list[dict]  # [{"question_id": "...", "selected_option_id": "..."}]


@router.post("/tests/{test_id}/start")
def start_test_attempt(test_id: str, user: dict = require_role("student")):
    """Начать прохождение теста (только ученик)"""
    sb = get_supabase()
    try:
        # Get test
        test_resp = (
            sb.table("course_tests")
            .select("id,test_type,time_limit_minutes")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        test = test_resp.data
        test_type = test.get("test_type")
        
        # Check if student already has an active attempt
        existing_resp = (
            sb.table("test_attempts")
            .select("id")
            .eq("test_id", test_id)
            .eq("student_id", user["id"])
            .is_("submitted_at", "null")
            .limit(1)
            .execute()
        )
        if existing_resp.data:
            raise HTTPException(status_code=400, detail="You already have an active attempt for this test")
        
        # For quiz tests, calculate time limit in seconds
        time_limit_seconds = None
        if test_type == "quiz":
            time_limit_minutes = test.get("time_limit_minutes")
            if time_limit_minutes:
                time_limit_seconds = time_limit_minutes * 60
        
        # Create attempt
        attempt_resp = (
            sb.table("test_attempts")
            .insert({
                "test_id": test_id,
                "student_id": user["id"],
                "time_limit_seconds": time_limit_seconds,
            })
            .execute()
        )
        attempt = attempt_resp.data[0] if isinstance(attempt_resp.data, list) and attempt_resp.data else attempt_resp.data
        
        # For quiz tests, return questions (without correct answers)
        if test_type == "quiz":
            questions_resp = (
                sb.table("test_questions")
                .select("id,question_text,order_index")
                .eq("test_id", test_id)
                .order("order_index")
                .execute()
            )
            questions = questions_resp.data or []
            
            question_ids = [str(q.get("id", "")) for q in questions if q.get("id")]
            options_by_question = {}
            if question_ids:
                options_resp = (
                    sb.table("test_question_options")
                    .select("id,question_id,option_text,order_index")
                    .in_("question_id", question_ids)
                    .order("order_index")
                    .execute()
                )
                for option in (options_resp.data or []):
                    qid = str(option.get("question_id", ""))
                    if qid not in options_by_question:
                        options_by_question[qid] = []
                    options_by_question[qid].append({
                        "id": option.get("id"),
                        "option_text": option.get("option_text"),
                        "order_index": option.get("order_index"),
                    })
            
            for question in questions:
                qid = str(question.get("id", ""))
                question["options"] = options_by_question.get(qid, [])
            
            return {
                "attempt": attempt,
                "questions": questions,
                "time_limit_seconds": time_limit_seconds,
            }
        else:
            # Document test - return test info
            return {
                "attempt": attempt,
                "test": test,
            }
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_attempts"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.post("/attempts/{attempt_id}/submit")
def submit_test_attempt(attempt_id: str, payload: SubmitTestAttemptIn, user: dict = require_role("student")):
    """Отправить ответы на тест (только ученик, только для quiz тестов)"""
    sb = get_supabase()
    try:
        # Get attempt
        attempt_resp = (
            sb.table("test_attempts")
            .select("id,test_id,student_id,submitted_at")
            .eq("id", attempt_id)
            .single()
            .execute()
        )
        if not attempt_resp.data:
            raise HTTPException(status_code=404, detail="Attempt not found")
        
        attempt = attempt_resp.data
        if attempt.get("student_id") != user["id"]:
            raise HTTPException(status_code=403, detail="This is not your attempt")
        
        if attempt.get("submitted_at"):
            raise HTTPException(status_code=400, detail="This attempt has already been submitted")
        
        test_id = attempt.get("test_id")
        
        # Get test
        test_resp = (
            sb.table("course_tests")
            .select("id,test_type")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        if test_resp.data.get("test_type") != "quiz":
            raise HTTPException(status_code=400, detail="This endpoint is only for quiz tests")
        
        # Get all questions for this test
        questions_resp = (
            sb.table("test_questions")
            .select("id")
            .eq("test_id", test_id)
            .execute()
        )
        questions = questions_resp.data or []
        question_ids = [str(q.get("id", "")) for q in questions if q.get("id")]
        total_questions = len(question_ids)
        
        if total_questions == 0:
            raise HTTPException(status_code=400, detail="Test has no questions")
        
        # Get correct answers
        options_resp = (
            sb.table("test_question_options")
            .select("id,question_id,is_correct")
            .in_("question_id", question_ids)
            .eq("is_correct", True)
            .execute()
        )
        correct_options_by_question = {}
        for option in (options_resp.data or []):
            qid = str(option.get("question_id", ""))
            correct_options_by_question[qid] = str(option.get("id", ""))
        
        # Process answers
        score = 0
        answers_to_save = []
        
        for answer_data in payload.answers:
            question_id = str(answer_data.get("question_id", ""))
            selected_option_id = str(answer_data.get("selected_option_id", "")) if answer_data.get("selected_option_id") else None
            
            if question_id not in question_ids:
                continue  # Skip invalid question IDs
            
            correct_option_id = correct_options_by_question.get(question_id)
            is_correct = (selected_option_id == correct_option_id) if correct_option_id else False
            
            if is_correct:
                score += 1
            
            answers_to_save.append({
                "attempt_id": attempt_id,
                "question_id": question_id,
                "selected_option_id": selected_option_id,
                "is_correct": is_correct,
            })
        
        # Save answers
        if answers_to_save:
            sb.table("test_attempt_answers").insert(answers_to_save).execute()
        
        # Calculate percentage
        percentage_score = (score / total_questions * 100) if total_questions > 0 else 0
        
        # Update attempt
        now = datetime.now(timezone.utc)
        attempt_resp = (
            sb.table("test_attempts")
            .update({
                "submitted_at": now.isoformat(),
                "score": score,
                "total_questions": total_questions,
                "percentage_score": round(percentage_score, 2),
            })
            .eq("id", attempt_id)
            .execute()
        )
        updated_attempt = attempt_resp.data[0] if isinstance(attempt_resp.data, list) and attempt_resp.data else attempt_resp.data
        
        return {
            "attempt": updated_attempt,
            "score": score,
            "total_questions": total_questions,
            "percentage_score": round(percentage_score, 2),
        }
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_attempts"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/attempts/{attempt_id}")
def get_test_attempt(attempt_id: str, user: dict = require_role("admin", "teacher", "student")):
    """Получить результат попытки прохождения теста"""
    sb = get_supabase()
    try:
        # Get attempt
        attempt_resp = (
            sb.table("test_attempts")
            .select("id,test_id,student_id,started_at,submitted_at,time_limit_seconds,score,total_questions,percentage_score")
            .eq("id", attempt_id)
            .single()
            .execute()
        )
        if not attempt_resp.data:
            raise HTTPException(status_code=404, detail="Attempt not found")
        
        attempt = attempt_resp.data
        
        # Check permissions
        if user.get("role") == "student" and attempt.get("student_id") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only view your own attempts")
        
        # Get answers if submitted
        answers = []
        if attempt.get("submitted_at"):
            answers_resp = (
                sb.table("test_attempt_answers")
                .select("id,question_id,selected_option_id,is_correct")
                .eq("attempt_id", attempt_id)
                .execute()
            )
            answers = answers_resp.data or []
        
        return {
            "attempt": attempt,
            "answers": answers,
        }
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_attempts"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/tests/{test_id}/attempts")
def list_test_attempts(test_id: str, user: dict = require_role("admin", "teacher", "student")):
    """Получить список попыток прохождения теста"""
    sb = get_supabase()
    try:
        # Get test
        test_resp = (
            sb.table("course_tests")
            .select("id")
            .eq("id", test_id)
            .single()
            .execute()
        )
        if not test_resp.data:
            raise HTTPException(status_code=404, detail="Test not found")
        
        # Build query
        query = (
            sb.table("test_attempts")
            .select("id,test_id,student_id,started_at,submitted_at,score,total_questions,percentage_score")
            .eq("test_id", test_id)
        )
        
        # Students can only see their own attempts
        if user.get("role") == "student":
            query = query.eq("student_id", user["id"])
        
        attempts_resp = query.order("started_at", desc=True).execute()
        attempts = attempts_resp.data or []
        
        # Get student info
        student_ids = list(set([str(a.get("student_id", "")) for a in attempts if a.get("student_id")]))
        students = {}
        if student_ids:
            students_resp = (
                sb.table("users")
                .select("id,full_name,first_name,last_name,middle_name,username")
                .in_("id", student_ids)
                .execute()
            )
            for s in (students_resp.data or []):
                sid = str(s.get("id", ""))
                full_name = s.get("full_name") or ""
                if not full_name:
                    parts = [s.get("last_name"), s.get("first_name"), s.get("middle_name")]
                    full_name = " ".join([p for p in parts if p]).strip() or s.get("username", "")
                students[sid] = {"id": sid, "full_name": full_name}
        
        # Enrich attempts with student info
        for attempt in attempts:
            sid = str(attempt.get("student_id", ""))
            attempt["student"] = students.get(sid, {"id": sid, "full_name": "Неизвестно"})
        
        return {"attempts": attempts}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_attempts"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise


@router.get("/student/attempts")
def list_student_attempts(user: dict = require_role("student")):
    """Получить все попытки прохождения тестов текущего ученика"""
    sb = get_supabase()
    try:
        attempts_resp = (
            sb.table("test_attempts")
            .select("id,test_id,started_at,submitted_at,score,total_questions,percentage_score")
            .eq("student_id", user["id"])
            .order("started_at", desc=True)
            .execute()
        )
        attempts = attempts_resp.data or []
        
        # Get test info
        test_ids = list(set([str(a.get("test_id", "")) for a in attempts if a.get("test_id")]))
        tests = {}
        if test_ids:
            tests_resp = (
                sb.table("course_tests")
                .select("id,title,test_type")
                .in_("id", test_ids)
                .execute()
            )
            for t in (tests_resp.data or []):
                tid = str(t.get("id", ""))
                tests[tid] = {"id": tid, "title": t.get("title"), "test_type": t.get("test_type")}
        
        # Enrich attempts with test info
        for attempt in attempts:
            tid = str(attempt.get("test_id", ""))
            attempt["test"] = tests.get(tid, {"id": tid, "title": "Неизвестно"})
        
        return {"attempts": attempts}
    except APIError as e:
        if _is_missing_table_api_error(e, "public.test_attempts"):
            raise HTTPException(
                status_code=500,
                detail="Courses schema is missing. Apply migration supabase/migrations/20250101_000001_courses_system.sql",
            )
        raise