import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiAdminListUsers,
  apiCreateTimetableEntry,
  apiDeleteTimetableEntry,
  apiListClasses,
  apiListTimetableEntries,
  apiListTimetableRooms,
  apiTimetableWeek,
  apiUpdateTimetableEntry,
  apiListSubjects,
  apiGetStreams,
  apiGetStream,
  apiCreateZoomMeetingNew,
  type AdminUser,
  type ClassItem,
  type TimetableEntry,
  type Subject,
  type Stream,
  type WeekTimetableItem,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import styles from "./AdminTimetable.module.css";
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Calendar, Video, ExternalLink } from "lucide-react";

const timeSlots = [
  { slot: 1, start: "09:00", end: "10:20" },
  { slot: 2, start: "10:30", end: "11:50" },
  { slot: 3, start: "12:00", end: "13:20" },
  { slot: 4, start: "14:20", end: "15:40" },
];

function toDbWeekday(date: Date): number {
  // DB constraint: 0..6. We use 0=Mon .. 6=Sun.
  // JS getDay(): 0=Sun .. 6=Sat
  return (date.getDay() + 6) % 7;
}

function hhmm(t: string): string {
  // Supabase returns TIME as HH:MM:SS; normalize to HH:MM.
  return t?.slice(0, 5) ?? t;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function formatDayTitle(date: Date): string {
  const weekday = date.toLocaleDateString("ru-RU", { weekday: "short" });
  // Capitalize first letter (e.g. "пн" -> "Пн")
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${wd} ${formatDate(date)}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeUiError(e: unknown): string {
  const raw = String(e ?? "").trim();
  const noPrefix = raw.replace(/^Error:\s*/i, "").trim();
  // Drop trailing technical details like "(... does not exist)" that can be huge on mobile.
  const noParensTail = noPrefix.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return noParensTail || noPrefix || raw;
}

type ConflictEntryInfo = {
  id?: string;
  weekday?: number;
  weekday_label?: string;
  start_time?: string;
  end_time?: string;
  room?: string | null;
  subject?: string | null;
  lesson_type?: string | null;
  class_names?: string[] | null;
};

type TimetableConflictDetail = {
  message?: string;
  proposed?: {
    weekday_label?: string;
    start_time?: string;
    end_time?: string;
  };
  conflicts?: Array<{
    type?: "CLASS_BUSY" | "TEACHER_BUSY" | "ROOM_BUSY" | string;
    title?: string;
    affected_class_names?: string[];
    entry?: ConflictEntryInfo;
  }>;
};

type UiErrorState =
  | { kind: "text"; title: string; message: string }
  | { kind: "conflict"; title: string; detail: TimetableConflictDetail };

function weekdayRuShortFromLabel(label?: string): string {
  const s = String(label ?? "").trim();
  return s || "";
}

function formatConflictLine(c: NonNullable<TimetableConflictDetail["conflicts"]>[number]): string {
  const entry = c.entry || {};
  const day = weekdayRuShortFromLabel(entry.weekday_label);
  const time = `${(entry.start_time ?? "").slice(0, 5)}–${(entry.end_time ?? "").slice(0, 5)}`.replace(/^–|–$/g, "");
  const room = entry.room ? `каб. ${entry.room}` : "";
  const subject = entry.subject ? `предмет: ${entry.subject}` : "";
  const groups = Array.isArray(entry.class_names) && entry.class_names.length ? `группы: ${entry.class_names.join(", ")}` : "";
  const parts = [c.title || "Конфликт", [day, time].filter(Boolean).join(" "), room, subject, groups].filter(Boolean);
  return parts.join(" — ");
}

function toUiError(e: unknown): UiErrorState {
  const anyErr = e as any;
  const detail: TimetableConflictDetail | undefined = anyErr?.detail;
  if (detail && typeof detail === "object" && Array.isArray(detail.conflicts) && detail.conflicts.length) {
    const types = new Set(detail.conflicts.map((c) => c.type));
    let title = "Конфликт расписания";
    if (types.size === 1) {
      const t = Array.from(types)[0];
      if (t === "TEACHER_BUSY") title = "Преподаватель занят";
      if (t === "ROOM_BUSY") title = "Аудитория занята";
      if (t === "CLASS_BUSY") title = "Группа занята";
    }
    return { kind: "conflict", title, detail };
  }

  return { kind: "text", title: "Ошибка", message: normalizeUiError(e) };
}

function renderUiErrorBody(err: UiErrorState): React.ReactNode {
  if (err.kind === "text") return <div style={{ whiteSpace: "pre-wrap" }}>{err.message}</div>;
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      <div style={{ marginBottom: 8 }}>{err.detail.message || "Конфликт расписания"}</div>
      <div>
        {(err.detail.conflicts || []).map((c, idx) => (
          <div key={idx} style={{ marginBottom: 6 }}>
            {formatConflictLine(c)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminTimetablePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [streamClasses, setStreamClasses] = useState<ClassItem[]>([]);
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);

  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState("");
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [err, setErr] = useState<UiErrorState | null>(null);
  const [loading, setLoading] = useState(false);

  const [rooms, setRooms] = useState<string[]>([]);

  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));

  const [zoomByCell, setZoomByCell] = useState<Record<string, { join_url: string; starts_at: string }>>({});
  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomEntryId, setZoomEntryId] = useState<string | null>(null);
  const [zoomDay, setZoomDay] = useState<Date | null>(null);
  const [zoomTime, setZoomTime] = useState<string>("");
  const [zoomCreating, setZoomCreating] = useState(false);
  const [zoomErr, setZoomErr] = useState<string | null>(null);
  const [zoomSuccess, setZoomSuccess] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<TimetableEntry | null>(null);
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalSlot, setModalSlot] = useState<number | null>(null);

  // Form fields
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formRoom, setFormRoom] = useState("");
  const [formLessonType, setFormLessonType] = useState<"lecture" | "seminar" | "exam">("lecture");
  const [formClassIds, setFormClassIds] = useState<string[]>([]);

  const weekDays = useMemo(() => {
    // Admin timetable grid: Mon-Sat (6 days)
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  async function reload() {
    if (!token) return;
    setLoading(true);
    try {
      const [streamRes, classRes, t, s, rr] = await Promise.all([
        apiGetStreams(token),
        apiListClasses(token),
        apiAdminListUsers(token, "teacher"),
        apiListSubjects(token),
        apiListTimetableRooms(token).catch(() => ({ rooms: [] })),
      ]);
      setStreams(streamRes.streams || []);
      setAllClasses(classRes.classes || []);
      setTeachers(t.users);
      setSubjects(s.subjects || []);
      setRooms(rr.rooms || []);

      if (classId) {
        const e = await apiListTimetableEntries(token, classId);
        setEntries(e.entries);
      } else {
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }

  function buildZoomMap(weekEntries: WeekTimetableItem[]): Record<string, { join_url: string; starts_at: string }> {
    const m: Record<string, { join_url: string; starts_at: string }> = {};
    for (const e of weekEntries) {
      const z = e.zoom;
      if (!z?.join_url) continue;
      const key = `${e.weekday}|${String(e.start_time).slice(0, 5)}`;
      m[key] = { join_url: z.join_url, starts_at: z.starts_at };
    }
    return m;
  }

  async function reloadZoomWeek() {
    if (!token || !classId) {
      setZoomByCell({});
      return;
    }
    try {
      const w = await apiTimetableWeek(token, ymd(weekStart), classId);
      setZoomByCell(buildZoomMap(w.entries || []));
    } catch {
      setZoomByCell({});
    }
  }

  // Load classes when stream is selected
  useEffect(() => {
    if (!token || !selectedStreamId) {
      setStreamClasses([]);
      setClassId("");
      return;
    }

    setLoading(true);
    apiGetStream(token, selectedStreamId)
      .then((res) => {
        const classes = res.stream.classes || [];
        setStreamClasses(classes.map(c => ({
          id: c.id,
          name: c.name,
          direction_id: c.direction_id,
          curator_id: c.curator_id
        })));
        // Auto-select first class if available
        if (classes.length > 0 && !classId) {
          setClassId(classes[0].id);
        }
      })
      .catch((e) => setErr(toUiError(e)))
      .finally(() => setLoading(false));
  }, [selectedStreamId, token]);

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(toUiError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  useEffect(() => {
    if (!can) return;
    if (!token) return;
    if (!classId) {
      setEntries([]);
      setZoomByCell({});
      return;
    }
    setLoading(true);
    apiListTimetableEntries(token, classId)
      .then((e) => setEntries(e.entries))
      .catch((e) => setErr(toUiError(e)))
      .finally(() => setLoading(false));
  }, [classId, can, token]);

  useEffect(() => {
    if (!can) return;
    reloadZoomWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, token, classId, weekStart]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Расписание" : "Админ → Расписание";

  function openZoomModal(e: React.MouseEvent, entryId: string, day: Date, time: string) {
    e.stopPropagation();
    setZoomEntryId(entryId);
    setZoomDay(day);
    setZoomTime(time);
    setZoomErr(null);
    setZoomSuccess(null);
    setZoomModalOpen(true);
  }

  async function createZoomMeeting() {
    if (!token || !zoomEntryId || !zoomDay || !zoomTime) return;
    setZoomCreating(true);
    setZoomErr(null);
    setZoomSuccess(null);
    try {
      const startsAtISO = `${ymd(zoomDay)}T${zoomTime}:00`;
      await apiCreateZoomMeetingNew(token, zoomEntryId, startsAtISO);
      setZoomSuccess("Zoom конференция создана");
      await reloadZoomWeek();
      setTimeout(() => setZoomModalOpen(false), 900);
    } catch (e) {
      setZoomErr(String(e));
    } finally {
      setZoomCreating(false);
    }
  }

  function openAddModal(date: Date, slot: number) {
    setModalDate(date);
    setModalSlot(slot);
    setEditEntry(null);
    setErr(null);
    setFormSubjectId("");
    setFormSubject("");
    setFormRoom("");
    setFormLessonType("lecture");
    setFormClassIds(classId ? [classId] : []);
    setModalOpen(true);
  }

  function openEditModal(date: Date, slot: number, entry: TimetableEntry) {
    setModalDate(date);
    setModalSlot(slot);
    setEditEntry(entry);
    setErr(null);
    setFormSubjectId(entry.subject_id || "");
    setFormSubject(entry.subject);
    setFormRoom(entry.room || "");
    setFormLessonType((entry.lesson_type as any) || "lecture");
    const ids = (Array.isArray((entry as any).class_ids) && (entry as any).class_ids.length
      ? ((entry as any).class_ids as string[])
      : [entry.class_id]
    ).filter(Boolean);
    setFormClassIds(ids);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalDate(null);
    setModalSlot(null);
    setEditEntry(null);
  }

  async function handleSave() {
    if (!token || !modalDate || modalSlot === null) return;
    setErr(null);
    try {
      const weekday = toDbWeekday(modalDate);
      const slotInfo = timeSlots[modalSlot - 1];

      const effectiveClassIds = formLessonType === "lecture" ? formClassIds : (classId ? [classId] : []);
      if (formLessonType === "lecture") {
        if (effectiveClassIds.length === 0) throw new Error("Выберите хотя бы одну группу");
        if (effectiveClassIds.length > 4) throw new Error("Нельзя больше 4 групп на одной паре");
      }
      if (editEntry) {
        await apiUpdateTimetableEntry(token, editEntry.id, {
          subject: formSubject.trim(),
          subject_id: formSubjectId || null,
          room: formRoom.trim() ? formRoom.trim() : null,
          lesson_type: formLessonType,
          stream_id: selectedStreamId || null,
          class_ids: formLessonType === "lecture" ? effectiveClassIds : null,
        });
      } else {
        await apiCreateTimetableEntry(token, {
          class_id: classId,
          stream_id: selectedStreamId || undefined,
          class_ids: formLessonType === "lecture" ? effectiveClassIds : undefined,
          subject: formSubject.trim(),
          subject_id: formSubjectId || undefined,
          weekday,
          start_time: slotInfo.start,
          end_time: slotInfo.end,
          room: formRoom.trim() || undefined,
          lesson_type: formLessonType,
        });
      }
      const e = await apiListTimetableEntries(token, classId);
      setEntries(e.entries);
      closeModal();
    } catch (e) {
      setErr(toUiError(e));
    }
  }

  async function handleDelete() {
    if (!token || !editEntry) return;
    setErr(null);
    try {
      const ok = window.confirm(t("common.deleteConfirm"));
      if (!ok) return;
      await apiDeleteTimetableEntry(token, editEntry.id);
      const e = await apiListTimetableEntries(token, classId);
      setEntries(e.entries);
      closeModal();
    } catch (e) {
      setErr(toUiError(e));
    }
  }

  function getLessonForCell(date: Date, slot: number): TimetableEntry | null {
    const weekday = toDbWeekday(date);
    const slotInfo = timeSlots[slot - 1];
    return (
      entries.find(
        (e) =>
          e.weekday === weekday &&
          hhmm(e.start_time) === slotInfo.start &&
          hhmm(e.end_time) === slotInfo.end
      ) || null
    );
  }

  function getTeacherName(teacherId: string | null | undefined): string {
    if (!teacherId) return "---";
    const teacher = teachers.find((t) => t.id === teacherId);
    const fullName = teacher?.full_name?.trim();
    if (fullName) return fullName;
    const parts = [teacher?.last_name, teacher?.first_name, teacher?.middle_name]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
    return teacher?.username || teacherId;
  }

  return (
    <AppShell
      title={title}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Расписание</h2>
        </div>

        {err && !modalOpen && (
          <div className={styles.modalOverlay} onClick={() => setErr(null)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalTitle}>{err.title}</div>
              {renderUiErrorBody(err)}
              <div className={styles.modalActions}>
                <button className="primary" onClick={() => setErr(null)}>
                  ОК
                </button>
              </div>
            </div>
          </div>
        )}
        {loading && <Loader text="Загрузка..." />}

        <div className={styles.controls}>
          <div className={styles.selectors}>
            <div className={styles.selectorGroup}>
              <label className={styles.selectorLabel}>Поток:</label>
              <select
                value={selectedStreamId}
                onChange={(e) => {
                  setSelectedStreamId(e.target.value);
                  setClassId(""); // Reset class selection
                }}
                className={styles.select}
              >
                <option value="">— Все группы —</option>
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status === "active" ? "Активный" : s.status})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.selectorGroup}>
              <label className={styles.selectorLabel}>Группа:</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className={styles.select}
              >
                <option value="">— Выберите группу —</option>
                {(selectedStreamId ? streamClasses : allClasses).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.weekNav}>
            <button className={styles.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>
              <ChevronLeft size={18} />
            </button>
            <div className={styles.currentWeek}>
              <Calendar size={16} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 6 }} />
              {formatDate(weekDays[0])} - {formatDate(weekDays[weekDays.length - 1])}
            </div>
            <button className={styles.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className={styles.quickWeek}>
            <button className={styles.quickBtn} onClick={() => setWeekStart(getMonday(new Date()))}>
              Текущая неделя
            </button>
            <button className={styles.quickBtn} onClick={() => setWeekStart(addDays(getMonday(new Date()), 7))}>
              Следующая неделя
            </button>
          </div>
        </div>

        {classId ? (
          <div className={styles.grid}>
            {/* Header Row */}
            <div className={styles.cellHeader}>Время</div>
            {weekDays.map((day) => (
              <div key={day.toISOString()} className={styles.cellHeader}>
                {formatDayTitle(day)}
              </div>
            ))}

            {/* Time Slots */}
            {timeSlots.map((ts) => (
              <React.Fragment key={ts.slot}>
                {/* Lunch Break */}
                {ts.slot === 4 && (
                  <div className={styles.lunchRow}>
                    ОБЕДЕННЫЙ ПЕРЕРЫВ (13:20 - 14:20)
                  </div>
                )}

                <div className={styles.cellTime}>
                  <div style={{ fontWeight: 600 }}>{ts.slot} пара</div>
                  <div>{ts.start}</div>
                  <div>{ts.end}</div>
                </div>

                {weekDays.map((day) => {
                  const lesson = getLessonForCell(day, ts.slot);
                  const z = zoomByCell[`${toDbWeekday(day)}|${ts.start}`];
                  return (
                    <div key={day.toISOString()} className={styles.cell}>
                      {lesson ? (
                        <div className={styles.entry} onClick={() => openEditModal(day, ts.slot, lesson)}>
                          <div className={styles.entrySubject}>
                            {lesson.subject}
                            {lesson.lesson_type === "exam" && (
                              <span style={{
                                marginLeft: 4,
                                fontSize: 10,
                                background: "#ef4444",
                                color: "#fff",
                                padding: "1px 4px",
                                borderRadius: 3
                              }}>
                                ЭКЗАМЕН
                              </span>
                            )}
                            {lesson.lesson_type === "lecture" && (
                              <span style={{
                                marginLeft: 4,
                                fontSize: 10,
                                background: "#3b82f6",
                                color: "#fff",
                                padding: "1px 4px",
                                borderRadius: 3
                              }}>
                                ЛЕКЦИЯ
                              </span>
                            )}
                            {lesson.lesson_type === "seminar" && (
                              <span style={{
                                marginLeft: 4,
                                fontSize: 10,
                                background: "#10b981",
                                color: "#fff",
                                padding: "1px 4px",
                                borderRadius: 3
                              }}>
                                СЕМИНАР
                              </span>
                            )}
                          </div>
                          <div className={styles.entryTeacher}>{getTeacherName(lesson.teacher_id)}</div>
                          {lesson.room && <div className={styles.entryRoom}>{lesson.room}</div>}

                          <div className={styles.zoomRow}>
                            {z?.join_url ? (
                              <a
                                className={styles.zoomLink}
                                href={z.join_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Подключиться к конференции"
                              >
                                <ExternalLink size={14} />
                                Zoom
                              </a>
                            ) : (
                              <button
                                className={styles.zoomBtn}
                                onClick={(e) => openZoomModal(e, lesson.id, day, ts.start)}
                                title="Создать Zoom конференцию"
                              >
                                <Video size={14} />
                                Zoom
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button className={styles.addBtn} onClick={() => openAddModal(day, ts.slot)}>
                          <Plus size={24} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            Выберите группу, чтобы увидеть расписание
          </div>
        )}
      </div>

      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              {editEntry ? "Редактировать пару" : "Добавить пару"}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Предмет</label>
              <select
                value={formSubjectId}
                onChange={(e) => {
                  const subjectId = e.target.value;
                  setFormSubjectId(subjectId);
                  const subj = subjects.find(s => s.id === subjectId);
                  if (subj) {
                    setFormSubject(subj.name);
                  }
                }}
                className={styles.select}
              >
                <option value="">— Выберите предмет —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {err && (
              <div style={{ marginTop: 6, color: "var(--color-error)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{err.title}</div>
                <div style={{ color: "var(--color-text)" }}>{renderUiErrorBody(err)}</div>
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label}>Тип занятия</label>
              <select
                value={formLessonType}
                onChange={(e) => setFormLessonType(e.target.value as "lecture" | "seminar" | "exam")}
                className={styles.select}
              >
                <option value="lecture">Лекционное</option>
                <option value="seminar">Семинарское</option>
                <option value="exam">Экзамен</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Аудитория</label>
              <select value={formRoom} onChange={(e) => setFormRoom(e.target.value)} className={styles.select}>
                <option value="">— Не выбрано —</option>
                {rooms.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {formLessonType === "lecture" && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Группы (до 4 на одной паре)</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {streamClasses.map((c) => {
                    const checked = formClassIds.includes(c.id);
                    return (
                      <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...formClassIds, c.id]))
                              : formClassIds.filter((x) => x !== c.id);
                            if (next.length > 4) {
                              setErr(toUiError(new Error("Нельзя больше 4 групп на одной паре")));
                              return;
                            }
                            setFormClassIds(next);
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.modalActions}>
              {editEntry && (
                <button className={`secondary ${styles.deleteBtn}`} onClick={handleDelete}>
                  <Trash2 size={18} style={{ marginRight: 8 }} />
                  Удалить
                </button>
              )}
              <button className="secondary" onClick={closeModal}>
                Отмена
              </button>
              <button onClick={handleSave} disabled={!formSubjectId}>
                <Save size={18} style={{ marginRight: 8 }} />
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setZoomModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Создать Zoom конференцию</div>

            <div style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 12 }}>
              Неделя: {formatDate(weekDays[0])} - {formatDate(weekDays[weekDays.length - 1])}
            </div>

            {zoomErr && <div style={{ color: "var(--color-error)", marginBottom: 10 }}>{zoomErr}</div>}
            {zoomSuccess && <div style={{ color: "var(--color-success)", marginBottom: 10 }}>{zoomSuccess}</div>}

            <div className={styles.formGroup}>
              <label className={styles.label}>Дата</label>
              <input
                type="date"
                value={zoomDay ? ymd(zoomDay) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const [yy, mm, dd] = v.split("-").map((x) => Number(x));
                  const d = new Date(yy, mm - 1, dd);
                  setZoomDay(d);
                }}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Время начала</label>
              <input type="time" value={zoomTime} onChange={(e) => setZoomTime(e.target.value)} />
            </div>

            <div className={styles.modalActions}>
              <button onClick={() => setZoomModalOpen(false)} disabled={zoomCreating}>
                Отмена
              </button>
              <button onClick={createZoomMeeting} disabled={zoomCreating || !zoomEntryId || !zoomDay || !zoomTime}>
                {zoomCreating ? "Создание..." : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
