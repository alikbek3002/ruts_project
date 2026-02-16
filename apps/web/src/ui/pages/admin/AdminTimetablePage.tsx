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
  type AdminUser,
  type ClassItem,
  type TimetableEntry,
  type Subject,
  type Stream,
  type WeekTimetableItem,
  apiDuplicateTimetableWeek,
  apiGetCycleDetail,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import styles from "./AdminTimetable.module.css";
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Calendar, Video, ExternalLink, Copy } from "lucide-react";

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

  // Edit/Add Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<TimetableEntry | null>(null);
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalSlot, setModalSlot] = useState<number | null>(null);

  // Form fields
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formRoom, setFormRoom] = useState("");
  const [formLessonType, setFormLessonType] = useState<"lecture" | "seminar" | "exam" | "practical">("lecture");
  const [formClassIds, setFormClassIds] = useState<string[]>([]);
  const [formTeacherId, setFormTeacherId] = useState<string>("");
  const [formLessonNumber, setFormLessonNumber] = useState<number | "">(1);
  const [formMeetUrl, setFormMeetUrl] = useState("");


  // Duplication state
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateTargetClassIds, setDuplicateTargetClassIds] = useState<string[]>([]);
  const [duplicating, setDuplicating] = useState(false);

  // Teachers filtered by subject's cycle
  const [cycleTeachers, setCycleTeachers] = useState<Array<{ id: string; name: string }>>([]);

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
        const start = ymd(weekStart);
        const end = ymd(addDays(weekStart, 6));
        const e = await apiListTimetableEntries(token, classId, start, end);
        setEntries(e.entries);
      } else {
        setEntries([]);
      }
    } finally {
      setLoading(false);
    }
  }

  // Load classes when stream is selected

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
      return;
    }
    setLoading(true);
    const start = ymd(weekStart);
    const end = ymd(addDays(weekStart, 6));
    apiListTimetableEntries(token, classId, start, end)
      .then((e) => setEntries(e.entries))
      .catch((e) => setErr(toUiError(e)))
      .finally(() => setLoading(false));
  }, [classId, can, token, weekStart]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Расписание" : "Админ → Расписание";



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
    setFormTeacherId("");
    setFormLessonNumber(1);
    setFormMeetUrl("");
    setCycleTeachers([]); // Clear cycle teachers for new entry
    setModalOpen(true);
  }

  async function openEditModal(date: Date, slot: number, entry: TimetableEntry) {
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
    setFormTeacherId(entry.teacher_id || "");
    setFormLessonNumber((entry as any).lesson_number || 1);
    setFormMeetUrl(entry.meet_url || "");

    // Load cycle teachers for the entry's subject
    setCycleTeachers([]);
    if (entry.subject_id && token) {
      const subj = subjects.find(s => s.id === entry.subject_id);
      if (subj?.cycle_id) {
        try {
          const res = await apiGetCycleDetail(token, subj.cycle_id);
          setCycleTeachers(res.teachers || []);
        } catch {
          // Fallback to all teachers
        }
      }
    }

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
          teacher_id: formTeacherId || null,
          stream_id: selectedStreamId || null,
          lesson_number: formLessonNumber && formLessonNumber > 0 ? formLessonNumber : null,
          meet_url: formMeetUrl.trim() || null,
          lesson_date: ymd(modalDate),
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
          teacher_id: formTeacherId || undefined,
          lesson_number: formLessonNumber && formLessonNumber > 0 ? formLessonNumber : undefined,
          meet_url: formMeetUrl.trim() || undefined,
          lesson_date: ymd(modalDate),
        });
      }
      const start = ymd(weekStart);
      const end = ymd(addDays(weekStart, 6));
      const e = await apiListTimetableEntries(token, classId, start, end);
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
      const start = ymd(weekStart);
      const end = ymd(addDays(weekStart, 6));
      const e = await apiListTimetableEntries(token, classId, start, end);
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

  // Calculate lesson type number (e.g., 1st lecture, 2nd seminar for this subject)
  function getLessonTypeNumber(targetEntry: TimetableEntry): number {
    // Use manual lesson_number if set
    if (targetEntry.lesson_number && targetEntry.lesson_number > 0) {
      return targetEntry.lesson_number;
    }

    if (!targetEntry.subject_id || !targetEntry.lesson_type) return 1;

    // Get all entries for this subject and lesson type, sorted by date
    const sameTypeEntries = entries.filter(
      e => e.subject_id === targetEntry.subject_id &&
        e.lesson_type === targetEntry.lesson_type
    ).sort((a, b) => {
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      return a.start_time.localeCompare(b.start_time);
    });

    // Find the index of this entry + 1
    const index = sameTypeEntries.findIndex(e => e.id === targetEntry.id);
    return index >= 0 ? index + 1 : 1;
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

        {classId && (
          <div style={{ padding: "0 16px 16px", display: "flex", justifyContent: "flex-end" }}>
            <button
              className={styles.secondaryBtn}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
              onClick={async () => {
                if (!token) return;
                if (!window.confirm("Скопировать расписание текущей недели на СЛЕДУЮЩУЮ неделю?")) return;
                setLoading(true);
                try {
                  const srcStart = ymd(weekStart);
                  const targetStart = ymd(addDays(weekStart, 7));

                  // We duplication for selected class (and stream?)
                  // Backend logic supports class_id filter.
                  const res = await apiDuplicateTimetableWeek(token, {
                    source_week_start: srcStart,
                    target_week_start: targetStart,
                    class_id: classId,
                    stream_id: selectedStreamId || undefined
                  });
                  alert(res.message);
                } catch (e) {
                  alert(normalizeUiError(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Copy size={16} />
              Дублировать на след. неделю
            </button>
          </div>
        )}

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
                                ЛЕКЦИЯ {getLessonTypeNumber(lesson)}
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
                                СЕМИНАР {getLessonTypeNumber(lesson)}
                              </span>
                            )}
                            {lesson.lesson_type === "practical" && (
                              <span style={{
                                marginLeft: 4,
                                fontSize: 10,
                                background: "#8b5cf6",
                                color: "#fff",
                                padding: "1px 4px",
                                borderRadius: 3
                              }}>
                                ПРАКТИКА {getLessonTypeNumber(lesson)}
                              </span>
                            )}
                          </div>
                          <div className={styles.entryTeacher}>{getTeacherName(lesson.teacher_id)}</div>
                          {lesson.room && <div className={styles.entryRoom}>{lesson.room}</div>}

                          {lesson.meet_url && (
                            <div className={styles.zoomRow}>
                              <a
                                className={styles.zoomLink}
                                href={lesson.meet_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Google Meet"
                              >
                                <ExternalLink size={14} />
                                Meet
                              </a>
                            </div>
                          )}
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

      {
        modalOpen && (
          <div className={styles.modalOverlay} onClick={closeModal}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalTitle}>
                {editEntry ? "Редактировать пару" : "Добавить пару"}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Предмет</label>
                <select
                  value={formSubjectId}
                  onChange={async (e) => {
                    const subjectId = e.target.value;
                    setFormSubjectId(subjectId);
                    setFormTeacherId(""); // Reset teacher when subject changes
                    setCycleTeachers([]); // Clear cycle teachers

                    const subj = subjects.find(s => s.id === subjectId);
                    if (subj) {
                      setFormSubject(subj.name);

                      // Load teachers for this subject's cycle
                      if (subj.cycle_id && token) {
                        try {
                          const res = await apiGetCycleDetail(token, subj.cycle_id);
                          setCycleTeachers(res.teachers || []);
                        } catch {
                          // Fallback to all teachers if cycle load fails
                          setCycleTeachers([]);
                        }
                      }
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
                  onChange={(e) => setFormLessonType(e.target.value as "lecture" | "seminar" | "exam" | "practical")}
                  className={styles.select}
                >
                  <option value="lecture">Лекционное</option>
                  <option value="seminar">Семинарское</option>
                  <option value="exam">Экзамен</option>
                  <option value="practical">Практическое</option>
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

              <div className={styles.formGroup}>
                <label className={styles.label}>Ссылка Google Meet (необязательно)</label>
                <input
                  value={formMeetUrl}
                  onChange={(e) => setFormMeetUrl(e.target.value)}
                  placeholder="https://meet.google.com/..."
                  className={styles.input} // Ensure using same input styles, might need to check css or use standard style
                  style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px solid #ccc" }}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  Преподаватель
                  {cycleTeachers.length > 0 && <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>(учителя цикла)</span>}
                </label>
                <select
                  value={formTeacherId}
                  onChange={(e) => setFormTeacherId(e.target.value)}
                  className={styles.select}
                >
                  <option value="">— Не выбрано —</option>
                  {cycleTeachers.length > 0 ? (
                    cycleTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  ) : (
                    teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name || t.username}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Номер занятия</label>
                <input
                  type="number"
                  min={1}
                  value={formLessonNumber}
                  onChange={(e) => setFormLessonNumber(e.target.value ? parseInt(e.target.value) : "")}
                  className={styles.input}
                  placeholder="1"
                  style={{ width: 80 }}
                />
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
                {editEntry && (
                  <button
                    onClick={() => {
                      setDuplicateModalOpen(true);
                      setDuplicateTargetClassIds([]);
                    }}
                    style={{ marginLeft: "auto", background: "#8b5cf6" }}
                  >
                    Дублировать
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      }



      {
        duplicateModalOpen && editEntry && (
          <div className={styles.modalOverlay} onClick={() => setDuplicateModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalTitle}>Дублировать расписание</div>

              <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
                Выберите группы для копирования этого занятия:
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Целевые группы</label>
                <select
                  multiple
                  value={duplicateTargetClassIds}
                  onChange={(e) => {
                    const opts = Array.from(e.target.selectedOptions, (o) => o.value);
                    setDuplicateTargetClassIds(opts);
                  }}
                  className={styles.select}
                  style={{ height: "200px" }}
                >
                  {allClasses
                    .filter((c) => c.id !== classId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.id}
                      </option>
                    ))}
                </select>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
                  Используйте Cmd (macOS) / Ctrl (Windows) для выбора нескольких групп
                </div>
              </div>

              <div className={styles.modalActions}>
                <button onClick={() => setDuplicateModalOpen(false)} disabled={duplicating}>
                  Отмена
                </button>
                <button
                  onClick={async () => {
                    if (!token || !editEntry || duplicateTargetClassIds.length === 0) return;
                    setDuplicating(true);
                    try {
                      for (const targetClassId of duplicateTargetClassIds) {
                        await apiCreateTimetableEntry(token, {
                          class_id: targetClassId,
                          subject: editEntry.subject,
                          subject_id: editEntry.subject_id || undefined,
                          weekday: editEntry.weekday,
                          start_time: editEntry.start_time,
                          end_time: editEntry.end_time,
                          room: editEntry.room || undefined,
                          lesson_type: editEntry.lesson_type,
                          teacher_id: editEntry.teacher_id,
                          stream_id: editEntry.stream_id || undefined,
                        });
                      }
                      setDuplicateModalOpen(false);
                      setDuplicateTargetClassIds([]);
                      reload();
                    } catch (err: any) {
                      alert("Ошибка дублирования: " + (err?.message || err));
                    } finally {
                      setDuplicating(false);
                    }
                  }}
                  disabled={duplicating || duplicateTargetClassIds.length === 0}
                >
                  {duplicating ? "Дублирование..." : "Дублировать"}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </AppShell >
  );
}
