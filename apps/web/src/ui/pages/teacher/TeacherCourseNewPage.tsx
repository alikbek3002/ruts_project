import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { apiCreateCourse } from "../../../api/client";
import styles from "./TeacherCourseNew.module.css";

export function TeacherCourseNewPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!token || !title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiCreateCourse(token, { title: title.trim(), description: description.trim() || null });
      navigate(`/app/teacher/courses/${res.course.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Создать курс"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/workload", label: "Часы работы" },
        { to: "/app/teacher/library", label: "Библиотека" },
        { to: "/app/teacher/courses", label: "Курсы" },
      ]}
    >
      <div className={styles.container}>
        <button onClick={() => navigate("/app/teacher/courses")} className={styles.backLink}>
          <ArrowLeft size={20} />
          Назад к курсам
        </button>

        <div className={styles.formCard}>
          <h1>Создать новый курс</h1>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.formGroup}>
            <label>Название курса *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите название курса"
              className={styles.input}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Описание (необязательно)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Введите описание курса"
              className={styles.textarea}
              rows={5}
            />
          </div>

          <div className={styles.formFooter}>
            <button onClick={() => navigate("/app/teacher/courses")} className={styles.cancelButton}>
              Отмена
            </button>
            <button
              onClick={handleCreate}
              className={styles.createButton}
              disabled={loading || !title.trim()}
            >
              <Save size={16} />
              {loading ? "Создание..." : "Создать курс"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

