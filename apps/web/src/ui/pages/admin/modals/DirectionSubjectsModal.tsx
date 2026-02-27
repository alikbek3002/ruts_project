import React, { useState, useEffect, useMemo } from "react";
import {
    X,
    Plus,
    Trash2,
    Save,
    FileText,
} from "lucide-react";
import styles from "../AdminSubjects.module.css";
import { Loader } from "../../../components/Loader";
import {
    type Direction,
    type DirectionSubject,
    type DirectionSubjectInput,
    type Subject,
    apiListDirectionSubjects,
    apiListSubjects,
    apiAddDirectionSubject,
    apiUpdateDirectionSubject,
    apiDeleteDirectionSubject,
} from "../../../../api/client";

type Props = {
    direction: Direction;
    token: string;
    onClose: () => void;
};

export const DirectionSubjectsModal: React.FC<Props> = ({ direction, token, onClose }) => {
    const [items, setItems] = useState<DirectionSubject[]>([]);
    const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Totals
    const totals = useMemo(() => {
        return items.reduce((acc, item) => ({
            lecture_hours: acc.lecture_hours + item.lecture_hours,
            seminar_hours: acc.seminar_hours + item.seminar_hours,
            practical_hours: acc.practical_hours + item.practical_hours,
            exam_hours: acc.exam_hours + item.exam_hours,
            total_hours: acc.total_hours + item.total_hours
        }), { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
    }, [items]);

    // Editing logic
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<DirectionSubjectInput | null>(null);

    // Adding new logic
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newItem, setNewItem] = useState<DirectionSubjectInput>({
        subject_id: "",
        lecture_hours: 0,
        seminar_hours: 0,
        practical_hours: 0,
        exam_hours: 0,
        total_hours: 0,
    });

    const reloadData = async () => {
        setLoading(true);
        try {
            const [planData, subjectsData] = await Promise.all([
                apiListDirectionSubjects(token, direction.id),
                apiListSubjects(token)
            ]);
            setItems(planData.subjects);
            setAllSubjects(subjectsData.subjects || []);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        reloadData();
    }, [direction.id]);

    const startEdit = (item: DirectionSubject) => {
        setEditingId(item.id);
        setEditingItem({
            subject_id: item.subject_id,
            lecture_hours: item.lecture_hours,
            seminar_hours: item.seminar_hours,
            practical_hours: item.practical_hours,
            exam_hours: item.exam_hours,
            total_hours: item.total_hours,
        });
    };

    const saveEdit = async () => {
        if (!editingId || !editingItem) return;
        setLoading(true);
        try {
            await apiUpdateDirectionSubject(token, direction.id, editingId, editingItem);
            setEditingId(null);
            setEditingItem(null);
            void reloadData();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const saveNew = async () => {
        if (!newItem.subject_id) return;
        setLoading(true);
        try {
            await apiAddDirectionSubject(token, direction.id, newItem);
            setIsAddingNew(false);
            setNewItem({
                subject_id: "",
                lecture_hours: 0,
                seminar_hours: 0,
                practical_hours: 0,
                exam_hours: 0,
                total_hours: 0,
            });
            void reloadData();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const deleteItem = async (itemId: string) => {
        if (!window.confirm("Удалить предмет из плана?")) return;
        setLoading(true);
        try {
            await apiDeleteDirectionSubject(token, direction.id, itemId);
            void reloadData();
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    };

    const calculateTotal = (item: DirectionSubjectInput) => {
        return (item.lecture_hours || 0) + (item.seminar_hours || 0) + (item.practical_hours || 0) + (item.exam_hours || 0);
    };

    // Filter available subjects for new item
    const availableSubjects = useMemo(() => {
        const usedIds = new Set(items.map(i => i.subject_id));
        return allSubjects.filter(s => !usedIds.has(s.id));
    }, [allSubjects, items]);

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ width: 900 }}>
                <div className={styles.modalHeader}>
                    <h2>{direction.name} - Учебный план (3 месяца)</h2>
                    <button className="secondary" onClick={onClose} title="Закрыть">
                        <X size={20} />
                    </button>
                </div>

                {err && <div className={styles.error}>{err}</div>}
                {loading && <Loader text="Загрузка..." />}

                <div className={styles.modalBody}>
                    <div className={styles.syllabusActions}>
                        <button onClick={() => setIsAddingNew(true)} disabled={loading || isAddingNew} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Plus size={18} />
                            Добавить предмет
                        </button>
                    </div>

                    <div className={styles.syllabusTable}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Предмет</th>
                                    <th style={{ width: 80 }}>Лекции</th>
                                    <th style={{ width: 80 }}>Сем.</th>
                                    <th style={{ width: 80 }}>Сем.</th>
                                    <th style={{ width: 80 }}>СРСП</th>
                                    <th>Всего</th>
                                    <th style={{ width: 100 }}>Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => {
                                    const isEditing = editingId === item.id;
                                    const data = isEditing ? editingItem! : item;

                                    // Auto update total when editing
                                    if (isEditing) {
                                        data.total_hours = calculateTotal(data);
                                    }

                                    return (
                                        <tr key={item.id}>
                                            <td>
                                                <div style={{ fontWeight: 500 }}>{item.subject_name}</div>
                                            </td>
                                            <td>
                                                {isEditing ? <input type="number" value={data.lecture_hours} onChange={e => setEditingItem({ ...data, lecture_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : item.lecture_hours || "-"}
                                            </td>
                                            <td>
                                                {isEditing ? <input type="number" value={data.seminar_hours} onChange={e => setEditingItem({ ...data, seminar_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : item.seminar_hours || "-"}
                                            </td>
                                            <td>
                                                {isEditing ? <input type="number" value={data.practical_hours} onChange={e => setEditingItem({ ...data, practical_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : item.practical_hours || "-"}
                                            </td>
                                            <td>
                                                {isEditing ? <input type="number" value={data.exam_hours} onChange={e => setEditingItem({ ...data, exam_hours: parseFloat(e.target.value) || 0 })} className={styles.hourInput} /> : item.exam_hours || "-"}
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{data.total_hours}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    {isEditing ? (
                                                        <>
                                                            <button className={styles.iconBtn} onClick={saveEdit}><Save size={16} /></button>
                                                            <button className={styles.iconBtn} onClick={() => { setEditingId(null); setEditingItem(null); }}><X size={16} /></button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className={styles.iconBtn} onClick={() => startEdit(item)}><FileText size={16} /></button>
                                                            <button className={styles.iconBtnDanger} onClick={() => deleteItem(item.id)}><Trash2 size={16} /></button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}

                                {isAddingNew && (
                                    <tr className={styles.newIdxRow}>
                                        <td>
                                            <select
                                                className={styles.selectInput}
                                                value={newItem.subject_id}
                                                onChange={e => setNewItem({ ...newItem, subject_id: e.target.value })}
                                                autoFocus
                                            >
                                                <option value="">Выберите предмет...</option>
                                                {availableSubjects.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td><input type="number" value={newItem.lecture_hours} onChange={e => setNewItem({ ...newItem, lecture_hours: parseFloat(e.target.value) || 0, total_hours: calculateTotal({ ...newItem, lecture_hours: parseFloat(e.target.value) || 0 }) })} className={styles.hourInput} /></td>
                                        <td><input type="number" value={newItem.seminar_hours} onChange={e => setNewItem({ ...newItem, seminar_hours: parseFloat(e.target.value) || 0, total_hours: calculateTotal({ ...newItem, seminar_hours: parseFloat(e.target.value) || 0 }) })} className={styles.hourInput} /></td>
                                        <td><input type="number" value={newItem.practical_hours} onChange={e => setNewItem({ ...newItem, practical_hours: parseFloat(e.target.value) || 0, total_hours: calculateTotal({ ...newItem, practical_hours: parseFloat(e.target.value) || 0 }) })} className={styles.hourInput} /></td>
                                        <td><input type="number" value={newItem.exam_hours} onChange={e => setNewItem({ ...newItem, exam_hours: parseFloat(e.target.value) || 0, total_hours: calculateTotal({ ...newItem, exam_hours: parseFloat(e.target.value) || 0 }) })} className={styles.hourInput} /></td>
                                        <td>{newItem.total_hours}</td>
                                        <td>
                                            <div className={styles.actions}>
                                                <button className={styles.primaryBtnSm} onClick={saveNew} disabled={!newItem.subject_id}>OK</button>
                                                <button className={styles.secondaryBtnSm} onClick={() => setIsAddingNew(false)}>X</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                <tr className={styles.totalsRow}>
                                    <td>ИТОГО</td>
                                    <td>{totals.lecture_hours}</td>
                                    <td>{totals.seminar_hours}</td>
                                    <td>{totals.practical_hours}</td>
                                    <td>{totals.exam_hours}</td>
                                    <td>{totals.total_hours}</td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

