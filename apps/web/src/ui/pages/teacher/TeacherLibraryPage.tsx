import React, { useEffect, useMemo, useState, useRef } from "react";
import { Navigate } from "react-router-dom";
import { 
  apiListLibrary, 
  apiListClasses, 
  apiUploadLibraryFile,
  apiGetLibraryDownloadUrl,
  apiDeleteLibraryItem,
  type ClassItem, 
  type LibraryItem 
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
  const [items, setItems] = useState<LibraryItem[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function reload() {
    if (!token) return;
    try {
      const [c, l] = await Promise.all([apiListClasses(token), apiListLibrary(token, classId || undefined)]);
      setClasses(c.classes);
      setItems(l.items);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    if (!can) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, classId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, "")); // Remove extension
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleUpload = async () => {
    if (!token || !selectedFile || !title.trim()) return;
    
    setUploading(true);
    setErr(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      const result = await apiUploadLibraryFile(
        token,
        selectedFile,
        title.trim(),
        description.trim() || undefined,
        classId || null,
        (percent) => setUploadProgress(percent)
      );
      
      setSuccess(`Файл "${result.originalFilename}" успешно загружен!`);
      setTitle("");
      setDescription("");
      setSelectedFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      await reload();
    } catch (e) {
      setErr(`Ошибка загрузки: ${String(e)}`);
    } finally {
      setUploading(false);
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
        <button onClick={() => reload()}>🔄 Обновить</button>
      </div>

      <hr />
      
      <h3 style={{ marginTop: 20, marginBottom: 12 }}>📤 Загрузить файл</h3>
      
      <div
        style={{
          border: dragOver ? "2px dashed var(--color-primary)" : "2px dashed var(--color-border)",
          borderRadius: 12,
          padding: 32,
          textAlign: "center",
          background: dragOver ? "var(--color-card)" : "transparent",
          marginBottom: 16,
          transition: "all 0.2s",
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          style={{ display: "none" }}
          id="file-input"
        />
        <label htmlFor="file-input" style={{ cursor: "pointer" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📁</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>
            {selectedFile ? (
              <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>{selectedFile.name}</span>
            ) : (
              <>Перетащите файл сюда или <span style={{ color: "var(--color-primary)" }}>выберите</span></>
            )}
          </div>
          <div style={{ fontSize: 14, opacity: 0.7 }}>
            {selectedFile ? `Размер: ${(selectedFile.size / 1024 / 1024).toFixed(2)} МБ` : "Максимальный размер: 50 МБ"}
          </div>
        </label>
      </div>

      {selectedFile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Название:</label>
            <input
              type="text"
              placeholder="Название файла"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14 }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Описание (опционально):</label>
            <textarea
              placeholder="Краткое описание"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, minHeight: 60, resize: "vertical" }}
            />
          </div>
          
          {uploading && (
            <div>
              <div style={{ 
                height: 8, 
                background: "var(--color-border)", 
                borderRadius: 4, 
                overflow: "hidden",
                marginBottom: 8
              }}>
                <div style={{ 
                  height: "100%", 
                  background: "var(--color-primary)", 
                  width: `${uploadProgress}%`,
                  transition: "width 0.3s"
                }} />
              </div>
              <div style={{ textAlign: "center", fontSize: 14, opacity: 0.8 }}>
                Загрузка: {uploadProgress}%
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={!title.trim() || uploading}
              onClick={handleUpload}
              style={{
                flex: 1,
                padding: "10px 20px",
                background: "var(--color-primary)",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: uploading ? "not-allowed" : "pointer",
                opacity: (!title.trim() || uploading) ? 0.5 : 1,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {uploading ? "Загрузка..." : "📤 Загрузить файл"}
            </button>
            <button
              onClick={() => {
                setSelectedFile(null);
                setTitle("");
                setDescription("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={uploading}
              style={{ padding: "10px 20px" }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <hr />
      
      <h3 style={{ marginTop: 20, marginBottom: 12 }}>📚 Список файлов</h3>
      {items.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Пока нет загруженных файлов.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 16,
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                background: "var(--color-card)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                  📄 {item.title}
                </div>
                {item.description && (
                  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>{item.description}</div>
                )}
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  {new Date(item.created_at).toLocaleDateString("ru-RU")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleDownload(item)}
                  style={{
                    padding: "8px 16px",
                    background: "var(--color-primary)",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  ⬇️ Скачать
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  style={{
                    padding: "8px 16px",
                    background: "#fee",
                    color: "#c00",
                    border: "1px solid #c00",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  🗑️ Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
