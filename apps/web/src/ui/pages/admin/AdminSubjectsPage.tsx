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
import { BookOpen, Trash2, Plus, Image as ImageIcon, User } from "lucide-react";

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
          <h2>Предметы</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}
        
        <div className={styles.createRow}>
          <div style={{ position: "relative", flex: 1 }}>
            <BookOpen size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)" }} />
            <input
              placeholder="Название предмета"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
              style={{ paddingLeft: 40, width: "100%" }}
            />
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <ImageIcon size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)" }} />
            <input
              placeholder="Ссылка на фото (необязательно)"
              value={newSubjectPhotoUrl}
              onChange={(e) => setNewSubjectPhotoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
              style={{ paddingLeft: 40, width: "100%" }}
            />
          </div>
          <button onClick={handleCreateSubject} disabled={loading || !newSubjectName.trim()} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={18} />
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
                <div className={styles.cardInfo}>
                  <div className={styles.title}>{s.name}</div>
                  <div className={styles.meta}>
                    <User size={14} />
                    {teacherLine(s)}
                  </div>
                </div>
                <button className={`secondary ${styles.deleteBtn}`} onClick={() => handleDeleteSubject(s.id)} title="Удалить" disabled={loading}>
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}

          {subjects.length === 0 && <div className={styles.empty}>Предметы не созданы</div>}
        </div>

        <div className={styles.infoBox}>
          <h3>👨‍🏫 Предметы учителям</h3>
          <p>
            Предметы назначаются при создании учителя в разделе “Пользователи”.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
