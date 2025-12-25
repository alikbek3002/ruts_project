import { useEffect, useState } from "react";
import { Bell, CheckCircle, AlertTriangle, XCircle, Megaphone, Info, X } from "lucide-react";
import {
  apiGetNotifications,
  apiGetUnreadNotificationCount,
  apiMarkNotificationRead,
  type Notification,
} from "../../api/client";
import styles from "./NotificationBell.module.css";

interface Props {
  token: string;
}

export function NotificationBell({ token }: Props) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUnreadCount();
    // Poll for new notifications every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [token]);

  async function loadUnreadCount() {
    try {
      const data = await apiGetUnreadNotificationCount(token);
      setUnreadCount(data.count);
    } catch (err) {
      console.error("Failed to load unread count:", err);
    }
  }

  async function loadNotifications() {
    setLoading(true);
    try {
      const data = await apiGetNotifications(token, 6, 0);
      setNotifications(data.notifications);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    if (!isOpen) {
      await loadNotifications();
    }
    setIsOpen(!isOpen);
  }

  async function handleMarkRead(notificationId: string) {
    try {
      await apiMarkNotificationRead(token, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case "success":
        return <CheckCircle size={16} color="white" />;
      case "warning":
        return <AlertTriangle size={16} color="white" />;
      case "error":
        return <XCircle size={16} color="white" />;
      case "announcement":
        return <Megaphone size={16} color="white" />;
      default:
        return <Info size={16} color="white" />;
    }
  }

  function getTypeColor(type: string) {
    switch (type) {
      case "success":
        return "#10b981"; // emerald-500
      case "warning":
        return "#f59e0b"; // amber-500
      case "error":
        return "#ef4444"; // red-500
      case "announcement":
        return "#3b82f6"; // blue-500
      default:
        return "#6b7280"; // gray-500
    }
  }

  return (
    <div className={styles.container}>
      <button className={styles.bell} onClick={handleToggle}>
        <Bell size={24} />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>

      {isOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <div className={styles.header}>
              <h3>Уведомления</h3>
              <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {loading && <div className={styles.loading}>Загрузка...</div>}

            {!loading && notifications.length === 0 && (
              <div className={styles.empty}>Нет уведомлений</div>
            )}

            {!loading && notifications.length > 0 && (
              <div className={styles.list}>
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`${styles.item} ${notif.is_read ? styles.read : ""}`}
                    onClick={() => !notif.is_read && handleMarkRead(notif.id)}
                  >
                    <div
                      className={styles.typeIcon}
                      style={{ backgroundColor: getTypeColor(notif.type) }}
                    >
                      {getTypeIcon(notif.type)}
                    </div>
                    <div className={styles.content}>
                      <div className={styles.title}>{notif.title}</div>
                      <div className={styles.message}>{notif.message}</div>
                      <div className={styles.time}>
                        {new Date(notif.created_at).toLocaleString("ru-RU")}
                      </div>
                    </div>
                    {!notif.is_read && <div className={styles.unreadDot} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
