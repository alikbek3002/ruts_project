import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Header } from "./Header";
import styles from "./AppShell.module.css";

export function AppShell(props: {
  title: string;
  nav: Array<{ to: string; label: string }>;
  children: React.ReactNode;
}) {
  const location = useLocation();
  
  return (
    <div className={styles.shell}>
      <Header title={props.title} />
      <nav className={styles.nav}>
        <div className={styles.navContainer}>
          {props.nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`${styles.navLink} ${location.pathname === n.to ? styles.active : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
      <main className={styles.content}>{props.children}</main>
    </div>
  );
}
