import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { useI18n } from "../i18n/I18nProvider";
import type { I18nKey } from "../i18n/i18n";
import styles from "./AppShell.module.css";

type NavItem = { to: string; label?: string; labelKey?: I18nKey };

export function AppShell(props: {
  title?: string;
  titleKey?: I18nKey;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const location = useLocation();
  const { t } = useI18n();

  const title = props.titleKey ? t(props.titleKey) : props.title ?? "";
  
  return (
    <div className={styles.shell}>
      <Header title={title} />
      <nav className={styles.nav}>
        <div className={styles.navContainer}>
          {props.nav.map((n) => {
            const isActive =
              location.pathname === n.to ||
              (n.to !== "/" && location.pathname.startsWith(n.to.endsWith("/") ? n.to : `${n.to}/`));

            return (
              <Link key={n.to} to={n.to} className={`${styles.navLink} ${isActive ? styles.active : ""}`}>
                {n.labelKey ? t(n.labelKey) : n.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className={styles.content}>{props.children}</main>
    </div>
  );
}
