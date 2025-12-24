import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { useAuth } from "../auth/AuthProvider";
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
  const { logout, user } = useAuth();
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
              <img src="/assets/rob-logo.png" alt="РОБ" className={styles.logoImage} />
            </div>
          </Link>
        )}
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.headerActions}>
          <button
            className={styles.langBtn}
            onClick={toggleLang}
            aria-label="Switch language"
            title={lang === "ru" ? "Кыргызча" : "Русский"}
          >
            <span className={styles.langFlag}>{FLAGS[lang]}</span>
            <span className={styles.langCode}>{lang.toUpperCase()}</span>
          </button>
          <button
            className={styles.langBtn}
            onClick={handleProfile}
            title="Profile"
          >
            👤 {user?.username || "Profile"}
          </button>
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
            title={t("nav.logout")}
          >
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
