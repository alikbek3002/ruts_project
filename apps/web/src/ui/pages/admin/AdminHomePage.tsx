import React from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "./AdminHome.module.css";
import { 
  Users, 
  GraduationCap, 
  BookOpen, 
  Map, 
  Calendar, 
  Bell, 
  Phone, 
  Cake, 
  Briefcase,
  User,
  Clock
} from "lucide-react";

export function AdminHomePage() {
  const { state } = useAuth();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Панель менеджера" : "Админ панель";

  const menuItems = [
    { to: `${base}/users`, label: "Пользователи", icon: Users, color: "blue" as const, desc: "Управление учителями и учениками" },
    { to: `${base}/classes`, label: "Группы", icon: GraduationCap, color: "green" as const, desc: "Создание групп и назначение кураторов" },
    { to: `${base}/subjects`, label: "Предметы", icon: BookOpen, color: "purple" as const, desc: "Список предметов и учителей" },
    { to: `${base}/directions`, label: "Направления", icon: Map, color: "orange" as const, desc: "Факультеты и специальности" },
    { to: `${base}/timetable`, label: "Расписание", icon: Calendar, color: "blue" as const, desc: "Редактирование расписания занятий" },
    { to: `${base}/notifications`, label: "Уведомления", icon: Bell, color: "green" as const, desc: "Рассылка объявлений" },
  ];

  const formattedDate = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDateCap = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

  return (
    <AppShell
      title={title}
      nav={[
        { to: base, label: "Главная" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.welcomeSection}>
          <div className={styles.welcomeContent}>
            <h1 className={styles.welcomeTitle}>Добро пожаловать, {user.first_name || user.username}!</h1>
            <p className={styles.welcomeSubtitle}>
              Сегодня {formattedDateCap} • {user.role === "admin" ? "Администратор" : "Менеджер"}
            </p>
          </div>
        </div>

        <div className={styles.grid}>
          <div>
            <h2 className={styles.sectionTitle}>
              <Clock size={20} />
              Быстрый доступ
            </h2>
            <div className={styles.quickLinksGrid}>
              {menuItems.map((item) => (
                <Link key={item.to} to={item.to} className={styles.quickLinkCard}>
                  <div className={`${styles.iconBox} ${styles[item.color]}`}>
                    <item.icon size={24} />
                  </div>
                  <span className={styles.linkTitle}>{item.label}</span>
                  <span className={styles.linkDesc}>{item.desc}</span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className={styles.sectionTitle}>
              <User size={20} />
              Профиль
            </h2>
            <div className={styles.profileCard}>
              {user.photo_data_url ? (
                <img src={user.photo_data_url} alt="Фото" className={styles.avatar} />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  <User size={40} />
                </div>
              )}

              <div className={styles.profileInfo}>
                <div className={styles.name}>{user.full_name || user.username}</div>
                <div className={styles.username}>@{user.username}</div>

                <div className={styles.details}>
                  {user.phone && (
                    <div className={styles.detailItem}>
                      <Phone size={16} className={styles.detailIcon} />
                      {user.phone}
                    </div>
                  )}
                  {user.birth_date && (
                    <div className={styles.detailItem}>
                      <Cake size={16} className={styles.detailIcon} />
                      {user.birth_date}
                    </div>
                  )}
                  {user.teacher_subject && (
                    <div className={styles.detailItem}>
                      <Briefcase size={16} className={styles.detailIcon} />
                      {user.teacher_subject}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
