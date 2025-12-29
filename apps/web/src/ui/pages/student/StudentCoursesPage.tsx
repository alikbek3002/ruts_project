import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiListCourses, type Course } from "../../../api/client";
import styles from "./StudentCourses.module.css";

export function StudentCoursesPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadCourses();
  }, [token]);

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

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Курсы"
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
          <h2>Доступные курсы</h2>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <Loader text="Загрузка курсов..." />
        ) : courses.length === 0 ? (
          <div className={styles.empty}>
            <BookOpen size={48} />
            <p>Пока нет доступных курсов</p>
          </div>
        ) : (
          <div className={styles.coursesGrid}>
            {courses.map((course) => (
              <Link key={course.id} to={`/app/student/courses/${course.id}`} className={styles.courseCard} title="Открыть курс">
                <div className={styles.courseHeader}>
                  <h3>{course.title}</h3>
                </div>
                {course.description && <p className={styles.courseDescription}>{course.description}</p>}
                <div className={styles.courseFooter}>
                  <span className={styles.courseMeta}>
                    Автор: {course.teacher?.full_name || "Неизвестно"}
                  </span>
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

