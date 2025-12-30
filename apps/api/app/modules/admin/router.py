from __future__ import annotations

from datetime import date
from io import BytesIO

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openpyxl import Workbook

from app.core.deps import CurrentUser, require_role
from app.core.monitor import timed
from app.core.provisioning import (
    full_name_from_parts,
    generate_numeric_password,
    password_fingerprint,
    username_base,
)
from app.core.security import hash_password
from app.core.security import verify_password
from app.db.supabase_client import get_supabase

router = APIRouter()


def _require_users_schema(sb) -> None:
    """Ensure the DB has columns required for the new user provisioning flow."""
    try:
        sb.table("users").select("password_fingerprint, first_name").limit(1).execute()
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=(
                "DB schema is outdated. Apply migration supabase/migrations/20251223_000002_manager_and_profiles.sql "
                "(adds profile fields + password_fingerprint) and restart the API."
            ),
        )


class CreateUserIn(BaseModel):
    role: str  # manager|admin|teacher|student
    first_name: str
    last_name: str
    middle_name: str | None = None
    phone: str
    birth_date: date
    photo_data_url: str | None = None

    # Optional pre-generated credentials (for UI "Generate" button)
    username: str | None = None
    temp_password: str | None = None

    # Student
    class_id: str | None = None

    # Teacher
    teacher_subject: str | None = None
    subject_ids: list[str] | None = None


class UpdateUserIn(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    phone: str | None = None
    birth_date: date | None = None
    photo_data_url: str | None = None

    # Student-only: allow moving a student between classes.
    # If provided as null/None -> unenroll from any class.
    class_id: str | None = None


@router.post("/users")
def admin_create_user(payload: CreateUserIn, actor: dict = require_role("admin", "manager")):
    role = payload.role
    if role == "manager":
        raise HTTPException(status_code=400, detail="Cannot create manager users")
    if actor.get("role") == "admin" and role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot create admins")
    if actor.get("role") != "manager" and role == "admin":
        raise HTTPException(status_code=403, detail="Only managers can create admins")

    phone = (payload.phone or "").strip()
    if not phone.startswith("+996"):
        raise HTTPException(status_code=400, detail="Phone must start with +996")

    if role == "teacher":
        # New flow: subjects assigned at teacher creation
        subject_ids = [s for s in (payload.subject_ids or []) if isinstance(s, str) and s.strip()]
        if len(subject_ids) > 2:
            raise HTTPException(status_code=400, detail="Teacher can have maximum 2 subjects")
        if not subject_ids and not (payload.teacher_subject and payload.teacher_subject.strip()):
            raise HTTPException(status_code=400, detail="subject_ids required for teacher")

    sb = get_supabase()
    _require_users_schema(sb)

    # 1) Allocate username
    if payload.username:
        username = payload.username.strip().lower()
        exists = sb.table("users").select("id").eq("username", username).limit(1).execute().data
        if exists:
            raise HTTPException(status_code=409, detail="Username already exists")
    else:
        base = username_base(
            role=role,
            first_name=payload.first_name,
            last_name=payload.last_name,
            birth_date=payload.birth_date,
        )
        username = base
        suffix = 2
        while True:
            exists = sb.table("users").select("id").eq("username", username).limit(1).execute().data
            if not exists:
                break
            username = f"{base}-{suffix}"
            suffix += 1
            if suffix > 5000:
                raise HTTPException(status_code=500, detail="Could not allocate unique username")

    # 2) Allocate numeric password (<= 12 digits), unique via fingerprint
    if payload.temp_password:
        cand = payload.temp_password.strip()
        if not cand.isdigit() or len(cand) > 12:
            raise HTTPException(status_code=400, detail="temp_password must be digits and <= 12 length")
        temp_password = cand
        pw_fp = password_fingerprint(cand)
        exists = sb.table("users").select("id").eq("password_fingerprint", pw_fp).limit(1).execute().data
        if exists:
            raise HTTPException(status_code=409, detail="Password already exists")
    else:
        temp_password = None
        pw_fp = None
        for _ in range(200):
            cand = generate_numeric_password(12)
            fp = password_fingerprint(cand)
            exists = sb.table("users").select("id").eq("password_fingerprint", fp).limit(1).execute().data
            if not exists:
                temp_password = cand
                pw_fp = fp
                break
        if not temp_password or not pw_fp:
            raise HTTPException(status_code=500, detail="Could not allocate unique password")

    full_name = full_name_from_parts(
        last_name=payload.last_name,
        first_name=payload.first_name,
        middle_name=payload.middle_name,
    )

    sb_subject_names: list[str] = []
    if role == "teacher":
        subject_ids = [s for s in (payload.subject_ids or []) if isinstance(s, str) and s.strip()]
        if subject_ids:
            subj_rows = sb.table("subjects").select("id,name").in_("id", subject_ids).execute().data or []
            found = {r.get("id") for r in subj_rows}
            missing = [sid for sid in subject_ids if sid not in found]
            if missing:
                raise HTTPException(status_code=404, detail="Subject not found")
            sb_subject_names = [str(r.get("name") or "").strip() for r in subj_rows if str(r.get("name") or "").strip()]

    teacher_subject_str = (payload.teacher_subject.strip() if payload.teacher_subject else None)
    if role == "teacher" and not teacher_subject_str and sb_subject_names:
        teacher_subject_str = ", ".join(sb_subject_names[:2])

    resp = (
        sb.table("users")
        .insert(
            {
                "role": role,
                "username": username,
                "full_name": full_name,
                "first_name": payload.first_name.strip(),
                "last_name": payload.last_name.strip(),
                "middle_name": (payload.middle_name.strip() if payload.middle_name else None),
                "phone": phone,
                "birth_date": payload.birth_date.isoformat(),
                "photo_data_url": payload.photo_data_url,
                "teacher_subject": teacher_subject_str,
                "password_hash": hash_password(temp_password),
                "password_fingerprint": pw_fp,
                "must_change_password": True,
                "is_active": True,
            }
        )
        .execute()
    )

    created = resp.data[0] if isinstance(resp.data, list) and resp.data else resp.data
    if role == "student" and payload.class_id:
        sb.table("class_enrollments").insert({"class_id": payload.class_id, "student_id": created["id"]}).execute()

    if role == "teacher":
        subject_ids = [s for s in (payload.subject_ids or []) if isinstance(s, str) and s.strip()]
        if subject_ids:
            # Insert teacher_subjects links (max 2 already validated)
            for sid in subject_ids[:2]:
                # ignore duplicates silently
                existing = (
                    sb.table("teacher_subjects")
                    .select("teacher_id")
                    .eq("teacher_id", created["id"])
                    .eq("subject_id", sid)
                    .limit(1)
                    .execute()
                    .data
                )
                if existing:
                    continue
                sb.table("teacher_subjects").insert({"teacher_id": created["id"], "subject_id": sid}).execute()

    return {"user": created, "tempPassword": temp_password}


class CredentialsIn(BaseModel):
    role: str  # admin|teacher|student
    first_name: str
    last_name: str
    birth_date: date


@router.post("/users/credentials")
def generate_credentials(payload: CredentialsIn, actor: dict = require_role("admin", "manager")):
    role = payload.role
    if role == "manager":
        raise HTTPException(status_code=400, detail="Cannot generate manager credentials")
    if actor.get("role") == "admin" and role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot create admins")
    if actor.get("role") != "manager" and role == "admin":
        raise HTTPException(status_code=403, detail="Only managers can create admins")

    sb = get_supabase()
    _require_users_schema(sb)

    base = username_base(role=role, first_name=payload.first_name, last_name=payload.last_name, birth_date=payload.birth_date)
    username = base
    suffix = 2
    while True:
        exists = sb.table("users").select("id").eq("username", username).limit(1).execute().data
        if not exists:
            break
        username = f"{base}-{suffix}"
        suffix += 1
        if suffix > 5000:
            raise HTTPException(status_code=500, detail="Could not allocate unique username")

    password = None
    for _ in range(200):
        cand = generate_numeric_password(12)
        fp = password_fingerprint(cand)
        exists = sb.table("users").select("id").eq("password_fingerprint", fp).limit(1).execute().data
        if not exists:
            password = cand
            break
    if not password:
        raise HTTPException(status_code=500, detail="Could not allocate unique password")

    return {"username": username, "password": password}


@router.get("/users")
@timed("admin_list_users")
def admin_list_users(
    role: str | None = None,
    q: str | None = None,
    include_inactive: bool = False,
    limit: int = 50,
    offset: int = 0,
    _: dict = require_role("admin", "manager"),
):
    sb = get_supabase()

    # Attempt to serve quick cached response when unfiltered (root page)
    if not role and not q and not include_inactive and offset == 0:
        from app.core.cache import cache
        cached = cache.get("admin_users:root")
        if cached is not None:
            return {"users": cached}

    def _attach_student_class(users: list[dict]) -> list[dict]:
        try:
            student_ids = [u.get("id") for u in (users or []) if u.get("role") == "student" and u.get("id")]
            if not student_ids:
                return users

            enr_rows = (
                sb.table("class_enrollments")
                .select("student_id,class_id")
                .in_("student_id", student_ids)
                .execute()
                .data
                or []
            )

            class_id_by_student: dict[str, str] = {
                str(r.get("student_id")): str(r.get("class_id"))
                for r in enr_rows
                if r.get("student_id") and r.get("class_id")
            }
            class_ids = list({cid for cid in class_id_by_student.values() if cid})
            if not class_ids:
                for u in users:
                    if u.get("role") == "student":
                        u["class"] = None
                return users

            class_rows = sb.table("classes").select("id,name").in_("id", class_ids).execute().data or []
            class_by_id: dict[str, dict] = {
                str(c.get("id")): {"id": str(c.get("id")), "name": c.get("name")}
                for c in class_rows
                if c.get("id")
            }

            for u in users:
                if u.get("role") != "student":
                    continue
                uid = str(u.get("id"))
                cid = class_id_by_student.get(uid)
                u["class"] = class_by_id.get(cid) if cid else None
            return users
        except Exception:
            # Listing users must not fail if schema differs.
            return users

    def _apply_filters(query):
        if not include_inactive:
            query = query.eq("is_active", True)
        if role:
            query = query.eq("role", role)
        if q and q.strip():
            term = q.strip()
            query = query.ilike("full_name", f"%{term}%")
        return query

    # Backward-compatible: DB may not yet have first_name/last_name/middle_name/password_fingerprint.
    # Listing users should still work; schema is enforced on create/credentials endpoints.
    try:
        query = sb.table("users").select(
            "id,role,username,full_name,is_active,must_change_password,created_at,first_name,last_name,middle_name,photo_data_url,teacher_subject"
        )
        query = _apply_filters(query)
        # pagination
        resp = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        users = resp.data or []
        users = _attach_student_class(users)
        # Short cache when unfiltered to reduce DB load
        from app.core.cache import cache
        if not role and not q and not include_inactive and offset == 0:
            cache.set("admin_users:root", users, ttl=10)
        return {"users": users}
    except Exception:
        query = sb.table("users").select("id,role,username,full_name,is_active,must_change_password,created_at")
        query = _apply_filters(query)
        resp = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        users = resp.data or []
        users = _attach_student_class(users)
        return {"users": users}


@router.get("/users/{user_id}")
def admin_get_user(user_id: str, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    _require_users_schema(sb)

    rows = (
        sb.table("users")
        .select(
            "id,role,username,full_name,is_active,must_change_password,created_at,"
            "first_name,last_name,middle_name,phone,birth_date,photo_data_url,teacher_subject"
        )
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    u = rows[0]
    extra: dict[str, object] = {"class": None}
    if u.get("role") == "student":
        enr = (
            sb.table("class_enrollments")
            .select("class_id")
            .eq("student_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        class_id = enr[0]["class_id"] if enr else None
        if class_id:
            c = (
                sb.table("classes")
                .select("id,name")
                .eq("id", class_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            extra["class"] = c[0] if c else {"id": class_id, "name": None}

    return {"user": u, **extra}


@router.put("/users/{user_id}")
def admin_update_user(user_id: str, payload: UpdateUserIn, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    _require_users_schema(sb)

    rows = (
        sb.table("users")
        .select(
            "id,role,username,full_name,is_active,must_change_password,created_at,"
            "first_name,last_name,middle_name,phone,birth_date,photo_data_url,teacher_subject"
        )
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    current = rows[0]

    update_data: dict[str, object] = {}

    # Names
    name_changed = False
    first_name = current.get("first_name")
    last_name = current.get("last_name")
    middle_name = current.get("middle_name")

    if payload.first_name is not None:
        first_name = payload.first_name.strip() if payload.first_name.strip() else None
        update_data["first_name"] = first_name
        name_changed = True
    if payload.last_name is not None:
        last_name = payload.last_name.strip() if payload.last_name.strip() else None
        update_data["last_name"] = last_name
        name_changed = True
    if payload.middle_name is not None:
        middle_name = payload.middle_name.strip() if payload.middle_name.strip() else None
        update_data["middle_name"] = middle_name
        name_changed = True

    if name_changed:
        update_data["full_name"] = full_name_from_parts(
            last_name=str(last_name or ""),
            first_name=str(first_name or ""),
            middle_name=(str(middle_name) if middle_name else None),
        )

    # Phone
    if payload.phone is not None:
        phone = payload.phone.strip() if payload.phone.strip() else None
        if phone and not phone.startswith("+996"):
            raise HTTPException(status_code=400, detail="Phone must start with +996")
        update_data["phone"] = phone

    # Birth date
    if payload.birth_date is not None:
        update_data["birth_date"] = payload.birth_date.isoformat()

    # Photo (allow clear)
    if "photo_data_url" in payload.model_fields_set:
        update_data["photo_data_url"] = payload.photo_data_url

    if update_data:
        sb.table("users").update(update_data).eq("id", user_id).execute()

    # Student class change
    extra: dict[str, object] = {"class": None}
    if current.get("role") == "student" and "class_id" in payload.model_fields_set:
        sb.table("class_enrollments").delete().eq("student_id", user_id).execute()
        if payload.class_id:
            sb.table("class_enrollments").insert({"class_id": payload.class_id, "student_id": user_id}).execute()

    # Return refreshed user
    refreshed = (
        sb.table("users")
        .select(
            "id,role,username,full_name,is_active,must_change_password,created_at,"
            "first_name,last_name,middle_name,phone,birth_date,photo_data_url,teacher_subject"
        )
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not refreshed:
        raise HTTPException(status_code=404, detail="User not found")

    u = refreshed[0]
    if u.get("role") == "student":
        enr = (
            sb.table("class_enrollments")
            .select("class_id")
            .eq("student_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        class_id = enr[0]["class_id"] if enr else None
        if class_id:
            c = (
                sb.table("classes")
                .select("id,name")
                .eq("id", class_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            extra["class"] = c[0] if c else {"id": class_id, "name": None}

    return {"user": u, **extra}


@router.delete("/users/{user_id}")
def admin_delete_user(user_id: str, actor: dict = require_role("admin", "manager")):
    sb = get_supabase()
    _require_users_schema(sb)

    if actor.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    t_rows = sb.table("users").select("id,role,is_active").eq("id", user_id).limit(1).execute().data or []
    target = t_rows[0] if isinstance(t_rows, list) and t_rows else None
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    target_role = target.get("role")
    if target_role == "manager":
        raise HTTPException(status_code=400, detail="Cannot delete manager users")
    if actor.get("role") == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot delete admins")
    if actor.get("role") != "manager" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Only managers can delete admins")

    # Revoke all refresh tokens so the user is logged out everywhere.
    sb.table("refresh_tokens").delete().eq("user_id", user_id).execute()

    # Detach from active relations to keep UI lists consistent.
    if target_role == "student":
        sb.table("class_enrollments").delete().eq("student_id", user_id).execute()
    if target_role == "teacher":
        sb.table("teacher_subjects").delete().eq("teacher_id", user_id).execute()

    # Soft-delete: disable login without breaking FK constraints (many tables use RESTRICT).
    sb.table("users").update({"is_active": False}).eq("id", user_id).execute()
    return {"ok": True}


class ResetStudentPasswordIn(BaseModel):
    actor_password: str


@router.post("/users/{user_id}/reset-student-password")
def reset_student_password(
    user_id: str,
    payload: ResetStudentPasswordIn,
    actor: dict = require_role("admin", "manager"),
):
    sb = get_supabase()
    _require_users_schema(sb)

    # Verify actor password
    a_rows = sb.table("users").select("id,password_hash").eq("id", actor["id"]).limit(1).execute().data or []
    a = a_rows[0] if isinstance(a_rows, list) and a_rows else None
    if not a or not verify_password(payload.actor_password, a["password_hash"]):
        raise HTTPException(status_code=400, detail="Wrong admin/manager password")

    # Target must be a student
    t_rows = sb.table("users").select("id,role").eq("id", user_id).limit(1).execute().data or []
    t = t_rows[0] if isinstance(t_rows, list) and t_rows else None
    if not t:
        raise HTTPException(status_code=404, detail="User not found")
    if t.get("role") != "student":
        raise HTTPException(status_code=400, detail="Password reveal/reset is only supported for students")

    # Allocate unique numeric password
    password = None
    fp = None
    for _ in range(200):
        cand = generate_numeric_password(12)
        cand_fp = password_fingerprint(cand)
        exists = sb.table("users").select("id").eq("password_fingerprint", cand_fp).limit(1).execute().data
        if not exists:
            password = cand
            fp = cand_fp
            break
    if not password or not fp:
        raise HTTPException(status_code=500, detail="Could not allocate unique password")

    sb.table("users").update(
        {
            "password_hash": hash_password(password),
            "password_fingerprint": fp,
            "must_change_password": True,
        }
    ).eq("id", user_id).execute()

    return {"tempPassword": password}


@router.post("/users/{user_id}/reset-teacher-password")
def reset_teacher_password(
    user_id: str,
    payload: ResetStudentPasswordIn,
    actor: dict = require_role("admin", "manager"),
):
    sb = get_supabase()
    _require_users_schema(sb)

    # Verify actor password
    a_rows = sb.table("users").select("id,password_hash").eq("id", actor["id"]).limit(1).execute().data or []
    a = a_rows[0] if isinstance(a_rows, list) and a_rows else None
    if not a or not verify_password(payload.actor_password, a["password_hash"]):
        raise HTTPException(status_code=400, detail="Wrong admin/manager password")

    # Target must be a teacher
    t_rows = sb.table("users").select("id,role").eq("id", user_id).limit(1).execute().data or []
    t = t_rows[0] if isinstance(t_rows, list) and t_rows else None
    if not t:
        raise HTTPException(status_code=404, detail="User not found")
    if t.get("role") != "teacher":
        raise HTTPException(status_code=400, detail="Password reveal/reset is only supported for teachers")

    # Allocate unique numeric password
    password = None
    fp = None
    for _ in range(200):
        cand = generate_numeric_password(12)
        cand_fp = password_fingerprint(cand)
        exists = sb.table("users").select("id").eq("password_fingerprint", cand_fp).limit(1).execute().data
        if not exists:
            password = cand
            fp = cand_fp
            break
    if not password or not fp:
        raise HTTPException(status_code=500, detail="Could not allocate unique password")

    sb.table("users").update(
        {
            "password_hash": hash_password(password),
            "password_fingerprint": fp,
            "must_change_password": True,
        }
    ).eq("id", user_id).execute()

    return {"tempPassword": password}


@router.get("/exports/classes/{class_id}/students.xlsx")
def export_class_students(class_id: str, _: dict = require_role("admin", "manager")):
    sb = get_supabase()
    class_row = sb.table("classes").select("id,name").eq("id", class_id).single().execute().data
    if not class_row:
        return StreamingResponse(BytesIO(b""), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    enr = (
        sb.table("class_enrollments")
        .select("student_id, users(id,username,full_name)")
        .eq("class_id", class_id)
        .execute()
        .data
        or []
    )
    students = [r.get("users") for r in enr if r.get("users")]
    students.sort(key=lambda s: (s.get("full_name") or "", s.get("username") or ""))

    wb = Workbook()
    ws = wb.active
    ws.title = "Students"
    ws.append(["Class", class_row.get("name")])
    ws.append([])
    ws.append(["Full name", "Username"])
    for s in students:
        ws.append([s.get("full_name"), s.get("username")])

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"{class_row.get('name','class')}_students.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )


@router.get("/exports/classes-with-streams.xlsx")
@timed("export_classes_with_streams")
def export_classes_with_streams(_: dict = require_role("admin", "manager")):
    """Export all classes with their associated streams to Excel"""
    sb = get_supabase()
    
    # Get all classes
    classes_result = sb.table("classes").select("id,name,curator_id,direction_id").execute()
    classes = classes_result.data or []
    
    # Get all streams
    streams_result = sb.table("streams").select("id,name,start_date,end_date,status").execute()
    streams = streams_result.data or []
    streams_by_id = {str(s["id"]): s for s in streams}
    
    # Get stream_classes associations
    stream_classes_result = sb.table("stream_classes").select("stream_id,class_id").execute()
    stream_classes = stream_classes_result.data or []
    
    # Build mapping: class_id -> [stream_names]
    class_streams_map: dict[str, list[str]] = {}
    for sc in stream_classes:
        class_id = str(sc.get("class_id"))
        stream_id = str(sc.get("stream_id"))
        stream = streams_by_id.get(stream_id)
        if stream:
            stream_name = stream.get("name", "")
            if class_id not in class_streams_map:
                class_streams_map[class_id] = []
            class_streams_map[class_id].append(stream_name)
    
    # Get curators
    curator_ids = [c.get("curator_id") for c in classes if c.get("curator_id")]
    curators_map = {}
    if curator_ids:
        curators_result = sb.table("users").select("id,full_name,username").in_("id", curator_ids).execute()
        curators_map = {str(c["id"]): c for c in (curators_result.data or [])}
    
    # Get directions
    direction_ids = [c.get("direction_id") for c in classes if c.get("direction_id")]
    directions_map = {}
    if direction_ids:
        directions_result = sb.table("directions").select("id,name").in_("id", direction_ids).execute()
        directions_map = {str(d["id"]): d for d in (directions_result.data or [])}
    
    # Create Excel workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Classes and Streams"
    
    # Headers
    ws.append(["Группа", "Направление", "Куратор", "Потоки"])
    
    # Sort classes by name
    classes.sort(key=lambda c: c.get("name", ""))
    
    # Fill data
    for cls in classes:
        class_id = str(cls.get("id"))
        class_name = cls.get("name", "")
        
        # Get direction
        direction_id = cls.get("direction_id")
        direction_name = ""
        if direction_id:
            direction = directions_map.get(str(direction_id))
            if direction:
                direction_name = direction.get("name", "")
        
        # Get curator
        curator_id = cls.get("curator_id")
        curator_name = ""
        if curator_id:
            curator = curators_map.get(str(curator_id))
            if curator:
                curator_name = curator.get("full_name") or curator.get("username", "")
        
        # Get streams
        streams_list = class_streams_map.get(class_id, [])
        streams_str = ", ".join(streams_list) if streams_list else "—"
        
        ws.append([class_name, direction_name, curator_name, streams_str])
    
    # Auto-adjust column widths
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter
        for cell in column:
            try:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width
    
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    
    filename = "classes_with_streams.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )
