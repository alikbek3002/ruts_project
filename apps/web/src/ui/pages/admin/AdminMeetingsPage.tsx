import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Video, ExternalLink, Trash2 } from "lucide-react";
import { apiDeleteZoomMeeting, apiListZoomMeetings, type ZoomMeeting } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminMeetings.module.css";

function fmtStartsAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AdminMeetingsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [meetings, setMeetings] = useState<ZoomMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";

  async function reload() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiListZoomMeetings(token);
      setMeetings(res.meetings || []);
    } catch (e) {
      setError(String(e));
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(meetingId: string) {
    if (!token) return;
    if (!window.confirm("Удалить конференцию?") ) return;
    try {
      await apiDeleteZoomMeeting(token, meetingId);
      await reload();
    } catch (e) {
      alert(String(e));
    }
  }

  useEffect(() => {
    if (can) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title={user.role === "manager" ? "Менеджер → Конференции" : "Админ → Конференции"}
      nav={[
        { to: base, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/courses`, labelKey: "nav.courses" },
        { to: `${base}/meetings`, labelKey: "nav.meetings" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Конференции (Zoom)</h2>
          <button className={styles.refreshBtn} onClick={reload} disabled={loading}>
            Обновить
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <Loader text="Загрузка конференций..." />
        ) : meetings.length === 0 ? (
          <div className={styles.empty}>
            <Video size={44} />
            <div>Пока нет конференций</div>
          </div>
        ) : (
          <div className={styles.list}>
            {meetings.map((m) => {
              const subject = m.timetable_entries?.subject || "Занятие";
              const className = m.timetable_entries?.classes?.name;
              const time = fmtStartsAt(m.starts_at);
              return (
                <div key={m.id} className={styles.item}>
                  <div className={styles.meta}>
                    <div className={styles.titleRow}>
                      <div className={styles.title}>
                        {className ? `${className} — ` : ""}{subject}
                      </div>
                      <div className={styles.time}>{time}</div>
                    </div>
                    <div className={styles.sub}>
                      {m.timetable_entries?.start_time ? `${String(m.timetable_entries.start_time).slice(0, 5)}–${String(m.timetable_entries.end_time).slice(0, 5)}` : ""}
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <a className={styles.joinBtn} href={m.join_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      Подключиться
                    </a>
                    <button className={styles.deleteBtn} onClick={() => onDelete(m.id)} title="Удалить">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
