import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Clock, Download, Search, TrendingUp, Users } from "lucide-react";
import { apiGetAllTeachersWorkload, apiDownloadTeachersWorkload } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminWorkload.module.css";

type TeacherWorkloadSummary = {
  teacher_id: string;
  teacher_name: string;
  weekly_hours: number;
  weekly_lessons: number;
  monthly_hours: number;
  three_month_hours: number;
};

export function AdminWorkloadPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [teachers, setTeachers] = useState<TeacherWorkloadSummary[]>([]);
  const [filteredTeachers, setFilteredTeachers] = useState<TeacherWorkloadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!token) return;
    loadWorkload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTeachers(teachers);
      return;
    }
    const query = searchQuery.toLowerCase();
    setFilteredTeachers(
      teachers.filter((t) => t.teacher_name.toLowerCase().includes(query))
    );
  }, [searchQuery, teachers]);

  async function loadWorkload() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetAllTeachersWorkload(token);
      setTeachers(data.teachers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadWorkload() {
    if (!token) return;
    
    apiDownloadTeachersWorkload(token)
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "teachers_workload.xlsx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      })
      .catch(err => {
        console.error("Failed to download:", err);
        setError("Не удалось скачать файл");
      });
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const totalWeeklyHours = teachers.reduce((sum, t) => sum + t.weekly_hours, 0);
  const totalMonthlyHours = teachers.reduce((sum, t) => sum + t.monthly_hours, 0);
  const totalThreeMonthHours = teachers.reduce((sum, t) => sum + t.three_month_hours, 0);

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";

  return (
    <AppShell
      title={user.role === "manager" ? "Менеджер → Часы работы" : "Админ → Часы работы"}
      nav={[
        { to: `${base}`, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/directions`, labelKey: "nav.directions" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
        { to: `${base}/workload`, labelKey: "nav.workload" },
        { to: `${base}/notifications`, labelKey: "nav.notifications" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Clock size={28} />
              Часы работы учителей
            </h1>
            <p className={styles.subtitle}>
              Статистика педагогической нагрузки по расписанию
            </p>
          </div>
          <button className={styles.downloadButton} onClick={handleDownloadWorkload}>
            <Download size={18} />
            Скачать отчет по нагрузке
          </button>
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

        {!loading && !error && (
          <>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <div className={styles.summaryIcon} style={{ background: "#e3f2fd" }}>
                  <Users size={24} color="#1976d2" />
                </div>
                <div className={styles.summaryContent}>
                  <div className={styles.summaryLabel}>Всего учителей</div>
                  <div className={styles.summaryValue}>{teachers.length}</div>
                </div>
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryIcon} style={{ background: "#f3e5f5" }}>
                  <Clock size={24} color="#7b1fa2" />
                </div>
                <div className={styles.summaryContent}>
                  <div className={styles.summaryLabel}>Всего часов в неделю</div>
                  <div className={styles.summaryValue}>{totalWeeklyHours.toFixed(1)} ч</div>
                </div>
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryIcon} style={{ background: "#fff3e0" }}>
                  <TrendingUp size={24} color="#f57c00" />
                </div>
                <div className={styles.summaryContent}>
                  <div className={styles.summaryLabel}>Всего часов за месяц</div>
                  <div className={styles.summaryValue}>{totalMonthlyHours.toFixed(1)} ч</div>
                </div>
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryIcon} style={{ background: "#e8f5e9" }}>
                  <TrendingUp size={24} color="#388e3c" />
                </div>
                <div className={styles.summaryContent}>
                  <div className={styles.summaryLabel}>Всего часов за 3 месяца</div>
                  <div className={styles.summaryValue}>{totalThreeMonthHours.toFixed(1)} ч</div>
                </div>
              </div>
            </div>

            <div className={styles.tableSection}>
              <div className={styles.tableHeader}>
                <h2 className={styles.tableTitle}>Список учителей</h2>
                <div className={styles.searchBox}>
                  <Search size={18} />
                  <input
                    type="text"
                    placeholder="Поиск учителя..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={styles.searchInput}
                  />
                </div>
              </div>

              {filteredTeachers.length === 0 ? (
                <div className={styles.emptyState}>
                  <Users size={48} color="#ccc" />
                  <p>{searchQuery ? "Учителей не найдено" : "Нет данных об учителях"}</p>
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>ФИО учителя</th>
                        <th>Часов за месяц</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTeachers.map((teacher) => (
                        <tr key={teacher.teacher_id}>
                          <td className={styles.nameCell}>{teacher.teacher_name}</td>
                          <td className={styles.numberCell}>{teacher.monthly_hours.toFixed(1)} ч</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
