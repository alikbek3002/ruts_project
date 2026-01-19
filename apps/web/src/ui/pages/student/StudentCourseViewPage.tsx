import React, { useEffect, useState } from "react";
import { Navigate, useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Clock, Play } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiGetCourse, type Course, type CourseTopic, type CourseTest } from "../../../api/client";
import styles from "./StudentCourseView.module.css";

export function StudentCourseViewPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token && courseId) loadCourse();
  }, [token, courseId]);

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

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;
  if (!courseId) return <Navigate to="/app/student/courses" replace />;

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
      title="Курс"
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
        { to: "/app/student/teachers", labelKey: "nav.teachers" },
      ]}
    >
      <div className={styles.container}>
        <Link to="/app/student/courses" className={styles.backLink}>
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
                            <button
                              onClick={() => navigate(`/app/student/courses/${courseId}/test/${test.id}`)}
                              className={styles.startButton}
                            >
                              <Play size={16} />
                              {test.test_type === "quiz" ? "Начать тест" : "Открыть"}
                            </button>
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

