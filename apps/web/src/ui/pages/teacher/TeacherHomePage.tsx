import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { 
  BookOpen, 
  Calendar, 
  Users, 
  Library, 
  Clock, 
  MapPin,
  ArrowRight
} from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { ZoomMeetingsWidget } from "../../components/ZoomMeetingsWidget";
import { trackedFetch } from "../../../api/client";
import { Loader } from "../../components/Loader";
import styles from "./TeacherHome.module.css";

type Lesson = {
  timetable_entry_id: string;
  date: string;
  start_time: string;
  end_time: string;
  subject: string;
  subject_name: string;
  class_id: string;
  class_name: string;
  room?: string;
};

export function TeacherHomePage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [todayLessons, setTodayLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    loadTodayLessons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadTodayLessons() {
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await trackedFetch(`/api/journal/teacher/lessons/${today}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Sort by start time
        const sorted = (data.lessons || []).sort((a: Lesson, b: Lesson) => 
          a.start_time.localeCompare(b.start_time)
        );
        setTodayLessons(sorted);
      }
    } catch (e) {
      console.error("Failed to load lessons", e);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  const today = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Capitalize first letter of date
  const formattedDate = today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <AppShell
      title="Панель преподавателя"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ]}
    >
      <div className={styles.container}>
        {/* Welcome Section */}
        <div className={styles.welcomeSection}>
          <div className={styles.welcomeContent}>
            <h1 className={styles.welcomeTitle}>
              Добро пожаловать, {user.name || user.username}!
            </h1>
            <p className={styles.welcomeSubtitle}>
              Сегодня {formattedDate}
            </p>
          </div>
        </div>

        <div className={styles.grid}>
          {/* Left Column: Schedule */}
          <div>
            <h2 className={styles.sectionTitle}>
              <Calendar size={20} />
              Расписание на сегодня
            </h2>
            
            <div className={styles.scheduleCard}>
              {loading ? (
                <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
                  <Loader />
                </div>
              ) : todayLessons.length > 0 ? (
                <div>
                  {todayLessons.map((lesson) => (
                    <div key={lesson.timetable_entry_id} className={styles.lessonItem}>
                      <div className={styles.lessonTime}>
                        {lesson.start_time.slice(0, 5)} - {lesson.end_time.slice(0, 5)}
                      </div>
                      <div className={styles.lessonInfo}>
                        <div className={styles.lessonSubject}>
                          {lesson.subject_name}
                        </div>
                        <div className={styles.lessonMeta}>
                          <span>
                            <Users size={14} />
                            {lesson.class_name}
                          </span>
                          {lesson.room && (
                            <span>
                              <MapPin size={14} />
                              Каб. {lesson.room}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link 
                        to={`/app/teacher/journal`} 
                        className="btn-icon"
                        title="Перейти к журналу"
                      >
                        <ArrowRight size={18} color="#9ca3af" />
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptySchedule}>
                  <Calendar size={48} strokeWidth={1} />
                  <p>На сегодня занятий нет</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Quick Links & Widgets */}
          <div>
            <h2 className={styles.sectionTitle}>
              <Clock size={20} />
              Быстрый доступ
            </h2>
            
            <div className={styles.quickLinksGrid}>
              <Link to="/app/teacher/journal" className={styles.quickLinkCard}>
                <div className={`${styles.iconBox} ${styles.blue}`}>
                  <BookOpen size={24} />
                </div>
                <span className={styles.linkTitle}>Журнал</span>
              </Link>
              
              <Link to="/app/teacher/timetable" className={styles.quickLinkCard}>
                <div className={`${styles.iconBox} ${styles.green}`}>
                  <Calendar size={24} />
                </div>
                <span className={styles.linkTitle}>Расписание</span>
              </Link>
              
              <Link to="/app/teacher/vzvody" className={styles.quickLinkCard}>
                <div className={`${styles.iconBox} ${styles.purple}`}>
                  <Users size={24} />
                </div>
                <span className={styles.linkTitle}>Мои взводы</span>
              </Link>
              
              <Link to="/app/teacher/library" className={styles.quickLinkCard}>
                <div className={`${styles.iconBox} ${styles.orange}`}>
                  <Library size={24} />
                </div>
                <span className={styles.linkTitle}>Библиотека</span>
              </Link>
            </div>

            <h2 className={styles.sectionTitle} style={{ marginTop: 32 }}>
              Zoom
            </h2>
            <div className={styles.zoomWrapper}>
              {token && <ZoomMeetingsWidget token={token} userRole={user.role} />}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
