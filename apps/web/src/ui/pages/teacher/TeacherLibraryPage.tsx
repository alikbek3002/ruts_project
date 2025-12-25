import React, { useEffect, useMemo, useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import { 
  apiListClasses, 
  apiListLibrary,
  apiListLibraryTopics,
  apiCreateLibraryTopic,
  apiUploadLibraryFileToTopic,
  apiGetLibraryDownloadUrl,
  apiDeleteLibraryItem,
  type ClassItem, 
  type LibraryItem,
  type LibraryTopic
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function TeacherLibraryPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "teacher" && !!token, [user, token]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [topics, setTopics] = useState<LibraryTopic[]>([]);
  const [topicsSchemaMissing, setTopicsSchemaMissing] = useState(false);

  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [topicFile, setTopicFile] = useState<File | null>(null);

  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const createTopicFileInputRef = useRef<HTMLInputElement>(null);
  const topicUploadInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function reload() {
    if (!token) return;
    try {
      const [c, t] = await Promise.all([apiListClasses(token), apiListLibraryTopics(token, classId || undefined)]);
      setClasses(c.classes);
      const schemaMissing = !!(t as any)?.schema_missing;
      setTopicsSchemaMissing(schemaMissing);

      if (schemaMissing) {
        // Fallback: show flat library list until migration is applied.
        const flat = await apiListLibrary(token, classId || undefined);
        setTopics([
          {
            id: "__flat__",
            title: "Файлы",
            description: null,
            class_id: classId || null,
            created_at: new Date().toISOString(),
            items: flat.items,
          },
        ]);
        setErr(
          "Темы библиотеки ещё не включены (не применена миграция library_topics). Пока показываю общий список файлов."
        );
      } else {
        setErr(null);
        setTopics(t.topics);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    if (!can) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, classId]);

  const handleCreateTopic = async () => {
    if (!token || !topicTitle.trim()) return;

    setUploading(true);
    setErr(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      const result = await apiCreateLibraryTopic(
        token,
        topicFile,
        topicTitle.trim(),
        topicDescription.trim() || undefined,
        classId || null,
        (percent) => setUploadProgress(percent)
      );

      if (result.originalFilename) {
        setSuccess(`Тема "${topicTitle.trim()}" создана, файл "${result.originalFilename}" загружен`);
      } else {
        setSuccess(`Тема "${topicTitle.trim()}" создана`);
      }
      setShowCreateTopic(false);
      setTopicTitle("");
      setTopicDescription("");
      setTopicFile(null);
      setUploadProgress(0);
      if (createTopicFileInputRef.current) createTopicFileInputRef.current.value = "";
      await reload();
    } catch (e) {
      setErr(`Ошибка создания темы: ${String(e)}`);
    } finally {
      setUploading(false);
      setUploadingTopicId(null);
    }
  };

  const handleTopicFilePick = (topicId: string) => {
    const ref = topicUploadInputRefs.current[topicId];
    if (ref) ref.click();
  };

  const handleUploadToTopic = async (topic: LibraryTopic, file: File) => {
    if (!token) return;
    setUploading(true);
    setUploadingTopicId(topic.id);
    setErr(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      const title = file.name.replace(/\.[^/.]+$/, "");
      const res = await apiUploadLibraryFileToTopic(token, topic.id, file, title, undefined, (p) => setUploadProgress(p));
      setSuccess(`Файл "${res.originalFilename}" загружен в тему "${topic.title}"`);
      await reload();
    } catch (e) {
      setErr(`Ошибка загрузки: ${String(e)}`);
    } finally {
      setUploading(false);
      setUploadingTopicId(null);
      setUploadProgress(0);
      const input = topicUploadInputRefs.current[topic.id];
      if (input) input.value = "";
    }
  };

  const handleDownload = async (item: LibraryItem) => {
    if (!token) return;
    try {
      const { url } = await apiGetLibraryDownloadUrl(token, item.id);
      window.open(url, "_blank");
    } catch (e) {
      setErr(`Ошибка скачивания: ${String(e)}`);
    }
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!token) return;
    if (!confirm(`Удалить "${item.title}"?`)) return;
    
    try {
      await apiDeleteLibraryItem(token, item.id);
      setSuccess("Файл удален");
      await reload();
    } catch (e) {
      setErr(`Ошибка удаления: ${String(e)}`);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учитель → Библиотека"
      nav={[
        { to: "/app/teacher", label: "🏠 Главная" },
        { to: "/app/teacher/journal", label: "📖 Журнал" },
        { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      {err && <div style={{ padding: "12px", background: "#fee", color: "#c00", borderRadius: 8, marginBottom: 16 }}>{err}</div>}
      {success && <div style={{ padding: "12px", background: "#efe", color: "#060", borderRadius: 8, marginBottom: 16 }}>{success}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <label>
          Группа:
          <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ marginLeft: 8, padding: "6px 12px" }}>
            <option value="">(все / общая библиотека)</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setErr(null);
            setSuccess(null);
            setShowCreateTopic(true);
          }}
          disabled={topicsSchemaMissing}
          title={topicsSchemaMissing ? "Нужно применить миграцию library_topics в Supabase" : undefined}
        >
          ➕ Добавить тему
        </button>
        <button onClick={() => reload()}>🔄 Обновить</button>
      </div>

      {showCreateTopic && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => (uploading ? null : setShowCreateTopic(false))}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>➕ Добавить тему</h3>
              <button onClick={() => (uploading ? null : setShowCreateTopic(false))} disabled={uploading}>
                ✖
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Название темы:</label>
                <input
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  placeholder="Например: Тема 1 — Основы"
                  style={{ width: "100%", padding: "8px 12px", fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Описание темы:</label>
                <textarea
                  value={topicDescription}
                  onChange={(e) => setTopicDescription(e.target.value)}
                  placeholder="Краткое описание темы"
                  style={{ width: "100%", padding: "8px 12px", fontSize: 14, minHeight: 80, resize: "vertical" }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Файл:</label>
                <input
                  ref={createTopicFileInputRef}
                  type="file"
                  onChange={(e) => setTopicFile(e.target.files?.[0] ?? null)}
                />
                {topicFile && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{topicFile.name}</div>}
              </div>

              {uploading && (
                <div>
                  <div
                    style={{
                      height: 8,
                      background: "var(--color-border)",
                      borderRadius: 4,
                      overflow: "hidden",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: "var(--color-primary)",
                        width: `${uploadProgress}%`,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 14, opacity: 0.8 }}>Загрузка: {uploadProgress}%</div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setShowCreateTopic(false)} disabled={uploading}>
                  Отмена
                </button>
                <button
                  onClick={handleCreateTopic}
                  disabled={!topicTitle.trim() || uploading}
                  style={{
                    padding: "10px 20px",
                    background: "var(--color-primary)",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    cursor: uploading ? "not-allowed" : "pointer",
                    opacity: (!topicTitle.trim() || uploading) ? 0.5 : 1,
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {uploading ? "Создание..." : "Создать"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <hr />

      <h3 style={{ marginTop: 20, marginBottom: 12 }}>📚 Темы</h3>
      {topics.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Пока нет тем. Нажмите «Добавить тему».</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {topics.map((topic) => (
            <div
              key={topic.id}
              style={{
                padding: 16,
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                background: "var(--color-card)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📌 {topic.title}</div>
                  {topic.description && <div style={{ fontSize: 14, opacity: 0.85 }}>{topic.description}</div>}
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                    {new Date(topic.created_at).toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="file"
                    style={{ display: "none" }}
                    ref={(el) => {
                      topicUploadInputRefs.current[topic.id] = el;
                    }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadToTopic(topic, f);
                    }}
                  />
                  <button
                    onClick={() => handleTopicFilePick(topic.id)}
                    disabled={topic.id === "__flat__" || (uploading && uploadingTopicId === topic.id)}
                    title={topic.id === "__flat__" ? "Нужно применить миграцию library_topics" : undefined}
                    style={{
                      padding: "8px 12px",
                      background: "var(--color-primary)",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      cursor: uploading && uploadingTopicId === topic.id ? "not-allowed" : "pointer",
                      opacity: uploading && uploadingTopicId === topic.id ? 0.6 : 1,
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {uploading && uploadingTopicId === topic.id ? "Загрузка..." : "📤 Загрузить файл"}
                  </button>
                </div>
              </div>

              {uploading && uploadingTopicId === topic.id && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      height: 8,
                      background: "var(--color-border)",
                      borderRadius: 4,
                      overflow: "hidden",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: "var(--color-primary)",
                        width: `${uploadProgress}%`,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 14, opacity: 0.8 }}>Загрузка: {uploadProgress}%</div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {topic.items.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>В теме пока нет файлов.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {topic.items.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: 12,
                          border: "1px solid var(--color-border)",
                          borderRadius: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📄 {item.title}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.6 }}>{new Date(item.created_at).toLocaleDateString("ru-RU")}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => handleDownload(item)}
                            style={{
                              padding: "8px 12px",
                              background: "var(--color-primary)",
                              color: "white",
                              border: "none",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 14,
                            }}
                          >
                            ⬇️ Скачать
                          </button>
                          {!!item.can_delete && (
                            <button
                              onClick={() => handleDelete(item)}
                              style={{
                                padding: "8px 12px",
                                background: "#fee",
                                color: "#c00",
                                border: "1px solid #c00",
                                borderRadius: 8,
                                cursor: "pointer",
                                fontSize: 14,
                              }}
                            >
                              🗑️ Удалить
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
