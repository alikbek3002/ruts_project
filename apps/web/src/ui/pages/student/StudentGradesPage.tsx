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
        { to: "/app/student", label: "Панель" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/library", label: "Библиотека" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "10px 0" }}>Оценки (контрольные)</h3>
        {grades.length === 0 ? (
          <p>Оценок пока нет.</p>
        ) : (
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(grades, null, 2)}</pre>
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
