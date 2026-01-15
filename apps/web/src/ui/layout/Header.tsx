import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";
import { useAuth } from "../auth/AuthProvider";
import { NotificationBell } from "../components/NotificationBell";
import type { Lang } from "../i18n/i18n";
import styles from "./Header.module.css";

interface HeaderProps {
  title: string;
  showLogo?: boolean;
}

const FLAGS: Record<Lang, string> = {
  ru: "🇷🇺",
  ky: "🇰🇬",
};

export function Header({ title, showLogo = true }: HeaderProps) {
  const { lang, setLang, t } = useI18n();
  const { logout, state } = useAuth();
  const user = state.user;
  const navigate = useNavigate();

  const toggleLang = () => {
    setLang(lang === "ru" ? "ky" : "ru");
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleProfile = () => {
    navigate("/app/profile");
  };

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        {showLogo && (
          <Link to="/app" className={styles.logoLink}>
            <div className={styles.logo}>
              <img src="/assets/rob-logo.png" alt={t("app.logoAlt")} className={styles.logoImage} />
            </div>
          </Link>
        )}
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.headerActions}>
          {state.accessToken && <NotificationBell token={state.accessToken} />}
          <button
            className={styles.langBtn}
            onClick={toggleLang}
            aria-label={t("header.switchLanguage")}
            title={lang === "ru" ? t("lang.ky") : t("lang.ru")}
          >
            <span className={styles.langFlag}>{FLAGS[lang]}</span>
            <span className={styles.langCode}>{lang === "ru" ? t("lang.ru") : t("lang.ky")}</span>
          </button>
          <button
            className={styles.profileBtn}
            onClick={handleProfile}
            aria-label={t("header.profile")}
            title={t("header.profile")}
          >
            <User size={18} />
            <span className={styles.username}>{user?.username}</span>
          </button>
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
