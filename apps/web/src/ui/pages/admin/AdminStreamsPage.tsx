import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  apiCreateStream,
  apiGetStream,
  apiGetStreams,
  apiListClasses,
  type ClassItem,
  type Stream,
  type StreamDetail,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "./AdminStreams.module.css";
import { Plus, RefreshCw, Layers } from "lucide-react";

export function AdminStreamsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamDetails, setStreamDetails] = useState<Map<string, StreamDetail>>(new Map());
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStart, setCreateStart] = useState("");
  const [createEnd, setCreateEnd] = useState("");

  async function reload() {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [resp, clsResp] = await Promise.all([apiGetStreams(token), apiListClasses(token)]);
      const nextStreams = resp.streams || [];
      setStreams(nextStreams);
      setClasses(clsResp.classes || []);

      const details = await Promise.all(
        nextStreams.map(async (s) => {
          const d = await apiGetStream(token, s.id);
          return d.stream;
        })
      );
      const map = new Map<string, StreamDetail>();
      for (const d of details) map.set(d.id, d);
      setStreamDetails(map);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!can) return;
    reload();
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Потоки" : "Админ → Потоки";

  const assignedClassIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of streamDetails.values()) {
      for (const c of d.classes || []) ids.add(c.id);
    }
    return ids;
  }, [streamDetails]);

  const unassignedClasses = useMemo(
    () => (classes || []).filter((c) => !assignedClassIds.has(c.id)),
    [classes, assignedClassIds]
  );

  function openCreate() {
    setErr(null);
    setCreateName("");
    setCreateStart("");
    setCreateEnd("");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!token) return;
    if (!createName.trim()) {
      setErr("Введите название потока");
      return;
    }
    if (!createStart || !createEnd) {
      setErr("Укажите даты начала и окончания");
      return;
    }
    setErr(null);
    try {
      await apiCreateStream(token, {
        name: createName.trim(),
        start_date: createStart,
        end_date: createEnd,
      });
      setCreateOpen(false);
      await reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <AppShell
      title={title}
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
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={18} /> Потоки
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={reload} disabled={loading} className={styles.btn}>
              <RefreshCw size={16} /> Обновить
            </button>
            <button onClick={openCreate} className={styles.btnPrimary}>
              <Plus size={16} /> Создать поток
            </button>
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.list}>
          {streams.length === 0 ? (
            <div className={styles.empty}>Потоков пока нет</div>
          ) : (
            streams.map((s) => {
              const detail = streamDetails.get(s.id);
              const classNames = (detail?.classes || []).map((c) => c.name);
              return (
                <Link key={s.id} to={`${base}/streams/${s.id}`} className={styles.card}>
                  <div className={styles.cardTitle}>{s.name}</div>
                  <div className={styles.cardMeta}>
                    {s.start_date} → {s.end_date} • {s.status} • групп: {s.class_count} • учеников: {s.student_count}
                  </div>
                  <div className={styles.cardSubTitle}>Взводы в потоке</div>
                  {classNames.length === 0 ? (
                    <div className={styles.cardMeta}>—</div>
                  ) : (
                    <div className={styles.classChips}>
                      {classNames.map((n) => (
                        <span key={n} className={styles.chip}>
                          {n}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Группы без потока</div>
          {unassignedClasses.length === 0 ? (
            <div className={styles.empty}>Все группы распределены по потокам</div>
          ) : (
            <div className={styles.classChips}>
              {unassignedClasses.map((c) => (
                <span key={c.id} className={styles.chip}>
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {createOpen && (
          <div className={styles.modalBackdrop} onClick={() => setCreateOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalTitle}>Создать поток</div>
              <div className={styles.formRow}>
                <label>Название</label>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>Дата начала</label>
                <input type="date" value={createStart} onChange={(e) => setCreateStart(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>Дата окончания</label>
                <input type="date" value={createEnd} onChange={(e) => setCreateEnd(e.target.value)} />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.btn} onClick={() => setCreateOpen(false)}>
                  Отмена
                </button>
                <button className={styles.btnPrimary} onClick={handleCreate}>
                  Создать
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
