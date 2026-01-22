import React, { useState, useMemo, useEffect } from "react";
import {
    X,
    Plus,
    Trash2,
    Save,
    FileText,
    Paperclip,
    FlaskConical,
    Link as LinkIcon,
    HelpCircle,
    FileDown
} from "lucide-react";
import styles from "../AdminSubjects.module.css";
import { Loader } from "../../../components/Loader";
import {
    type SubjectWithTeachers,
    type SubjectTopic,
    type SubjectTopicInput,
    type SubjectContentMaterial,
    type SubjectContentTest,
    type SubjectTestQuestion,
    type SubjectTestQuestionOption,
    apiGetSubjectTopics,
    apiTeacherGetSubject,
    apiUpdateSubjectTopic,
    apiCreateSubjectTopic,
    apiDeleteSubjectTopic,
    apiSubjectContentUploadFile,
    apiSubjectContentCreateLink,
    apiSubjectContentDeleteMaterial,
    apiSubjectContentCreateQuiz,
    apiSubjectContentCreateDocumentTest,
    apiSubjectContentDeleteTest,
    apiSubjectContentCreateQuestion,
    apiSubjectContentCreateOption,
    apiSubjectContentDeleteQuestion,
    apiSubjectContentDeleteOption,
    apiSubjectListQuestions,
    getSubjectTopicsExportUrl,
} from "../../../../api/client";
import { TopicMaterialsModal } from "./TopicMaterialsModal";

type Props = {
    subject: SubjectWithTeachers;
    token: string;
    isTeacher: boolean;
    onClose: () => void;
};

type ExtendedSubjectTopic = SubjectTopic & {
    materials?: SubjectContentMaterial[];
    tests?: SubjectContentTest[];
};

export const SubjectTopicsModal: React.FC<Props> = ({ subject, token, isTeacher, onClose }) => {
    const [topics, setTopics] = useState<ExtendedSubjectTopic[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Totals
    const [totals, setTotals] = useState({
        lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0
    });

    // Editing logic
    const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
    const [editingTopic, setEditingTopic] = useState<SubjectTopicInput | null>(null);

    // Adding new logic
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newTopic, setNewTopic] = useState<SubjectTopicInput>({
        topic_number: 1,
        topic_name: "",
        lecture_hours: 0,
        seminar_hours: 0,
        practical_hours: 0,
        exam_hours: 0,
        description: "",
    });

    // Materials Modal State
    const [activeTopicForMaterials, setActiveTopicForMaterials] = useState<ExtendedSubjectTopic | null>(null);

    const reloadTopics = async () => {
        setLoading(true);
        try {
            const [syllabusData, contentData] = await Promise.all([
                apiGetSubjectTopics(token, subject.id),
                apiTeacherGetSubject(token, subject.id).catch(() => ({ topics: [] }))
            ]);

            const mergedTopics: ExtendedSubjectTopic[] = syllabusData.topics.map((t) => {
                const c = contentData.topics.find((ct) => ct.id === t.id);
                return {
                    ...t,
                    materials: c?.materials || [],
                    tests: c?.tests || [],
                };
            });

            setTopics(mergedTopics);
            setTotals(syllabusData.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        reloadTopics();
    }, [subject.id]);

    const startEditTopic = (topic: ExtendedSubjectTopic) => {
        setEditingTopicId(topic.id);
        setEditingTopic({
            topic_number: topic.topic_number,
            topic_name: topic.topic_name,
            lecture_hours: topic.lecture_hours,
            seminar_hours: topic.seminar_hours,
            practical_hours: topic.practical_hours,
            exam_hours: topic.exam_hours,
            description: topic.description || "",
        });
    };

    const saveEditTopic = async () => {
        if (!editingTopicId || !editingTopic) return;
        setLoading(true);
        try {
            await apiUpdateSubjectTopic(token, subject.id, editingTopicId, editingTopic);
            setEditingTopicId(null);
            setEditingTopic(null);
            await reloadTopics();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const startAddNew = () => {
        const nextNumber = topics.length > 0 ? Math.max(...topics.map(t => t.topic_number)) + 1 : 1;
        setNewTopic({ topic_number: nextNumber, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
        setIsAddingNew(true);
    };

    const saveNewTopic = async () => {
        if (!newTopic.topic_name.trim()) return;
        setLoading(true);
        try {
            await apiCreateSubjectTopic(token, subject.id, newTopic);
            setIsAddingNew(false);
            await reloadTopics();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const deleteTopic = async (topicId: string) => {
        if (!window.confirm("Удалить тему?")) return;
        setLoading(true);
        try {
            await apiDeleteSubjectTopic(token, subject.id, topicId);
            await reloadTopics();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadExcel = () => {
        const url = getSubjectTopicsExportUrl(subject.id, token);
        window.open(url, "_blank");
    };

    return (
        <>
            <div className={styles.modalOverlay} onClick={onClose}>
                <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.modalHeader}>
                        <h2>{subject.name} - {isTeacher ? "Материалы" : "Учебный план"}</h2>
                        <button className="secondary" onClick={onClose} title="Закрыть">
                            <X size={20} />
                        </button>
                    </div>

                    {err && <div className={styles.error}>{err}</div>}
                    {loading && <Loader text="Загрузка..." />}

                    <div className={styles.modalBody}>
                        <div className={styles.syllabusActions}>
                            {!isTeacher && (
                                <button onClick={startAddNew} disabled={loading || isAddingNew} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <Plus size={18} />
                                    Добавить тему
                                </button>
                            )}
                            <button onClick={handleDownloadExcel} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <FileDown size={18} />
                                Скачать Excel
                            </button>
                        </div>

                        <div className={styles.syllabusTable}>
                            <table>
                                <thead>
                                    <tr>
                                        <th style={{ width: 60 }}>№</th>
                                        <th>Название темы</th>
                                        <th style={{ width: 80 }}>Лекции</th>
                                        <th style={{ width: 80 }}>Сем.</th>
                                        <th style={{ width: 80 }}>Сем.</th>
                                        <th style={{ width: 80 }}>СРСП</th>
                                        <th>Всего</th>
                                        <th>Материалы</th>
                                        <th style={{ width: 120 }}>Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topics.map((topic) => {
                                        const isEditing = editingTopicId === topic.id;
                                        const data = isEditing ? editingTopic! : topic;
                                        const hasMaterials = (topic.materials?.length || 0) + (topic.tests?.length || 0) > 0;

                                        return (
                                            <tr key={topic.id}>
                                                <td>
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            value={data.topic_number}
                                                            onChange={(e) => setEditingTopic({ ...data, topic_number: parseInt(e.target.value) || 0 })}
                                                            className={styles.numInput}
                                                        />
                                                    ) : topic.topic_number}
                                                </td>
                                                <td>
                                                    {isEditing ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                value={data.topic_name}
                                                                onChange={(e) => setEditingTopic({ ...data, topic_name: e.target.value })}
                                                                className={styles.textInput}
                                                                placeholder="Название темы"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={data.description || ""}
                                                                onChange={(e) => setEditingTopic({ ...data, description: e.target.value })}
                                                                className={styles.textInput}
                                                                placeholder="Описание (необязательно)"
                                                                style={{ marginTop: 6, fontSize: 13 }}
                                                            />
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div style={{ fontWeight: 500 }}>{topic.topic_name}</div>
                                                            {topic.description && (
                                                                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{topic.description}</div>
                                                            )}
                                                        </>
                                                    )}
                                                </td>
                                                <td>
                                                    {isEditing && !isTeacher ? <input type="number" value={data.lecture_hours} onChange={e => setEditingTopic({ ...data, lecture_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : topic.lecture_hours || "-"}
                                                </td>
                                                <td>
                                                    {isEditing && !isTeacher ? <input type="number" value={data.seminar_hours} onChange={e => setEditingTopic({ ...data, seminar_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : topic.seminar_hours || "-"}
                                                </td>
                                                <td>
                                                    {isEditing && !isTeacher ? <input type="number" value={data.practical_hours} onChange={e => setEditingTopic({ ...data, practical_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : topic.practical_hours || "-"}
                                                </td>
                                                <td>
                                                    {isEditing && !isTeacher ? <input type="number" value={data.exam_hours} onChange={e => setEditingTopic({ ...data, exam_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : topic.exam_hours || "-"}
                                                </td>
                                                <td style={{ fontWeight: 600 }}>{topic.total_hours}</td>
                                                <td>
                                                    <button
                                                        className={styles.materialsBtn}
                                                        onClick={() => setActiveTopicForMaterials(topic)}
                                                        style={hasMaterials ? { background: "var(--color-primary-light)", color: "var(--color-primary-dark)", border: "1px solid var(--color-primary)" } : {}}
                                                    >
                                                        <Paperclip size={14} />
                                                        {hasMaterials ? `${(topic.materials?.length || 0) + (topic.tests?.length || 0)} файл(ов)` : "Добавить"}
                                                    </button>
                                                </td>
                                                <td>
                                                    <div className={styles.actions}>
                                                        {isEditing ? (
                                                            <>
                                                                <button className={styles.iconBtn} onClick={saveEditTopic}><Save size={16} /></button>
                                                                <button className={styles.iconBtn} onClick={() => { setEditingTopicId(null); setEditingTopic(null); }}><X size={16} /></button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button className={styles.iconBtn} onClick={() => startEditTopic(topic)}><FileText size={16} /></button>
                                                                {!isTeacher && <button className={styles.iconBtnDanger} onClick={() => deleteTopic(topic.id)}><Trash2 size={16} /></button>}
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {isAddingNew && (
                                        <tr className={styles.newIdxRow}>
                                            <td><input type="number" value={newTopic.topic_number} onChange={e => setNewTopic({ ...newTopic, topic_number: parseInt(e.target.value) || 0 })} className={styles.numInput} /></td>
                                            <td>
                                                <input type="text" placeholder="Название темы" value={newTopic.topic_name} onChange={e => setNewTopic({ ...newTopic, topic_name: e.target.value })} className={styles.textInput} autoFocus />
                                                <input type="text" placeholder="Описание (необязательно)" value={newTopic.description || ""} onChange={e => setNewTopic({ ...newTopic, description: e.target.value })} className={styles.textInput} style={{ marginTop: 6, fontSize: 13 }} />
                                            </td>
                                            <td><input type="number" value={newTopic.lecture_hours} onChange={e => setNewTopic({ ...newTopic, lecture_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /></td>
                                            <td><input type="number" value={newTopic.seminar_hours} onChange={e => setNewTopic({ ...newTopic, seminar_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /></td>
                                            <td><input type="number" value={newTopic.practical_hours} onChange={e => setNewTopic({ ...newTopic, practical_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /></td>
                                            <td><input type="number" value={newTopic.exam_hours} onChange={e => setNewTopic({ ...newTopic, exam_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /></td>
                                            <td>-</td>
                                            <td></td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button className={styles.primaryBtnSm} onClick={saveNewTopic} disabled={!newTopic.topic_name.trim()}>OK</button>
                                                    <button className={styles.secondaryBtnSm} onClick={() => setIsAddingNew(false)}>X</button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    <tr className={styles.totalsRow}>
                                        <td colSpan={2}>ИТОГО</td>
                                        <td>{totals.lecture_hours}</td>
                                        <td>{totals.seminar_hours}</td>
                                        <td>{totals.practical_hours}</td>
                                        <td>{totals.exam_hours}</td>
                                        <td>{totals.total_hours}</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {activeTopicForMaterials && (
                <TopicMaterialsModal
                    topic={activeTopicForMaterials}
                    token={token}
                    onClose={() => { setActiveTopicForMaterials(null); reloadTopics(); }}
                />
            )}
        </>
    );
};
