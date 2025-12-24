import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiCreateLibraryItem, apiListLibrary, apiListClasses, type ClassItem, type LibraryItem } from "../../../api/client";
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
  const [storagePath, setStoragePath] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!token) return;
    const [c, l] = await Promise.all([apiListClasses(token), apiListLibrary(token, classId || undefined)]);
    setClasses(c.classes);
    setItems(l.items);
  }

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, classId]);

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
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Группа (опционально):
          <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="">(общая)</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => reload().catch((e) => setErr(String(e)))}>Обновить</button>
      </div>

      <hr />
      <h3>Добавить запись (метаданные)</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minWidth: 240 }} />
        <input
          placeholder="Описание"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ minWidth: 360 }}
        />
        <input
          placeholder="storage_path (например: manuals/file.pdf)"
          value={storagePath}
          onChange={(e) => setStoragePath(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <button
          disabled={!title.trim() || !storagePath.trim()}
          onClick={async () => {
            if (!token) return;
            setErr(null);
            try {
              await apiCreateLibraryItem(token, {
                title: title.trim(),
                description: description.trim() || undefined,
                class_id: classId || null,
                storage_path: storagePath.trim(),
              });
              setTitle("");
              setDescription("");
              setStoragePath("");
              await reload();
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Добавить
        </button>
      </div>

      <hr />
      <h3>Список</h3>
      {items.length === 0 ? (
        <p>Пока пусто.</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <b>{i.title}</b> {i.description ? `— ${i.description}` : ""}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
