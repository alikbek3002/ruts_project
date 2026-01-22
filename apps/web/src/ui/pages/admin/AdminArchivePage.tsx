import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
    apiGetArchivedStreams,
    type ArchivedStreamStats,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminStreams.module.css";
import { Archive, RefreshCw, TrendingUp, Users, Calendar } from "lucide-react";

export function AdminArchivePage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const user = state.user;
    const token = state.accessToken;

    const [archives, setArchives] = useState<ArchivedStreamStats[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function reload() {
        if (!token) return;
        setLoading(true);
        setErr(null);
        try {
            const data = await apiGetArchivedStreams(token);
            setArchives(data || []);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (token) reload();
    }, [token]);

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "admin" && user.role !== "manager" && user.role !== "teacher")
        return <Navigate to="/app" replace />;

    const base = user.role === "manager" ? "/app/manager" : user.role === "admin" ? "/app/admin" : "/app/teacher";

    return (
        <AppShell
            titleKey="Архив потоков"
            nav={getAdminNavItems(base)}
        >
            <div className={styles.container}>
                <div className={styles.header}>
                    <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Archive size={18} /> Архив потоков
                    </h2>
                    <button onClick={reload} disabled={loading} className={styles.btn}>
                        <RefreshCw size={16} /> {t("common.refresh") || "Обновить"}
                    </button>
                </div>

                {err && <div className={styles.error}>{err}</div>}

                {archives.length === 0 ? (
                    <div className={styles.empty}>Архивированных потоков пока нет</div>
                ) : (
                    <div className={styles.list}>
                        {archives.map((archive) => (
                            <Link
                                key={archive.stream_id}
                                to={`${base}/archive/${archive.stream_id}`}
                                className={styles.card}
                            >
                                <div className={styles.cardTitle}>{archive.stream_name}</div>
                                <div className={styles.cardMeta} style={{ marginBottom: 8 }}>
                                    <Calendar size={12} style={{ display: "inline", marginRight: 4 }} />
                                    {archive.start_date} → {archive.end_date}
                                </div>
                                <div className={styles.cardMeta} style={{ marginBottom: 4 }}>
                                    <Users size={12} style={{ display: "inline", marginRight: 4 }} />
                                    Групп: {archive.total_classes} • Студентов: {archive.total_students}
                                </div>
                                <div className={styles.cardMeta}>
                                    <TrendingUp size={12} style={{ display: "inline", marginRight: 4 }} />
                                    Посещаемость: {archive.avg_attendance_percentage?.toFixed(1) || "—"}% •
                                    Средний балл: {archive.avg_lesson_grade?.toFixed(2) || "—"}
                                </div>
                                {archive.archived_at && (
                                    <div className={styles.cardMeta} style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>
                                        Архивирован: {new Date(archive.archived_at).toLocaleDateString("ru-RU")}
                                    </div>
                                )}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </AppShell>
    );
}
