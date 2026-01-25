import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiSubjectContentListSubjects, type SubjectContentSubject } from "../../../api/client";
import { getStudentNavItems } from "../../layout/navigation";
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
      nav={getStudentNavItems()}
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
          <div className={styles.cardsGrid}>
            {subjects.map((s) => (
              <Link key={s.id} to={`/app/student/subjects/${s.id}`} className={styles.card}>
                <div className={styles.cardTop}>
                  <img
                    className={styles.photo}
                    src={(s as any).photo_url || "/favicon.svg"}
                    alt="Фото предмета"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.src.endsWith("/favicon.svg")) return;
                      img.src = "/favicon.svg";
                    }}
                  />
                  <div className={styles.cardInfo}>
                    <div className={styles.title}>{s.name}</div>
                    <div className={styles.meta}>
                      <span>Нажмите чтобы открыть</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
