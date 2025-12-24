import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
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
import styles from "../admin/AdminTimetable.module.css";

const timeSlots = [
  { slot: 1, start: "09:00", end: "10:20" },
  { slot: 2, start: "10:30", end: "11:50" },
  { slot: 3, start: "12:00", end: "13:20" },
  { slot: 4, start: "13:20", end: "14:20", labelKey: "timetable.lunch" as const },
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
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
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
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

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
    } catch (e) {
      setJournalErr(String(e));
    } finally {
      setJournalLoading(false);
    }
  }

  async function openZoomModal(lesson: WeekTimetableItem, day: Date) {
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
        { to: "/app/teacher", label: "🏠 Главная" },
        { to: "/app/teacher/journal", label: "📖 Журнал" },
        { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div className={styles.weekNav}>
        <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, -7))}>
          ←
        </button>
        <div className={styles.weekLabel}>{formatDate(weekStart)}</div>
        <button className={styles.navButton} onClick={() => setWeekStart(addDays(weekStart, 7))}>
          →
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
                <span className={styles.slotTime} style={{ fontSize: "10px", color: "#6ba92c" }}>
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
                const weekday = toDbWeekday(day);
                const lesson =
                  items.find(
                    (e) =>
                      e.weekday === weekday &&
                      hhmm(e.start_time) === ts.start &&
                      hhmm(e.end_time) === ts.end
                  ) || null;
                return (
                  <div key={ts.slot} className={styles.cell}>
                    {lesson ? (
                      <div className={styles.lesson}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openJournal(lesson, day)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") openJournal(lesson, day);
                          }}
                          style={{ cursor: "pointer", flex: 1 }}
                        >
                          {lesson.room && <div className={styles.lessonRoom}>{lesson.room}</div>}
                          <div className={styles.lessonSubject}>{lesson.subject}</div>
                          <div className={styles.lessonTeacher}>{lesson.class_name}</div>
                          {lesson.zoom && (
                            <div style={{ marginTop: 4, fontSize: 12, color: "#0066cc" }}>
                              📹 Zoom встреча
                            </div>
                          )}
                        </div>
                        <div style={{ 
                          display: "flex", 
                          gap: 4, 
                          marginTop: 8, 
                          justifyContent: "center",
                          flexWrap: "wrap"
                        }}>
                          {lesson.zoom ? (
                            <a
                              href={lesson.zoom.join_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                padding: "4px 8px",
                                background: "#0066cc",
                                color: "white",
                                textDecoration: "none",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Войти в Zoom
                            </a>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openZoomModal(lesson, day);
                              }}
                              style={{
                                padding: "4px 8px",
                                background: "#f0f0f0",
                                border: "1px solid #ccc",
                                borderRadius: 4,
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                            >
                              📹 Создать Zoom
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.readonlyEmpty} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {journalOpen && (
        <div className={styles.modal} onClick={() => !journalLoading && setJournalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Посещаемость и оценки</div>
            {journalLesson && (
              <div style={{ marginBottom: 12, opacity: 0.9 }}>
                <div>
                  {journalLesson.className} — {journalLesson.subject}
                </div>
                <div>
                  {journalLesson.date} {journalLesson.start}-{journalLesson.end}
                  {journalLesson.room ? ` • ${journalLesson.room}` : ""}
                </div>
              </div>
            )}

            {journalErr && <p style={{ color: "crimson" }}>{journalErr}</p>}
            {journalSaved && <p style={{ color: "#6ba92c" }}>{journalSaved}</p>}

            {journalLoading ? (
              <Loader text="Загрузка журнала..." />
            ) : journalRows.length === 0 ? (
              <p>В этом классе нет учеников.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {journalRows.map((s) => (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.full_name || s.username}</div>
                      {s.full_name && <div style={{ fontSize: 12, opacity: 0.75 }}>{s.username}</div>}
                    </div>

                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!s.present}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setJournalRows((prev) => prev.map((p) => (p.id === s.id ? { ...p, present: next } : p)));
                        }}
                      />
                      <span>Был(а)</span>
                    </label>

                    <select
                      className={styles.formSelect}
                      value={s.grade ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        const grade = v === "" ? null : Number(v);
                        setJournalRows((prev) => prev.map((p) => (p.id === s.id ? { ...p, grade } : p)));
                      }}
                    >
                      <option value="">Оценка</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => !journalLoading && setJournalOpen(false)}>
                Закрыть
              </button>
              <button className={styles.saveButton} onClick={saveJournal} disabled={journalLoading || !journalLesson}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomModalOpen && (
        <div className={styles.modal} onClick={() => !zoomCreating && setZoomModalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Создать Zoom встречу</div>
            {zoomLesson && zoomDay && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>{zoomLesson.class_name}</strong> — {zoomLesson.subject}
                </div>
                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  {formatDate(zoomDay)}, {zoomLesson.start_time.slice(0, 5)}-{zoomLesson.end_time.slice(0, 5)}
                  {zoomLesson.room && ` • ${zoomLesson.room}`}
                </div>
              </div>
            )}

            {zoomErr && <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 8, marginBottom: 12 }}>{zoomErr}</div>}
            {zoomSuccess && <div style={{ padding: 12, background: "#efe", color: "#060", borderRadius: 8, marginBottom: 12 }}>{zoomSuccess}</div>}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
                Время начала встречи:
              </label>
              <input
                type="time"
                value={zoomTime}
                onChange={(e) => setZoomTime(e.target.value)}
                disabled={zoomCreating}
                style={{ width: "100%", padding: "8px 12px", fontSize: 14 }}
              />
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                Встреча будет создана на {zoomDay ? formatDate(zoomDay) : ""} в {zoomTime}
              </div>
            </div>

            <div className={styles.modalActions}>
              <button 
                className={styles.cancelButton} 
                onClick={() => !zoomCreating && setZoomModalOpen(false)}
                disabled={zoomCreating}
              >
                Отмена
              </button>
              <button 
                className={styles.saveButton} 
                onClick={createZoomMeeting} 
                disabled={zoomCreating || !zoomTime}
                style={{
                  background: zoomCreating ? "#ccc" : "#0066cc",
                  cursor: zoomCreating || !zoomTime ? "not-allowed" : "pointer",
                }}
              >
                {zoomCreating ? "Создание..." : "📹 Создать встречу"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
