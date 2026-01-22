import React, { useEffect, useState } from "react";
import { X, Plus, Trash2, Edit2, Save } from "lucide-react";
import {
    apiListCurriculum,
    apiAddCurriculumItem,
    apiUpdateCurriculumItem,
    apiDeleteCurriculumItem,
    apiListSubjects,
    type CurriculumItem,
    type CurriculumItemInput,
    type Direction,
    type Subject,
} from "../../../../api/client";
import styles from "./CurriculumModal.module.css";

type Props = {
    direction: Direction;
    token: string;
    onClose: () => void;
};

const SECTIONS = {
    general: "Общеобразовательные и общеправовые дисциплины",
    special_legal: "Специальные юридические дисциплины",
    special: "Специальные дисциплины",
} as const;

export function CurriculumModal({ direction, token, onClose }: Props) {
    const [items, setItems] = useState<CurriculumItem[]>([]);
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<CurriculumItem | null>(null);

    const [newItem, setNewItem] = useState<CurriculumItemInput>({
        subject_id: "",
        section: "general",
        total_hours: 0,
        lecture_hours: 0,
        seminar_hours: 0,
        practical_hours: 0,
        credit_hours: 0,
        exam_hours: 0,
        test_hours: 0,
    });

    useEffect(() => {
        load();
        loadSubjects();
        // eslint-disable-next-line
    }, []);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await apiListCurriculum(token, direction.id);
            setItems(res.items || []);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    async function loadSubjects() {
        try {
            const res = await apiListSubjects(token);
            setSubjects(res.subjects || []);
        } catch (e) {
            console.error(e);
        }
    }

    async function handleAdd() {
        if (!newItem.subject_id) {
            setError("Выберите предмет");
            return;
        }
        setError(null);
        try {
            await apiAddCurriculumItem(token, direction.id, newItem);
            setNewItem({
                subject_id: "",
                section: "general",
                total_hours: 0,
                lecture_hours: 0,
                seminar_hours: 0,
                practical_hours: 0,
                credit_hours: 0,
                exam_hours: 0,
                test_hours: 0,
            });
            await load();
        } catch (e) {
            setError(String(e));
        }
    }

    async function handleUpdate(item: CurriculumItem) {
        setError(null);
        try {
            const payload: CurriculumItemInput = {
                subject_id: item.subject_id,
                section: item.section,
                total_hours: item.total_hours,
                lecture_hours: item.lecture_hours,
                seminar_hours: item.seminar_hours,
                practical_hours: item.practical_hours,
                credit_hours: item.credit_hours,
                exam_hours: item.exam_hours,
                test_hours: item.test_hours,
            };
            await apiUpdateCurriculumItem(token, direction.id, item.id, payload);
            setEditingId(null);
            setEditingItem(null);
            await load();
        } catch (e) {
            setError(String(e));
        }
    }

    function startEditing(item: CurriculumItem) {
        setEditingId(item.id);
        setEditingItem({ ...item });
    }

    function cancelEditing() {
        setEditingId(null);
        setEditingItem(null);
    }

    function saveEditing() {
        if (editingItem) {
            handleUpdate(editingItem);
        }
    }

    async function handleDelete(itemId: string) {
        if (!confirm("Удалить предмет из плана?")) return;
        setError(null);
        try {
            await apiDeleteCurriculumItem(token, direction.id, itemId);
            await load();
        } catch (e) {
            setError(String(e));
        }
    }

    // Group items by section
    const itemsBySection = {
        general: items.filter((i) => i.section === "general"),
        special_legal: items.filter((i) => i.section === "special_legal"),
        special: items.filter((i) => i.section === "special"),
    };

    return (
        <div className={styles.backdrop} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>Учебный план: {direction.name}</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                <div className={styles.content}>
                    {/* Add new item form */}
                    <div className={styles.addForm}>
                        <h3>Добавить предмет</h3>
                        <div className={styles.formRow}>
                            <select
                                value={newItem.section}
                                onChange={(e) => setNewItem({ ...newItem, section: e.target.value as any })}
                            >
                                <option value="general">{SECTIONS.general}</option>
                                <option value="special_legal">{SECTIONS.special_legal}</option>
                                <option value="special">{SECTIONS.special}</option>
                            </select>
                            <select
                                value={newItem.subject_id}
                                onChange={(e) => setNewItem({ ...newItem, subject_id: e.target.value })}
                            >
                                <option value="">— Выберите предмет —</option>
                                {subjects.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                            <button onClick={handleAdd}>
                                <Plus size={16} /> Добавить
                            </button>
                        </div>
                    </div>

                    {/* Table by sections */}
                    {loading ? (
                        <div>Загрузка...</div>
                    ) : (
                        <>
                            {(Object.keys(SECTIONS) as Array<keyof typeof SECTIONS>).map((sectionKey) => (
                                <div key={sectionKey} className={styles.section}>
                                    <h3 className={styles.sectionTitle}>{SECTIONS[sectionKey]}</h3>
                                    {itemsBySection[sectionKey].length === 0 ? (
                                        <div className={styles.empty}>Нет предметов</div>
                                    ) : (
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th rowSpan={2}>Наименование дисциплины</th>
                                                    <th rowSpan={2}>Всего часов</th>
                                                    <th colSpan={3}>Аудиторные занятия</th>
                                                    <th rowSpan={2}>Зачет</th>
                                                    <th rowSpan={2}>Экзамен</th>
                                                    <th rowSpan={2}>Комп. тест</th>
                                                    <th rowSpan={2}></th>
                                                </tr>
                                                <tr>
                                                    <th>л/з</th>
                                                    <th>с/з</th>
                                                    <th>пр/з</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {itemsBySection[sectionKey].map((item) => {
                                                    const isEditing = editingId === item.id;
                                                    const displayItem = isEditing && editingItem ? editingItem : item;
                                                    
                                                    return (
                                                    <tr key={item.id}>
                                                        <td>{item.subject_name}</td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.total_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, total_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.lecture_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, lecture_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.seminar_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, seminar_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.practical_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, practical_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.credit_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, credit_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.exam_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, exam_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                value={displayItem.test_hours}
                                                                onChange={(e) => {
                                                                    if (isEditing && editingItem) {
                                                                        setEditingItem({ ...editingItem, test_hours: parseFloat(e.target.value) || 0 });
                                                                    }
                                                                }}
                                                                disabled={!isEditing}
                                                                className={styles.inputSmall}
                                                            />
                                                        </td>
                                                        <td>
                                                            <div style={{ display: 'flex', gap: 4 }}>
                                                                {isEditing ? (
                                                                    <>
                                                                        <button
                                                                            className={styles.saveBtn}
                                                                            onClick={saveEditing}
                                                                            title="Сохранить"
                                                                        >
                                                                            <Save size={16} />
                                                                        </button>
                                                                        <button
                                                                            className={styles.cancelBtn}
                                                                            onClick={cancelEditing}
                                                                            title="Отмена"
                                                                        >
                                                                            <X size={16} />
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <button
                                                                            className={styles.editBtn}
                                                                            onClick={() => startEditing(item)}
                                                                            title="Изменить"
                                                                        >
                                                                            <Edit2 size={16} />
                                                                        </button>
                                                                        <button
                                                                            className={styles.deleteBtn}
                                                                            onClick={() => handleDelete(item.id)}
                                                                            title="Удалить"
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
