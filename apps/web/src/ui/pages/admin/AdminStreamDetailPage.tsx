import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  apiAddClassesToStream,
  apiGenerateStreamSchedule,
  apiGetCurriculumTemplates,
  apiGetStream,
  apiListClasses,
  apiRemoveClassFromStream,
  apiDeleteStream,
  apiArchiveStream,
  type ClassItem,
  type CurriculumTemplate,
  type StreamDetail,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminStreamDetail.module.css";
import { Layers, RefreshCw, Trash2, Wand2, Archive, XCircle } from "lucide-react";

export function AdminStreamDetailPage() {
  const { state } = useAuth();
  const { t } = useI18n();
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
  const titleKey = user?.role === "manager" ? "admin.streamDetail.pageTitleManager" : "admin.streamDetail.pageTitleAdmin";

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
      void reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleRemoveClass(classId: string) {
    if (!token || !streamId) return;
    const ok = window.confirm(t("admin.streamDetail.removeClassConfirm"));
    if (!ok) return;
    setErr(null);
    try {
      await apiRemoveClassFromStream(token, streamId, classId);
      void reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleArchive() {
    if (!token || !streamId || !stream) return;
    const ok = window.confirm(`Вы уверены, что хотите архивировать поток "${stream.name}"?\n\nПосле архивирования поток будет перемещен в архив, но все данные сохранятся.`);
    if (!ok) return;
    setErr(null);
    try {
      await apiArchiveStream(token, streamId);
      alert("Поток успешно архивирован!");
      window.location.href = base + "/streams";
    } catch (e) {
      setErr("Ошибка архивирования: " + String(e));
    }
  }

  async function handleDelete() {
    if (!token || !streamId || !stream) return;
    const ok = window.confirm(`Вы уверены, что хотите УДАЛИТЬ поток "${stream.name}"?\n\nЭто действие нельзя отменить! Все связи с группами будут удалены.`);
    if (!ok) return;
    const confirmAgain = window.confirm("ВНИМАНИЕ: Удаление потока безвозвратно. Продолжить?");
    if (!confirmAgain) return;
    setErr(null);
    try {
      await apiDeleteStream(token, streamId);
      alert("Поток успешно удален!");
      window.location.href = base + "/streams";
    } catch (e) {
      setErr("Ошибка удаления: " + String(e));
    }
  }

  async function handleGenerate() {
    if (!token || !streamId) return;
    if (!templateId) {
      setErr(t("admin.streamDetail.gen.templateRequired"));
      return;
    }
    setErr(null);
    setGenResult(null);
    try {
      const res = await apiGenerateStreamSchedule(token, streamId, templateId, force);
      const warningsText =
        (res.warnings || []).length
          ? `\n\n${t("admin.streamDetail.gen.warningsTitle")}\n- ${(res.warnings || []).join("\n- ")}`
          : "";

      let message = t("admin.streamDetail.gen.done", {
        entries: res.entries_created,
        journals: res.journal_entries_created,
      });

      if (res.entries_created === 0 && res.journal_entries_created > 0) {
        message += `\n\n${t("admin.streamDetail.gen.tipExisting", { forceLabel: t("admin.streamDetail.gen.forceLabel") })}`;
      }

      setGenResult(message + warningsText);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <AppShell
      titleKey={titleKey}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={18} /> {stream?.name || t("admin.streamDetail.fallbackName")}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={reload} disabled={loading} className={styles.btn}>
              <RefreshCw size={16} /> {t("common.refresh")}
            </button>
            {stream && stream.status !== "archived" && (user?.role === "admin" || user?.role === "manager") && (
              <button onClick={handleArchive} className={styles.btn} style={{ color: "#f59e0b" }}>
                <Archive size={16} /> Архивировать
              </button>
            )}
            {stream && stream.status !== "archived" && (user?.role === "admin" || user?.role === "manager") && (
              <button onClick={handleDelete} className={styles.btn} style={{ color: "#ef4444" }}>
                <XCircle size={16} /> Удалить
              </button>
            )}
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {genResult && <div className={styles.ok}>{genResult}</div>}

        {stream && (
          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>{t("admin.streamDetail.params")}</div>
              <div className={styles.meta}>{t("admin.streamDetail.period")}: {stream.start_date} — {stream.end_date}</div>
              <div className={styles.meta}>{t("admin.streamDetail.status")}: {stream.status}</div>
              <div className={styles.meta}>{t("admin.streamDetail.classCount")}: {stream.classes.length}</div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>{t("admin.streamDetail.addClasses")}</div>
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
                  {t("admin.streamDetail.add")}
                </button>
              </div>
              <div className={styles.hint}>{t("admin.streamDetail.multiHint")}</div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>{t("admin.streamDetail.classesInStream")}</div>
              {stream.classes.length === 0 ? (
                <div className={styles.hint}>{t("admin.streamDetail.noClasses")}</div>
              ) : (
                <div className={styles.classList}>
                  {stream.classes.map((c) => (
                    <div key={c.id} className={styles.classRow}>
                      <div>
                        <div className={styles.className}>{c.name}</div>
                        <div className={styles.hint}>{t("admin.streamDetail.students")}: {c.student_count}</div>
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
              <div className={styles.cardTitle}>{t("admin.streamDetail.gen.title")}</div>
              <div className={styles.row}>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={styles.select}>
                  <option value="">{t("admin.streamDetail.gen.selectTemplate")}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}{template.is_default ? ` (${t("common.default")})` : ""}
                    </option>
                  ))}
                </select>
                <button className={styles.btnPrimary} onClick={handleGenerate}>
                  <Wand2 size={16} /> {t("admin.streamDetail.gen.generate")}
                </button>
              </div>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>{t("admin.streamDetail.gen.forceLabel")}</span>
              </label>
              <div className={styles.hint}>
                {force ? t("admin.streamDetail.gen.forceHint") : t("admin.streamDetail.gen.safeHint")}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
