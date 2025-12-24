import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiCreateAssessment,
  apiGetClass,
  apiListAssessments,
  apiListClasses,
  apiSetGrade,
  type Assessment,
  type ClassItem,
  type ClassStudent,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function TeacherGradebookPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "teacher" && !!token, [user, token]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<ClassStudent[]>([]);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentId, setAssessmentId] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [grades, setGrades] = useState<Record<string, number | "">>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!can) return;
    if (!token) return;
    apiListClasses(token)
      .then((r) => setClasses(r.classes))
      .catch((e) => setErr(String(e)));
  }, [can, token]);

  useEffect(() => {
    if (!can || !token || !classId) {
      setStudents([]);
      setAssessments([]);
      setAssessmentId("");
      return;
    }
    Promise.all([apiGetClass(token, classId), apiListAssessments(token, classId)])
      .then(([c, a]) => {
        setStudents(c.students);
        setAssessments(a.assessments);
      })
      .catch((e) => setErr(String(e)));
  }, [can, token, classId]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учитель → Оценки"
      nav={[
        { to: "/app/teacher", label: "🏠 Главная" },
        { to: "/app/teacher/journal", label: "📖 Журнал" },
        { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Группа: 
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">(выберите)</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {classId && (
        <>
          <hr />
          <h3>Контрольная/оценивание</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="Название" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <input value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <button
              disabled={!newTitle.trim()}
              onClick={async () => {
                if (!token) return;
                setErr(null);
                try {
                  const r = await apiCreateAssessment(token, { class_id: classId, title: newTitle.trim(), date: newDate });
                  setNewTitle("");
                  const a = await apiListAssessments(token, classId);
                  setAssessments(a.assessments);
                  setAssessmentId(r.assessment.id);
                } catch (e) {
                  setErr(String(e));
                }
              }}
            >
              Создать
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            <label>
              Выбрать: 
              <select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
                <option value="">(не выбрано)</option>
                {assessments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.date} — {a.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {assessmentId && (
            <>
              <hr />
              <h3>Оценки</h3>
              {students.length === 0 ? (
                <p>В группе нет учеников.</p>
              ) : (
                <table cellPadding={6} style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Ученик</th>
                      <th align="left">Оценка (1-5)</th>
                      <th align="left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                        <td>
                          {s.username} {s.full_name ? `— ${s.full_name}` : ""}
                        </td>
                        <td>
                          <input
                            style={{ width: 80 }}
                            value={grades[s.id] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              const n = v === "" ? "" : Number(v);
                              setGrades((g) => ({ ...g, [s.id]: n }));
                            }}
                            placeholder="1-5"
                          />
                        </td>
                        <td>
                          <button
                            onClick={async () => {
                              if (!token) return;
                              const v = grades[s.id];
                              if (v === "" || typeof v !== "number") return;
                              setErr(null);
                              try {
                                await apiSetGrade(token, { assessment_id: assessmentId, student_id: s.id, value: v });
                              } catch (e) {
                                setErr(String(e));
                              }
                            }}
                            disabled={grades[s.id] === "" || grades[s.id] == null}
                          >
                            Сохранить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
