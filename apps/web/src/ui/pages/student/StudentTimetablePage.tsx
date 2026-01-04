import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { MapPin, User } from "lucide-react";
import { apiTimetableWeek, apiListClasses, type WeekTimetableItem, type ClassItem } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "../teacher/TeacherTimetable.module.css";

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
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function getDayName(date: Date): string {
  return date.toLocaleDateString("ru-RU", { weekday: "short" }).toUpperCase();
}

export function StudentTimetablePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "student" && !!token, [user, token]);

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [items, setItems] = useState<WeekTimetableItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon–Sat
  }, [weekStart]);

  const today = new Date();
  const isCurrentWeek = getMonday(today).getTime() === weekStart.getTime();

  // Load classes list (only once on mount)
  useEffect(() => {
    if (!can || !token) return;
    apiListClasses(token)
      .then((r) => {
        setClasses(r.classes);
        // Auto-select first class if available
        if (r.classes.length > 0 && !selectedClassId) {
          setSelectedClassId(r.classes[0].id);
        }
      })
      .catch((e) => console.error("Failed to load classes:", e));
  }, [can, token]); // Removed selectedClassId dependency to load only once

  // Load timetable
  useEffect(() => {
    if (!can || !token) return;
    apiTimetableWeek(token, ymd(weekStart), selectedClassId || undefined)
      .then((r) => setItems(r.entries))
      .catch((e) => setErr(String(e)));
  }, [can, token, weekStart, selectedClassId]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Ученик → Расписание"
      nav={[
        { to: "/app/student", label: "Главная" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/homework", label: "Домашнее задание" },
        { to: "/app/student/library", label: "Библиотека" },
        { to: "/app/student/courses", label: "Курсы" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>Взвод:</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                fontSize: 14,
                minWidth: "200px",
              }}
            >
              <option value="">— Все взводы —</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>

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
            {/* Header Row */}
            <div className={styles.headerCell}></div>
            {weekDays.map((day) => {
              const isToday = ymd(day) === ymd(today);
              return (
                <div key={day.toISOString()} className={`${styles.headerCell} ${isToday ? styles.todayHeader : ""}`}>
                  <div className={styles.dayName}>{getDayName(day)}</div>
                  <div className={styles.dayDate}>{formatDate(day)}</div>
                </div>
              );
            })}

            {/* Time Slots */}
            {timeSlots.map((ts) => (
              <React.Fragment key={ts.slot}>
                <div className={styles.timeCell}>
                  <span className={styles.slotNumber}>{ts.slot}</span>
                  <span className={styles.slotTime}>{ts.start}</span>
                  <span className={styles.slotTime}>{ts.end}</span>
                  {(ts as any).labelKey && <span className={styles.lunchLabel}>{t((ts as any).labelKey)}</span>}
                </div>

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
                        <div className={styles.lessonCard} style={{ cursor: "default" }}>
                          <div className={styles.lessonSubject}>{lesson.subject}</div>
                          <div className={styles.lessonClass}>
                            <User size={12} style={{ display: "inline", marginRight: 4 }} />
                            {lesson.teacher_name || "---"}
                          </div>
                          {lesson.room && (
                            <div className={styles.lessonRoom}>
                              <MapPin size={12} />
                              {lesson.room}
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
    </AppShell>
  );
}
