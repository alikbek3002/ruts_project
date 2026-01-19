import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { useI18n } from "../i18n/I18nProvider";
import type { I18nKey } from "../i18n/i18n";
import { ChevronDown, ChevronUp } from "lucide-react";
import styles from "./AppShell.module.css";

type NavItem = { to: string; label?: string; labelKey?: I18nKey };

function NavLink({ to, label, active, onClick }: { to: string, label: string, active: boolean, onClick?: () => void }) {
  return (
    <Link 
      to={to} 
      className={`${styles.navLink} ${active ? styles.active : ''}`} 
      onClick={onClick}
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
  const [isOpen, setIsOpen] = useState(false);

  const title = props.titleKey ? t(props.titleKey) : props.title ?? "";
  
  const isLinkActive = (to: string) => {
    // Exact match for roots
    if (to.endsWith('/admin') || to.endsWith('/manager') || to.endsWith('/teacher') || to.endsWith('/student')) {
       return location.pathname === to;
    }
    return location.pathname.startsWith(to);
  };

  const activeItem = props.nav.find(item => isLinkActive(item.to)) || props.nav[0];

  return (
    <div className={styles.shell}>
      <Header title={title} />
      <nav className={styles.nav}>
          <div className={styles.navContainer} style={{ flexDirection: "column", alignItems: "flex-start", height: "auto" }}>
            
            {/* Active Tab Toggle */}
            <div 
               className={`${styles.navLink} ${styles.active}`} 
               onClick={() => setIsOpen(!isOpen)}
               style={{ cursor: "pointer", display: "flex", gap: 8, paddingLeft: 0 }}
            >
                <span style={{ fontWeight: 600 }}>
                    {activeItem ? (activeItem.labelKey ? t(activeItem.labelKey) : activeItem.label) : "Menu"}
                </span>
                {isOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
             </div>

             {/* Other items */}
            {isOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", paddingLeft: 16 }}>
                    {props.nav.map((item, idx) => {
                        // Skip the active one
                        if (item.to === activeItem?.to) return null;

                        return (
                        <NavLink
                            key={item.to + idx}
                            to={item.to}
                            label={
                            item.labelKey
                                ? t(item.labelKey) || item.label || "Link"
                                : item.label || "Link"
                            }
                            active={false} // Since it's in the "others" list
                            onClick={() => setIsOpen(false)}
                        />
                        );
                    })}
                </div>
            )}
          </div>
      </nav>
      <main className={styles.content}>{props.children}</main>
    </div>
  );
}
