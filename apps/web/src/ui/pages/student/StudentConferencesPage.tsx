import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Video } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { useI18n } from "../../i18n/I18nProvider";
import {
    apiListAllClasses,
    apiListMeetingLinks,
    MeetingLink
} from "../../../api/client";
import { Loader } from "../../components/Loader";
import styles from "./StudentConferences.module.css";

export function StudentConferencesPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const user = state.user;
    const token = state.accessToken;

    const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
    const [selectedClassId, setSelectedClassId] = useState<string>("");
    const [links, setLinks] = useState<MeetingLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);

    // Load classes
    useEffect(() => {
        if (!token) return;
        apiListAllClasses(token)
            .then(resp => {
                setClasses(resp.classes || []);
                // Try to recover selected class from localStorage
                const saved = localStorage.getItem("ruts_student_class_id");
                if (saved && resp.classes.some(c => c.id === saved)) {
                    setSelectedClassId(saved);
                }
            })
            .catch(console.error)
            .finally(() => setInitialLoading(false));
    }, [token]);

    // Load links when class selected
    useEffect(() => {
        if (!token || !selectedClassId) {
            setLinks([]);
            return;
        }

        setLoading(true);
        localStorage.setItem("ruts_student_class_id", selectedClassId);

        apiListMeetingLinks(token, { classId: selectedClassId })
            .then(resp => setLinks(resp.links || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [token, selectedClassId]);

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "student") return <Navigate to="/app" replace />;

    const nav: any = [
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
        { to: "/app/student/conferences", label: "Конференции" },
    ];

    return (
        <AppShell title="Конференции" nav={nav}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.controls}>
                        <label className={styles.label}>Выберите вашу группу:</label>
                        <select
                            className={styles.select}
                            value={selectedClassId}
                            onChange={e => setSelectedClassId(e.target.value)}
                            disabled={initialLoading}
                        >
                            <option value="">-- Не выбрано --</option>
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {initialLoading ? (
                    <div className={styles.loading}><Loader /></div>
                ) : !selectedClassId ? (
                    <div className={styles.emptyState}>
                        Пожалуйста, выберите свою группу из списка выше, чтобы увидеть доступные конференции.
                    </div>
                ) : loading ? (
                    <div className={styles.loading}><Loader /></div>
                ) : links.length === 0 ? (
                    <div className={styles.emptyState}>
                        Нет конференций для этой группы.
                    </div>
                ) : (
                    <div className={styles.grid}>
                        {links.map(link => (
                            <div key={link.id} className={styles.card}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <Video size={20} color="#2563eb" />
                                    <h3 className={styles.cardTitle}>{link.title || "Конференция"}</h3>
                                </div>
                                <a href={link.meet_url} target="_blank" rel="noreferrer" className={styles.cardLink}>
                                    {link.meet_url}
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AppShell>
    );
}
