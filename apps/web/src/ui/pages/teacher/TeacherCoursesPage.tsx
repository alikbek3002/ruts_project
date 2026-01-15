import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { BookOpen, Plus, Edit, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiListCourses, apiDeleteCourse, type Course } from "../../../api/client";
import styles from "./TeacherCourses.module.css";

export function TeacherCoursesPage() {
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
      // Filter only courses created by current teacher
      const myCourses = res.courses.filter((c) => c.teacher_id === user?.id);
      setCourses(myCourses);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(courseId: string) {
    if (!token) return;
    const password = window.prompt("Введите ваш пароль для подтверждения удаления:");
    if (!password) return;

    try {
      await apiDeleteCourse(token, courseId, password);
      await loadCourses();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Мои курсы"
      nav={[
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/library", labelKey: "nav.library" },
        { to: "/app/teacher/courses", labelKey: "nav.courses" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Мои курсы</h2>
          <Link to="/app/teacher/courses/new" className={styles.createButton}>
            <Plus size={20} />
            Создать курс
          </Link>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <Loader text="Загрузка курсов..." />
        ) : courses.length === 0 ? (
          <div className={styles.empty}>
            <BookOpen size={48} />
            <p>У вас пока нет курсов</p>
            <Link to="/app/teacher/courses/new" className={styles.createButton}>
              <Plus size={20} />
              Создать первый курс
            </Link>
          </div>
        ) : (
          <div className={styles.coursesGrid}>
            {courses.map((course) => (
              <div key={course.id} className={styles.courseCard}>
                <div className={styles.courseHeader}>
                  <h3>{course.title}</h3>
                  <div className={styles.courseActions}>
                    <Link to={`/app/teacher/courses/${course.id}`} className={styles.editButton} title="Редактировать">
                      <Edit size={16} />
                    </Link>
                    <button
                      onClick={() => {
                        if (window.confirm(`Удалить курс "${course.title}"?`)) {
                          handleDelete(course.id);
                        }
                      }}
                      className={styles.deleteButton}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {course.description && <p className={styles.courseDescription}>{course.description}</p>}
                <div className={styles.courseFooter}>
                  <span className={styles.courseMeta}>
                    {course.topics?.length || 0} {course.topics?.length === 1 ? "тема" : "тем"}
                  </span>
                  <Link to={`/app/teacher/courses/${course.id}`} className={styles.viewLink}>
                    Открыть →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

