import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { useI18n } from "../i18n/I18nProvider";
import type { I18nKey } from "../i18n/i18n";
import styles from "./AppShell.module.css";

type NavItem = { to: string; label?: string; labelKey?: I18nKey };

function NavLink({ to, label, active }: { to: string, label: string, active: boolean }) {
  return (
    <Link 
      to={to} 
      className={`${styles.navLink} ${active ? styles.active : ''}`} 
    >
      {label}
    </Link>
  );
}

export function AppShell(props: {
  title?: string;
  titleKey?: I18nKey;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const location = useLocation();
  const { t } = useI18n();

  const title = props.titleKey ? t(props.titleKey) : props.title ?? "";
  
  const isLinkActive = (to: string) => {
    // Exact match for roots
    if (to.endsWith('/admin') || to.endsWith('/manager') || to.endsWith('/teacher') || to.endsWith('/student')) {
       return location.pathname === to;
    }
    return location.pathname.startsWith(to);
  };

  return (
    <div className={styles.shell}>
      <Header title={title} />
      <nav className={styles.nav}>
          <div className={styles.navContainer}>
            {props.nav.map((item, idx) => (
              <NavLink
                key={item.to + idx}
                to={item.to}
                label={
                  item.labelKey
                    ? t(item.labelKey) || item.label || "Link"
                    : item.label || "Link"
                }
                active={isLinkActive(item.to)}
              />
            ))}
          </div>
      </nav>
      <main className={styles.content}>{props.children}</main>
    </div>
  );
}
