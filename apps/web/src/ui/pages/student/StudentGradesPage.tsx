import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiMyGrades, type LessonJournalItem } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function StudentGradesPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "student" && !!token, [user, token]);
  const [grades, setGrades] = useState<any[]>([]);
  const [lessonJournal, setLessonJournal] = useState<LessonJournalItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!can || !token) return;
    apiMyGrades(token)
      .then((r) => {
        setGrades(r.grades);
        setLessonJournal(r.lessonJournal ?? []);
      })
      .catch((e) => setErr(String(e)));
  }, [can, token]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Ученик → Оценки"
      nav={[
        { to: "/app/student", label: "Главная" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/homework", label: "Домашнее задание" },
        { to: "/app/student/library", label: "Библиотека" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "10px 0" }}>Оценки (контрольные)</h3>
        {grades.length === 0 ? (
          <p>Оценок пока нет.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {grades.map((g, idx) => (
              <div
                key={idx}
                style={{
                  padding: 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-card)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{g.title || "Контрольная работа"}</div>
                  <div style={{ opacity: 0.7, fontSize: "0.9em" }}>{g.date}</div>
                  {g.comment && <div style={{ marginTop: 4, fontStyle: "italic" }}>{g.comment}</div>}
                </div>
                <div style={{ 
                  fontSize: "1.2em", 
                  fontWeight: "bold", 
                  color: "var(--color-primary)",
                  background: "var(--color-bg-secondary)",
                  padding: "4px 12px",
                  borderRadius: 16
                }}>
                  {g.grade}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ margin: "10px 0" }}>Оценки и посещаемость (по урокам)</h3>
        {lessonJournal.length === 0 ? (
          <p>Пока нет записей.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lessonJournal.map((r) => (
              <div
                key={`${r.timetable_entry_id}|${r.date}`}
                style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-card)" }}
              >
                <div style={{ fontWeight: 600 }}>
                  {r.date} — {r.subject || "Урок"}
                  {r.class_name ? ` (${r.class_name})` : ""}
                </div>
                <div style={{ opacity: 0.85 }}>
                  Посещение: {r.present ? "Был(а)" : "Нет"} · Оценка: {r.grade ?? "—"}
                  {r.room ? ` · ${r.room}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
