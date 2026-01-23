import React, { useEffect, useState } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import { apiGetClass } from "../../../api/client";

import styles from "./AdminClassJournal.module.css";
import { Users, TrendingUp, Book } from "lucide-react";

interface Student {
    id: string;
    full_name: string;
    student_number: number;
}

export function AdminArchiveClassDetailPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const { classId } = useParams<{ classId: string }>();
    const user = state.user;
    const token = state.accessToken;
    const base = state.user?.role === "manager" ? "/app/manager" : "/app/admin";

    const [classData, setClassData] = useState<any>(null);
    const [students, setStudents] = useState<Student[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!token || !classId) return;
        setLoading(true);
        apiGetClass(token, classId)
            .then(data => {
                setClassData(data.class);
                // Cast to any because API returns mixed types sometimes or unexported internal types
                setStudents(data.students as any[] || []);
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, [token, classId]);

    if (!user) return <Navigate to="/login" replace />;

    return (
        <AppShell titleKey={"Архив группы" as any} nav={getAdminNavItems(base)}>
            <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <h2 style={{ display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
                        <Users size={24} />
                        {loading ? "Загрузка..." : classData ? `Архив: ${classData.name}` : "Группа не найдена"}
                    </h2>
                    <Link to={`${base}/archive`} className="btn">
                        ← Вернуться в архив
                    </Link>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {classData && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                        <div style={{ background: "white", padding: 20, borderRadius: 8, border: "1px solid #eee" }}>
                            <h3 style={{ marginTop: 0 }}>Информация</h3>
                            <div style={{ marginBottom: 8, color: "#666" }}>
                                Направление: <b>{classData.direction_id || "—"}</b>
                            </div>
                            <div style={{ marginBottom: 8, color: "#666" }}>
                                Куратор ID: <b>{classData.curator_id || "—"}</b>
                            </div>
                            {classData.archived_at && (
                                <div style={{ marginBottom: 8, color: "#d32f2f" }}>
                                    Дата архивации: <b>{new Date(classData.archived_at).toLocaleDateString()}</b>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ background: "white", padding: 20, borderRadius: 8, border: "1px solid #eee" }}>
                    <h3 style={{ marginTop: 0 }}>Студенты ({students.length})</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                                <th style={{ padding: 10 }}>№</th>
                                <th style={{ padding: 10 }}>ФИО</th>
                                <th style={{ padding: 10 }}>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map((s, idx) => (
                                <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                                    <td style={{ padding: 10 }}>{s.student_number || idx + 1}</td>
                                    <td style={{ padding: 10 }}>{s.full_name}</td>
                                    <td style={{ padding: 10 }}>
                                        <span style={{ color: "#999", fontSize: 12 }}>Оценки (скоро)</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </AppShell>
    );
}
