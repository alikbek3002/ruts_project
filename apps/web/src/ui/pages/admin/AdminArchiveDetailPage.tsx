import React, { useEffect, useState } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import {
    apiGetArchivedStreamDetails,
    apiGetArchivedStreamStudents,
    apiRestoreStream,
    type ArchivedStreamStats,
    type ArchivedStudentPerformance,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AdminStreams.module.css";
import { Archive, RefreshCw, RotateCcw, Users, TrendingUp, Award, CheckCircle, XCircle } from "lucide-react";

export function AdminArchiveDetailPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const { streamId } = useParams<{ streamId: string }>();
    const user = state.user;
    const token = state.accessToken;

    const [archive, setArchive] = useState<ArchivedStreamStats | null>(null);
    const [students, setStudents] = useState<ArchivedStudentPerformance[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [filterPassed, setFilterPassed] = useState<boolean | undefined>(undefined);
    const [searchQuery, setSearchQuery] = useState("");

    async function reload() {
        if (!token || !streamId) return;
        setLoading(true);
        setErr(null);
        try {
            const [archiveData, studentsData] = await Promise.all([
                apiGetArchivedStreamDetails(token, streamId),
                apiGetArchivedStreamStudents(token, streamId),
            ]);
            setArchive(archiveData);
            setStudents(studentsData || []);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }

    async function handleRestore() {
        if (!token || !streamId || !window.confirm("Восстановить этот поток из архива?")) return;
        setErr(null);
        try {
            await apiRestoreStream(token, streamId);
            alert("Поток успешно восстановлен!");
            window.location.href = base + "/streams";
        } catch (e) {
            setErr("Ошибка восстановления: " + String(e));
        }
    }

    useEffect(() => {
        if (token && streamId) reload();
    }, [token, streamId]);

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "admin" && user.role !== "manager" && user.role !== "teacher")
        return <Navigate to="/app" replace />;

    const base = user.role === "manager" ? "/app/manager" : user.role === "admin" ? "/app/admin" : "/app/teacher";
    const isAdmin = user.role === "admin";

    const filteredStudents = students.filter(s => {
        const matchesSearch = s.student_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.class_name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = filterPassed === undefined || s.passed_course === filterPassed;
        return matchesSearch && matchesFilter;
    });

    const passedCount = students.filter(s => s.passed_course).length;
    const failedCount = students.length - passedCount;

    return (
        <AppShell titleKey="Архив потока" nav={getAdminNavItems(base)}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Archive size={18} />
                        {archive?.stream_name || "Загрузка..."}
                    </h2>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Link to={`${base}/archive`} className={styles.btn}>
                            ← Назад к списку
                        </Link>
                        <button onClick={reload} disabled={loading} className={styles.btn}>
                            <RefreshCw size={16} /> Обновить
                        </button>
                        {isAdmin && (
                            <button onClick={handleRestore} className={styles.btn}>
                                <RotateCcw size={16} /> Восстановить
                            </button>
                        )}
                    </div>
                </div>

                {err && <div className={styles.error}>{err}</div>}

                {archive && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>Период</div>
                            <div style={{ fontWeight: 700, marginTop: 4 }}>
                                {archive.start_date} → {archive.end_date}
                            </div>
                        </div>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>
                                <Users size={14} style={{ display: "inline", marginRight: 4 }} />
                                Студенты
                            </div>
                            <div style={{ fontWeight: 700, marginTop: 4 }}>
                                {archive.total_students} чел. в {archive.total_classes} группах
                            </div>
                        </div>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>
                                <TrendingUp size={14} style={{ display: "inline", marginRight: 4 }} />
                                Посещаемость
                            </div>
                            <div style={{ fontWeight: 700, marginTop: 4 }}>
                                {archive.avg_attendance_percentage?.toFixed(1) || "—"}%
                            </div>
                        </div>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>
                                <Award size={14} style={{ display: "inline", marginRight: 4 }} />
                                Средний балл
                            </div>
                            <div style={{ fontWeight: 700, marginTop: 4 }}>
                                {archive.avg_lesson_grade?.toFixed(2) || "—"}
                            </div>
                        </div>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>
                                <CheckCircle size={14} style={{ display: "inline", marginRight: 4, color: "#10b981" }} />
                                Сдали курс
                            </div>
                            <div style={{ fontWeight: 700, marginTop: 4, color: "#10b981" }}>
                                {passedCount} ({((passedCount / students.length) * 100).toFixed(0)}%)
                            </div>
                        </div>
                        <div className={styles.section}>
                            <div style={{ fontSize: 13, opacity: 0.7 }}>
                                <XCircle size={14} style={{ display: "inline", marginRight: 4, color: "#ef4444" }} />
                                Не сдали
                            </div>
                            <div style={{ fontWeight: 700, marginTop: 4, color: "#ef4444" }}>
                                {failedCount} ({((failedCount / students.length) * 100).toFixed(0)}%)
                            </div>
                        </div>
                    </div>
                )}

                <div className={styles.section} style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <h3 style={{ margin: 0 }}>Студенты ({filteredStudents.length})</h3>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                type="text"
                                placeholder="Поиск..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }}
                            />
                            <select
                                value={filterPassed === undefined ? "all" : filterPassed ? "passed" : "failed"}
                                onChange={(e) => setFilterPassed(e.target.value === "all" ? undefined : e.target.value === "passed")}
                                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }}
                            >
                                <option value="all">Все</option>
                                <option value="passed">Сдали</option>
                                <option value="failed">Не сдали</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                                    <th style={{ padding: 8, textAlign: "left" }}>ФИО</th>
                                    <th style={{ padding: 8, textAlign: "left" }}>Группа</th>
                                    <th style={{ padding: 8, textAlign: "right" }}>Посещ.</th>
                                    <th style={{ padding: 8, textAlign: "right" }}>Ср. балл</th>
                                    <th style={{ padding: 8, textAlign: "right" }}>Тесты</th>
                                    <th style={{ padding: 8, textAlign: "center" }}>Статус</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((student) => (
                                    <tr key={student.student_id} style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                                        <td style={{ padding: 8 }}>{student.student_name}</td>
                                        <td style={{ padding: 8 }}>{student.class_name}</td>
                                        <td style={{ padding: 8, textAlign: "right" }}>
                                            {student.attendance_percentage?.toFixed(1) || "—"}%
                                        </td>
                                        <td style={{ padding: 8, textAlign: "right" }}>
                                            {student.avg_lesson_grade?.toFixed(2) || "—"}
                                        </td>
                                        <td style={{ padding: 8, textAlign: "right" }}>
                                            {student.avg_test_score?.toFixed(1) || "—"}%
                                        </td>
                                        <td style={{ padding: 8, textAlign: "center" }}>
                                            {student.passed_course ? (
                                                <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Сдал</span>
                                            ) : (
                                                <span style={{ color: "#ef4444", fontWeight: 600 }}>✗ Не сдал</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </AppShell>
    );
}
