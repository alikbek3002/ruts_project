import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Video, Trash2, Plus, X, ExternalLink } from "lucide-react";
import {
  apiDeleteZoomMeeting,
  apiListZoomMeetings,
  apiCreateCustomZoomMeeting,
  apiListClasses,
  type ZoomMeeting,
  type ClassItem
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
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

  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // Form State
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [audience, setAudience] = useState<"teachers" | "class">("class");
  const [selectedClassId, setSelectedClassId] = useState("");

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

  useEffect(() => {
    if (can && token) {
      reload();
      apiListClasses(token).then(r => setClasses(r.classes || [])).catch(console.error);
    }
  }, [can, token]);

  async function onDelete(meetingId: string) {
    if (!token) return;
    if (!window.confirm("Удалить конференцию?")) return;
    try {
      await apiDeleteZoomMeeting(token, meetingId);
      await reload();
    } catch (e) {
      alert(String(e));
    }
  }

  async function handleCreate() {
    if (!title || !date || !time) {
      alert("Заполните все поля");
      return;
    }
    if (audience === "class" && !selectedClassId) {
      alert("Выберите группу");
      return;
    }

    setCreateLoading(true);
    try {
      const startsAt = `${date}T${time}:00`; // Local time, backend handles timezone
      await apiCreateCustomZoomMeeting(token as string, {
        title,
        startsAt,
        targetAudience: audience,
        classId: audience === "class" ? selectedClassId : undefined
      });
      setIsModalOpen(false);
      setTitle("");
      setDate("");
      setTime("");
      setSelectedClassId("");
      await reload();
    } catch (e: any) {
      alert(e.message || "Ошибка создания");
    } finally {
      setCreateLoading(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title={user.role === "manager" ? "Менеджер → Конференции" : "Админ → Конференции"}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2>Конференции (Zoom)</h2>
            <button className={styles.createBtn} onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Создать
            </button>
          </div>
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
              const subject = m.title || m.timetable_entries?.subject || "Занятие";
              const className = m.timetable_entries?.classes?.name || (m.target_audience === 'teachers' ? 'Все учителя' : '—');
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

      {isModalOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>Создать конференцию</h3>
              <button
                className={styles.closeBtn}
                onClick={() => setIsModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <label>Название</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Например: Общее собрание"
                className={styles.input}
              />

              <div className={styles.row}>
                <div>
                  <label>Дата</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className={styles.input}
                  />
                </div>
                <div>
                  <label>Время</label>
                  <input
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <label>Кто участвует?</label>
              <div className={styles.audienceSwitch}>
                <button
                  className={audience === "class" ? styles.active : ""}
                  onClick={() => setAudience("class")}
                >
                  Для учеников
                </button>
                <button
                  className={audience === "teachers" ? styles.active : ""}
                  onClick={() => setAudience("teachers")}
                >
                  Для учителей
                </button>
              </div>

              {audience === "class" && (
                <>
                  <label>Группа</label>
                  <select
                    value={selectedClassId}
                    onChange={e => setSelectedClassId(e.target.value)}
                    className={styles.select}
                  >
                    <option value="">— Выберите группу —</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </>
              )}

              <div className={styles.modalFooter}>
                <button
                  onClick={handleCreate}
                  disabled={createLoading}
                  className={styles.primaryBtn}
                >
                  {createLoading ? "Создание..." : "Создать конференцию"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
