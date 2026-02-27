import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Video, Trash2, Plus, X, ExternalLink, Calendar, Users, Briefcase } from "lucide-react";
import {
  apiListMeetingLinks,
  apiCreateMeetingLink,
  apiDeleteMeetingLink,
  apiListClasses,
  type MeetingLink,
  type ClassItem
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import styles from "./AdminMeetings.module.css";
import { useI18n } from "../../i18n/I18nProvider";

function fmtStartsAt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AdminMeetingsPage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [links, setLinks] = useState<MeetingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // Form State
  const [meetUrl, setMeetUrl] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [audience, setAudience] = useState<"class" | "teachers" | "all">("all");
  const [selectedClassId, setSelectedClassId] = useState("");

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";

  async function reload() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // List all links (audience filtering is optional, we want to see everything admin created)
      const res = await apiListMeetingLinks(token);
      setLinks(res.links || []);
    } catch (e) {
      setError(String(e));
      setLinks([]);
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

  async function onDelete(linkId: string) {
    if (!token) return;
    if (!window.confirm("Удалить ссылку?")) return;
    try {
      await apiDeleteMeetingLink(token, linkId);
      void reload();
    } catch (e) {
      alert(String(e));
    }
  }

  async function handleCreate() {
    if (!meetUrl.trim()) {
      alert("Введите ссылку на Google Meet");
      return;
    }
    if (audience === "class" && !selectedClassId) {
      alert("Выберите группу");
      return;
    }

    setCreateLoading(true);
    try {
      let startsAt: string | undefined = undefined;
      if (date && time) {
        startsAt = `${date}T${time}:00`;
      }

      await apiCreateMeetingLink(token as string, {
        meet_url: meetUrl.trim(),
        title: title.trim() || undefined,
        starts_at: startsAt,
        audience: audience,
        class_id: audience === "class" ? selectedClassId : undefined
      });

      setIsModalOpen(false);
      setMeetUrl("");
      setTitle("");
      setDate("");
      setTime("");
      setSelectedClassId("");
      setAudience("all");
      void reload();
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
      title={user.role === "manager" ? "Менеджер → Собрания" : "Админ → Собрания"}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2>Онлайн собрания</h2>
            <button className={styles.createBtn} onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Создать
            </button>
          </div>
          <button className={styles.refreshBtn} onClick={reload} disabled={loading}>
            Обновить
          </button>
        </div>

        <div className={styles.infoBox} style={{ marginBottom: 16 }}>
          💡 Здесь создаются общие собрания (для учителей, всей школы или группы). <br />
          Для уроков используйте <strong>Расписание</strong> (там тоже можно добавить ссылку Meet).
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <Loader text="Загрузка..." />
        ) : links.length === 0 ? (
          <div className={styles.empty}>
            <Video size={44} />
            <div>Нет активных собраний</div>
          </div>
        ) : (
          <div className={styles.list}>
            {links.map((link) => {
              const audienceLabel =
                link.audience === "teachers" ? "Для учителей" :
                  link.audience === "class" ? (link.class_name ? `Группа ${link.class_name}` : "Группа") :
                    "Для всех";

              return (
                <div key={link.id} className={styles.item}>
                  <div className={styles.meta}>
                    <div className={styles.titleRow}>
                      <div className={styles.title}>
                        {link.title || link.meet_url}
                      </div>
                      {link.starts_at && (
                        <div className={styles.time}>
                          <Calendar size={14} style={{ marginRight: 4 }} />
                          {fmtStartsAt(link.starts_at)}
                        </div>
                      )}
                    </div>
                    <div className={styles.sub}>
                      <span className={styles.audienceBadge}>
                        {link.audience === "teachers" && <Briefcase size={12} />}
                        {link.audience === "class" && <Users size={12} />}
                        {(!link.audience || link.audience === "all") && <Users size={12} />}
                        {audienceLabel}
                      </span>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <a className={styles.joinBtn} href={link.meet_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      Google Meet
                    </a>
                    <button className={styles.deleteBtn} onClick={() => onDelete(link.id)} title="Удалить">
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
        <div className={styles.modalBackdrop} onClick={() => setIsModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Создать собрание</h3>
              <button
                className={styles.closeBtn}
                onClick={() => setIsModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <label>Ссылка Google Meet <span style={{ color: 'red' }}>*</span></label>
              <input
                type="text"
                value={meetUrl}
                onChange={e => setMeetUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
                className={styles.input}
              />

              <label>Название (необязательно)</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Например: Педсовет"
                className={styles.input}
              />

              <div className={styles.row}>
                <div>
                  <label>Дата (необязательно)</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className={styles.input}
                  />
                </div>
                <div>
                  <label>Время (необязательно)</label>
                  <input
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <label>Для кого?</label>
              <div className={styles.audienceSwitch}>
                <button
                  className={audience === "all" ? styles.active : ""}
                  onClick={() => setAudience("all")}
                >
                  Все
                </button>
                <button
                  className={audience === "teachers" ? styles.active : ""}
                  onClick={() => setAudience("teachers")}
                >
                  Учителя
                </button>
                <button
                  className={audience === "class" ? styles.active : ""}
                  onClick={() => setAudience("class")}
                >
                  Группа
                </button>
              </div>

              {audience === "class" && (
                <div style={{ marginTop: 12 }}>
                  <label>Выберите группу</label>
                  <select
                    value={selectedClassId}
                    onChange={e => setSelectedClassId(e.target.value)}
                    className={styles.select}
                  >
                    <option value="">— Группа —</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles.modalFooter}>
                <button
                  onClick={handleCreate}
                  disabled={createLoading}
                  className={styles.primaryBtn}
                >
                  {createLoading ? "Создание..." : "Создать"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
