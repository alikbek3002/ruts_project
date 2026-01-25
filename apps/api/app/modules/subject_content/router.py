from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from postgrest.exceptions import APIError

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()

SHARED_STUDENT_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000001"


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


def _is_shared_student_account(user: dict) -> bool:
    return str(user.get("id")) == SHARED_STUDENT_USER_ID or (
        user.get("role") == "student" and (user.get("username") or "").strip().lower() == "student"
    )


def _resolve_effective_student_id(user: dict, requested_student_id: str | None) -> str:
    """
    Возвращает ID студента для записи в базу данных.
    Для shared student account возвращаем SHARED_STUDENT_USER_ID,
    так как таблицы subject_topic_reads/attempts требуют FK на users.
    requested_student_id (enrollment ID) используется только для проверки принадлежности к группе.
    """
    if _is_shared_student_account(user):
        if not requested_student_id:
            raise HTTPException(status_code=400, detail="Требуется выбрать ученика")
        # Возвращаем SHARED_STUDENT_USER_ID для записи в БД,
        # enrollment ID будет проверен отдельно в _ensure_student_in_class
        return SHARED_STUDENT_USER_ID
    return str(user.get("id"))


def _ensure_student_in_class(sb, class_id: str, student_id: str):
    if not class_id:
        raise HTTPException(status_code=400, detail="Требуется выбрать группу")
    # Ищем по enrollment id (первичный ключ) или по legacy_student_id для обратной совместимости
    enr = (
        sb.table("class_enrollments")
        .select("id")
        .eq("class_id", class_id)
        .eq("id", student_id)
        .limit(1)
        .execute()
        .data
    )
    if not enr:
        # Попробуем поиск по legacy_student_id для обратной совместимости
        enr = (
            sb.table("class_enrollments")
            .select("id")
            .eq("class_id", class_id)
            .eq("legacy_student_id", student_id)
            .limit(1)
            .execute()
            .data
        )
    if not enr:
        raise HTTPException(status_code=400, detail="Выбранный ученик не найден в этой группе")


# ============================================================
# Models
# ============================================================


class MarkReadIn(BaseModel):
    student_id: str | None = None
    class_id: str | None = None


class CreateLinkMaterialIn(BaseModel):
    title: str
    url: str


class CreateQuizTestIn(BaseModel):
    topic_id: str
    title: str
    description: str | None = None
    time_limit_minutes: int


class CreateQuestionIn(BaseModel):
    question_text: str
    order_index: int = 0


class CreateOptionIn(BaseModel):
    option_text: str
    is_correct: bool = False
    order_index: int = 0


class StartAttemptIn(BaseModel):
    student_id: str | None = None
    class_id: str | None = None


class SubmitAttemptIn(BaseModel):
    answers: list[dict]
    student_id: str | None = None
    class_id: str | None = None


class CreateTopicIn(BaseModel):
    topic_number: int
    topic_name: str
    description: str | None = None


class UpdateTopicIn(BaseModel):
    topic_number: int | None = None
    topic_name: str | None = None
    description: str | None = None


# ============================================================
# Student-facing: subjects content + gating
# ============================================================


@router.get("/subjects")
def list_subjects_for_student(user: dict = require_role("student")):
    sb = get_supabase()
    subjects = sb.table("subjects").select("id,name,photo_url").order("name").execute().data or []
    return {"subjects": subjects}


@router.get("/subjects/{subject_id}")
def get_subject_content(subject_id: str, student_id: str | None = None, class_id: str | None = None, user: dict = require_role("student")):
    sb = get_supabase()

    effective_student_id = _resolve_effective_student_id(user, student_id)
    if _is_shared_student_account(user):
        # Проверяем по enrollment ID (student_id из query params), а не по effective_student_id
        _ensure_student_in_class(sb, str(class_id or ""), str(student_id or ""))

    subj = sb.table("subjects").select("id,name,photo_url").eq("id", subject_id).limit(1).execute().data
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")

    topics = (
        sb.table("subject_topics")
        .select("id,subject_id,topic_number,topic_name,description")
        .eq("subject_id", subject_id)
        .order("topic_number")
        .execute()
        .data
        or []
    )
    topic_ids = [str(t.get("id")) for t in topics if t.get("id")]

    materials_by_topic: dict[str, list[dict]] = {tid: [] for tid in topic_ids}
    tests_by_topic: dict[str, list[dict]] = {tid: [] for tid in topic_ids}
    read_topic_ids: set[str] = set()

    if topic_ids:
        mats = (
            sb.table("subject_topic_materials")
            .select(
                "id,topic_id,kind,title,url,storage_bucket,storage_path,original_filename,created_at"
            )
            .in_("topic_id", topic_ids)
            .order("created_at")
            .execute()
            .data
            or []
        )
        for m in mats:
            tid = str(m.get("topic_id"))
            if tid:
                # Best-effort: signed URL for files
                try:
                    if m.get("kind") == "file" and m.get("storage_bucket") and m.get("storage_path"):
                        signed = sb.storage.from_(str(m.get("storage_bucket"))).create_signed_url(
                            str(m.get("storage_path")), 3600
                        )
                        m["signed_url"] = signed.get("signedURL")
                except Exception:
                    pass
                materials_by_topic.setdefault(tid, []).append(m)

        tests = (
            sb.table("subject_tests")
            .select("id,topic_id,title,description,test_type,time_limit_minutes,created_at")
            .in_("topic_id", topic_ids)
            .order("created_at")
            .execute()
            .data
            or []
        )
        for t in tests:
            tid = str(t.get("topic_id"))
            if tid:
                tests_by_topic.setdefault(tid, []).append(t)

        reads = (
            sb.table("subject_topic_reads")
            .select("topic_id")
            .eq("student_id", effective_student_id)
            .in_("topic_id", topic_ids)
            .execute()
            .data
            or []
        )
        for r in reads:
            if r.get("topic_id"):
                read_topic_ids.add(str(r.get("topic_id")))

    # Attempts summary
    test_ids: list[str] = []
    for tid in topic_ids:
        for t in tests_by_topic.get(tid, []):
            if t.get("id"):
                test_ids.append(str(t.get("id")))
    test_ids = list(dict.fromkeys(test_ids))

    best_pct_by_test: dict[str, float] = {}
    passed_by_test: dict[str, bool] = {}
    if test_ids:
        attempts = (
            sb.table("subject_test_attempts")
            .select("test_id,percentage_score,submitted_at")
            .eq("student_id", effective_student_id)
            .in_("test_id", test_ids)
            .not_.is_("submitted_at", "null")
            .execute()
            .data
            or []
        )
        for a in attempts:
            tid = str(a.get("test_id") or "")
            pct = float(a.get("percentage_score") or 0)
            if not tid:
                continue
            if tid not in best_pct_by_test or pct > best_pct_by_test[tid]:
                best_pct_by_test[tid] = pct

        for tid, pct in best_pct_by_test.items():
            passed_by_test[tid] = pct >= 60.0

    # Determine primary test per topic (first created)
    primary_test_id_by_topic: dict[str, str | None] = {}
    for tid in topic_ids:
        tlist = tests_by_topic.get(tid, [])
        primary_test_id_by_topic[tid] = str(tlist[0].get("id")) if tlist and tlist[0].get("id") else None

    # Build topics with gating
    out_topics: list[dict] = []
    prev_topic_primary_passed = True

    for t in topics:
        tid = str(t.get("id"))
        is_read = tid in read_topic_ids

        topic_tests_out: list[dict] = []
        for test in tests_by_topic.get(tid, []):
            test_id = str(test.get("id")) if test.get("id") else ""
            best_pct = best_pct_by_test.get(test_id)
            passed = bool(passed_by_test.get(test_id, False)) if test_id else False

            can_start = bool(is_read and prev_topic_primary_passed)
            locked_reason = None
            if not is_read:
                locked_reason = "Сначала нажмите «прочитал»"
            elif not prev_topic_primary_passed:
                locked_reason = "Сначала сдайте прошлый тест"

            topic_tests_out.append(
                {
                    **test,
                    "best_percentage": best_pct,
                    "passed": passed,
                    "can_start": can_start,
                    "locked_reason": locked_reason,
                }
            )

        primary_test_id = primary_test_id_by_topic.get(tid)
        if primary_test_id:
            prev_topic_primary_passed = bool(passed_by_test.get(primary_test_id, False))
        else:
            prev_topic_primary_passed = True

        out_topics.append(
            {
                **t,
                "is_read": is_read,
                "materials": materials_by_topic.get(tid, []),
                "tests": topic_tests_out,
            }
        )

    return {"subject": subj[0], "topics": out_topics}


@router.post("/topics/{topic_id}/read")
def mark_topic_read(topic_id: str, payload: MarkReadIn, user: dict = require_role("student")):
    sb = get_supabase()

    effective_student_id = _resolve_effective_student_id(user, payload.student_id)
    if _is_shared_student_account(user):
        # Проверяем по enrollment ID (payload.student_id), а не по effective_student_id
        _ensure_student_in_class(sb, str(payload.class_id or ""), str(payload.student_id or ""))

    # Validate topic exists
    topic = sb.table("subject_topics").select("id").eq("id", topic_id).limit(1).execute().data
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    sb.table("subject_topic_reads").upsert(
        {"student_id": effective_student_id, "topic_id": topic_id},
        on_conflict="student_id,topic_id",
    ).execute()

    return {"ok": True}


# ============================================================
# Teacher/admin: materials
# ============================================================


@router.get("/teacher/subjects")
def list_subjects_for_teacher(user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    subjects = sb.table("subjects").select("id,name,photo_url").order("name").execute().data or []
    return {"subjects": subjects}


@router.get("/teacher/subjects/{subject_id}")
def get_subject_content_for_teacher(subject_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    subj = sb.table("subjects").select("id,name,photo_url").eq("id", subject_id).limit(1).execute().data
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")

    topics = (
        sb.table("subject_topics")
        .select("id,subject_id,topic_number,topic_name,description")
        .eq("subject_id", subject_id)
        .order("topic_number")
        .execute()
        .data
        or []
    )
    topic_ids = [str(t.get("id")) for t in topics if t.get("id")]

    materials_by_topic: dict[str, list[dict]] = {tid: [] for tid in topic_ids}
    tests_by_topic: dict[str, list[dict]] = {tid: [] for tid in topic_ids}

    if topic_ids:
        mats = (
            sb.table("subject_topic_materials")
            .select(
                "id,topic_id,kind,title,url,storage_bucket,storage_path,original_filename,created_at"
            )
            .in_("topic_id", topic_ids)
            .order("created_at")
            .execute()
            .data
            or []
        )
        for m in mats:
            tid = str(m.get("topic_id"))
            if tid:
                try:
                    if m.get("kind") == "file" and m.get("storage_bucket") and m.get("storage_path"):
                        signed = sb.storage.from_(str(m.get("storage_bucket"))).create_signed_url(
                            str(m.get("storage_path")), 3600
                        )
                        m["signed_url"] = signed.get("signedURL")
                except Exception:
                    pass
                materials_by_topic.setdefault(tid, []).append(m)

        tests = (
            sb.table("subject_tests")
            .select(
                "id,topic_id,title,description,test_type,time_limit_minutes,document_storage_path,document_original_filename,created_at"
            )
            .in_("topic_id", topic_ids)
            .order("created_at")
            .execute()
            .data
            or []
        )
        for t in tests:
            tid = str(t.get("topic_id"))
            if tid:
                tests_by_topic.setdefault(tid, []).append(t)

    out_topics: list[dict] = []
    for t in topics:
        tid = str(t.get("id"))
        out_topics.append(
            {
                **t,
                "materials": materials_by_topic.get(tid, []),
                "tests": tests_by_topic.get(tid, []),
            }
        )

    return {"subject": subj[0], "topics": out_topics}


@router.post("/teacher/subjects/{subject_id}/topics")
def create_subject_topic(subject_id: str, payload: CreateTopicIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    subj = sb.table("subjects").select("id").eq("id", subject_id).limit(1).execute().data
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")

    name = (payload.topic_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="topic_name is required")

    try:
        resp = (
            sb.table("subject_topics")
            .insert(
                {
                    "subject_id": subject_id,
                    "topic_number": int(payload.topic_number),
                    "topic_name": name,
                    "description": (payload.description.strip() if payload.description else None),
                }
            )
            .execute()
        )
    except APIError as e:
        # Unique(subject_id, topic_number)
        if "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Topic number already exists")
        raise

    topic = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
    return {"topic": topic}


@router.put("/teacher/topics/{topic_id}")
def update_subject_topic(topic_id: str, payload: UpdateTopicIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    existing = sb.table("subject_topics").select("id").eq("id", topic_id).limit(1).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Topic not found")

    update_data: dict = {}
    if payload.topic_number is not None:
        update_data["topic_number"] = int(payload.topic_number)
    if payload.topic_name is not None:
        update_data["topic_name"] = (payload.topic_name or "").strip()
    if payload.description is not None:
        update_data["description"] = payload.description.strip() if payload.description else None

    if not update_data:
        return {"ok": True}

    try:
        resp = sb.table("subject_topics").update(update_data).eq("id", topic_id).execute()
    except APIError as e:
        if "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Topic number already exists")
        raise

    topic = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
    return {"topic": topic}


@router.delete("/teacher/topics/{topic_id}")
def delete_subject_topic(topic_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    
    # Check existence
    existing = sb.table("subject_topics").select("id,subject_id").eq("id", topic_id).limit(1).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Topic not found")
        
    sb.table("subject_topics").delete().eq("id", topic_id).execute()
    
    return {"ok": True}


@router.post("/topics/{topic_id}/materials/link")
def create_link_material(topic_id: str, payload: CreateLinkMaterialIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    topic = (
        sb.table("subject_topics")
        .select("id,subject_id")
        .eq("id", topic_id)
        .single()
        .execute()
        .data
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    title = (payload.title or "").strip()
    url = (payload.url or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    row = (
        sb.table("subject_topic_materials")
        .insert(
            {
                "subject_id": topic.get("subject_id"),
                "topic_id": topic_id,
                "kind": "link",
                "title": title,
                "url": url,
                "uploaded_by": user.get("id"),
            }
        )
        .execute()
    )
    return {"material": row.data[0] if isinstance(row.data, list) and row.data else row.data}


@router.delete("/materials/{material_id}")
def delete_material(material_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    sb.table("subject_topic_materials").delete().eq("id", material_id).execute()
    return {"ok": True}


@router.post("/topics/{topic_id}/materials/file")
async def create_file_material(
    topic_id: str,
    title: str = Form(""),
    file: UploadFile = File(...),
    user: dict = require_role("teacher", "admin", "manager"),
):
    sb = get_supabase()

    topic = (
        sb.table("subject_topics")
        .select("id,subject_id")
        .eq("id", topic_id)
        .single()
        .execute()
        .data
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    display_title = (title or "").strip() or (file.filename or "Файл")

    file_ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else ""
    unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
    storage_path = f"subjects/{topic.get('subject_id')}/topics/{topic_id}/{unique_filename}"
    content = await file.read()

    try:
        sb.storage.from_("library").upload(
            path=storage_path,
            file=content,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    row = (
        sb.table("subject_topic_materials")
        .insert(
            {
                "subject_id": topic.get("subject_id"),
                "topic_id": topic_id,
                "kind": "file",
                "title": display_title,
                "storage_bucket": "library",
                "storage_path": storage_path,
                "original_filename": file.filename,
                "uploaded_by": user.get("id"),
            }
        )
        .execute()
    )

    return {"material": row.data[0] if isinstance(row.data, list) and row.data else row.data}


# ============================================================
# Tests (quiz/document) + questions/options + attempts
# ============================================================


@router.post("/tests/quiz")
def create_quiz_test(payload: CreateQuizTestIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    # Validate topic
    topic = (
        sb.table("subject_topics")
        .select("id")
        .eq("id", payload.topic_id)
        .limit(1)
        .execute()
        .data
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    if payload.time_limit_minutes <= 0:
        raise HTTPException(status_code=400, detail="Time limit must be greater than 0")

    test_resp = (
        sb.table("subject_tests")
        .insert(
            {
                "topic_id": payload.topic_id,
                "title": payload.title.strip(),
                "description": payload.description.strip() if payload.description else None,
                "test_type": "quiz",
                "time_limit_minutes": payload.time_limit_minutes,
            }
        )
        .execute()
    )
    test = test_resp.data[0] if isinstance(test_resp.data, list) and test_resp.data else test_resp.data
    return {"test": test}


@router.delete("/tests/{test_id}")
def delete_test(test_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    sb.table("subject_tests").delete().eq("id", test_id).execute()
    return {"ok": True}


@router.post("/tests/document")
async def create_document_test(
    topic_id: str = Form(...),
    title: str = Form(...),
    description: str | None = Form(None),
    document: UploadFile | None = File(None),
    user: dict = require_role("teacher", "admin", "manager"),
):
    sb = get_supabase()

    topic = (
        sb.table("subject_topics")
        .select("id,subject_id")
        .eq("id", topic_id)
        .single()
        .execute()
        .data
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    document_path = None
    document_filename = None

    if document:
        file_ext = document.filename.split(".")[-1] if document.filename and "." in document.filename else ""
        unique_filename = f"{uuid.uuid4().hex}.{file_ext}" if file_ext else uuid.uuid4().hex
        storage_path = f"subjects/{topic.get('subject_id')}/tests/{unique_filename}"
        content = await document.read()

        try:
            sb.storage.from_("library").upload(
                path=storage_path,
                file=content,
                file_options={"content-type": document.content_type or "application/octet-stream"},
            )
            document_path = storage_path
            document_filename = document.filename
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Document upload failed: {str(e)}")

    test_resp = (
        sb.table("subject_tests")
        .insert(
            {
                "topic_id": topic_id,
                "title": title.strip(),
                "description": description.strip() if description else None,
                "document_storage_path": document_path,
                "document_original_filename": document_filename,
                "test_type": "document",
                "time_limit_minutes": None,
            }
        )
        .execute()
    )
    test = test_resp.data[0] if isinstance(test_resp.data, list) and test_resp.data else test_resp.data
    return {"test": test}


@router.post("/tests/{test_id}/questions")
def create_question(test_id: str, payload: CreateQuestionIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    test = (
        sb.table("subject_tests")
        .select("id,test_type")
        .eq("id", test_id)
        .single()
        .execute()
        .data
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    if test.get("test_type") != "quiz":
        raise HTTPException(status_code=400, detail="Questions can only be added to quiz tests")

    question_text = (payload.question_text or "").strip()
    if not question_text:
        raise HTTPException(status_code=400, detail="Question text is required")

    q_resp = (
        sb.table("subject_test_questions")
        .insert(
            {
                "test_id": test_id,
                "question_text": question_text,
                "order_index": payload.order_index,
            }
        )
        .execute()
    )
    q = q_resp.data[0] if isinstance(q_resp.data, list) and q_resp.data else q_resp.data
    return {"question": q}


@router.delete("/questions/{question_id}")
def delete_question(question_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    sb.table("subject_test_questions").delete().eq("id", question_id).execute()
    return {"ok": True}


@router.post("/questions/{question_id}/options")
def create_option(question_id: str, payload: CreateOptionIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    # Validate question exists
    q = (
        sb.table("subject_test_questions")
        .select("id")
        .eq("id", question_id)
        .single()
        .execute()
        .data
    )
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    option_text = (payload.option_text or "").strip()
    if not option_text:
        raise HTTPException(status_code=400, detail="Option text is required")

    o_resp = (
        sb.table("subject_test_question_options")
        .insert(
            {
                "question_id": question_id,
                "option_text": option_text,
                "is_correct": bool(payload.is_correct),
                "order_index": payload.order_index,
            }
        )
        .execute()
    )
    opt = o_resp.data[0] if isinstance(o_resp.data, list) and o_resp.data else o_resp.data
    return {"option": opt}


@router.delete("/options/{option_id}")
def delete_option(option_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()
    sb.table("subject_test_question_options").delete().eq("id", option_id).execute()
    return {"ok": True}


@router.post("/tests/{test_id}/start")
def start_attempt(test_id: str, payload: StartAttemptIn, user: dict = require_role("student")):
    print(f"[START_ATTEMPT] Called with test_id={test_id}, payload={payload}")
    sb = get_supabase()

    effective_student_id = _resolve_effective_student_id(user, payload.student_id)
    print(f"[START_ATTEMPT] effective_student_id={effective_student_id}")
    
    if _is_shared_student_account(user):
        # Проверяем по enrollment ID, а не по effective_student_id
        _ensure_student_in_class(sb, str(payload.class_id or ""), str(payload.student_id or ""))

    print(f"[START_ATTEMPT] Fetching test...")
    test = (
        sb.table("subject_tests")
        .select("id,test_type,time_limit_minutes,topic_id")
        .eq("id", test_id)
        .single()
        .execute()
        .data
    )
    print(f"[START_ATTEMPT] Test fetched: {test}")
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    # Must be read
    print(f"[START_ATTEMPT] Checking if topic {test.get('topic_id')} is read by student {effective_student_id}...")
    read_row = (
        sb.table("subject_topic_reads")
        .select("id")
        .eq("student_id", effective_student_id)
        .eq("topic_id", test.get("topic_id"))
        .limit(1)
        .execute()
        .data
    )
    print(f"[START_ATTEMPT] Read check result: {read_row}")
    if not read_row:
        raise HTTPException(status_code=400, detail="Сначала нажмите «прочитал»")

    print(f"[START_ATTEMPT] Checking for existing attempt...")
    existing = (
        sb.table("subject_test_attempts")
        .select("id,time_limit_seconds")
        .eq("test_id", test_id)
        .eq("student_id", effective_student_id)
        .is_("submitted_at", "null")
        .limit(1)
        .execute()
        .data
    )
    
    # If there's an existing attempt, return it instead of creating a new one
    if existing:
        print(f"[START_ATTEMPT] Found existing attempt, returning it: {existing[0].get('id')}")
        existing_attempt = existing[0]
        existing_time_limit = existing_attempt.get("time_limit_seconds")
        
        # For quiz tests, fetch questions
        if test.get("test_type") == "quiz":
            print(f"[START_ATTEMPT] Fetching questions for existing attempt...")
            questions = (
                sb.table("subject_test_questions")
                .select("id,question_text,order_index")
                .eq("test_id", test_id)
                .order("order_index")
                .execute()
                .data
                or []
            )
            
            question_ids = [str(q.get("id")) for q in questions if q.get("id")]
            options_by_question: dict[str, list[dict]] = {qid: [] for qid in question_ids}
            
            if question_ids:
                options = (
                    sb.table("subject_test_question_options")
                    .select("id,question_id,option_text,order_index")
                    .in_("question_id", question_ids)
                    .order("order_index")
                    .execute()
                    .data
                    or []
                )
                for o in options:
                    qid = str(o.get("question_id"))
                    options_by_question.setdefault(qid, []).append(
                        {
                            "id": o.get("id"),
                            "option_text": o.get("option_text"),
                            "order_index": o.get("order_index"),
                        }
                    )
            
            for q in questions:
                qid = str(q.get("id"))
                q["options"] = options_by_question.get(qid, [])
            
            print(f"[START_ATTEMPT] Returning existing attempt with questions")
            return {"attempt": existing_attempt, "questions": questions, "time_limit_seconds": existing_time_limit}
        else:
            return {"attempt": existing_attempt, "test": test}

    time_limit_seconds = None
    if test.get("test_type") == "quiz":
        mins = test.get("time_limit_minutes")
        if mins:
            time_limit_seconds = int(mins) * 60

    attempt_resp = (
        sb.table("subject_test_attempts")
        .insert(
            {
                "test_id": test_id,
                "student_id": effective_student_id,
                "time_limit_seconds": time_limit_seconds,
            }
        )
        .execute()
    )
    attempt = (
        attempt_resp.data[0]
        if isinstance(attempt_resp.data, list) and attempt_resp.data
        else attempt_resp.data
    )

    if test.get("test_type") != "quiz":
        return {"attempt": attempt, "test": test}

    print(f"[START_ATTEMPT] Fetching questions for test_id={test_id}...")
    questions = (
        sb.table("subject_test_questions")
        .select("id,question_text,order_index")
        .eq("test_id", test_id)
        .order("order_index")
        .execute()
        .data
        or []
    )
    print(f"[START_ATTEMPT] Found {len(questions)} questions")

    question_ids = [str(q.get("id")) for q in questions if q.get("id")]
    options_by_question: dict[str, list[dict]] = {qid: [] for qid in question_ids}

    if question_ids:
        print(f"[START_ATTEMPT] Fetching options for {len(question_ids)} questions...")
        options = (
            sb.table("subject_test_question_options")
            .select("id,question_id,option_text,order_index")
            .in_("question_id", question_ids)
            .order("order_index")
            .execute()
            .data
            or []
        )
        print(f"[START_ATTEMPT] Found {len(options)} options")
        for o in options:
            qid = str(o.get("question_id"))
            options_by_question.setdefault(qid, []).append(
                {
                    "id": o.get("id"),
                    "option_text": o.get("option_text"),
                    "order_index": o.get("order_index"),
                }
            )

    for q in questions:
        qid = str(q.get("id"))
        q["options"] = options_by_question.get(qid, [])

    print(f"[START_ATTEMPT] Returning response...")
    return {"attempt": attempt, "questions": questions, "time_limit_seconds": time_limit_seconds}


@router.post("/attempts/{attempt_id}/submit")
def submit_attempt(attempt_id: str, payload: SubmitAttemptIn, user: dict = require_role("student")):
    sb = get_supabase()

    attempt = (
        sb.table("subject_test_attempts")
        .select("id,test_id,student_id,submitted_at")
        .eq("id", attempt_id)
        .single()
        .execute()
        .data
    )
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")

    effective_student_id = _resolve_effective_student_id(user, payload.student_id)
    if str(attempt.get("student_id")) != str(effective_student_id):
        raise HTTPException(status_code=403, detail="This is not your attempt")

    if _is_shared_student_account(user):
        # Проверяем по enrollment ID, а не по effective_student_id
        _ensure_student_in_class(sb, str(payload.class_id or ""), str(payload.student_id or ""))

    if attempt.get("submitted_at"):
        raise HTTPException(status_code=400, detail="This attempt has already been submitted")

    test_id = str(attempt.get("test_id"))
    test = (
        sb.table("subject_tests")
        .select("id,test_type,topic_id")
        .eq("id", test_id)
        .single()
        .execute()
        .data
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    if test.get("test_type") != "quiz":
        raise HTTPException(status_code=400, detail="This endpoint is only for quiz tests")

    questions = (
        sb.table("subject_test_questions")
        .select("id")
        .eq("test_id", test_id)
        .execute()
        .data
        or []
    )
    question_ids = [str(q.get("id")) for q in questions if q.get("id")]
    total_questions = len(question_ids)
    if total_questions == 0:
        raise HTTPException(status_code=400, detail="Test has no questions")

    correct_opts = (
        sb.table("subject_test_question_options")
        .select("id,question_id,is_correct")
        .in_("question_id", question_ids)
        .eq("is_correct", True)
        .execute()
        .data
        or []
    )
    correct_by_q: dict[str, str] = {}
    for o in correct_opts:
        qid = str(o.get("question_id") or "")
        oid = str(o.get("id") or "")
        if qid and oid:
            correct_by_q[qid] = oid

    score = 0
    answers_to_save: list[dict] = []
    for a in payload.answers or []:
        qid = str(a.get("question_id") or "")
        sel = str(a.get("selected_option_id")) if a.get("selected_option_id") else None
        if qid not in question_ids:
            continue
        is_correct = bool(sel and correct_by_q.get(qid) == sel)
        if is_correct:
            score += 1
        answers_to_save.append(
            {
                "attempt_id": attempt_id,
                "question_id": qid,
                "selected_option_id": sel,
                "is_correct": is_correct,
            }
        )

    if answers_to_save:
        sb.table("subject_test_attempt_answers").insert(answers_to_save).execute()

    percentage_score = (score / total_questions * 100) if total_questions > 0 else 0
    now = datetime.now(timezone.utc)

    updated = (
        sb.table("subject_test_attempts")
        .update(
            {
                "submitted_at": now.isoformat(),
                "score": score,
                "total_questions": total_questions,
                "percentage_score": round(percentage_score, 2),
            }
        )
        .eq("id", attempt_id)
        .execute()
    )

    # Best-effort write to lesson_journal if class_id provided and timetable entry exists
    try:
        if payload.class_id:
            topic = (
                sb.table("subject_topics")
                .select("subject_id")
                .eq("id", test.get("topic_id"))
                .single()
                .execute()
                .data
            )
            if topic and topic.get("subject_id"):
                entry = (
                    sb.table("timetable_entries")
                    .select("id")
                    .eq("class_id", payload.class_id)
                    .eq("subject_id", topic.get("subject_id"))
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                if entry:
                    entry_id = entry[0].get("id")
                    grade = 5 if percentage_score >= 90 else 4 if percentage_score >= 75 else 3 if percentage_score >= 60 else 2
                    comment = f"Тест: {test.get('id')} — {score}/{total_questions} ({round(float(percentage_score), 2)}%)"
                    lesson_date = now.date().isoformat()
                    sb.table("lesson_journal").upsert(
                        {
                            "timetable_entry_id": entry_id,
                            "lesson_date": lesson_date,
                            "student_id": effective_student_id,
                            "present": None,
                            "grade": grade,
                            "comment": comment,
                            "created_by": str(user.get("id")),
                            "updated_at": datetime.utcnow().isoformat(),
                        },
                        on_conflict="timetable_entry_id,lesson_date,student_id",
                    ).execute()
    except Exception:
        pass

    upd_row = updated.data[0] if isinstance(updated.data, list) and updated.data else updated.data
    return {
        "attempt": upd_row,
        "score": score,
        "total_questions": total_questions,
        "percentage_score": round(percentage_score, 2),
    }


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str, user: dict = require_role("admin", "teacher", "student", "manager")):
    sb = get_supabase()

    attempt = (
        sb.table("subject_test_attempts")
        .select(
            "id,test_id,student_id,started_at,submitted_at,time_limit_seconds,score,total_questions,percentage_score"
        )
        .eq("id", attempt_id)
        .single()
        .execute()
        .data
    )
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")

    if user.get("role") == "student" and (not _is_shared_student_account(user)) and str(attempt.get("student_id")) != str(user.get("id")):
        raise HTTPException(status_code=403, detail="You can only view your own attempts")

    answers = []
    if attempt.get("submitted_at"):
        answers = (
            sb.table("subject_test_attempt_answers")
            .select("id,question_id,selected_option_id,is_correct")
            .eq("attempt_id", attempt_id)
            .execute()
            .data
            or []
        )

    return {"attempt": attempt, "answers": answers}


@router.get("/tests/{test_id}/questions")
def list_questions(
    test_id: str,
    attempt_id: str | None = None,
    student_id: str | None = None,
    user: dict = require_role("admin", "teacher", "student", "manager"),
):
    sb = get_supabase()

    test = (
        sb.table("subject_tests")
        .select("id,test_type")
        .eq("id", test_id)
        .single()
        .execute()
        .data
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    if test.get("test_type") != "quiz":
        raise HTTPException(status_code=400, detail="This endpoint is only for quiz tests")

    reveal_correct = user.get("role") != "student"
    if user.get("role") == "student" and attempt_id:
        attempt = (
            sb.table("subject_test_attempts")
            .select("id,test_id,student_id,submitted_at")
            .eq("id", attempt_id)
            .single()
            .execute()
            .data
        )
        if not attempt:
            raise HTTPException(status_code=404, detail="Attempt not found")
        if str(attempt.get("test_id")) != str(test_id):
            raise HTTPException(status_code=400, detail="Attempt does not belong to this test")
        if not attempt.get("submitted_at"):
            raise HTTPException(status_code=400, detail="Attempt is not submitted yet")

        # Only reveal for own attempt. For shared student account, require explicit student_id match.
        if _is_shared_student_account(user):
            if not student_id:
                raise HTTPException(status_code=400, detail="student_id is required for shared student account")
            if str(attempt.get("student_id")) != str(student_id):
                raise HTTPException(status_code=403, detail="Forbidden")
        else:
            if str(attempt.get("student_id")) != str(user.get("id")):
                raise HTTPException(status_code=403, detail="Forbidden")

        reveal_correct = True

    questions = (
        sb.table("subject_test_questions")
        .select("id,question_text,order_index,created_at")
        .eq("test_id", test_id)
        .order("order_index")
        .execute()
        .data
        or []
    )

    qids = [str(q.get("id")) for q in questions if q.get("id")]
    options_by_q: dict[str, list[dict]] = {qid: [] for qid in qids}

    if qids:
        opts = (
            sb.table("subject_test_question_options")
            .select("id,question_id,option_text,is_correct,order_index")
            .in_("question_id", qids)
            .order("order_index")
            .execute()
            .data
            or []
        )
        for o in opts:
            qid = str(o.get("question_id"))
            if not reveal_correct:
                options_by_q.setdefault(qid, []).append(
                    {
                        "id": o.get("id"),
                        "option_text": o.get("option_text"),
                        "order_index": o.get("order_index"),
                    }
                )
            else:
                options_by_q.setdefault(qid, []).append(
                    {
                        "id": o.get("id"),
                        "option_text": o.get("option_text"),
                        "is_correct": o.get("is_correct"),
                        "order_index": o.get("order_index"),
                    }
                )

    for q in questions:
        qid = str(q.get("id"))
        q["options"] = options_by_q.get(qid, [])

    return {"questions": questions}


@router.get("/health")
def health():
    return {"ok": True}


# NOTE: Tables are created by supabase migrations:
# - 20260119_000000_subject_topics.sql
# - 20260119_000001_subject_content.sql
