import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGetArchivedStreams, type ArchivedStreamStats } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminStreams.module.css";
import { Archive, RefreshCw, TrendingUp, Users, Calendar } from "lucide-react";

export function AdminArchiveStreamsPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const token = state.accessToken;
    const base = state.user?.role === "manager" ? "/app/manager" : state.user?.role === "admin" ? "/app/admin" : "/app/teacher";

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

    return (
        <div>
            <div className={styles.header}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    Архив потоков
                </h3>
                <button onClick={reload} disabled={loading} className={styles.btn}>
                    <RefreshCw size={16} /> Обновить
                </button>
            </div>

            {err && <div className={styles.error}>{err}</div>}

            {archives.length === 0 && !loading && (
                <div className={styles.empty}>Архивированных потоков пока нет</div>
            )}

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
        </div>
    );
}
