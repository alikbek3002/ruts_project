import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../layout/AppShell";
import { Loader } from "../components/Loader";
import {
  apiGetProfile,
  type UserProfile,
} from "../../api/client";
import styles from "./ProfilePage.module.css";

export function ProfilePage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const token = state.accessToken;
  const authUser = state.user;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (token) {
      loadProfile();
    }
  }, [token]);

  async function loadProfile() {
    try {
      setLoading(true);
      setError("");
      const data = await apiGetProfile(token!);
      setProfile(data.profile);
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  }

  const getNavLinks = () => {
    const role = authUser?.role;
    if (role === "teacher") {
      return [
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ];
    }
    if (role === "student") {
      return [
        { to: "/app/student", label: "Главная" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/homework", label: "Домашнее задание" },
        { to: "/app/student/library", label: "Библиотека" },
      ];
    }
    if (role === "admin" || role === "manager") {
      const prefix = role === "manager" ? "/app/manager" : "/app/admin";
      return [
        { to: prefix, label: "Главная" },
        { to: `${prefix}/users`, label: "Пользователи" },
        { to: `${prefix}/classes`, label: "Классы" },
        { to: `${prefix}/timetable`, label: "Расписание" },
      ];
    }
    return [];
  };

  if (loading) {
    return <Loader fullScreen text="Загрузка профиля..." />;
  }

  if (!profile) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.error}>Профиль не найден</div>
        <button onClick={() => navigate(-1)} className={styles.backButton}>
          Назад
        </button>
      </div>
    );
  }

  const isStudent = authUser?.role === "student";
  const isTeacher = authUser?.role === "teacher";
  const initials = profile.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : profile.username[0].toUpperCase();

  return (
    <AppShell title="Профиль пользователя" nav={getNavLinks()}>
      <div className={styles.container}>
        <div className={styles.profileHeader}>
          <div className={styles.avatarSection}>
            {profile.photo_data_url ? (
              <img src={profile.photo_data_url} alt="Avatar" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder}>{initials}</div>
            )}
          </div>
          
          <div className={styles.headerInfo}>
            <h1 className={styles.name}>{profile.full_name || profile.username}</h1>
            <div className={styles.badges}>
              <span className={`${styles.roleBadge} ${styles[authUser?.role || ""]}`}>
                {authUser?.role === "admin" ? "Администратор" :
                 authUser?.role === "manager" ? "Менеджер" :
                 authUser?.role === "teacher" ? "Преподаватель" : "Ученик"}
              </span>
              {isStudent && profile.class_name && (
                <span className={styles.classBadge}>{profile.class_name}</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <User size={20} />
                Личная информация
              </h2>
            </div>

            <div className={styles.cardContent}>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Фамилия</span>
                  <span className={styles.value}>{profile.last_name || "—"}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Имя</span>
                  <span className={styles.value}>{profile.first_name || "—"}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Отчество</span>
                  <span className={styles.value}>{profile.middle_name || "—"}</span>
                </div>
                
                {isTeacher && profile.teacher_subject_name && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Предмет</span>
                    <span className={styles.value}>{profile.teacher_subject_name}</span>
                  </div>
                )}

                {isStudent && profile.class_name && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Группа</span>
                    <span className={styles.value}>{profile.class_name}</span>
                  </div>
                )}

                <div className={styles.infoItem}>
                  <span className={styles.label}>Телефон</span>
                  <span className={styles.value}>
                    {profile.phone ? (
                      <a href={`tel:${profile.phone}`} className={styles.link}>{profile.phone}</a>
                    ) : "Не указано"}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Дата рождения</span>
                  <span className={styles.value}>
                    {profile.birth_date ? new Date(profile.birth_date).toLocaleDateString("ru-RU") : "Не указано"}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Логин</span>
                  <span className={styles.value}>{profile.username}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
