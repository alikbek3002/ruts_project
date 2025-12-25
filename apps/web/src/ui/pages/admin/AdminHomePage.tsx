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
  User
} from "lucide-react";

export function AdminHomePage() {
  const { state } = useAuth();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Панель менеджера" : "Админ панель";

  const menuItems = [
    { to: `${base}/users`, label: "Пользователи", icon: Users, desc: "Управление учителями и учениками" },
    { to: `${base}/classes`, label: "Группы", icon: GraduationCap, desc: "Создание групп и назначение кураторов" },
    { to: `${base}/subjects`, label: "Предметы", icon: BookOpen, desc: "Список предметов и учителей" },
    { to: `${base}/directions`, label: "Направления", icon: Map, desc: "Факультеты и специальности" },
    { to: `${base}/timetable`, label: "Расписание", icon: Calendar, desc: "Редактирование расписания занятий" },
    { to: `${base}/notifications`, label: "Уведомления", icon: Bell, desc: "Рассылка объявлений" },
  ];

  return (
    <AppShell
      title={title}
      nav={[
        { to: base, label: user.role === "manager" ? "Менеджер" : "Админ" },
        ...menuItems.map(i => ({ to: i.to, label: i.label }))
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Добро пожаловать, {user.first_name || user.username}!</h2>
          <div className={styles.subtitle}>
            Вы вошли как {user.role === "admin" ? "Администратор" : "Менеджер"}
          </div>
        </div>

        <div className={styles.profileCard}>
          {user.photo_data_url ? (
            <img
              src={user.photo_data_url}
              alt="Фото"
              className={styles.avatar}
            />
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

        <h3 style={{ marginBottom: 'var(--spacing-md)', color: 'var(--color-text)' }}>Быстрый доступ</h3>
        <div className={styles.dashboardGrid}>
          {menuItems.map((item) => (
            <Link key={item.to} to={item.to} className={styles.dashboardCard}>
              <div className={styles.cardIcon}>
                <item.icon size={20} />
              </div>
              <div className={styles.cardTitle}>{item.label}</div>
              <div className={styles.cardDesc}>{item.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
