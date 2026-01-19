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
  apiTeacherGetSubject,
  apiSubjectContentUploadFile,
  apiSubjectContentCreateQuiz,
  apiSubjectContentCreateDocumentTest,
  apiSubjectContentDeleteMaterial,
  apiSubjectContentDeleteTest,
  type SubjectWithTeachers,
  type SubjectTopic,
  type SubjectTopicInput,
  type SubjectContentTopic,
  type SubjectContentMaterial,
  type SubjectContentTest,
  getSubjectTopicsExportUrl,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminSubjects.module.css";
import { BookOpen, Trash2, Plus, Image as ImageIcon, User, FileDown, Save, X, Edit2, FileText, FlaskConical, Paperclip, Link as LinkIcon, Download } from "lucide-react";

type ExtendedSubjectTopic = SubjectTopic & {
  materials?: SubjectContentMaterial[];
  tests?: SubjectContentTest[];
};

export function AdminSubjectsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager" || user.role === "teacher") && !!token, [user, token]);

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
  const [modalTopics, setModalTopics] = useState<ExtendedSubjectTopic[]>([]);
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
  
  // Attachments for new topic
  const [newTopicFile, setNewTopicFile] = useState<File | null>(null);
  const [newTopicTestTitle, setNewTopicTestTitle] = useState("");
  const [newTopicTestType, setNewTopicTestType] = useState<"quiz" | "document">("quiz"); // simple toggle
  const [newTopicTestFile, setNewTopicTestFile] = useState<File | null>(null);

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
  if (user.role !== "admin" && user.role !== "manager" && user.role !== "teacher") return <Navigate to="/app" replace />;

  const isTeacher = user.role === "teacher";
  const base = isTeacher ? "/app/teacher" : (user.role === "manager" ? "/app/manager" : "/app/admin");
  const title = isTeacher ? "Учитель → Предметы" : (user.role === "manager" ? "Менеджер → Предметы" : "Админ → Предметы");

  const handleCreateSubject = async () => {
    if (isTeacher) return; // Teachers cannot create subjects
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

  const reloadTopics = async (subjectId?: string) => {
    const sid = subjectId || modalSubject?.id;
    if (!token || !sid) return;
    setLoading(true);
    try {
      // Parallel fetch for hours (syllabus) and content (teacher view)
      const [syllabusData, contentData] = await Promise.all([
        apiGetSubjectTopics(token, sid),
        apiTeacherGetSubject(token, sid).catch(() => ({ topics: [] })) // fallback if content fails
      ]);

      const mergedTopics: ExtendedSubjectTopic[] = syllabusData.topics.map((t) => {
        const c = contentData.topics.find((ct) => ct.id === t.id);
        return {
          ...t,
          materials: c?.materials || [],
          tests: c?.tests || [],
        };
      });

      setModalTopics(mergedTopics);
      setModalTotals(syllabusData.totals || { lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, total_hours: 0 });
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
      await reloadTopics(subject.id);
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
    setNewTopicFile(null);
    setNewTopicTestTitle("");
    setNewTopicTestFile(null);
  };

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
      await reloadTopics();
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
    setNewTopicFile(null);
    setNewTopicTestTitle("");
    setNewTopicTestFile(null);
  };

  const saveNewTopic = async () => {
    if (!token || !modalSubject || !newTopic.topic_name.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      // 1. Create Topic
      const res = await apiCreateSubjectTopic(token, modalSubject.id, newTopic);
      const topicId = res.topic.id;

      // 2. Upload File if present
      if (newTopicFile) {
        await apiSubjectContentUploadFile(token, topicId, newTopicFile);
      }

      // 3. Create Test if present
      if (newTopicTestTitle.trim()) {
        if (newTopicTestType === "document" && newTopicTestFile) {
          await apiSubjectContentCreateDocumentTest(token, topicId, newTopicTestTitle, newTopicTestFile);
        } else if (newTopicTestType === "quiz") {
          await apiSubjectContentCreateQuiz(token, topicId, newTopicTestTitle, 30); // default 30 mins
        }
      }

      await reloadTopics();
      setIsAddingNew(false);
      setNewTopic({ topic_number: 1, topic_name: "", lecture_hours: 0, seminar_hours: 0, practical_hours: 0, exam_hours: 0, description: "" });
      setNewTopicFile(null);
      setNewTopicTestTitle("");
      setNewTopicTestFile(null);
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
      await reloadTopics();
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

  const handleUploadFileToTopic = async (topicId: string, file: File) => {
    if (!token) return;
    setLoading(true);
    try {
      await apiSubjectContentUploadFile(token, topicId, file);
      await reloadTopics();
    } catch(e) { setErr(String(e)); } finally { setLoading(false); }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!token || !window.confirm("Удалить файл?")) return;
    setLoading(true);
    try {
      await apiSubjectContentDeleteMaterial(token, materialId);
      await reloadTopics();
    } catch(e) { setErr(String(e)); } finally { setLoading(false); }
  };

  const handleDeleteTest = async (testId: string) => {
    if (!token || !window.confirm("Удалить тест?")) return;
    setLoading(true);
    try {
      await apiSubjectContentDeleteTest(token, testId);
      await reloadTopics();
    } catch(e) { setErr(String(e)); } finally { setLoading(false); }
  };


  return (
    <AppShell
      title={title}
      nav={isTeacher ? [
        { to: "/app/teacher", labelKey: "nav.home" },
        { to: "/app/teacher/journal", labelKey: "nav.journal" },
        { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
        { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
        { to: "/app/teacher/workload", labelKey: "nav.workload" },
        { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
      ] : [
        { to: base, labelKey: "nav.home" },
        { to: `${base}/users`, labelKey: "nav.users" },
        { to: `${base}/classes`, labelKey: "nav.groups" },
        { to: `${base}/streams`, labelKey: "nav.streams" },
        { to: `${base}/subjects`, labelKey: "nav.subjects" },
        { to: `${base}/directions`, labelKey: "nav.directions" },
        { to: `${base}/timetable`, labelKey: "nav.timetable" },
        { to: `${base}/workload`, labelKey: "nav.workload" },
        { to: `${base}/notifications`, labelKey: "nav.notifications" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Предметы</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}
        
        <div className={styles.createRow}>
          {/* Hide create subject for teachers */}
          {!isTeacher && (
            <>
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
            </>
          )}
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
                        disabled={loading || isTeacher}
                        style={{ padding: 8, opacity: isTeacher ? 0.3 : 1 }}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        className={`secondary ${styles.deleteBtn}`} 
                        onClick={(e) => { e.stopPropagation(); handleDeleteSubject(s.id); }} 
                        title="Удалить" 
                        disabled={loading || isTeacher}
                        style={{ padding: 8, opacity: isTeacher ? 0.3 : 1 }}
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
                {/* Teachers cannot add new topics */}
                {!isTeacher && (
                  <button onClick={startAddNew} disabled={loading || isAddingNew} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Plus size={18} />
                    Добавить тему
                  </button>
                )}
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
                        <React.Fragment key={topic.id}>
                        <tr>
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
                            {isEditing && !isTeacher ? (
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
                            {isEditing && !isTeacher ? (
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
                            {isEditing && !isTeacher ? (
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
                            {isEditing && !isTeacher ? (
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
                                  {/* Teachers cannot delete topics */}
                                  {!isTeacher && (
                                    <button className="secondary" onClick={() => deleteTopic(topic.id)} disabled={loading} title="Удалить">
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isEditing && (
                          <tr style={{ background: "var(--color-bg-subtle)" }}>
                            <td colSpan={9} style={{ padding: 12 }}>
                                <div style={{ display: "flex", gap: 32 }}>
                                   <div style={{ flex: 1 }}>
                                     <strong style={{fontSize: 13}}>Материалы</strong>
                                     <ul style={{ paddingLeft: 20, margin: "8px 0", fontSize: 13 }}>
                                        {topic.materials?.map(m => (
                                          <li key={m.id} style={{marginBottom: 4}}>
                                            {m.title || "Файл"} <a href={m.signed_url || "#"} target="_blank" rel="noreferrer"><Download size={14} style={{verticalAlign: "middle"}}/></a>
                                            <button className="secondary" style={{padding: 2, marginLeft: 8, border: "none", background: "transparent", color: "red", cursor:"pointer"}} onClick={() => handleDeleteMaterial(m.id)}><Trash2 size={14} style={{verticalAlign: "middle"}}/></button>
                                          </li>
                                        ))}
                                     </ul>
                                     <div style={{marginTop: 8}}>
                                       <label style={{display:"block", fontSize:12, marginBottom:4}}>Добавить файл:</label>
                                       <input type="file" style={{fontSize: 12}} onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) handleUploadFileToTopic(topic.id, f).then(() => { e.target.value = ""; });
                                       }} />
                                     </div>
                                   </div>
                                   <div style={{ flex: 1 }}>
                                      <strong style={{fontSize: 13}}>Тесты</strong>
                                      <ul style={{ paddingLeft: 20, margin: "8px 0", fontSize: 13 }}>
                                        {topic.tests?.map(t => (
                                          <li key={t.id} style={{marginBottom: 4}}>
                                            {t.title} <span style={{color: "gray", fontSize: 11}}>({t.test_type === "quiz" ? "Квиз" : "Файл"})</span>
                                            <button className="secondary" style={{padding: 2, marginLeft: 8, border: "none", background: "transparent", color: "red", cursor:"pointer"}} onClick={() => handleDeleteTest(t.id)}><Trash2 size={14} style={{verticalAlign: "middle"}}/></button>
                                          </li>
                                        ))}
                                      </ul>
                                      <div style={{display:"flex", gap:4, marginTop: 8}}>
                                        <input id={`new-test-${topic.id}`} placeholder="Название квиза" style={{fontSize:12, padding: "4px 8px"}} />
                                        <button className="secondary" style={{padding: "4px 8px", fontSize: 12}} onClick={() => {
                                           const input = document.getElementById(`new-test-${topic.id}`) as HTMLInputElement;
                                           if (input && input.value && token) {
                                               apiSubjectContentCreateQuiz(token, topic.id, input.value, 30).then(() => { input.value = ""; reloadTopics(); });
                                           }
                                        }}>Создать</button>
                                      </div>
                                   </div>
                                </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}

                    {isAddingNew && (
                      <>
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
                      {/* Expanded inputs for attachments when adding new */}
                      <tr className={styles.addExtrasRow}>
                        <td colSpan={9} style={{ padding: "0 12px 12px 12px", background: "var(--color-bg-subtle)" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>Материалы и Тесты</div>
                                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                        <label style={{ fontSize: 12, marginBottom: 4, display: "block" }}>Презентация / Файл</label>
                                        <input type="file" onChange={(e) => setNewTopicFile(e.target.files?.[0] || null)} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                        <label style={{ fontSize: 12, marginBottom: 4, display: "block" }}>Добавить Тест (Опционально)</label>
                                        <input 
                                            placeholder="Название теста" 
                                            value={newTopicTestTitle} 
                                            onChange={(e) => setNewTopicTestTitle(e.target.value)} 
                                            style={{ width: "100%", marginBottom: 4 }}
                                        />
                                        <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                            <label><input type="radio" checked={newTopicTestType === "quiz"} onChange={() => setNewTopicTestType("quiz")} /> Квиз</label>
                                            <label><input type="radio" checked={newTopicTestType === "document"} onChange={() => setNewTopicTestType("document")} /> Файл</label>
                                        </div>
                                        {newTopicTestType === "document" && (
                                            <input type="file" style={{ marginTop: 4 }} onChange={(e) => setNewTopicTestFile(e.target.files?.[0] || null)} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </td>
                      </tr>
                      </>
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
