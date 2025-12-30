import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import {
  apiGetNotifications,
  apiCreateNotification,
  apiDeleteNotification,
  type Notification,
} from "../../../api/client";
import styles from "./AdminNotificationsPage.module.css";
import { Loader } from "../../components/Loader";
import { Bell, Plus, Trash2, Send, X, Info, AlertTriangle, CheckCircle, AlertCircle, Megaphone } from "lucide-react";

export function AdminNotificationsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"info" | "success" | "warning" | "error" | "announcement">("info");
  const [targetRole, setTargetRole] = useState<"all" | "teacher" | "student" | "admin" | "manager">("all");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (token) {
      loadNotifications();
    }
  }, [token]);

  async function loadNotifications() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetNotifications(token);
      setNotifications(data.notifications);
    } catch (err: any) {
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setError(null);
    try {
      await apiCreateNotification(token, {
        title,
        message,
        type,
        target_role: targetRole === "all" ? undefined : targetRole,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setShowForm(false);
      setTitle("");
      setMessage("");
      setType("info");
      setTargetRole("all");
      setExpiresAt("");
      await loadNotifications();
    } catch (err: any) {
      setError(err.message || "Ошибка создания");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (!window.confirm("Удалить уведомление?")) return;
    try {
      await apiDeleteNotification(token, id);
      await loadNotifications();
    } catch (err: any) {
      setError(err.message || "Ошибка удаления");
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const pageTitle = user.role === "manager" ? "Менеджер → Уведомления" : "Админ → Уведомления";

  const getTypeIcon = (t: string) => {
    switch (t) {
      case "success": return <CheckCircle size={18} />;
      case "warning": return <AlertTriangle size={18} />;
      case "error": return <AlertCircle size={18} />;
      case "announcement": return <Megaphone size={18} />;
      default: return <Info size={18} />;
    }
  };

  const getRoleLabel = (r?: string) => {
    switch (r) {
      case "teacher": return "Учителя";
      case "student": return "Студенты";
      case "admin": return "Админы";
      case "manager": return "Менеджеры";
      default: return "Все пользователи";
    }
  };

  return (
    <AppShell
      title={pageTitle}
      nav={[
        { to: base, label: "Главная" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/streams`, label: "Потоки" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/workload`, label: "Часы работы" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Уведомления</h2>
          {!showForm && (
            <button className={styles.createBtn} onClick={() => setShowForm(true)}>
              <Plus size={18} />
              Создать
            </button>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {showForm && (
          <form className={styles.form} onSubmit={handleCreate}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Заголовок</label>
              <input
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Важное объявление"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Сообщение</label>
              <textarea
                className={styles.textarea}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                placeholder="Текст уведомления..."
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Тип</label>
                <select
                  className={styles.select}
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                >
                  <option value="info">Информация</option>
                  <option value="success">Успех</option>
                  <option value="warning">Предупреждение</option>
                  <option value="error">Ошибка</option>
                  <option value="announcement">Объявление</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Для кого</label>
                <select
                  className={styles.select}
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as any)}
                >
                  <option value="all">Все</option>
                  <option value="student">Студенты</option>
                  <option value="teacher">Учителя</option>
                  <option value="manager">Менеджеры</option>
                  <option value="admin">Админы</option>
                </select>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Истекает (необязательно)</label>
              <input
                type="datetime-local"
                className={styles.input}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>

            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setShowForm(false)}
                disabled={creating}
              >
                Отмена
              </button>
              <button type="submit" className={styles.submitBtn} disabled={creating}>
                <Send size={16} />
                {creating ? "Отправка..." : "Отправить"}
              </button>
            </div>
          </form>
        )}

        {loading && <Loader text="Загрузка уведомлений..." />}

        <div className={styles.list}>
          {!loading && notifications.map((n) => (
            <div key={n.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  {getTypeIcon(n.type)}
                  {n.title}
                  <span className={`${styles.badge} ${styles[`badge-${n.type}`]}`}>
                    {n.type}
                  </span>
                </div>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(n.id)}
                  title="Удалить"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <div className={styles.cardMeta}>
                <span>Для: {getRoleLabel(n.target_role || undefined)}</span>
                <span>Создано: {new Date(n.created_at).toLocaleDateString()}</span>
                {n.expires_at && (
                  <span>Истекает: {new Date(n.expires_at).toLocaleDateString()}</span>
                )}
              </div>

              <div className={styles.cardBody}>{n.message}</div>
            </div>
          ))}

          {!loading && notifications.length === 0 && (
            <div className={styles.empty}>
              Нет активных уведомлений
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
