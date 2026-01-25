import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import { useI18n } from "../../i18n/I18nProvider";
import {
    apiListCycles,
    apiGetCycleDetail,
    apiListSubjectsWithTeachers,
    apiAssignSubjectToCycle,
    apiAddTeacherToCycle,
    apiRemoveTeacherFromCycle,
    type Cycle,
    type SubjectWithTeachers,
} from "../../../api/client";
import styles from "./AdminCycles.module.css";
import { BookOpen, Users, Plus, X, Trash2 } from "lucide-react";

type Teacher = { id: string; name: string; photo_url?: string | null };
type CycleSubject = { id: string; name: string; photo_url?: string | null };

export function AdminCyclesPage() {
    const { state } = useAuth();
    const { t } = useI18n();
    const user = state.user;
    const token = state.accessToken;

    const [cycles, setCycles] = useState<Cycle[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Modal state
    const [selectedCycle, setSelectedCycle] = useState<Cycle | null>(null);
    const [cycleSubjects, setCycleSubjects] = useState<CycleSubject[]>([]);
    const [cycleTeachers, setCycleTeachers] = useState<Teacher[]>([]);
    const [modalLoading, setModalLoading] = useState(false);

    // Add subject/teacher state
    const [allSubjects, setAllSubjects] = useState<SubjectWithTeachers[]>([]);
    const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
    const [selectedSubjectId, setSelectedSubjectId] = useState("");
    const [selectedTeacherId, setSelectedTeacherId] = useState("");

    async function loadCycles() {
        if (!token) return;
        setLoading(true);
        setErr(null);
        try {
            const resp = await apiListCycles(token);
            setCycles(resp.cycles || []);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }

    async function loadCycleDetail(cycleId: string) {
        if (!token) return;
        setModalLoading(true);
        try {
            const resp = await apiGetCycleDetail(token, cycleId);
            setCycleSubjects(resp.subjects || []);
            setCycleTeachers(resp.teachers || []);
        } catch (e) {
            setErr(String(e));
        } finally {
            setModalLoading(false);
        }
    }

    async function loadAllSubjectsAndTeachers() {
        if (!token) return;
        try {
            const subjectsResp = await apiListSubjectsWithTeachers(token);
            setAllSubjects(subjectsResp.subjects || []);

            // Extract unique teachers
            const teachersMap = new Map<string, Teacher>();
            for (const s of subjectsResp.subjects || []) {
                for (const t of s.teachers || []) {
                    if (!teachersMap.has(t.id)) {
                        teachersMap.set(t.id, { id: t.id, name: t.name });
                    }
                }
            }
            setAllTeachers(Array.from(teachersMap.values()));
        } catch (e) {
            console.error("Failed to load subjects/teachers:", e);
        }
    }

    useEffect(() => {
        loadCycles();
        loadAllSubjectsAndTeachers();
    }, [token]);

    useEffect(() => {
        if (selectedCycle) {
            loadCycleDetail(selectedCycle.id);
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [selectedCycle]);

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

    const base = user.role === "manager" ? "/app/manager" : "/app/admin";

    const handleAddSubject = async () => {
        if (!token || !selectedCycle || !selectedSubjectId) return;
        setModalLoading(true);
        try {
            await apiAssignSubjectToCycle(token, selectedSubjectId, selectedCycle.id);
            await loadCycleDetail(selectedCycle.id);
            setSelectedSubjectId("");
        } catch (e) {
            setErr(String(e));
        } finally {
            setModalLoading(false);
        }
    };

    const handleRemoveSubject = async (subjectId: string) => {
        if (!token || !selectedCycle) return;
        if (!window.confirm("Убрать предмет из цикла?")) return;
        setModalLoading(true);
        try {
            await apiAssignSubjectToCycle(token, subjectId, null);
            await loadCycleDetail(selectedCycle.id);
        } catch (e) {
            setErr(String(e));
        } finally {
            setModalLoading(false);
        }
    };

    const handleAddTeacher = async () => {
        if (!token || !selectedCycle || !selectedTeacherId) return;
        setModalLoading(true);
        try {
            await apiAddTeacherToCycle(token, selectedCycle.id, selectedTeacherId);
            await loadCycleDetail(selectedCycle.id);
            setSelectedTeacherId("");
        } catch (e) {
            setErr(String(e));
        } finally {
            setModalLoading(false);
        }
    };

    const handleRemoveTeacher = async (teacherId: string) => {
        if (!token || !selectedCycle) return;
        if (!window.confirm("Убрать учителя из цикла?")) return;
        setModalLoading(true);
        try {
            await apiRemoveTeacherFromCycle(token, selectedCycle.id, teacherId);
            await loadCycleDetail(selectedCycle.id);
        } catch (e) {
            setErr(String(e));
        } finally {
            setModalLoading(false);
        }
    };

    // Filter available items
    const availableSubjects = allSubjects.filter(
        (s) => !cycleSubjects.some((cs) => cs.id === s.id)
    );
    const availableTeachers = allTeachers.filter(
        (t) => !cycleTeachers.some((ct) => ct.id === t.id)
    );

    const getCycleIcon = (code: string) => {
        switch (code) {
            case "A": return "А";
            case "BFP": return "БФП";
            case "U": return "У";
            case "ZUT": return "ЖУТ";
            default: return code;
        }
    };

    return (
        <AppShell
            titleKey="nav.cycles"
            nav={getAdminNavItems(base)}
        >
            <div className={styles.container}>
                <div className={styles.header}>
                    <h2>{t("nav.cycles")}</h2>
                </div>

                {err && <div className={styles.error}>{err}</div>}
                {loading && <Loader text="Загрузка..." />}

                <div className={styles.cyclesGrid}>
                    {cycles.map((cycle) => (
                        <div
                            key={cycle.id}
                            className={`${styles.cycleCard} ${styles[cycle.code]}`}
                            onClick={() => setSelectedCycle(cycle)}
                        >
                            <div className={styles.cycleIcon}>
                                {getCycleIcon(cycle.code)}
                            </div>
                            <div className={styles.cycleName}>{cycle.name}</div>
                            <div className={styles.cycleDescription}>
                                {cycle.description || "Нажмите для управления"}
                            </div>
                            <div className={styles.cycleStats}>
                                <span className={styles.stat}>
                                    <BookOpen size={16} /> Предметы
                                </span>
                                <span className={styles.stat}>
                                    <Users size={16} /> Учителя
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {!loading && cycles.length === 0 && (
                    <div className={styles.emptyText}>
                        Циклы не найдены. Выполните миграцию базы данных.
                    </div>
                )}
            </div>

            {/* Modal */}
            {selectedCycle && (
                <div className={styles.modalOverlay} onClick={() => setSelectedCycle(null)}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3>{selectedCycle.name}</h3>
                            <button className={styles.closeBtn} onClick={() => setSelectedCycle(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className={styles.modalContent}>
                            {modalLoading && <Loader text="Загрузка..." />}

                            {/* Subjects Section */}
                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>
                                    <BookOpen size={18} /> Предметы в цикле
                                </div>
                                <div className={styles.itemsList}>
                                    {cycleSubjects.length === 0 ? (
                                        <div className={styles.emptyText}>Предметы не назначены</div>
                                    ) : (
                                        cycleSubjects.map((s) => (
                                            <div key={s.id} className={styles.itemRow}>
                                                <img
                                                    src={s.photo_url || "/favicon.svg"}
                                                    alt=""
                                                    className={styles.itemPhoto}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = "/favicon.svg";
                                                    }}
                                                />
                                                <span className={styles.itemName}>{s.name}</span>
                                                <button
                                                    className={styles.removeBtn}
                                                    onClick={() => handleRemoveSubject(s.id)}
                                                    title="Убрать"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className={styles.addRow}>
                                    <select
                                        value={selectedSubjectId}
                                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                                    >
                                        <option value="">Выберите предмет...</option>
                                        {availableSubjects.map((s) => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        className={styles.addBtn}
                                        onClick={handleAddSubject}
                                        disabled={!selectedSubjectId || modalLoading}
                                    >
                                        <Plus size={16} /> Добавить
                                    </button>
                                </div>
                            </div>

                            {/* Teachers Section */}
                            <div className={styles.section}>
                                <div className={styles.sectionTitle}>
                                    <Users size={18} /> Учителя в цикле
                                </div>
                                <div className={styles.itemsList}>
                                    {cycleTeachers.length === 0 ? (
                                        <div className={styles.emptyText}>Учителя не назначены</div>
                                    ) : (
                                        cycleTeachers.map((t) => (
                                            <div key={t.id} className={styles.itemRow}>
                                                {t.photo_url ? (
                                                    <img
                                                        src={t.photo_url}
                                                        alt=""
                                                        className={styles.itemPhoto}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = "none";
                                                        }}
                                                    />
                                                ) : (
                                                    <div className={styles.itemPhoto} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        <Users size={18} />
                                                    </div>
                                                )}
                                                <span className={styles.itemName}>{t.name}</span>
                                                <button
                                                    className={styles.removeBtn}
                                                    onClick={() => handleRemoveTeacher(t.id)}
                                                    title="Убрать"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className={styles.addRow}>
                                    <select
                                        value={selectedTeacherId}
                                        onChange={(e) => setSelectedTeacherId(e.target.value)}
                                    >
                                        <option value="">Выберите учителя...</option>
                                        {availableTeachers.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        className={styles.addBtn}
                                        onClick={handleAddTeacher}
                                        disabled={!selectedTeacherId || modalLoading}
                                    >
                                        <Plus size={16} /> Добавить
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </AppShell>
    );
}
