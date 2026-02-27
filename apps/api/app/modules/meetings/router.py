from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import require_role
from app.db.supabase_client import get_supabase

router = APIRouter()


class SetMeetLinkIn(BaseModel):
    meet_url: str | None = None


class CreateMeetingLinkIn(BaseModel):
    meet_url: str
    title: str | None = None
    starts_at: str | None = None
    timetable_entry_id: str | None = None
    class_id: str | None = None
    class_ids: list[str] | None = None
    stream_id: str | None = None
    audience: str | None = None


def _entry_class_ids(entry: dict) -> list[str]:
    class_ids = entry.get("class_ids") or []
    if not class_ids and entry.get("class_id"):
        class_ids = [entry.get("class_id")]
    return [str(cid) for cid in class_ids if cid]


def _student_can_access_entry(sb, student_id: str, entry: dict) -> bool:
    class_ids = _entry_class_ids(entry)
    if not class_ids:
        return False

    try:
        rows = (
            sb.table("class_enrollments")
            .select("class_id")
            .in_("class_id", class_ids)
            .or_(f"legacy_student_id.eq.{student_id},student_id.eq.{student_id}")
            .limit(1)
            .execute()
            .data
            or []
        )
        return bool(rows)
    except Exception:
        rows = (
            sb.table("class_enrollments")
            .select("class_id")
            .in_("class_id", class_ids)
            .eq("legacy_student_id", student_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        return bool(rows)


def _student_class_ids(sb, student_id: str) -> list[str]:
    try:
        rows = (
            sb.table("class_enrollments")
            .select("class_id")
            .or_(f"legacy_student_id.eq.{student_id},student_id.eq.{student_id}")
            .execute()
            .data
            or []
        )
    except Exception:
        rows = (
            sb.table("class_enrollments")
            .select("class_id")
            .eq("legacy_student_id", student_id)
            .execute()
            .data
            or []
        )
    return list({str(r.get("class_id")) for r in rows if r.get("class_id")})


@router.put("/timetable/{entry_id}/meet")
def set_timetable_meet_link(entry_id: str, payload: SetMeetLinkIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    entry = sb.table("timetable_entries").select("id,teacher_id").eq("id", entry_id).limit(1).execute().data
    if not entry:
        raise HTTPException(status_code=404, detail="Timetable entry not found")

    if user.get("role") == "teacher" and entry[0].get("teacher_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Permission denied")

    meet_url = (payload.meet_url or "").strip() or None
    sb.table("timetable_entries").update({"meet_url": meet_url}).eq("id", entry_id).execute()

    return {"ok": True, "meet_url": meet_url}


@router.get("/timetable/{entry_id}/meet")
def get_timetable_meet_link(entry_id: str, user: dict = require_role("teacher", "admin", "manager", "student")):
    sb = get_supabase()

    entry = (
        sb.table("timetable_entries")
        .select("id,meet_url,teacher_id,class_id,class_ids")
        .eq("id", entry_id)
        .limit(1)
        .execute()
        .data
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Timetable entry not found")

    entry_row = entry[0]

    if user.get("role") == "teacher" and entry_row.get("teacher_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Permission denied")

    if user.get("role") == "student" and not _student_can_access_entry(sb, str(user.get("id")), entry_row):
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"meet_url": entry_row.get("meet_url")}


@router.post("/links")
def create_meeting_link(payload: CreateMeetingLinkIn, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    meet_url = (payload.meet_url or "").strip()
    if not meet_url:
        raise HTTPException(status_code=400, detail="meet_url is required")

    insert_data = {
        "meet_url": meet_url,
        "title": (payload.title or "").strip() or None,
        "created_by": user.get("id"),
        "audience": payload.audience,
    }

    if payload.starts_at:
        insert_data["starts_at"] = payload.starts_at

    if payload.timetable_entry_id:
        insert_data["timetable_entry_id"] = payload.timetable_entry_id

    if payload.class_id:
        insert_data["class_id"] = payload.class_id

    if payload.stream_id:
        insert_data["stream_id"] = payload.stream_id

    resp = sb.table("meeting_links").insert(insert_data).execute()
    link = resp.data[0] if resp.data else None

    if link and payload.class_ids:
        audience_data = [{"meeting_link_id": link["id"], "class_id": cid} for cid in payload.class_ids]
        if audience_data:
            sb.table("meeting_link_audiences").insert(audience_data).execute()

    return {"link": link}


@router.get("/links")
def list_meeting_links(
    class_id: str | None = None,
    stream_id: str | None = None,
    audience: str | None = None,
    user: dict = require_role("teacher", "admin", "manager", "student"),
):
    sb = get_supabase()
    role = user.get("role")
    user_id = str(user.get("id"))

    query = sb.table("meeting_links").select("*, classes(name), meeting_link_audiences(class_id, classes(name))")

    student_classes: list[str] = []
    if role == "student":
        student_classes = _student_class_ids(sb, user_id)
        if class_id and class_id not in student_classes:
            raise HTTPException(status_code=403, detail="Permission denied")
        if not class_id and not student_classes:
            return {"links": []}

    if class_id:
        audience_matches = sb.table("meeting_link_audiences").select("meeting_link_id").eq("class_id", class_id).execute()
        matched_ids = [row["meeting_link_id"] for row in (audience_matches.data or [])]

        if matched_ids:
            ids_str = ",".join(matched_ids)
            query = query.or_(f"class_id.eq.{class_id},id.in.({ids_str})")
        else:
            query = query.eq("class_id", class_id)
    elif role == "student":
        audience_matches = (
            sb.table("meeting_link_audiences")
            .select("meeting_link_id")
            .in_("class_id", student_classes)
            .execute()
        )
        matched_ids = [row["meeting_link_id"] for row in (audience_matches.data or []) if row.get("meeting_link_id")]
        class_ids_str = ",".join(student_classes)
        if matched_ids:
            ids_str = ",".join(matched_ids)
            query = query.or_(f"class_id.in.({class_ids_str}),id.in.({ids_str})")
        else:
            query = query.in_("class_id", student_classes)

    if stream_id:
        query = query.eq("stream_id", stream_id)

    if audience:
        query = query.eq("audience", audience)

    if role == "teacher" and not class_id and not stream_id:
        query = query.eq("created_by", user_id)

    query = query.order("created_at", desc=True).limit(50)
    resp = query.execute()

    links = []
    for row in (resp.data or []):
        if row.get("classes"):
            row["class_name"] = row["classes"]["name"]

        audience_groups = []
        if row.get("meeting_link_audiences"):
            for aud in row["meeting_link_audiences"]:
                if aud.get("classes"):
                    audience_groups.append(aud["classes"]["name"])

        if audience_groups:
            row["audience_names"] = audience_groups

        if "classes" in row:
            del row["classes"]
        if "meeting_link_audiences" in row:
            del row["meeting_link_audiences"]

        links.append(row)

    return {"links": links}


@router.delete("/links/{link_id}")
def delete_meeting_link(link_id: str, user: dict = require_role("teacher", "admin", "manager")):
    sb = get_supabase()

    link = sb.table("meeting_links").select("id,created_by").eq("id", link_id).limit(1).execute().data
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    if user.get("role") == "teacher" and link[0].get("created_by") != user.get("id"):
        raise HTTPException(status_code=403, detail="Permission denied")

    sb.table("meeting_links").delete().eq("id", link_id).execute()

    return {"ok": True}
