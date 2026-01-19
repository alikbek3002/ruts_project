import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { X } from "lucide-react";
import { apiGetClass, apiListCuratedClasses, type ClassItem, type ClassStudent } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "./TeacherMyVzvody.module.css";

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
    try {
      const resp = await apiListCuratedClasses(token);
      setClasses(resp.classes || []);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    if (!can) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учитель → Мои взводы"
      nav={[
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Мои взводы</h1>
        </div>

        {err && <div style={{ padding: 12, background: "#fee", color: "#c00", borderRadius: 8, marginBottom: 24 }}>{err}</div>}

        <div className={styles.grid}>
          {classes.map((cls) => (
            <div key={cls.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{cls.name}</h3>
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
                  Список учеников
                </button>
              </div>
            </div>
          ))}
        </div>

        {classes.length === 0 && !err && (
          <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
            Вы не назначены куратором ни одного взвода.
          </div>
        )}
      </div>

      {studentsOpen && (
        <div className={styles.modalOverlay} onClick={() => setStudentsOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Ученики — {studentsTitle}</h2>
              <button className={styles.closeButton} onClick={() => setStudentsOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {students.length === 0 ? (
                <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>Пока нет учеников</div>
              ) : (
                <table className={styles.studentTable}>
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>№</th>
                      <th>ФИО</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsSorted.map((s, idx) => (
                      <tr key={s.id}>
                        <td>{s.student_number ?? idx + 1}</td>
                        <td>{s.full_name || s.username}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.secondaryBtn} onClick={() => setStudentsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
