import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  apiAddClassesToStream,
  apiGenerateStreamSchedule,
  apiGetCurriculumTemplates,
  apiGetStream,
  apiListClasses,
  apiRemoveClassFromStream,
  type ClassItem,
  type CurriculumTemplate,
  type StreamDetail,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "./AdminStreamDetail.module.css";
import { Layers, RefreshCw, Trash2, Wand2 } from "lucide-react";

export function AdminStreamDetailPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const params = useParams();
  const streamId = params.streamId || "";

  const [stream, setStream] = useState<StreamDetail | null>(null);
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [templates, setTemplates] = useState<CurriculumTemplate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [addClassIds, setAddClassIds] = useState<string[]>([]);

  const [templateId, setTemplateId] = useState<string>("");
  const [force, setForce] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user?.role === "manager" ? "Менеджер → Поток" : "Админ → Поток";

  async function reload() {
    if (!token || !streamId) return;
    setLoading(true);
    setErr(null);
    setGenResult(null);
    try {
      const [s, c, t] = await Promise.all([
        apiGetStream(token, streamId),
        apiListClasses(token),
        apiGetCurriculumTemplates(token),
      ]);
      setStream(s.stream);
      setAllClasses(c.classes || []);
      setTemplates(t.templates || []);
      const defaultTemplate = (t.templates || []).find((x) => x.is_default);
      setTemplateId(defaultTemplate?.id || (t.templates?.[0]?.id ?? ""));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!can) return;
    reload();
  }, [can, streamId]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const streamClassIds = useMemo(() => new Set((stream?.classes || []).map((c) => c.id)), [stream]);
  const availableToAdd = useMemo(() => allClasses.filter((c) => !streamClassIds.has(c.id)), [allClasses, streamClassIds]);

  async function handleAddClasses() {
    if (!token || !streamId) return;
    if (addClassIds.length === 0) return;
    setErr(null);
    try {
      await apiAddClassesToStream(token, streamId, addClassIds);
      setAddClassIds([]);
      await reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleRemoveClass(classId: string) {
    if (!token || !streamId) return;
    const ok = window.confirm("Убрать группу из потока?");
    if (!ok) return;
    setErr(null);
    try {
      await apiRemoveClassFromStream(token, streamId, classId);
      await reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleGenerate() {
    if (!token || !streamId) return;
    if (!templateId) {
      setErr("Выберите учебный шаблон");
      return;
    }
    setErr(null);
    setGenResult(null);
    try {
      const res = await apiGenerateStreamSchedule(token, streamId, templateId, force);
      const warnings = (res.warnings || []).length ? `\n\nПредупреждения:\n- ${(res.warnings || []).join("\n- ")}` : "";
      
      let message = `Готово: создано записей расписания: ${res.entries_created}, записей журнала: ${res.journal_entries_created}.`;
      
      // Если не создано ни одной записи расписания, показать подсказку
      if (res.entries_created === 0 && res.journal_entries_created > 0) {
        message += `\n\n💡 Расписание уже существует. Если хотите пересоздать, включите "Перегенерировать (force)".`;
      }
      
      setGenResult(message + warnings);
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
            <Layers size={18} /> {stream?.name || "Поток"}
          </h2>
          <button onClick={reload} disabled={loading} className={styles.btn}>
            <RefreshCw size={16} /> Обновить
          </button>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {genResult && <div className={styles.ok}>{genResult}</div>}

        {stream && (
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Параметры</div>
              <div className={styles.meta}>Период: {stream.start_date} → {stream.end_date}</div>
              <div className={styles.meta}>Статус: {stream.status}</div>
              <div className={styles.meta}>Групп в потоке: {stream.classes.length}</div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Добавить группы</div>
              <div className={styles.row}>
                <select
                  multiple
                  value={addClassIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                    setAddClassIds(selected);
                  }}
                  className={styles.multi}
                >
                  {availableToAdd.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className={styles.btnPrimary} onClick={handleAddClasses}>
                  Добавить
                </button>
              </div>
              <div className={styles.hint}>Выделяйте несколько групп с помощью Cmd (macOS) / Ctrl (Windows).</div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Группы в потоке</div>
              {stream.classes.length === 0 ? (
                <div className={styles.hint}>Пока групп нет</div>
              ) : (
                <div className={styles.classList}>
                  {stream.classes.map((c) => (
                    <div key={c.id} className={styles.classRow}>
                      <div>
                        <div className={styles.className}>{c.name}</div>
                        <div className={styles.hint}>Учеников: {c.student_count}</div>
                      </div>
                      <button className={styles.btnDanger} onClick={() => handleRemoveClass(c.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Генерация расписания</div>
              <div className={styles.row}>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={styles.select}>
                  <option value="">— Выберите шаблон —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.is_default ? " (по умолчанию)" : ""}
                    </option>
                  ))}
                </select>
                <button className={styles.btnPrimary} onClick={handleGenerate}>
                  <Wand2 size={16} /> Сгенерировать
                </button>
              </div>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>Перегенерировать (force)</span>
              </label>
              <div className={styles.hint}>
                {force 
                  ? "⚠️ Старое расписание будет удалено и создано заново. Журнал будет обновлен."
                  : "Генерация создаст расписание (если его нет) и автозаполнит журнал на даты потока."
                }
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
