import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { apiListCourses, type Course } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "../student/StudentCourses.module.css";

export function AdminCoursesPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";

  async function loadCourses() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiListCourses(token);
      setCourses(res.courses);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (can) loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title={user.role === "manager" ? "Менеджер → Курсы" : "Админ → Курсы"}
      nav={[
        { to: base, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/courses`, labelKey: "nav.courses" },
        { to: `${base}/meetings`, labelKey: "nav.meetings" },
        { to: `${base}/directions`, labelKey: "nav.directions" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
        { to: `${base}/workload`, labelKey: "nav.workload" },
        { to: `${base}/notifications`, labelKey: "nav.notifications" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Курсы</h2>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <Loader text="Загрузка курсов..." />
        ) : courses.length === 0 ? (
          <div className={styles.empty}>
            <BookOpen size={48} />
            <p>Пока нет курсов</p>
          </div>
        ) : (
          <div className={styles.coursesGrid}>
            {courses.map((course) => (
              <Link
                key={course.id}
                to={`${base}/courses/${course.id}`}
                className={styles.courseCard}
                title="Открыть курс"
              >
                <div className={styles.courseHeader}>
                  <h3>{course.title}</h3>
                </div>
                {course.description && <p className={styles.courseDescription}>{course.description}</p>}
                <div className={styles.courseFooter}>
                  <span className={styles.courseMeta}>Автор: {course.teacher?.full_name || "Неизвестно"}</span>
                  <span className={styles.courseMeta}>
                    {course.topics?.length || 0} {course.topics?.length === 1 ? "тема" : "тем"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
