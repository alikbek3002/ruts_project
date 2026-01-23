import React, { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { apiGetArchivedTeachers, apiRestoreTeacher, type ArchivedItem } from "../../../api/client";
import { RefreshCw, RotateCcw } from "lucide-react";
import styles from "./AdminArchive.module.css";

export function AdminArchiveTeachersPage() {
    const { state } = useAuth();
    const token = state.accessToken;

    const [items, setItems] = useState<ArchivedItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const data = await apiGetArchivedTeachers(token);
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
        if (!confirm(`Восстановить учителя "${name}"?`)) return;
        if (!token) return;
        try {
            await apiRestoreTeacher(token, id);
            reload();
        } catch (e) {
            alert("Ошибка восстановления: " + e);
        }
    };

    return (
        <div className={styles.tabContent}>
            <div className={styles.header}>
                <h3>Архив учителей</h3>
                <button onClick={reload} disabled={loading} className={styles.btn}>
                    <RefreshCw size={16} /> Обновить
                </button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {items.length === 0 && !loading && (
                <div className={styles.empty}>Нет архивных учителей</div>
            )}

            <div className={styles.list}>
                {items.map(item => (
                    <div key={item.id} className={styles.card}>
                        <div className={styles.cardTitle}>{item.name}</div>
                        {item.metadata?.email && (
                            <div className={styles.cardSubtitle}>{item.metadata.email}</div>
                        )}
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
