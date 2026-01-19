import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiSubjectContentListSubjects, type SubjectContentSubject } from "../../../api/client";
import styles from "./StudentSubjects.module.css";

export function StudentSubjectsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [subjects, setSubjects] = useState<SubjectContentSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiSubjectContentListSubjects(token);
      setSubjects(res.subjects || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Предметы"
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
        { to: "/app/student/teachers", labelKey: "nav.teachers" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Предметы</h2>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <Loader text="Загрузка предметов..." />
        ) : subjects.length === 0 ? (
          <div className={styles.empty}>
            <BookOpen size={48} />
            <p>Пока нет предметов</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {subjects.map((s) => (
              <Link key={s.id} to={`/app/student/subjects/${s.id}`} className={styles.card} title="Открыть предмет">
                <div className={styles.cardHeader}>
                  <h3>{s.name}</h3>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
