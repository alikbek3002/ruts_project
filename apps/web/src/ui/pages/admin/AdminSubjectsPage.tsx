import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListSubjects,
  apiCreateSubject,
  apiUpdateSubject,
  apiDeleteSubject,
  type Subject,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import styles from "./AdminSubjects.module.css";
import { BookOpen, Trash2, Plus, Image as ImageIcon, Save, X, Edit2 } from "lucide-react";
import { SubjectTopicsModal } from "./modals/SubjectTopicsModal";

export function AdminSubjectsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager" || user.role === "teacher") && !!token, [user, token]);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectPhotoUrl, setNewSubjectPhotoUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit subject state
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editSubjectName, setEditSubjectName] = useState("");
  const [editSubjectPhotoUrl, setEditSubjectPhotoUrl] = useState("");

  // Modal state
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  async function reloadAll() {
    if (!token) return;
    setLoading(true);
    try {
      const s = await apiListSubjects(token);
      setSubjects(s.subjects || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (can) reloadAll().catch((e) => setErr(String(e)));
  }, [can]);

  useEffect(() => {
    if (selectedSubject) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selectedSubject]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager" && user.role !== "teacher") return <Navigate to="/app" replace />;

  const isTeacher = user.role === "teacher";
  const base = isTeacher ? "/app/teacher" : (user.role === "manager" ? "/app/manager" : "/app/admin");
  const title = isTeacher ? "Учитель → Предметы" : (user.role === "manager" ? "Менеджер → Предметы" : "Админ → Предметы");

  const handleCreateSubject = async () => {
    if (isTeacher) return;
    if (!token || !newSubjectName.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      await apiCreateSubject(token, newSubjectName.trim(), newSubjectPhotoUrl.trim() || null, false);
      setNewSubjectName("");
      setNewSubjectPhotoUrl("");
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const startEditSubject = (subject: Subject) => {
    setEditingSubjectId(subject.id);
    setEditSubjectName(subject.name);
    setEditSubjectPhotoUrl(subject.photo_url || "");
  };

  const cancelEditSubject = () => {
    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectPhotoUrl("");
  };

  const saveEditSubject = async () => {
    if (!token || !editingSubjectId || !editSubjectName.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      await apiUpdateSubject(
        token,
        editingSubjectId,
        editSubjectName.trim(),
        editSubjectPhotoUrl.trim() || null,
        false,
      );
      setEditingSubjectId(null);
      setEditSubjectName("");
      setEditSubjectPhotoUrl("");
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!token) return;
    if (!window.confirm("Удалить предмет?")) return;
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
      nav={isTeacher ? [
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
      ] : getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Предметы</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}

        <div className={styles.createRow}>
          {/* Hide create subject for teachers */}
          {!isTeacher && (
            <>
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
              <button onClick={handleCreateSubject} disabled={loading || !newSubjectName.trim()} className={styles.primaryBtn}>
                <Plus size={18} />
                Создать предмет
              </button>
            </>
          )}
        </div>

        <div className={styles.cardsGrid}>
          {!loading && subjects.map((s) => {
            const isEditing = editingSubjectId === s.id;

            return (
              <div key={s.id} className={styles.card}>
                {isEditing ? (
                  <div className={styles.cardTop} style={{ flexDirection: "column", gap: 12 }}>
                    <div style={{ position: "relative", width: "100%" }}>
                      <BookOpen size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)", zIndex: 1 }} />
                      <input
                        placeholder="Название предмета"
                        value={editSubjectName}
                        onChange={(e) => setEditSubjectName(e.target.value)}
                        style={{ paddingLeft: 40, width: "100%" }}
                        autoFocus
                      />
                    </div>
                    <div style={{ position: "relative", width: "100%" }}>
                      <ImageIcon size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)", zIndex: 1 }} />
                      <input
                        placeholder="Ссылка на фото (необязательно)"
                        value={editSubjectPhotoUrl}
                        onChange={(e) => setEditSubjectPhotoUrl(e.target.value)}
                        style={{ paddingLeft: 40, width: "100%" }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 8, width: "100%" }}>
                      <button
                        className={styles.secondaryBtn}
                        onClick={saveEditSubject}
                        disabled={loading || !editSubjectName.trim()}
                        style={{ flex: 1 }}
                      >
                        <Save size={16} />
                        Сохранить
                      </button>
                      <button
                        className={styles.secondaryBtn}
                        onClick={cancelEditSubject}
                        disabled={loading}
                        style={{ flex: 1 }}
                      >
                        <X size={16} />
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cardTop} onClick={() => setSelectedSubject(s)} style={{ cursor: "pointer" }}>
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
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        className={styles.iconBtn}
                        onClick={(e) => { e.stopPropagation(); startEditSubject(s); }}
                        title="Редактировать"
                        disabled={loading || isTeacher}
                        style={{ opacity: isTeacher ? 0.3 : 1 }}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        className={styles.iconBtnDanger}
                        onClick={(e) => { e.stopPropagation(); handleDeleteSubject(s.id); }}
                        title="Удалить"
                        disabled={loading || isTeacher}
                        style={{ opacity: isTeacher ? 0.3 : 1 }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {subjects.length === 0 && !loading && <div className={styles.empty}>Предметы не созданы</div>}
        </div>
      </div>

      {selectedSubject && token && (
        <SubjectTopicsModal
          subject={selectedSubject}
          token={token}
          isTeacher={isTeacher}
          onClose={() => setSelectedSubject(null)}
        />
      )}
    </AppShell>
  );
}
