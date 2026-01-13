import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListSubjectsWithTeachers,
  apiCreateSubject,
  apiUpdateSubject,
  apiDeleteSubject,
  apiGetSubjectTopics,
  apiCreateSubjectTopic,
  apiUpdateSubjectTopic,
  apiDeleteSubjectTopic,
  apiBulkUpdateSubjectTopics,
  getSubjectTopicsExportUrl,
  type SubjectWithTeachers,
  type SubjectTopic,
  type SubjectTopicInput,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminSubjects.module.css";
import { BookOpen, Trash2, Plus, Image as ImageIcon, User, FileDown, Save, X, Edit2 } from "lucide-react";

export function AdminSubjectsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [subjects, setSubjects] = useState<SubjectWithTeachers[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectPhotoUrl, setNewSubjectPhotoUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit subject state
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editSubjectName, setEditSubjectName] = useState("");
  const [editSubjectPhotoUrl, setEditSubjectPhotoUrl] = useState("");

  // Modal state
  const [modalSubject, setModalSubject] = useState<SubjectWithTeachers | null>(null);
  const [modalTopics, setModalTopics] = useState<SubjectTopic[]>([]);
  const [modalTotals, setModalTotals] = useState({ lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<SubjectTopicInput | null>(null);
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

  async function reloadAll() {
    if (!token) return;
    setLoading(true);
    try {
      const s = await apiListSubjectsWithTeachers(token);
      setSubjects(s.subjects || []);
    } finally {
      setLoading(false);
    }
  }

  function teacherLine(s: SubjectWithTeachers): string {
    const names = (s.teachers || []).map((t) => t.name).filter(Boolean);
    return names.length ? names.join(", ") : "---";
  }

  useEffect(() => {
    if (can) reloadAll().catch((e) => setErr(String(e)));
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Предметы" : "Админ → Предметы";

  const handleCreateSubject = async () => {
    if (!token || !newSubjectName.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      // пока фото хранится как URL
      await apiCreateSubject(token, newSubjectName.trim(), newSubjectPhotoUrl.trim() || null);
      setNewSubjectName("");
      setNewSubjectPhotoUrl("");
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const startEditSubject = (subject: SubjectWithTeachers) => {
    setEditingSubjectId(subject.id);
    setEditSubjectName(subject.name);
    setEditSubjectPhotoUrl(subject.photo_url || "");
  };

  const cancelEditSubject = () => {
    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectPhotoUrl("");
  };

  const saveEditSubject = async () => {
    if (!token || !editingSubjectId || !editSubjectName.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      await apiUpdateSubject(token, editingSubjectId, editSubjectName.trim(), editSubjectPhotoUrl.trim() || null);
      setEditingSubjectId(null);
      setEditSubjectName("");
      setEditSubjectPhotoUrl("");
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!token) return;
    if (!window.confirm("Удалить предмет? Это также удалит все связи с учителями.")) return;
    setErr(null);
    setLoading(true);
    try {
      await apiDeleteSubject(token, subjectId);
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const openModal = async (subject: SubjectWithTeachers) => {
    if (!token) return;
    setModalSubject(subject);
    setErr(null);
    setLoading(true);
    try {
      const data = await apiGetSubjectTopics(token, subject.id);
      setModalTopics(data.topics || []);
      setModalTotals(data.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => {
    setModalSubject(null);
    setModalTopics([]);
    setEditingTopicId(null);
    setEditingTopic(null);
    setIsAddingNew(false);
    setNewTopic({ topic_number: 1, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
  };

  const startEditTopic = (topic: SubjectTopic) => {
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

  const cancelEdit = () => {
    setEditingTopicId(null);
    setEditingTopic(null);
  };

  const saveEditTopic = async () => {
    if (!token || !modalSubject || !editingTopicId || !editingTopic) return;
    setErr(null);
    setLoading(true);
    try {
      await apiUpdateSubjectTopic(token, modalSubject.id, editingTopicId, editingTopic);
      const data = await apiGetSubjectTopics(token, modalSubject.id);
      setModalTopics(data.topics || []);
      setModalTotals(data.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
      setEditingTopicId(null);
      setEditingTopic(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const startAddNew = () => {
    const nextNumber = modalTopics.length > 0 ? Math.max(...modalTopics.map(t => t.topic_number)) + 1 : 1;
    setNewTopic({ topic_number: nextNumber, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
    setIsAddingNew(true);
  };

  const cancelAddNew = () => {
    setIsAddingNew(false);
    setNewTopic({ topic_number: 1, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
  };

  const saveNewTopic = async () => {
    if (!token || !modalSubject || !newTopic.topic_name.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      await apiCreateSubjectTopic(token, modalSubject.id, newTopic);
      const data = await apiGetSubjectTopics(token, modalSubject.id);
      setModalTopics(data.topics || []);
      setModalTotals(data.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
      setIsAddingNew(false);
      setNewTopic({ topic_number: 1, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const deleteTopic = async (topicId: string) => {
    if (!token || !modalSubject) return;
    if (!window.confirm("Удалить тему?")) return;
    setErr(null);
    setLoading(true);
    try {
      await apiDeleteSubjectTopic(token, modalSubject.id, topicId);
      const data = await apiGetSubjectTopics(token, modalSubject.id);
      setModalTopics(data.topics || []);
      setModalTotals(data.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = () => {
    if (!token || !modalSubject) return;
    const url = getSubjectTopicsExportUrl(modalSubject.id, token);
    window.open(url, "_blank");
  };


  return (
    <AppShell
      title={title}
      nav={[
        { to: base, label: "Главная" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/streams`, label: "Потоки" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/workload`, label: "Часы работы" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Предметы</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}
        
        <div className={styles.createRow}>
          <div style={{ position: "relative", flex: 1 }}>
            <BookOpen size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)" }} />
            <input
              placeholder="Название предмета"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
              style={{ paddingLeft: 40, width: "100%" }}
            />
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <ImageIcon size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)" }} />
            <input
              placeholder="Ссылка на фото (необязательно)"
              value={newSubjectPhotoUrl}
              onChange={(e) => setNewSubjectPhotoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
              style={{ paddingLeft: 40, width: "100%" }}
            />
          </div>
          <button onClick={handleCreateSubject} disabled={loading || !newSubjectName.trim()} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={18} />
            Создать предмет
          </button>
        </div>

        <div className={styles.cardsGrid}>
          {!loading && subjects.map((s) => {
            const isEditing = editingSubjectId === s.id;
            
            return (
              <div key={s.id} className={styles.card}>
                {isEditing ? (
                  <div className={styles.cardTop} style={{ flexDirection: "column", gap: 12 }}>
                    <div style={{ position: "relative", width: "100%" }}>
                      <BookOpen size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)", zIndex: 1 }} />
                      <input
                        placeholder="Название предмета"
                        value={editSubjectName}
                        onChange={(e) => setEditSubjectName(e.target.value)}
                        style={{ paddingLeft: 40, width: "100%" }}
                        autoFocus
                      />
                    </div>
                    <div style={{ position: "relative", width: "100%" }}>
                      <ImageIcon size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-light)", zIndex: 1 }} />
                      <input
                        placeholder="Ссылка на фото (необязательно)"
                        value={editSubjectPhotoUrl}
                        onChange={(e) => setEditSubjectPhotoUrl(e.target.value)}
                        style={{ paddingLeft: 40, width: "100%" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, width: "100%" }}>
                      <button 
                        className="secondary" 
                        onClick={saveEditSubject} 
                        disabled={loading || !editSubjectName.trim()}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                      >
                        <Save size={16} />
                        Сохранить
                      </button>
                      <button 
                        className="secondary" 
                        onClick={cancelEditSubject} 
                        disabled={loading}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                      >
                        <X size={16} />
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cardTop} onClick={() => openModal(s)} style={{ cursor: "pointer" }}>
                    <img
                      className={styles.photo}
                      src={(s as any).photo_url || "/favicon.svg"}
                      alt="Фото предмета"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src.endsWith("/favicon.svg")) return;
                        img.src = "/favicon.svg";
                      }}
                    />
                    <div className={styles.cardInfo}>
                      <div className={styles.title}>{s.name}</div>
                      <div className={styles.meta}>
                        <User size={14} />
                        {teacherLine(s)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button 
                        className="secondary" 
                        onClick={(e) => { e.stopPropagation(); startEditSubject(s); }} 
                        title="Редактировать" 
                        disabled={loading}
                        style={{ padding: 8 }}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        className={`secondary ${styles.deleteBtn}`} 
                        onClick={(e) => { e.stopPropagation(); handleDeleteSubject(s.id); }} 
                        title="Удалить" 
                        disabled={loading}
                        style={{ padding: 8 }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {subjects.length === 0 && <div className={styles.empty}>Предметы не созданы</div>}
        </div>

        <div className={styles.infoBox}>
          <h3>👨‍🏫 Предметы учителям</h3>
          <p>
            Предметы назначаются при создании учителя в разделе “Пользователи”.
          </p>
        </div>
      </div>
      {modalSubject && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{modalSubject.name}</h2>
              <button className="secondary" onClick={closeModal} title="Закрыть">
                <X size={20} />
              </button>
            </div>

            {err && <div className={styles.error}>{err}</div>}

            <div className={styles.modalBody}>
              <div className={styles.syllabusActions}>
                <button onClick={startAddNew} disabled={loading || isAddingNew} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Plus size={18} />
                  Добавить тему
                </button>
                <button onClick={downloadExcel} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileDown size={18} />
                  Скачать Excel
                </button>
              </div>

              <div className={styles.syllabusTable}>
                <table>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Название темы</th>
                      <th>Лекции (ч)</th>
                      <th>Семинары (ч)</th>
                      <th>Практика (ч)</th>
                      <th>Экзамен (ч)</th>
                      <th>Всего (ч)</th>
                      <th>Описание</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalTopics.map((topic) => {
                      const isEditing = editingTopicId === topic.id;
                      const data = isEditing ? editingTopic! : topic;
                      
                      return (
                        <tr key={topic.id}>
                          <td>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={data.topic_number} 
                                onChange={(e) => setEditingTopic({ ...data, topic_number: parseInt(e.target.value) || 0 })}
                                style={{ width: "60px" }}
                              />
                            ) : (
                              topic.topic_number
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="text" 
                                value={data.topic_name} 
                                onChange={(e) => setEditingTopic({ ...data, topic_name: e.target.value })}
                                style={{ width: "100%" }}
                              />
                            ) : (
                              topic.topic_name
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={data.lecture_hours} 
                                onChange={(e) => setEditingTopic({ ...data, lecture_hours: parseFloat(e.target.value) || 0 })}
                                style={{ width: "80px" }}
                              />
                            ) : (
                              topic.lecture_hours
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={data.seminar_hours} 
                                onChange={(e) => setEditingTopic({ ...data, seminar_hours: parseFloat(e.target.value) || 0 })}
                                style={{ width: "80px" }}
                              />
                            ) : (
                              topic.seminar_hours
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={data.practical_hours} 
                                onChange={(e) => setEditingTopic({ ...data, practical_hours: parseFloat(e.target.value) || 0 })}
                                style={{ width: "80px" }}
                              />
                            ) : (
                              topic.practical_hours
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={data.exam_hours} 
                                onChange={(e) => setEditingTopic({ ...data, exam_hours: parseFloat(e.target.value) || 0 })}
                                style={{ width: "80px" }}
                              />
                            ) : (
                              topic.exam_hours
                            )}
                          </td>
                          <td>{topic.total_hours}</td>
                          <td>
                            {isEditing ? (
                              <input 
                                type="text" 
                                value={data.description || ""} 
                                onChange={(e) => setEditingTopic({ ...data, description: e.target.value })}
                                style={{ width: "100%" }}
                              />
                            ) : (
                              topic.description || "—"
                            )}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              {isEditing ? (
                                <>
                                  <button className="secondary" onClick={saveEditTopic} disabled={loading} title="Сохранить">
                                    <Save size={16} />
                                  </button>
                                  <button className="secondary" onClick={cancelEdit} disabled={loading} title="Отмена">
                                    <X size={16} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button className="secondary" onClick={() => startEditTopic(topic)} disabled={loading} title="Редактировать">
                                    <Edit2 size={16} />
                                  </button>
                                  <button className="secondary" onClick={() => deleteTopic(topic.id)} disabled={loading} title="Удалить">
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {isAddingNew && (
                      <tr>
                        <td>
                          <input 
                            type="number" 
                            value={newTopic.topic_number} 
                            onChange={(e) => setNewTopic({ ...newTopic, topic_number: parseInt(e.target.value) || 0 })}
                            style={{ width: "60px" }}
                          />
                        </td>
                        <td>
                          <input 
                            type="text" 
                            value={newTopic.topic_name} 
                            onChange={(e) => setNewTopic({ ...newTopic, topic_name: e.target.value })}
                            style={{ width: "100%" }}
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={newTopic.lecture_hours} 
                            onChange={(e) => setNewTopic({ ...newTopic, lecture_hours: parseFloat(e.target.value) || 0 })}
                            style={{ width: "80px" }}
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={newTopic.seminar_hours} 
                            onChange={(e) => setNewTopic({ ...newTopic, seminar_hours: parseFloat(e.target.value) || 0 })}
                            style={{ width: "80px" }}
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={newTopic.practical_hours} 
                            onChange={(e) => setNewTopic({ ...newTopic, practical_hours: parseFloat(e.target.value) || 0 })}
                            style={{ width: "80px" }}
                          />
                        </td>
                        <td>
                          <input 
                            type="number" 
                            value={newTopic.exam_hours} 
                            onChange={(e) => setNewTopic({ ...newTopic, exam_hours: parseFloat(e.target.value) || 0 })}
                            style={{ width: "80px" }}
                          />
                        </td>
                        <td>—</td>
                        <td>
                          <input 
                            type="text" 
                            value={newTopic.description || ""} 
                            onChange={(e) => setNewTopic({ ...newTopic, description: e.target.value })}
                            style={{ width: "100%" }}
                          />
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="secondary" onClick={saveNewTopic} disabled={loading || !newTopic.topic_name.trim()} title="Сохранить">
                              <Save size={16} />
                            </button>
                            <button className="secondary" onClick={cancelAddNew} disabled={loading} title="Отмена">
                              <X size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    <tr className={styles.totalsRow}>
                      <td colSpan={2}><strong>ИТОГО</strong></td>
                      <td><strong>{modalTotals.lecture_hours}</strong></td>
                      <td><strong>{modalTotals.seminar_hours}</strong></td>
                      <td><strong>{modalTotals.practical_hours}</strong></td>
                      <td><strong>{modalTotals.exam_hours}</strong></td>
                      <td><strong>{modalTotals.total_hours}</strong></td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}    </AppShell>
  );
}
