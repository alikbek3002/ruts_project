import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Clock, Calendar, TrendingUp, Layers } from "lucide-react";
import { apiGetTeacherWorkload, type TeacherWorkload } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./TeacherWorkload.module.css";

export function TeacherWorkloadPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [workload, setWorkload] = useState<TeacherWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user?.id) return;
    loadWorkload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  async function loadWorkload() {
    if (!token || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetTeacherWorkload(token, user.id);
      setWorkload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учитель → Часы работы"
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
          <h1 className={styles.title}>
            <Clock size={28} />
            Мои часы работы
          </h1>
          <p className={styles.subtitle}>
            Статистика вашей педагогической нагрузки по расписанию
          </p>
        </div>

        {loading && (
          <div className={styles.loaderWrapper}>
            <Loader />
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <p>{error}</p>
            <button className={styles.retryButton} onClick={loadWorkload}>
              Повторить попытку
            </button>
          </div>
        )}

        {!loading && !error && workload && (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statIcon} style={{ background: "#e3f2fd" }}>
                  <Clock size={24} color="#1976d2" />
                </div>
                <div className={styles.statContent}>
                  <div className={styles.statLabel}>Часов в неделю</div>
                  <div className={styles.statValue}>{workload.weekly_hours} ч</div>
                  <div className={styles.statSubtext}>{workload.weekly_lessons} занятий</div>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statIcon} style={{ background: "#f3e5f5" }}>
                  <Calendar size={24} color="#7b1fa2" />
                </div>
                <div className={styles.statContent}>
                  <div className={styles.statLabel}>Текущий месяц</div>
                  <div className={styles.statValue}>{workload.current_month_hours} ч</div>
                  <div className={styles.statSubtext}>{workload.current_month_lessons} занятий</div>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statIcon} style={{ background: "#e8f5e9" }}>
                  <TrendingUp size={24} color="#388e3c" />
                </div>
                <div className={styles.statContent}>
                  <div className={styles.statLabel}>За 3 месяца</div>
                  <div className={styles.statValue}>{workload.three_month_hours} ч</div>
                  <div className={styles.statSubtext}>{workload.three_month_lessons} занятий</div>
                </div>
              </div>
            </div>

            {workload.active_streams && workload.active_streams.length > 0 && (
              <div className={styles.streamsSection}>
                <h2 className={styles.sectionTitle}>
                  <Layers size={20} />
                  Разбивка по потокам
                </h2>
                <div className={styles.streamsGrid}>
                  {workload.active_streams.map((stream) => (
                    <div key={stream.stream_id} className={styles.streamCard}>
                      <div className={styles.streamHeader}>
                        <h3 className={styles.streamName}>{stream.stream_name}</h3>
                        <span className={`${styles.streamStatus} ${styles[stream.status] || ""}`}>
                          {stream.status === "active" ? "Активный" : stream.status === "upcoming" ? "Предстоящий" : "Завершён"}
                        </span>
                      </div>
                      <div className={styles.streamDates}>
                        {new Date(stream.start_date).toLocaleDateString("ru-RU")} — {new Date(stream.end_date).toLocaleDateString("ru-RU")}
                      </div>
                      <div className={styles.streamStats}>
                        <div className={styles.streamStat}>
                          <div className={styles.streamStatLabel}>В неделю</div>
                          <div className={styles.streamStatValue}>{stream.weekly_hours} ч</div>
                          <div className={styles.streamStatSubtext}>{stream.weekly_lessons} занятий</div>
                        </div>
                        <div className={styles.streamStat}>
                          <div className={styles.streamStatLabel}>За 3 месяца</div>
                          <div className={styles.streamStatValue}>{stream.total_hours_3months} ч</div>
                          <div className={styles.streamStatSubtext}>{stream.total_lessons_3months} занятий</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!workload.active_streams || workload.active_streams.length === 0) && (
              <div className={styles.emptyState}>
                <Layers size={48} color="#ccc" />
                <p>У вас пока нет активных потоков</p>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
