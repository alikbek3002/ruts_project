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
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
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

  const selectedClass = classes.find((c) => c.id === classId);

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
      title={t("admin.timetable.title")}
      nav={[
        { to: base, label: t("admin.nav.home") },
        { to: `${base}/users`, label: t("admin.nav.users") },
        { to: `${base}/classes`, label: t("admin.nav.classes") },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: t("admin.nav.timetable") },
      ]}
    >
      <div className={styles.container}>
        {err && <div className={styles.error}>{err}</div>}

        {loading && <Loader text={t("common.loading") || "Загрузка..."} />}

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.backButton} onClick={() => setClassId("")}>
              ←
            </button>
            <div className={styles.className}>
              {selectedClass ? selectedClass.name : t("timetable.selectGroup")}
            </div>
          </div>
          <div style={{ marginRight: 20 }}>
            <label style={{ marginRight: 8, fontSize: 14, color: "#8a93a0" }}>{t("timetable.groupShort")}</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className={styles.formSelect}
              style={{ width: "auto", display: "inline-block" }}
            >
              <option value="">{t("common.select")}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.weekNav}>
          <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, -7))}>
            {t("timetable.prevWeek")}
          </button>
          <div className={styles.weekLabel}>
            {formatDate(weekDays[0])} - {formatDate(weekDays[6])}
          </div>
          <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, 7))}>
            {t("timetable.nextWeek")}
          </button>
        </div>

        <div className={styles.gridContainer}>
          <div className={styles.timeHeader}>
            <div className={styles.timeSlot}></div>
            {timeSlots.map((ts) => (
              <div key={ts.slot} className={styles.timeSlot}>
                <span className={styles.slotNumber}>{ts.slot}</span>
                <span className={styles.slotTime}>
                  {ts.start}-{ts.end}
                </span>
                {(ts as any).labelKey && (
                  <span className={styles.slotTime} style={{ fontSize: '10px', color: '#6ba92c' }}>
                    {t((ts as any).labelKey)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className={styles.grid}>
            {weekDays.map((day) => (
              <div className={styles.dayRow} key={day.toISOString()}>
                <div className={styles.dateCell}>{formatDate(day)}</div>
                {timeSlots.map((ts) => {
                  const lesson = classId ? getLessonForCell(day, ts.slot) : null;
                  return (
                    <div key={ts.slot} className={styles.cell}>
                      {lesson ? (
                        <div className={styles.lesson} onClick={() => openEditModal(day, ts.slot, lesson)}>
                          {lesson.room && <div className={styles.lessonRoom}>{lesson.room}</div>}
                          <div className={styles.lessonSubject}>
                            {lesson.subject}
                            {lesson.lesson_type === "credit" && (
                              <span style={{ 
                                marginLeft: 4, 
                                fontSize: 10, 
                                background: "#ff9800", 
                                color: "#fff", 
                                padding: "1px 4px", 
                                borderRadius: 3 
                              }}>
                                ЗАЧЁТ
                              </span>
                            )}
                          </div>
                          <div className={styles.lessonTeacher}>{getTeacherName(lesson.teacher_id)}</div>
                        </div>
                      ) : (
                        <button 
                          className={styles.addButton} 
                          onClick={() => openAddModal(day, ts.slot)}
                          disabled={!classId}
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className={styles.modal} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>{editEntry ? t("timetable.editLesson") : t("timetable.addLesson")}</div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("timetable.subject")}</label>
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
                className={styles.formSelect}
              >
                <option value="">— Выберите предмет —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <small style={{ color: "#666", display: "block", marginTop: 4 }}>
                Учитель подставится автоматически по предмету (если назначен), иначе будет "---"
              </small>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Тип пары</label>
              <select
                value={formLessonType}
                onChange={(e) => setFormLessonType(e.target.value as "lecture" | "credit")}
                className={styles.formSelect}
              >
                <option value="lecture">Обычная пара</option>
                <option value="credit">Зачёт</option>
              </select>
              {formLessonType === "credit" && (
                <small style={{ color: "#666", display: "block", marginTop: 4 }}>
                  При зачёте оценки: зачёт/незачёт
                </small>
              )}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t("timetable.room")}</label>
              <input
                value={formRoom}
                onChange={(e) => setFormRoom(e.target.value)}
                className={styles.formInput}
                placeholder={t("timetable.roomPlaceholder")}
              />
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={closeModal}>
                {t("timetable.cancel")}
              </button>
              {editEntry && (
                <button className={styles.deleteButton} onClick={handleDelete}>
                  {t("common.delete")}
                </button>
              )}
              <button
                className={styles.saveButton}
                onClick={handleSave}
                disabled={!formSubjectId}
              >
                {t("timetable.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
