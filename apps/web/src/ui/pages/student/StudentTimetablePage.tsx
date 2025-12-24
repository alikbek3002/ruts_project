import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiTimetableWeek, type WeekTimetableItem } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
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

function mondayOf(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
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

export function StudentTimetablePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "student" && !!token, [user, token]);

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [items, setItems] = useState<WeekTimetableItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  useEffect(() => {
    if (!can || !token) return;
    apiTimetableWeek(token, ymd(weekStart))
      .then((r) => setItems(r.entries))
      .catch((e) => setErr(String(e)));
  }, [can, token, weekStart]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Ученик → Расписание"
      nav={[
        { to: "/app/student", label: "Панель" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/library", label: "Библиотека" },
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
                        {lesson.room && <div className={styles.lessonRoom}>{lesson.room}</div>}
                        <div className={styles.lessonSubject}>{lesson.subject}</div>
                        <div className={styles.lessonTeacher}>{lesson.teacher_name}</div>
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
    </AppShell>
  );
}
