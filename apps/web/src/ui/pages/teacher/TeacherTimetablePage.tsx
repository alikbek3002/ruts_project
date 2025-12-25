import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X, Video, MapPin, Users } from "lucide-react";
import {
  apiTeacherLessonJournalGet,
  apiTeacherLessonJournalSave,
  apiTimetableWeek,
  apiCreateZoomMeetingNew,
  type LessonJournalStudentRow,
  type WeekTimetableItem,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./TeacherTimetable.module.css";

const timeSlots = [
  { slot: 1, start: "09:00", end: "10:20" },
  { slot: 2, start: "10:30", end: "11:50" },
  { slot: 3, start: "12:00", end: "13:20" },
  { slot: 4, start: "13:20", end: "14:20", labelKey: "timetable.lunch" },
  { slot: 5, start: "14:20", end: "15:40" },
];

function hhmm(t: string): string {
  return t?.slice(0, 5) ?? t;
}

function toDbWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
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

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function getDayName(date: Date): string {
  return date.toLocaleDateString("ru-RU", { weekday: "short" }).toUpperCase();
}

export function TeacherTimetablePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "teacher" && !!token, [user, token]);

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [items, setItems] = useState<WeekTimetableItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [journalOpen, setJournalOpen] = useState(false);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalErr, setJournalErr] = useState<string | null>(null);
  const [journalSaved, setJournalSaved] = useState<string | null>(null);
  const [journalLesson, setJournalLesson] = useState<{
    timetableEntryId: string;
    date: string;
    subject: string;
    className: string;
    room?: string | null;
    start: string;
    end: string;
  } | null>(null);
  const [journalRows, setJournalRows] = useState<LessonJournalStudentRow[]>([]);

  // Zoom meeting states
  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomLesson, setZoomLesson] = useState<WeekTimetableItem | null>(null);
  const [zoomDay, setZoomDay] = useState<Date | null>(null);
  const [zoomTime, setZoomTime] = useState("");
  const [zoomCreating, setZoomCreating] = useState(false);
  const [zoomErr, setZoomErr] = useState<string | null>(null);
  const [zoomSuccess, setZoomSuccess] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Show Mon-Sat (6 days)
  }, [weekStart]);

  const today = new Date();
  const isCurrentWeek = getMonday(today).getTime() === weekStart.getTime();

  const totalLessons = useMemo(() => items.length, [items]);

  async function reload() {
    if (!token) return;
    const w = await apiTimetableWeek(token, ymd(weekStart));
    setItems(w.entries);
  }

  async function openJournal(lesson: WeekTimetableItem, day: Date) {
    if (!token) return;
    const dateISO = ymd(day);
    setJournalErr(null);
    setJournalSaved(null);
    setJournalLoading(true);
    setJournalOpen(true);
    setJournalLesson({
      timetableEntryId: lesson.id,
      date: dateISO,
      subject: lesson.subject,
      className: lesson.class_name,
      room: lesson.room ?? null,
      start: lesson.start_time,
      end: lesson.end_time,
    });
    try {
      const res = await apiTeacherLessonJournalGet(token, lesson.id, dateISO);
      setJournalRows(res.students);
    } catch (e) {
      setJournalErr(String(e));
      setJournalRows([]);
    } finally {
      setJournalLoading(false);
    }
  }

  async function saveJournal() {
    if (!token || !journalLesson) return;
    setJournalErr(null);
    setJournalSaved(null);
    setJournalLoading(true);
    try {
      await apiTeacherLessonJournalSave(token, journalLesson.timetableEntryId, {
        lesson_date: journalLesson.date,
        rows: journalRows.map((r) => ({
          student_id: r.id,
          present: r.present ?? null,
          grade: r.grade ?? null,
          comment: r.comment ?? null,
        })),
      });
      setJournalSaved("Сохранено");
      setTimeout(() => setJournalSaved(null), 2000);
    } catch (e) {
      setJournalErr(String(e));
    } finally {
      setJournalLoading(false);
    }
  }

  async function openZoomModal(e: React.MouseEvent, lesson: WeekTimetableItem, day: Date) {
    e.stopPropagation();
    const timeStr = `${lesson.start_time.slice(0, 5)}`;
    setZoomLesson(lesson);
    setZoomDay(day);
    setZoomTime(timeStr);
    setZoomErr(null);
    setZoomSuccess(null);
    setZoomModalOpen(true);
  }

  async function createZoomMeeting() {
    if (!token || !zoomLesson || !zoomDay || !zoomTime) return;
    
    setZoomCreating(true);
    setZoomErr(null);
    setZoomSuccess(null);

    try {
      const startsAtISO = `${ymd(zoomDay)}T${zoomTime}:00`;
      await apiCreateZoomMeetingNew(token, zoomLesson.id, startsAtISO);
      setZoomSuccess("Zoom встреча создана!");
      await reload(); // Refresh to show zoom link
      setTimeout(() => setZoomModalOpen(false), 1500);
    } catch (e) {
      setZoomErr(`Ошибка создания встречи: ${String(e)}`);
    } finally {
      setZoomCreating(false);
    }
  }

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, weekStart]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учитель → Расписание"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/gradebook", label: "Контрольные" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.weekNav}>
            <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ←
            </button>
            <div className={styles.weekLabel}>
              {formatDate(weekStart)} — {formatDate(addDays(weekStart, 6))}
            </div>
            <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, 7))}>
              →
            </button>
          </div>
          
          {!isCurrentWeek && (
            <button className={styles.todayButton} onClick={() => setWeekStart(getMonday(new Date()))}>
              Вернуться к сегодня
            </button>
          )}
        </div>

        {err && <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 8 }}>{err}</div>}

        <div className={styles.timetableWrapper}>
          <div className={styles.grid}>
            {/* Header Row: Empty corner + Days */}
            <div className={styles.headerCell}></div>
            {weekDays.map((day) => {
              const isToday = ymd(day) === ymd(today);
              return (
                <div key={day.toISOString()} className={`${styles.headerCell} ${isToday ? styles.todayHeader : ''}`}>
                  <div className={styles.dayName}>{getDayName(day)}</div>
                  <div className={styles.dayDate}>{formatDate(day)}</div>
                </div>
              );
            })}

            {/* Time Slots Rows */}
            {timeSlots.map((ts) => (
              <React.Fragment key={ts.slot}>
                {/* Time Column */}
                <div className={styles.timeCell}>
                  <span className={styles.slotNumber}>{ts.slot}</span>
                  <span className={styles.slotTime}>{ts.start}</span>
                  <span className={styles.slotTime}>{ts.end}</span>
                  {(ts as any).labelKey && (
                    <span className={styles.lunchLabel}>{t((ts as any).labelKey)}</span>
                  )}
                </div>

                {/* Day Columns for this Time Slot */}
                {weekDays.map((day) => {
                  const weekday = toDbWeekday(day);
                  const lesson = items.find(
                    (e) =>
                      e.weekday === weekday &&
                      hhmm(e.start_time) === ts.start &&
                      hhmm(e.end_time) === ts.end
                  );

                  return (
                    <div key={day.toISOString()} className={styles.cell}>
                      {lesson ? (
                        <div className={styles.lessonCard} onClick={() => openJournal(lesson, day)}>
                          <div className={styles.lessonSubject}>{lesson.subject}</div>
                          <div className={styles.lessonClass}>
                            <Users size={12} style={{ display: 'inline', marginRight: 4 }} />
                            {lesson.class_name}
                          </div>
                          {lesson.room && (
                            <div className={styles.lessonRoom}>
                              <MapPin size={12} />
                              {lesson.room}
                            </div>
                          )}
                          
                          {lesson.zoom ? (
                            <div className={styles.zoomBadge} onClick={(e) => e.stopPropagation()}>
                              <Video size={12} />
                              <a href={lesson.zoom.join_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                                Zoom
                              </a>
                            </div>
                          ) : (
                            <div 
                              className={styles.zoomBadge} 
                              style={{ color: '#9ca3af', cursor: 'pointer' }}
                              onClick={(e) => openZoomModal(e, lesson, day)}
                            >
                              <Video size={12} />
                              <span>+ Zoom</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={styles.emptyCell} />
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Journal Modal */}
      {journalOpen && (
        <div className={styles.modalOverlay} onClick={() => !journalLoading && setJournalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Посещаемость и оценки</div>
              <button className={styles.closeButton} onClick={() => setJournalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div className={styles.modalBody}>
              {journalLesson && (
                <div style={{ marginBottom: 16, padding: 12, background: '#f3f4f6', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, color: '#111827' }}>{journalLesson.subject}</div>
                  <div style={{ fontSize: 14, color: '#4b5563', marginTop: 4 }}>
                    {journalLesson.className} • {formatDate(new Date(journalLesson.date))} • {journalLesson.start}-{journalLesson.end}
                  </div>
                </div>
              )}

              {journalErr && <div style={{ color: "crimson", marginBottom: 12 }}>{journalErr}</div>}
              {journalSaved && <div style={{ color: "#059669", marginBottom: 12, fontWeight: 500 }}>{journalSaved}</div>}

              {journalLoading ? (
                <Loader text="Загрузка..." />
              ) : journalRows.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#6b7280' }}>Список учеников пуст</p>
              ) : (
                <div>
                  {journalRows.map((s) => (
                    <div key={s.id} className={styles.studentRow}>
                      <div className={styles.studentName}>{s.full_name || s.username}</div>
                      
                      <div className={styles.studentActions}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={!!s.present}
                            onChange={(e) => {
                              const next = e.target.checked;
                              setJournalRows((prev) => prev.map((p) => (p.id === s.id ? { ...p, present: next } : p)));
                            }}
                          />
                          Был(а)
                        </label>

                        <select
                          className={styles.gradeSelect}
                          value={s.grade ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const grade = v === "" ? null : Number(v);
                            setJournalRows((prev) => prev.map((p) => (p.id === s.id ? { ...p, grade } : p)));
                          }}
                        >
                          <option value="">-</option>
                          <option value="5">5</option>
                          <option value="4">4</option>
                          <option value="3">3</option>
                          <option value="2">2</option>
                          <option value="1">1</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setJournalOpen(false)}>
                Отмена
              </button>
              <button 
                className={`${styles.btn} ${styles.btnPrimary}`} 
                onClick={saveJournal} 
                disabled={journalLoading || !journalLesson}
              >
                {journalLoading ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Modal */}
      {zoomModalOpen && (
        <div className={styles.modalOverlay} onClick={() => !zoomCreating && setZoomModalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Создать Zoom встречу</div>
              <button className={styles.closeButton} onClick={() => setZoomModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {zoomLesson && zoomDay && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600 }}>{zoomLesson.subject}</div>
                  <div style={{ fontSize: 14, color: '#6b7280' }}>
                    {zoomLesson.class_name} • {formatDate(zoomDay)}
                  </div>
                </div>
              )}

              {zoomErr && <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 8, marginBottom: 12 }}>{zoomErr}</div>}
              {zoomSuccess && <div style={{ padding: 12, background: "#ecfdf5", color: "#059669", borderRadius: 8, marginBottom: 12 }}>{zoomSuccess}</div>}

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                  Время начала:
                </label>
                <input
                  type="time"
                  value={zoomTime}
                  onChange={(e) => setZoomTime(e.target.value)}
                  disabled={zoomCreating}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button 
                className={`${styles.btn} ${styles.btnSecondary}`} 
                onClick={() => setZoomModalOpen(false)}
                disabled={zoomCreating}
              >
                Отмена
              </button>
              <button 
                className={`${styles.btn} ${styles.btnPrimary}`} 
                onClick={createZoomMeeting} 
                disabled={zoomCreating || !zoomTime}
              >
                {zoomCreating ? "Создание..." : "Создать встречу"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
