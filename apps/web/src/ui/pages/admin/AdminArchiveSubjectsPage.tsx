import React, { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import { apiGetArchivedSubjects, apiRestoreSubject, type ArchivedItem } from "../../../api/client";
import { Archive, RefreshCw, RotateCcw } from "lucide-react";
import styles from "./AdminArchive.module.css";
import { Link } from "react-router-dom";

export function AdminArchiveSubjectsPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const token = state.accessToken;
    const base = state.user?.role === "manager" ? "/app/manager" : "/app/admin";

    const [items, setItems] = useState<ArchivedItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const data = await apiGetArchivedSubjects(token);
            setItems(data);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        reload();
    }, [token]);

    const handleRestore = async (id: string, name: string) => {
        if (!confirm(`Восстановить предмет "${name}"?`)) return;
        if (!token) return;
        try {
            await apiRestoreSubject(token, id);
            reload();
        } catch (e) {
            alert("Ошибка восстановления: " + e);
        }
    };

    return (
        <div className={styles.tabContent}>
            <div className={styles.header}>
                <h3>Архив предметов</h3>
                <button onClick={reload} disabled={loading} className={styles.btn}>
                    <RefreshCw size={16} /> Обновить
                </button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {items.length === 0 && !loading && (
                <div className={styles.empty}>Нет архивных предметов</div>
            )}

            <div className={styles.list}>
                {items.map(item => (
                    <div key={item.id} className={styles.card}>
                        <div className={styles.cardTitle}>{item.name}</div>
                        <div className={styles.cardMeta}>
                            Архивирован: {new Date(item.archived_at).toLocaleDateString()}
                        </div>
                        <div className={styles.actions}>
                            <button onClick={() => handleRestore(item.id, item.name)} className={styles.actionBtn}>
                                <RotateCcw size={14} /> Восстановить
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
