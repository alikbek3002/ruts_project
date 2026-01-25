import React, { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Plus, Trash2, Video, Users } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import {
    apiListMeetingLinks,
    apiCreateMeetingLink,
    apiDeleteMeetingLink,
    apiListTeacherClasses,
    MeetingLink
} from "../../../api/client";
import { Loader } from "../../components/Loader";
import styles from "./TeacherConferences.module.css";

export function TeacherConferencesPage() {
    const { state } = useAuth();
    const user = state.user;
    const token = state.accessToken;

    const [links, setLinks] = useState<MeetingLink[]>([]);
    const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form
    const [title, setTitle] = useState("");
    const [meetUrl, setMeetUrl] = useState("");
    const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!token) return;
        loadData();
    }, [token]);

    async function loadData() {
        setLoading(true);
        try {
            const [linksResp, classesResp] = await Promise.all([
                apiListMeetingLinks(token!),
                apiListTeacherClasses(token!)
            ]);
            setLinks(linksResp.links || []);
            setClasses(classesResp.classes || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;
        setSubmitting(true);
        try {
            await apiCreateMeetingLink(token, {
                meet_url: meetUrl,
                title: title,
                class_ids: selectedClassIds
            });
            setIsModalOpen(false);
            setTitle("");
            setMeetUrl("");
            setSelectedClassIds([]);
            loadData(); // Reload list
        } catch (e) {
            alert("Ошибка при создании: " + String(e));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Удалить конференцию?")) return;
        if (!token) return;
        try {
            await apiDeleteMeetingLink(token, id);
            setLinks(links.filter(l => l.id !== id));
        } catch (e) {
            alert("Ошибка удаления: " + String(e));
        }
    }

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "teacher") return <Navigate to="/app" replace />;

    const nav: any = [
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
        { to: "/app/teacher/conferences", label: "Конференции" },
    ];

    return (
        <AppShell title="Конференции" nav={nav}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Конференции</h1>
                    <button className={`${styles.btn} ${styles.primary}`} onClick={() => setIsModalOpen(true)}>
                        <Plus size={20} style={{ marginRight: 8, verticalAlign: 'bottom' }} />
                        Создать конференцию
                    </button>
                </div>

                {loading ? (
                    <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
                        <Loader />
                    </div>
                ) : (
                    <div className={styles.grid}>
                        {links.length === 0 ? (
                            <div className={styles.emptyState}>
                                Нет активных конференций. Создайте новую.
                            </div>
                        ) : (
                            links.map(link => (
                                <div key={link.id} className={styles.card}>
                                    <div className={styles.cardHeader}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Video size={20} color="#2563eb" />
                                            <h3 className={styles.cardTitle}>{link.title || "Конференция"}</h3>
                                        </div>
                                        <button className={styles.deleteBtn} onClick={() => handleDelete(link.id)}>
                                            <Trash2 size={18} />
                                        </button>
                                    </div>

                                    <a href={link.meet_url} target="_blank" rel="noreferrer" className={styles.cardLink}>
                                        {link.meet_url}
                                    </a>

                                    <div className={styles.cardAudience}>
                                        <Users size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                        {link.audience_names?.join(", ") || link.class_name || "Все"}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {isModalOpen && (
                    <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
                        <div className={styles.modal} onClick={e => e.stopPropagation()}>
                            <h2 style={{ marginTop: 0 }}>Новая конференция</h2>
                            <form onSubmit={handleCreate}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Название</label>
                                    <input
                                        className={styles.input}
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        placeholder="Например: Консультация"
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Ссылка на конференцию</label>
                                    <input
                                        className={styles.input}
                                        value={meetUrl}
                                        onChange={e => setMeetUrl(e.target.value)}
                                        placeholder="https://meet.google.com/..."
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Выберите группы (Ctrl+Click для выбора нескольких)</label>
                                    <select
                                        multiple
                                        className={styles.select}
                                        value={selectedClassIds}
                                        onChange={e => {
                                            const selected = Array.from(e.target.selectedOptions, option => option.value);
                                            setSelectedClassIds(selected);
                                        }}
                                    >
                                        {classes.map(cls => (
                                            <option key={cls.id} value={cls.id}>{cls.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className={styles.footer}>
                                    <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => setIsModalOpen(false)}>
                                        Отмена
                                    </button>
                                    <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={submitting}>
                                        {submitting ? "Создание..." : "Создать"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </AppShell>
    );
}
