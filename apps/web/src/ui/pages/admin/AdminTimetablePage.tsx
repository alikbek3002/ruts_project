import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiAdminListUsers,
  apiCreateTimetableEntry,
  apiDeleteTimetableEntry,
  apiListClasses,
  apiListTimetableEntries,
  apiUpdateTimetableEntry,
  apiListSubjects,
  type AdminUser,
  type ClassItem,
  type TimetableEntry,
  type Subject,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminTimetable.module.css";
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Calendar } from "lucide-react";

const timeSlots = [
  { slot: 1, start: "09:00", end: "10:20" },
  { slot: 2, start: "10:30", end: "11:50" },
  { slot: 3, start: "12:00", end: "13:20" },
  { slot: 4, start: "13:20", end: "14:20", labelKey: "timetable.lunch" as const },
  { slot: 5, start: "14:20", end: "15:40" },
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

export function AdminTimetablePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState("");
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<TimetableEntry | null>(null);
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalSlot, setModalSlot] = useState<number | null>(null);
  
  // Form fields
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formRoom, setFormRoom] = useState("");
  const [formLessonType, setFormLessonType] = useState<"lecture" | "credit">("lecture");

  const weekDays = useMemo(() => {
    // Admin timetable grid: Mon-Sat (6 days)
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  async function reload() {
    if (!token) return;
    setLoading(true);
    try {
      const [c, t, s] = await Promise.all([
        apiListClasses(token),
        apiAdminListUsers(token, "teacher"),
        apiListSubjects(token),
      ]);
      setClasses(c.classes);
      setTeachers(t.users);
      setSubjects(s.subjects || []);
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

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(String(e)));
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
    apiListTimetableEntries(token, classId)
      .then((e) => setEntries(e.entries))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [classId, can, token]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Расписание" : "Админ → Расписание";

  function openAddModal(date: Date, slot: number) {
    setModalDate(date);
    setModalSlot(slot);
    setEditEntry(null);
    setFormSubjectId("");
    setFormSubject("");
    setFormRoom("");
    setFormLessonType("lecture");
    setModalOpen(true);
  }

  function openEditModal(date: Date, slot: number, entry: TimetableEntry) {
    setModalDate(date);
    setModalSlot(slot);
    setEditEntry(entry);
    setFormSubjectId(entry.subject_id || "");
    setFormSubject(entry.subject);
    setFormRoom(entry.room || "");
    setFormLessonType(entry.lesson_type || "lecture");
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
      if (editEntry) {
        await apiUpdateTimetableEntry(token, editEntry.id, {
          subject: formSubject.trim(),
          subject_id: formSubjectId || null,
          room: formRoom.trim() ? formRoom.trim() : null,
          lesson_type: formLessonType,
        });
      } else {
        await apiCreateTimetableEntry(token, {
          class_id: classId,
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
      setErr(String(e));
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
      setErr(String(e));
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
      nav={[
        { to: base, label: "Главная" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Расписание</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}

        <div className={styles.controls}>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className={styles.select}
          >
            <option value="">— Выберите группу —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

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
                  return (
                    <div key={day.toISOString()} className={styles.cell}>
                      {lesson ? (
                        <div className={styles.entry} onClick={() => openEditModal(day, ts.slot, lesson)}>
                          <div className={styles.entrySubject}>
                            {lesson.subject}
                            {lesson.lesson_type === "credit" && (
                              <span style={{ 
                                marginLeft: 4, 
                                fontSize: 10, 
                                background: "#f59e0b", 
                                color: "#fff", 
                                padding: "1px 4px", 
                                borderRadius: 3 
                              }}>
                                ЗАЧЁТ
                              </span>
                            )}
                          </div>
                          <div className={styles.entryTeacher}>{getTeacherName(lesson.teacher_id)}</div>
                          {lesson.room && <div className={styles.entryRoom}>{lesson.room}</div>}
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

            <div className={styles.formGroup}>
              <label className={styles.label}>Тип занятия</label>
              <select
                value={formLessonType}
                onChange={(e) => setFormLessonType(e.target.value as "lecture" | "credit")}
                className={styles.select}
              >
                <option value="lecture">Обычная пара</option>
                <option value="credit">Зачёт</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Аудитория</label>
              <input
                value={formRoom}
                onChange={(e) => setFormRoom(e.target.value)}
                className={styles.input}
                placeholder="Например: 305"
              />
            </div>

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
    </AppShell>
  );
}
