import React from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminHome.module.css";
import { 
  Users, 
  GraduationCap, 
  BookOpen, 
  Map, 
  Calendar, 
  Layers,
  Bell, 
  Phone, 
  Cake, 
  Briefcase,
  User,
  Clock
} from "lucide-react";

export function AdminHomePage() {
  const { state } = useAuth();
  const { t, lang } = useI18n();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const titleKey = user.role === "manager" ? "manager.panelTitle" : "admin.panelTitle";

  const menuItems = [
    { to: `${base}/users`, labelKey: "nav.users" as const, icon: Users, color: "blue" as const, descKey: "admin.menu.usersDesc" as const },
    { to: `${base}/classes`, labelKey: "nav.groups" as const, icon: GraduationCap, color: "green" as const, descKey: "admin.menu.groupsDesc" as const },
    { to: `${base}/streams`, labelKey: "nav.streams" as const, icon: Layers, color: "purple" as const, descKey: "admin.menu.streamsDesc" as const },
    { to: `${base}/subjects`, labelKey: "nav.subjects" as const, icon: BookOpen, color: "purple" as const, descKey: "admin.menu.subjectsDesc" as const },
    { to: `${base}/directions`, labelKey: "nav.directions" as const, icon: Map, color: "orange" as const, descKey: "admin.menu.directionsDesc" as const },
    { to: `${base}/timetable`, labelKey: "nav.timetable" as const, icon: Calendar, color: "blue" as const, descKey: "admin.menu.timetableDesc" as const },
    { to: `${base}/workload`, labelKey: "nav.workload" as const, icon: Clock, color: "green" as const, descKey: "admin.menu.workloadDesc" as const },
    { to: `${base}/notifications`, labelKey: "nav.notifications" as const, icon: Bell, color: "green" as const, descKey: "admin.menu.notificationsDesc" as const },
  ];

  const formattedDate = new Date().toLocaleDateString(lang === "ky" ? "ky-KG" : "ru-RU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDateCap = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

  const displayName = user.first_name || user.full_name || user.username;
  const roleLabel = user.role === "admin" ? t("role.admin") : t("role.manager");

  return (
    <AppShell
      titleKey={titleKey}
      nav={[
        { to: base, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/directions`, labelKey: "nav.directions" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
        { to: `${base}/workload`, labelKey: "nav.workload" },
        { to: `${base}/notifications`, labelKey: "nav.notifications" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.welcomeSection}>
          <div className={styles.welcomeContent}>
            <h1 className={styles.welcomeTitle}>{t("home.welcome", { name: displayName })}</h1>
            <p className={styles.welcomeSubtitle}>
              {t("home.todayWithRole", { date: formattedDateCap, role: roleLabel })}
            </p>
          </div>
        </div>

        <div className={styles.grid}>
          <div>
            <h2 className={styles.sectionTitle}>
              <Clock size={20} />
              {t("admin.quickAccess")}
            </h2>
            <div className={styles.quickLinksGrid}>
              {menuItems.map((item) => (
                <Link key={item.to} to={item.to} className={styles.quickLinkCard}>
                  <div className={`${styles.iconBox} ${styles[item.color]}`}>
                    <item.icon size={24} />
                  </div>
                  <span className={styles.linkTitle}>{t(item.labelKey)}</span>
                  <span className={styles.linkDesc}>{t(item.descKey)}</span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className={styles.sectionTitle}>
              <User size={20} />
              {t("admin.profileSection")}
            </h2>
            <div className={styles.profileCard}>
              {user.photo_data_url ? (
                <img src={user.photo_data_url} alt={t("common.photo")} className={styles.avatar} />
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
