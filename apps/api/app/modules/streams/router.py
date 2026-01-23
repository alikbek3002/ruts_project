"""
Streams Router - API endpoints for educational streams (потоки) management
Handles: stream CRUD, class assignments, curriculum templates, auto-scheduling
"""

from datetime import date, datetime
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from postgrest.exceptions import APIError

from app.core.deps import require_role
from app.db.supabase_client import get_supabase


router = APIRouter(prefix="/api/streams", tags=["streams"])


def _raise_streams_schema_help(e: APIError) -> None:
    payload = getattr(e, "args", [None])[0]
    code = None
    message = None
    if isinstance(payload, dict):
        code = payload.get("code")
        message = payload.get("message")
    else:
        try:
            code = getattr(e, "code", None)
            message = getattr(e, "message", None)
        except Exception:
            pass

    if code == "PGRST205" or (isinstance(message, str) and "Could not find the table" in message):
        raise HTTPException(
            status_code=400,
            detail=(
                "Streams tables are missing in DB (migration not applied). "
                "Apply supabase/migrations/20251229_000001_streams_system.sql to your Supabase DB, "
                "then restart the API."
            ),
        )

    raise HTTPException(status_code=500, detail="Supabase error")


# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class StreamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    start_date: date
    end_date: date
    direction_id: Optional[UUID] = None
    status: str = Field(default="draft", pattern="^(draft|active|completed|archived)$")

    @field_validator("end_date")
    @classmethod
    def validate_dates(cls, v, info):
        start_date = (info.data or {}).get("start_date")
        if start_date and v <= start_date:
            raise ValueError("end_date must be after start_date")
        if start_date:
            duration = (v - start_date).days
            if duration > 100:
                raise ValueError("Stream duration should not exceed 100 days (~3 months)")
        return v


class StreamUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    direction_id: Optional[UUID] = None
    status: Optional[str] = Field(None, pattern="^(draft|active|completed|archived)$")


class StreamResponse(BaseModel):
    id: UUID
    name: str
    start_date: date
    end_date: date
    direction_id: Optional[UUID]
    direction_name: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    class_count: int = 0
    student_count: int = 0


class StreamDetailResponse(StreamResponse):
    classes: List[Dict[str, Any]] = []


class AddClassesToStream(BaseModel):
    class_ids: List[UUID] = Field(..., min_items=1)


class CurriculumTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    direction_id: Optional[UUID] = None
    is_default: bool = False


class CurriculumTemplateItemCreate(BaseModel):
    subject_id: UUID
    hours_per_week: float = Field(..., gt=0, le=40)
    lesson_type: str = Field(default="lecture", pattern="^(lecture|seminar|credit)$")


class CurriculumTemplateResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    direction_id: Optional[UUID]
    direction_name: Optional[str]
    is_default: bool
    created_at: datetime
    items: List[Dict[str, Any]] = []


class AutoScheduleRequest(BaseModel):
    template_id: Optional[UUID] = None
    force: bool = Field(default=False, description="Force regenerate even if schedule exists")


class AutoScheduleResponse(BaseModel):
    stream_id: UUID
    entries_created: int
    journal_entries_created: int = 0
    message: str
    warnings: List[str] = []


# ============================================================================
# STREAM CRUD ENDPOINTS
# ============================================================================

@router.post("", response_model=StreamResponse, status_code=status.HTTP_201_CREATED)
async def create_stream(
    data: StreamCreate,
    user: dict = require_role("admin", "manager"),
):
    """Create a new educational stream (поток)"""
    
    sb = get_supabase()
    try:
        existing = sb.table("streams").select("id").eq("name", data.name).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="Stream with this name already exists")

        result = (
            sb.table("streams")
            .insert(
                {
                    "name": data.name,
                    "start_date": data.start_date.isoformat(),
                    "end_date": data.end_date.isoformat(),
                    "direction_id": str(data.direction_id) if data.direction_id else None,
                    "status": data.status,
                }
            )
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create stream")

        stream = result.data[0]

        direction_name = None
        if stream.get("direction_id"):
            dir_result = sb.table("directions").select("name").eq("id", stream["direction_id"]).execute()
            if dir_result.data:
                direction_name = dir_result.data[0]["name"]

        return StreamResponse(
            **stream,
            direction_name=direction_name,
            class_count=0,
            student_count=0,
        )
    except APIError as e:
        _raise_streams_schema_help(e)


@router.get("", response_model=List[StreamResponse])
async def list_streams(
    status_filter: Optional[str] = None,
    direction_id: Optional[UUID] = None,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """List all streams with filtering options"""
    
    sb = get_supabase()
    try:
        query = sb.table("streams").select("*")

        if status_filter:
            query = query.eq("status", status_filter)
        else:
            # By default hide archived streams (they are in separate archive endpoints)
            query = query.neq("status", "archived")

        if direction_id:
            query = query.eq("direction_id", str(direction_id))

        result = query.order("created_at", desc=True).execute()

        streams = []
        for stream in result.data or []:
            class_count_result = (
                sb.table("stream_classes")
                .select("class_id", count="exact")
                .eq("stream_id", stream["id"])
                .execute()
            )
            class_count = class_count_result.count or 0

            student_count = 0
            if class_count > 0:
                class_ids_result = (
                    sb.table("stream_classes").select("class_id").eq("stream_id", stream["id"]).execute()
                )
                class_ids = [c["class_id"] for c in (class_ids_result.data or [])]
                if class_ids:
                    student_result = (
                        sb.table("class_enrollments")
                        .select("id", count="exact")
                        .in_("class_id", class_ids)
                        .execute()
                    )
                    student_count = student_result.count or 0

            direction_name = None
            if stream.get("direction_id"):
                dir_result = sb.table("directions").select("name").eq("id", stream["direction_id"]).execute()
                if dir_result.data:
                    direction_name = dir_result.data[0]["name"]

            streams.append(
                StreamResponse(
                    **stream,
                    direction_name=direction_name,
                    class_count=class_count,
                    student_count=student_count,
                )
            )

        return streams
    except APIError as e:
        _raise_streams_schema_help(e)


@router.get("/{stream_id:uuid}", response_model=StreamDetailResponse)
async def get_stream(
    stream_id: UUID,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get stream details with class list"""
    
    sb = get_supabase()
    try:
        result = sb.table("streams").select("*").eq("id", str(stream_id)).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Stream not found")

        stream = result.data[0]

        direction_name = None
        if stream.get("direction_id"):
            dir_result = sb.table("directions").select("name").eq("id", stream["direction_id"]).execute()
            if dir_result.data:
                direction_name = dir_result.data[0]["name"]

        classes_result = sb.table("stream_classes").select("class_id").eq("stream_id", str(stream_id)).execute()
        class_ids = [c["class_id"] for c in (classes_result.data or [])]

        classes = []
        student_count = 0
        if class_ids:
            classes_data = sb.table("classes").select("id, name, direction_id, curator_id").in_("id", class_ids).execute()
            for cls in classes_data.data or []:
                enrollment_count = (
                    sb.table("class_enrollments")
                    .select("id", count="exact")
                    .eq("class_id", cls["id"])
                    .execute()
                )
                cls_student_count = enrollment_count.count or 0
                student_count += cls_student_count

                curator_name = None
                if cls.get("curator_id"):
                    curator_result = sb.table("users").select("full_name, username").eq("id", cls["curator_id"]).execute()
                    if curator_result.data:
                        curator_name = curator_result.data[0].get("full_name") or curator_result.data[0]["username"]

                classes.append(
                    {
                        "id": cls["id"],
                        "name": cls["name"],
                        "direction_id": cls.get("direction_id"),
                        "curator_id": cls.get("curator_id"),
                        "curator_name": curator_name,
                        "student_count": cls_student_count,
                    }
                )

        return StreamDetailResponse(
            **stream,
            direction_name=direction_name,
            class_count=len(classes),
            student_count=student_count,
            classes=classes,
        )
    except APIError as e:
        _raise_streams_schema_help(e)


@router.patch("/{stream_id:uuid}", response_model=StreamResponse)
async def update_stream(
    stream_id: UUID,
    data: StreamUpdate,
    user: dict = require_role("admin", "manager"),
):
    """Update stream information"""
    
    # Check if stream exists
    sb = get_supabase()
    existing = sb.table("streams").select("*").eq("id", str(stream_id)).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    # Prevent editing archived streams
    stream = existing.data[0]
    if stream["status"] == "archived":
        raise HTTPException(status_code=400, detail="Cannot modify archived stream")
    
    # Build update dict
    update_data = {}
    if data.name is not None:
        # Check uniqueness
        name_check = sb.table("streams").select("id").eq("name", data.name).neq("id", str(stream_id)).execute()
        if name_check.data:
            raise HTTPException(status_code=400, detail="Stream with this name already exists")
        update_data["name"] = data.name
    
    if data.start_date is not None:
        update_data["start_date"] = data.start_date.isoformat()
    if data.end_date is not None:
        update_data["end_date"] = data.end_date.isoformat()
    if data.direction_id is not None:
        update_data["direction_id"] = str(data.direction_id)
    if data.status is not None:
        update_data["status"] = data.status
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    # Validate date range if both dates present
    stream_data = existing.data[0]
    final_start = data.start_date if data.start_date else datetime.fromisoformat(stream_data["start_date"]).date()
    final_end = data.end_date if data.end_date else datetime.fromisoformat(stream_data["end_date"]).date()
    
    if final_end <= final_start:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")
    if (final_end - final_start).days > 100:
        raise HTTPException(status_code=400, detail="Stream duration should not exceed 100 days")
    
    # Update
    result = sb.table("streams").update(update_data).eq("id", str(stream_id)).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update stream")
    
    stream = result.data[0]
    
    # Get counts and direction name
    class_count_result = sb.table("stream_classes").select("class_id", count="exact").eq("stream_id", str(stream_id)).execute()
    class_count = class_count_result.count or 0
    
    student_count = 0
    if class_count > 0:
        class_ids_result = sb.table("stream_classes").select("class_id").eq("stream_id", str(stream_id)).execute()
        class_ids = [c["class_id"] for c in class_ids_result.data]
        if class_ids:
            student_result = sb.table("class_enrollments").select("id", count="exact").in_("class_id", class_ids).execute()
            student_count = student_result.count or 0
    
    direction_name = None
    if stream.get("direction_id"):
        dir_result = sb.table("directions").select("name").eq("id", stream["direction_id"]).execute()
        if dir_result.data:
            direction_name = dir_result.data[0]["name"]
    
    return StreamResponse(
        **stream,
        direction_name=direction_name,
        class_count=class_count,
        student_count=student_count,
    )


@router.delete("/{stream_id:uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stream(
    stream_id: UUID,
    user: dict = require_role("admin"),
):
    """Delete a stream (admin only)"""
    
    # Check if exists
    sb = get_supabase()
    existing = sb.table("streams").select("id").eq("id", str(stream_id)).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    # Delete (cascade will remove stream_classes and timetable_entries)
    sb.table("streams").delete().eq("id", str(stream_id)).execute()
    
    return None


# ============================================================================
# STREAM CLASS MANAGEMENT
# ============================================================================

@router.post("/{stream_id:uuid}/classes", status_code=status.HTTP_201_CREATED)
async def add_classes_to_stream(
    stream_id: UUID,
    data: AddClassesToStream,
    user: dict = require_role("admin", "manager"),
):
    """Add classes to a stream"""
    
    # Check if stream exists
    sb = get_supabase()
    stream_result = sb.table("streams").select("id, status").eq("id", str(stream_id)).execute()
    if not stream_result.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    stream = stream_result.data[0]
    if stream["status"] == "archived":
        raise HTTPException(status_code=400, detail="Cannot modify archived stream")
    
    # Verify all classes exist
    classes_result = sb.table("classes").select("id").in_("id", [str(cid) for cid in data.class_ids]).execute()
    found_ids = {c["id"] for c in classes_result.data}
    requested_ids = {str(cid) for cid in data.class_ids}
    
    if found_ids != requested_ids:
        missing = requested_ids - found_ids
        raise HTTPException(status_code=404, detail=f"Classes not found: {missing}")
    
    # Check if already in stream
    existing_result = sb.table("stream_classes").select("class_id").eq("stream_id", str(stream_id)).execute()
    existing_class_ids = {c["class_id"] for c in existing_result.data}
    
    # Check if any classes are in other active streams
    for class_id in data.class_ids:
        if str(class_id) not in existing_class_ids:
            # Check if this class is in another active stream
            other_streams = sb.table("stream_classes") \
                .select("stream_id, streams!inner(name, status)") \
                .eq("class_id", str(class_id)) \
                .execute()
            
            for entry in other_streams.data or []:
                other_stream = entry.get("streams")
                if other_stream and other_stream.get("status") != "archived":
                    other_stream_id = entry.get("stream_id")
                    if str(other_stream_id) != str(stream_id):
                        stream_name = other_stream.get("name", "Unknown")
                        raise HTTPException(
                            status_code=400,
                            detail=f"Класс уже привязан к активному потоку '{stream_name}'. Сначала удалите его оттуда."
                        )
    
    # Insert new associations
    new_associations = []
    skipped = []
    for class_id in data.class_ids:
        if str(class_id) in existing_class_ids:
            skipped.append(str(class_id))
        else:
            new_associations.append({
                "stream_id": str(stream_id),
                "class_id": str(class_id),
            })
    
    if new_associations:
        sb.table("stream_classes").insert(new_associations).execute()
    
    return {
        "message": f"Added {len(new_associations)} classes to stream",
        "added": len(new_associations),
        "skipped": len(skipped),
    }


@router.delete("/{stream_id:uuid}/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_class_from_stream(
    stream_id: UUID,
    class_id: UUID,
    user: dict = require_role("admin", "manager"),
):
    """Remove a class from a stream"""
    
    # Check if stream exists
    sb = get_supabase()
    stream_result = sb.table("streams").select("id, status").eq("id", str(stream_id)).execute()
    if not stream_result.data:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    stream = stream_result.data[0]
    if stream["status"] == "archived":
        raise HTTPException(status_code=400, detail="Cannot modify archived stream")
    
    # Remove association
    result = sb.table("stream_classes").delete().eq("stream_id", str(stream_id)).eq("class_id", str(class_id)).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Class not in this stream")
    
    return {"ok": True}


# ============================================================================
# CURRICULUM TEMPLATES
# ============================================================================

@router.post("/curriculum-templates", response_model=CurriculumTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_curriculum_template(
    data: CurriculumTemplateCreate,
    user: dict = require_role("admin", "manager"),
):
    """Create a new curriculum template"""
    
    # Check uniqueness
    sb = get_supabase()
    existing = sb.table("curriculum_templates").select("id").eq("name", data.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Template with this name already exists")
    
    # If setting as default, unset other defaults
    if data.is_default:
        sb.table("curriculum_templates").update({"is_default": False}).eq("is_default", True).execute()
    
    # Insert
    result = sb.table("curriculum_templates").insert({
        "name": data.name,
        "description": data.description,
        "direction_id": str(data.direction_id) if data.direction_id else None,
        "is_default": data.is_default,
    }).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create template")
    
    template = result.data[0]
    
    # Get direction name
    direction_name = None
    if template.get("direction_id"):
        dir_result = sb.table("directions").select("name").eq("id", template["direction_id"]).execute()
        if dir_result.data:
            direction_name = dir_result.data[0]["name"]
    
    return CurriculumTemplateResponse(
        **template,
        direction_name=direction_name,
        items=[],
    )


@router.get("/curriculum-templates", response_model=List[CurriculumTemplateResponse])
async def list_curriculum_templates(
    user: dict = require_role("admin", "manager", "teacher"),
):
    """List all curriculum templates with items"""
    
    sb = get_supabase()
    result = sb.table("curriculum_templates").select("*").order("created_at", desc=True).execute()
    
    templates = []
    for tmpl in result.data:
        # Get items
        items_result = sb.table("curriculum_template_items").select("*, subjects(id, name)").eq("template_id", tmpl["id"]).execute()
        
        items = []
        for item in items_result.data:
            items.append({
                "id": item["id"],
                "subject_id": item["subject_id"],
                "subject_name": item["subjects"]["name"] if item.get("subjects") else None,
                "hours_per_week": item["hours_per_week"],
                "lesson_type": item["lesson_type"],
            })
        
        # Get direction name
        direction_name = None
        if tmpl.get("direction_id"):
            dir_result = sb.table("directions").select("name").eq("id", tmpl["direction_id"]).execute()
            if dir_result.data:
                direction_name = dir_result.data[0]["name"]
        
        templates.append(CurriculumTemplateResponse(
            **tmpl,
            direction_name=direction_name,
            items=items,
        ))
    
    return templates


@router.post("/curriculum-templates/{template_id}/items", status_code=status.HTTP_201_CREATED)
async def add_curriculum_item(
    template_id: UUID,
    data: CurriculumTemplateItemCreate,
    user: dict = require_role("admin", "manager"),
):
    """Add a subject to curriculum template"""
    
    # Check template exists
    sb = get_supabase()
    tmpl_result = sb.table("curriculum_templates").select("id").eq("id", str(template_id)).execute()
    if not tmpl_result.data:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Check subject exists
    subj_result = sb.table("subjects").select("id").eq("id", str(data.subject_id)).execute()
    if not subj_result.data:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Check if already exists
    existing = sb.table("curriculum_template_items").select("id").eq("template_id", str(template_id)).eq("subject_id", str(data.subject_id)).eq("lesson_type", data.lesson_type).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Item already exists in template")
    
    # Insert
    result = sb.table("curriculum_template_items").insert({
        "template_id": str(template_id),
        "subject_id": str(data.subject_id),
        "hours_per_week": data.hours_per_week,
        "lesson_type": data.lesson_type,
    }).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to add item")
    
    return {"message": "Item added successfully", "item": result.data[0]}


@router.delete("/curriculum-templates/{template_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_curriculum_item(
    template_id: UUID,
    item_id: UUID,
    user: dict = require_role("admin", "manager"),
):
    """Remove a subject from curriculum template"""
    
    sb = get_supabase()
    result = sb.table("curriculum_template_items").delete().eq("id", str(item_id)).eq("template_id", str(template_id)).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")
    
    return None


# ============================================================================
# AUTO-SCHEDULING
# ============================================================================

from app.modules.streams.scheduler import generate_schedule


@router.post("/{stream_id:uuid}/generate-schedule", response_model=AutoScheduleResponse)
async def auto_generate_schedule(
    stream_id: UUID,
    data: AutoScheduleRequest,
    user: dict = require_role("admin", "manager"),
):
    """Auto-generate timetable for a stream based on curriculum template
    
    This will:
    - Load curriculum template (subject hours per week)
    - Group classes (2-4 vzvodы per lesson)
    - Allocate time slots avoiding conflicts with other streams
    - Assign teachers and rooms
    - Respect lunch break (13:20-14:20)
    - Skip Saturdays (subbotnik)
    - Create timetable entries
    """
    
    sb = get_supabase()
    result = await generate_schedule(
        sb=sb,
        stream_id=str(stream_id),
        template_id=str(data.template_id) if data.template_id else None,
        force=data.force,
        user_id=str(user["id"]),
    )
    
    return AutoScheduleResponse(**result)


# ============================================================================
# ARCHIVE SYSTEM
# ============================================================================

class ArchiveStreamResponse(BaseModel):
    stream_id: UUID
    stream_name: str
    archived_at: datetime
    class_count: int
    student_count: int


class ArchivedStreamStatsResponse(BaseModel):
    stream_id: UUID
    stream_name: str
    start_date: date
    end_date: date
    archived_at: Optional[datetime]
    direction_id: Optional[UUID]
    direction_name: Optional[str]
    total_classes: int
    total_students: int
    avg_attendance_percentage: Optional[float]
    avg_lesson_grade: Optional[float]
    total_lesson_grades: int
    avg_subject_grade: Optional[float]
    total_subject_grades: int
    total_test_attempts: int
    avg_test_score: Optional[float]
    total_subject_test_attempts: int
    avg_subject_test_score: Optional[float]
    total_timetable_entries: int


class ArchivedStudentPerformance(BaseModel):
    student_id: UUID
    student_name: str
    class_id: UUID
    class_name: str
    total_lessons: int
    lessons_attended: int
    attendance_percentage: Optional[float]
    avg_lesson_grade: Optional[float]
    lesson_grades_count: int
    avg_subject_grade: Optional[float]
    subject_grades_count: int
    test_attempts_count: int
    tests_completed: int
    avg_test_score: Optional[float]
    subject_test_attempts_count: int
    subject_tests_completed: int
    avg_subject_test_score: Optional[float]
    passed_course: bool


@router.post("/{stream_id:uuid}/archive", response_model=ArchiveStreamResponse)
async def archive_stream_manually(
    stream_id: UUID,
    user: dict = require_role("admin", "manager"),
):
    """Manually archive a stream
    
    This will:
    - Change stream status to 'archived'
    - Set archived_at timestamp
    - Return statistics about the archived stream
    """
    
    sb = get_supabase()
    
    # Call the database function
    try:
        result = sb.rpc("archive_stream", {"p_stream_id": str(stream_id)}).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to archive stream")
        
        data = result.data
        
        return ArchiveStreamResponse(
            stream_id=data["stream_id"],
            stream_name=data["stream_name"],
            archived_at=data["archived_at"],
            class_count=data["class_count"],
            student_count=data["student_count"],
        )
    except APIError as e:
        error_msg = str(e)
        if "Stream not found" in error_msg:
            raise HTTPException(status_code=404, detail="Stream not found")
        elif "already archived" in error_msg:
            raise HTTPException(status_code=400, detail="Stream is already archived")
        else:
            raise HTTPException(status_code=500, detail=f"Database error: {error_msg}")


@router.get("/archived", response_model=List[ArchivedStreamStatsResponse])
async def list_archived_streams(
    direction_id: Optional[UUID] = None,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get list of all archived streams with statistics
    
    Uses the archived_streams_stats view for comprehensive statistics.
    """
    
    sb = get_supabase()
    
    try:
        query = sb.table("archived_streams_stats").select("*")
        
        if direction_id:
            query = query.eq("direction_id", str(direction_id))
        
        result = query.order("archived_at", desc=True).execute()
        
        return [ArchivedStreamStatsResponse(**stream) for stream in result.data or []]
    except APIError as e:
        raise HTTPException(status_code=500, detail="Failed to fetch archived streams")


@router.get("/archived/{stream_id:uuid}", response_model=ArchivedStreamStatsResponse)
async def get_archived_stream_details(
    stream_id: UUID,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get detailed statistics for a specific archived stream"""
    
    sb = get_supabase()
    
    try:
        result = sb.table("archived_streams_stats").select("*").eq("stream_id", str(stream_id)).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Archived stream not found")
        
        return ArchivedStreamStatsResponse(**result.data[0])
    except APIError as e:
        raise HTTPException(status_code=500, detail="Failed to fetch archived stream details")


@router.get("/archived/{stream_id:uuid}/students", response_model=List[ArchivedStudentPerformance])
async def get_archived_stream_students(
    stream_id: UUID,
    class_id: Optional[UUID] = None,
    passed_only: Optional[bool] = None,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get student performance data for an archived stream
    
    Query parameters:
    - class_id: Filter by specific class
    - passed_only: Filter to show only students who passed (true) or failed (false)
    """
    
    sb = get_supabase()
    
    try:
        query = sb.table("archived_student_performance").select("*").eq("stream_id", str(stream_id))
        
        if class_id:
            query = query.eq("class_id", str(class_id))
        
        if passed_only is not None:
            query = query.eq("passed_course", passed_only)
        
        result = query.order("class_name").order("student_name").execute()
        
        return [ArchivedStudentPerformance(**student) for student in result.data or []]
    except APIError as e:
        raise HTTPException(status_code=500, detail="Failed to fetch student performance data")


@router.post("/auto-archive", status_code=status.HTTP_200_OK)
async def auto_archive_streams(
    user: dict = require_role("admin"),
):
    """Automatically archive completed streams that are 7 days past their end date
    
    This endpoint should be called by a cron job or scheduled task.
    Only admin users can trigger auto-archiving.
    """
    
    sb = get_supabase()
    
    try:
        # 1. Archive streams
        result = sb.rpc("auto_archive_completed_streams").execute()
        archived_streams = result.data or []
        
        # 2. Archive teacher workload (previous month)
        # This is safe to run daily, it will update stats if they changed
        sb.rpc("auto_archive_teacher_workload").execute()
        
        return {
            "message": f"Successfully archived {len(archived_streams)} streams and updated teacher workload stats",
            "archived_count": len(archived_streams),
            "archived_streams": [
                {
                    "id": stream["archived_stream_id"],
                    "name": stream["archived_stream_name"],
                    "archived_at": stream["archived_at"],
                }
                for stream in archived_streams
            ],
            "workload_archived": True
        }
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Auto-archive failed: {str(e)}")


@router.post("/archive/workload/monthly", status_code=status.HTTP_200_OK)
async def manual_archive_teacher_workload(
    year: int,
    month: int,
    user: dict = require_role("admin"),
):
    """Manually trigger teacher workload archive for a specific month"""
    
    sb = get_supabase()
    try:
        sb.rpc("archive_teacher_workload_monthly", {"p_year": year, "p_month": month}).execute()
        return {"message": f"Successfully archived teacher workload for {year}-{month}"}
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive workload: {str(e)}")


@router.get("/archived/{stream_id:uuid}/schedule", response_model=List[Dict[str, Any]])
async def get_archived_stream_schedule(
    stream_id: UUID,
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get the timetable/schedule for an archived stream (read-only)"""
    
    sb = get_supabase()
    
    try:
        # First verify stream exists and is archived
        stream_result = sb.table("streams").select("id, status").eq("id", str(stream_id)).execute()
        if not stream_result.data:
            raise HTTPException(status_code=404, detail="Stream not found")
        
        if stream_result.data[0]["status"] != "archived":
            raise HTTPException(status_code=400, detail="Stream is not archived")
        
        # Get timetable entries
        result = sb.table("timetable_entries").select(
            "*, subjects(name), users(full_name)"
        ).eq("stream_id", str(stream_id)).order("weekday").order("start_time").execute()
        
        schedule = []
        for entry in result.data or []:
            schedule.append({
                "id": entry["id"],
                "weekday": entry["weekday"],
                "start_time": entry["start_time"],
                "end_time": entry["end_time"],
                "subject": entry.get("subject"),
                "teacher_name": entry["users"]["full_name"] if entry.get("users") else None,
                "room": entry.get("room"),
                "duration_minutes": entry.get("duration_minutes"),
            })
        
        return schedule
    except APIError as e:
        raise HTTPException(status_code=500, detail="Failed to fetch schedule")


@router.post("/archived/{stream_id:uuid}/restore", response_model=dict)
async def restore_stream(
    stream_id: UUID,
    user: dict = require_role("admin"),
):
    """Restore a stream from archive back to completed status (admin only)
    
    This allows admins to restore accidentally archived streams.
    """
    
    sb = get_supabase()
    
    try:
        result = sb.rpc("restore_stream_from_archive", {"p_stream_id": str(stream_id)}).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to restore stream")
        
        data = result.data
        
        return {
            "stream_id": data["stream_id"],
            "stream_name": data["stream_name"],
            "restored_at": data["restored_at"],
            "new_status": data["new_status"],
            "message": f"Stream '{data['stream_name']}' has been restored from archive",
        }
    except APIError as e:
        error_msg = str(e)
        if "Stream not found" in error_msg:
            raise HTTPException(status_code=404, detail="Stream not found")
        elif "not archived" in error_msg:
            raise HTTPException(status_code=400, detail="Stream is not archived")
        else:
            raise HTTPException(status_code=500, detail=f"Database error: {error_msg}")


@router.get("/archive/summary", response_model=dict)
async def get_archive_summary(
    user: dict = require_role("admin", "manager", "teacher"),
):
    """Get overall archive statistics across all archived streams
    
    Returns:
    - Total number of archived streams
    - Total students and classes in archive
    - Overall average attendance and grades
    - Oldest and newest archived dates
    """
    
    sb = get_supabase()
    
    try:
        result = sb.rpc("get_archive_summary").execute()
        
        if not result.data:
            # Return empty stats if no archives
            return {
                "total_archived_streams": 0,
                "total_students_in_archive": 0,
                "total_classes_in_archive": 0,
                "avg_attendance_overall": 0,
                "avg_grade_overall": 0,
                "oldest_archived": None,
                "newest_archived": None,
            }
        
        return result.data
    except APIError as e:
        raise HTTPException(status_code=500, detail="Failed to fetch archive summary")
