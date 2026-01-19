import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, FileText, Clock } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiGetCourse, type Course } from "../../../api/client";
import styles from "../student/StudentCourseView.module.css";

export function AdminCourseViewPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const { courseId } = useParams<{ courseId: string }>();
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";

  async function loadCourse() {
    if (!token || !courseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetCourse(token, courseId);
      setCourse(res.course);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (can && courseId) loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, courseId]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;
  if (!courseId) return <Navigate to={`${base}/courses`} replace />;

  if (loading) {
    return (
      <AppShell title="Курс" nav={[]}>
        <Loader text="Загрузка курса..." />
      </AppShell>
    );
  }

  if (!course) {
    return (
      <AppShell title="Курс" nav={[]}>
        <div className={styles.error}>Курс не найден</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={user.role === "manager" ? "Менеджер → Курс" : "Админ → Курс"}
      nav={[
        { to: base, labelKey: "nav.home" },
                { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/meetings`, labelKey: "nav.meetings" },
      ]}
    >
      <div className={styles.container}>
        <Link to={`${base}/courses`} className={styles.backLink}>
          <ArrowLeft size={20} />
          Назад к курсам
        </Link>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.courseHeader}>
          <h1>{course.title}</h1>
          {course.description && <p className={styles.description}>{course.description}</p>}
          <div className={styles.courseMeta}>
            <span>Автор: {course.teacher?.full_name || "Неизвестно"}</span>
          </div>
        </div>

        <div className={styles.topicsSection}>
          <h2>Темы курса</h2>

          {course.topics && course.topics.length > 0 ? (
            <div className={styles.topicsList}>
              {course.topics.map((topic) => (
                <div key={topic.id} className={styles.topicCard}>
                  <h3>{topic.title}</h3>
                  {topic.description && <p className={styles.topicDescription}>{topic.description}</p>}

                  {topic.presentation_storage_path && (
                    <div className={styles.presentationSection}>
                      <FileText size={16} />
                      <span>Презентация: {topic.presentation_original_filename || "Файл"}</span>
                    </div>
                  )}

                  {topic.tests && topic.tests.length > 0 && (
                    <div className={styles.testsSection}>
                      <h4>Тесты</h4>
                      <div className={styles.testsList}>
                        {topic.tests.map((test) => (
                          <div key={test.id} className={styles.testCard}>
                            <div className={styles.testInfo}>
                              <h5>
                                {test.title}
                                {test.test_type === "quiz" && (
                                  <span className={styles.testBadge}>
                                    <Clock size={12} />
                                    {test.time_limit_minutes} мин
                                  </span>
                                )}
                                {test.test_type === "document" && (
                                  <span className={styles.testBadge}>
                                    <FileText size={12} />
                                    Документ
                                  </span>
                                )}
                              </h5>
                              {test.description && <p className={styles.testDescription}>{test.description}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyText}>Пока нет тем</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
