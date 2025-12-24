import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiGetClass, apiListCuratedClasses, type ClassItem, type ClassStudent } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "../admin/AdminClasses.module.css";

export function TeacherMyVzvodyPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const can = useMemo(() => !!user && user.role === "teacher" && !!token, [user, token]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [studentsTitle, setStudentsTitle] = useState<string>("");
  const [students, setStudents] = useState<ClassStudent[]>([]);

  const studentsSorted = useMemo(() => {
    const list = [...students];
    list.sort((a, b) => {
      const an = a.student_number;
      const bn = b.student_number;
      if (an != null && bn != null) return an - bn;
      if (an != null) return -1;
      if (bn != null) return 1;
      const aName = (a.full_name || a.username || "").toLowerCase();
      const bName = (b.full_name || b.username || "").toLowerCase();
      return aName.localeCompare(bName);
    });
    return list;
  }, [students]);

  async function reload() {
    if (!token) return;
    const resp = await apiListCuratedClasses(token);
    setClasses(resp.classes || []);
  }

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Мои взводы"
      nav={[
        { to: "/app", label: "🏠 Dashboard" },
        { to: "/app/teacher/journal", label: "📖 Журнал" },
        { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      {err && <div style={{ color: "var(--color-error)", marginBottom: 12 }}>{err}</div>}

      <div className={styles.cardsGrid}>
        {classes.map((cls) => (
          <div key={cls.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{cls.name}</span>
              <span className={styles.studentCount}>👤 {cls.student_count ?? 0}</span>
            </div>

            {cls.direction && <div className={styles.direction}>📍 {cls.direction.name}</div>}

            <div className={styles.cardActions}>
              <button
                className={styles.primaryBtn}
                onClick={async () => {
                  if (!token) return;
                  setErr(null);
                  try {
                    const resp = await apiGetClass(token, cls.id);
                    setStudentsTitle(cls.name);
                    setStudents(resp.students || []);
                    setStudentsOpen(true);
                  } catch (e) {
                    setErr(String(e));
                  }
                }}
              >
                👤 Ученики
              </button>
            </div>
          </div>
        ))}

        {classes.length === 0 && (
          <div style={{ color: "var(--color-text-light)", gridColumn: "1 / -1" }}>
            Вы не назначены куратором ни одного взвода.
          </div>
        )}
      </div>

      {studentsOpen && (
        <div className={styles.modal} onClick={() => setStudentsOpen(false)}>
          <div className={styles.modalContent} style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>Ученики — {studentsTitle}</h3>

            {students.length === 0 ? (
              <div style={{ color: "var(--color-text-light)" }}>Пока нет учеников</div>
            ) : (
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                <table cellPadding={6} style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left" style={{ width: 60 }}>
                        №
                      </th>
                      <th align="left">ФИО</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsSorted.map((s, idx) => (
                      <tr key={s.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td>{s.student_number ?? idx + 1}</td>
                        <td>{s.full_name || s.username}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="secondary" onClick={() => setStudentsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
