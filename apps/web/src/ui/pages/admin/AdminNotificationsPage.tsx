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
        target_role: targetRole,
        expires_at: expiresAt || null,
      });

      // Reset form
      setTitle("");
      setMessage("");
      setType("info");
      setTargetRole("all");
      setExpiresAt("");
      setShowForm(false);

      // Reload notifications
      await loadNotifications();
    } catch (err: any) {
      setError(err.message || "Ошибка создания");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(notificationId: string) {
    if (!token) return;
    if (!confirm("Удалить уведомление?")) return;

    try {
      await apiDeleteNotification(token, notificationId);
      await loadNotifications();
    } catch (err: any) {
      setError(err.message || "Ошибка удаления");
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title_page = user.role === "manager" ? "Менеджер → Уведомления" : "Админ → Уведомления";

  return (
    <AppShell
      title={title_page}
      nav={[
        { to: base, label: user.role === "manager" ? "Менеджер" : "Админ" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Классы" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Уведомления</h2>
          <button className={styles.createBtn} onClick={() => setShowForm(!showForm)}>
            {showForm ? "Отмена" : "+ Создать уведомление"}
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {showForm && (
          <form className={styles.form} onSubmit={handleCreate}>
            <div className={styles.formGroup}>
              <label>Заголовок *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Например: Важное объявление"
              />
            </div>

            <div className={styles.formGroup}>
              <label>Сообщение *</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={4}
                placeholder="Текст уведомления..."
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Тип</label>
                <select value={type} onChange={(e) => setType(e.target.value as any)}>
                  <option value="info">Информация</option>
                  <option value="success">Успех</option>
                  <option value="warning">Предупреждение</option>
                  <option value="error">Ошибка</option>
                  <option value="announcement">Объявление</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Кому</label>
                <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as any)}>
                  <option value="all">Всем</option>
                  <option value="teacher">Учителям</option>
                  <option value="student">Студентам</option>
                  <option value="admin">Админам</option>
                  <option value="manager">Менеджерам</option>
                </select>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Истекает (опционально)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>

            <div className={styles.formActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowForm(false)}>
                Отмена
              </button>
              <button type="submit" className={styles.submitBtn} disabled={creating}>
                {creating ? "Создание..." : "Создать"}
              </button>
            </div>
          </form>
        )}

        {loading && <div className={styles.loading}>Загрузка...</div>}

        {!loading && notifications.length === 0 && !showForm && (
          <div className={styles.empty}>Уведомлений нет</div>
        )}

        {!loading && notifications.length > 0 && (
          <div className={styles.list}>
            {notifications.map((notif) => (
              <div key={notif.id} className={styles.notificationCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardType} data-type={notif.type}>
                    {notif.type}
                  </div>
                  <div className={styles.cardTarget}>
                    Кому: {notif.target_role || "Всем"}
                  </div>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(notif.id)}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
                <h3 className={styles.cardTitle}>{notif.title}</h3>
                <p className={styles.cardMessage}>{notif.message}</p>
                <div className={styles.cardFooter}>
                  <span>Создано: {new Date(notif.created_at).toLocaleString("ru-RU")}</span>
                  {notif.expires_at && (
                    <span>Истекает: {new Date(notif.expires_at).toLocaleString("ru-RU")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
