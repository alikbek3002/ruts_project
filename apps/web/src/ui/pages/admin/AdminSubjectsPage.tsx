import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListSubjectsWithTeachers,
  apiCreateSubject,
  apiDeleteSubject,
  type SubjectWithTeachers,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminSubjects.module.css";

export function AdminSubjectsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [subjects, setSubjects] = useState<SubjectWithTeachers[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectPhotoUrl, setNewSubjectPhotoUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reloadAll() {
    if (!token) return;
    setLoading(true);
    try {
      const s = await apiListSubjectsWithTeachers(token);
      setSubjects(s.subjects || []);
    } finally {
      setLoading(false);
    }
  }

  function teacherLine(s: SubjectWithTeachers): string {
    const names = (s.teachers || []).map((t) => t.name).filter(Boolean);
    return names.length ? names.join(", ") : "---";
  }

  useEffect(() => {
    if (can) reloadAll().catch((e) => setErr(String(e)));
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Предметы" : "Админ → Предметы";

  const handleCreateSubject = async () => {
    if (!token || !newSubjectName.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      // пока фото хранится как URL
      await apiCreateSubject(token, newSubjectName.trim(), newSubjectPhotoUrl.trim() || null);
      setNewSubjectName("");
      setNewSubjectPhotoUrl("");
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!token) return;
    if (!window.confirm("Удалить предмет? Это также удалит все связи с учителями.")) return;
    setErr(null);
    setLoading(true);
    try {
      await apiDeleteSubject(token, subjectId);
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };


  return (
    <AppShell
      title={title}
      nav={[
        { to: base, label: user.role === "manager" ? "Менеджер" : "Админ" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {loading && <Loader text="Загрузка..." />}
      
      <h3>📚 Предметы</h3>
      <div className={styles.createRow}>
        <input
          placeholder="Название предмета"
          value={newSubjectName}
          onChange={(e) => setNewSubjectName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
        />
        <input
          placeholder="Ссылка на фото (необязательно)"
          value={newSubjectPhotoUrl}
          onChange={(e) => setNewSubjectPhotoUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
        />
        <button onClick={handleCreateSubject} disabled={loading || !newSubjectName.trim()}>
          Создать предмет
        </button>
      </div>

      <div className={styles.cardsGrid}>
        {!loading && subjects.map((s) => (
          <div key={s.id} className={styles.card}>
            <div className={styles.cardTop}>
              <img
                className={styles.photo}
                src={(s as any).photo_url || "/favicon.svg"}
                alt="Фото предмета"
                loading="lazy"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src.endsWith("/favicon.svg")) return;
                  img.src = "/favicon.svg";
                }}
              />
              <div>
                <div className={styles.title}>{s.name}</div>
                <div className={styles.meta}>👨‍🏫 {teacherLine(s)}</div>
              </div>
              <button className={styles.deleteBtn} onClick={() => handleDeleteSubject(s.id)} title="Удалить" disabled={loading}>
                ✕
              </button>
            </div>
          </div>
        ))}

        {subjects.length === 0 && <div className={styles.empty}>Предметы не созданы</div>}
      </div>

      <hr />

      <h3>👨‍🏫 Предметы учителям</h3>
      <p style={{ color: "#666", fontSize: 14 }}>
        Предметы назначаются при создании учителя в разделе “Пользователи”.
      </p>
    </AppShell>
  );
}
