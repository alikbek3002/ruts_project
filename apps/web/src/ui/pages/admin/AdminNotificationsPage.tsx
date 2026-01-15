import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { useI18n } from "../../i18n/I18nProvider";
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
  const { t, lang } = useI18n();
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
      setError(err.message || t("admin.notifications.loadError"));
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
      setError(err.message || t("admin.notifications.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (!window.confirm(t("admin.notifications.deleteConfirm"))) return;
    try {
      await apiDeleteNotification(token, id);
      await loadNotifications();
    } catch (err: any) {
      setError(err.message || t("admin.notifications.deleteError"));
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const pageTitleKey = user.role === "manager" ? "admin.notifications.pageTitleManager" : "admin.notifications.pageTitleAdmin";

  const getTypeIcon = (t: string) => {
    switch (t) {
      case "success": return <CheckCircle size={18} />;
      case "warning": return <AlertTriangle size={18} />;
      case "error": return <AlertCircle size={18} />;
      case "announcement": return <Megaphone size={18} />;
      default: return <Info size={18} />;
    }
  };

  const getTypeLabel = (tt: string) => {
    switch (tt) {
      case "success":
        return t("admin.notifications.type.success");
      case "warning":
        return t("admin.notifications.type.warning");
      case "error":
        return t("admin.notifications.type.error");
      case "announcement":
        return t("admin.notifications.type.announcement");
      default:
        return t("admin.notifications.type.info");
    }
  };

  const getRoleLabel = (r?: string) => {
    switch (r) {
      case "teacher":
        return t("admin.notifications.target.teacher");
      case "student":
        return t("admin.notifications.target.student");
      case "admin":
        return t("admin.notifications.target.admin");
      case "manager":
        return t("admin.notifications.target.manager");
      default:
        return t("admin.notifications.target.all");
    }
  };

  return (
    <AppShell
      titleKey={pageTitleKey}
      nav={[
        { to: base, labelKey: "nav.home" },
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
          <h2>{t("notifications.title")}</h2>
          {!showForm && (
            <button className={styles.createBtn} onClick={() => setShowForm(true)}>
              <Plus size={18} />
              {t("admin.notifications.create")}
            </button>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {showForm && (
          <form className={styles.form} onSubmit={handleCreate}>
            <div className={styles.formGroup}>
              <label className={styles.label}>{t("admin.notifications.field.title")}</label>
              <input
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder={t("admin.notifications.field.titlePlaceholder")}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>{t("admin.notifications.field.message")}</label>
              <textarea
                className={styles.textarea}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                placeholder={t("admin.notifications.field.messagePlaceholder")}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className={styles.formGroup}>
                <label className={styles.label}>{t("admin.notifications.field.type")}</label>
                <select
                  className={styles.select}
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                >
                  <option value="info">{t("admin.notifications.type.info")}</option>
                  <option value="success">{t("admin.notifications.type.success")}</option>
                  <option value="warning">{t("admin.notifications.type.warning")}</option>
                  <option value="error">{t("admin.notifications.type.error")}</option>
                  <option value="announcement">{t("admin.notifications.type.announcement")}</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>{t("admin.notifications.field.target")}</label>
                <select
                  className={styles.select}
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as any)}
                >
                  <option value="all">{t("admin.notifications.target.all")}</option>
                  <option value="student">{t("admin.notifications.target.student")}</option>
                  <option value="teacher">{t("admin.notifications.target.teacher")}</option>
                  <option value="manager">{t("admin.notifications.target.manager")}</option>
                  <option value="admin">{t("admin.notifications.target.admin")}</option>
                </select>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>{t("admin.notifications.field.expiresAt")}</label>
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
                {t("common.cancel")}
              </button>
              <button type="submit" className={styles.submitBtn} disabled={creating}>
                <Send size={16} />
                {creating ? t("admin.notifications.sending") : t("admin.notifications.send")}
              </button>
            </div>
          </form>
        )}

        {loading && <Loader text={t("admin.notifications.loading")} />}

        <div className={styles.list}>
          {!loading && notifications.map((n) => (
            <div key={n.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  {getTypeIcon(n.type)}
                  {n.title}
                  <span className={`${styles.badge} ${styles[`badge-${n.type}`]}`}>
                    {getTypeLabel(n.type)}
                  </span>
                </div>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(n.id)}
                  title={t("common.delete")}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <div className={styles.cardMeta}>
                <span>{t("admin.notifications.meta.for")}: {getRoleLabel(n.target_role || undefined)}</span>
                <span>{t("admin.notifications.meta.created")}: {new Date(n.created_at).toLocaleDateString(lang === "ky" ? "ky-KG" : "ru-RU")}</span>
                {n.expires_at && (
                  <span>{t("admin.notifications.meta.expires")}: {new Date(n.expires_at).toLocaleDateString(lang === "ky" ? "ky-KG" : "ru-RU")}</span>
                )}
              </div>

              <div className={styles.cardBody}>{n.message}</div>
            </div>
          ))}

          {!loading && notifications.length === 0 && (
            <div className={styles.empty}>
              {t("notifications.empty")}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
