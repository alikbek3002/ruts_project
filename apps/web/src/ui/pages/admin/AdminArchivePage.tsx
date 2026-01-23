import React, { useState } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminArchive.module.css";
import { Archive, Layers, Users, Book, GraduationCap } from "lucide-react";

import { AdminArchiveStreamsPage } from "./AdminArchiveStreamsPage"; // Need to rename old page or use inline
import { AdminArchiveSubjectsPage } from "./AdminArchiveSubjectsPage";
import { AdminArchiveTeachersPage } from "./AdminArchiveTeachersPage";
import { AdminArchiveClassesPage } from "./AdminArchiveClassesPage";

// We will inline the old Streams logic into a component or file. 
// For now, let's assume we refactor the old content into AdminArchiveStreamsPage.tsx

export function AdminArchivePage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const user = state.user;
    const location = useLocation();

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "admin" && user.role !== "manager" && user.role !== "teacher")
        return <Navigate to="/app" replace />;

    const base = user.role === "manager" ? "/app/manager" : user.role === "admin" ? "/app/admin" : "/app/teacher";

    // Simple state for tabs if not using sub-routes yet, or use query param?
    // Let's use simple state for now to avoid creating 4 new routes in router configuration unless necessary.
    // Ideally we should use sub-routes: /admin/archive/streams, /admin/archive/groups etc.
    // But since I cannot edit App.tsx easily to add nested routes without seeing it, I'll use state switching here.

    const [activeTab, setActiveTab] = useState<"streams" | "classes" | "subjects" | "teachers">("streams");

    return (
        <AppShell
            titleKey={"Архив" as any}
            nav={getAdminNavItems(base)}
        >
            <div className={styles.container}>
                <div className={styles.tabs}>
                    <div
                        className={activeTab === "streams" ? styles.tabActive : styles.tab}
                        onClick={() => setActiveTab("streams")}
                    >
                        <Layers size={16} style={{ display: "inline", marginRight: 6, verticalAlign: "text-bottom" }} />
                        Потоки
                    </div>
                    <div
                        className={activeTab === "classes" ? styles.tabActive : styles.tab}
                        onClick={() => setActiveTab("classes")}
                    >
                        <Users size={16} style={{ display: "inline", marginRight: 6, verticalAlign: "text-bottom" }} />
                        Группы (Взводы)
                    </div>
                    <div
                        className={activeTab === "subjects" ? styles.tabActive : styles.tab}
                        onClick={() => setActiveTab("subjects")}
                    >
                        <Book size={16} style={{ display: "inline", marginRight: 6, verticalAlign: "text-bottom" }} />
                        Предметы
                    </div>
                    <div
                        className={activeTab === "teachers" ? activeTab === "teachers" ? styles.tabActive : styles.tab : styles.tab}
                        onClick={() => setActiveTab("teachers")}
                    >
                        <GraduationCap size={16} style={{ display: "inline", marginRight: 6, verticalAlign: "text-bottom" }} />
                        Учителя
                    </div>
                </div>

                {activeTab === "streams" && <AdminArchiveStreamsPage />}
                {activeTab === "classes" && <AdminArchiveClassesPage />}
                {activeTab === "subjects" && <AdminArchiveSubjectsPage />}
                {activeTab === "teachers" && <AdminArchiveTeachersPage />}

            </div>
        </AppShell>
    );
}
