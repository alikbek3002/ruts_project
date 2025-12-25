import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { trackedFetch } from "../../../api/client";
import styles from "./TeacherJournalPage.module.css";

type Student = {
  id: string;
  name: string;
  username: string;
};

type Grade = {
  grade: number;
  comment: string | null;
};

type CellData = {
  grades: Grade[];
  present: boolean | null;
};

type Lesson = {
  date: string;
  timetable_entry_id: string;
  subject_name: string;
  subject_id?: string;
  lesson_topic?: string | null;
  homework?: string | null;
};

type JournalData = {
  students: Student[];
  lessons: Lesson[];
  grades: Record<string, Record<string, CellData>>;
};

type SubjectInfo = {
  id: string;
  name: string;
};

type ClassInfo = {
  id: string;
  name: string;
  subjects: SubjectInfo[];
};

export function TeacherJournalPage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const token = state.accessToken;

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [journal, setJournal] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Для добавления оценки
  const [addingGrade, setAddingGrade] = useState<{ studentId: string; lessonKey: string; lesson: Lesson } | null>(null);
  const [newGrade, setNewGrade] = useState<number>(5);
  const [newComment, setNewComment] = useState<string>("");

  // Для темы урока и ДЗ
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lessonTopic, setLessonTopic] = useState<string>("");
  const [homework, setHomework] = useState<string>("");

  useEffect(() => {
    if (!token) return;
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedClassId) return;
    loadJournal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedClassId, selectedSubjectId]);

  async function loadClasses() {
    if (!token) return;
    setErr(null);
    try {
      const resp = await trackedFetch("/api/journal/teacher/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load classes");
      const data = await resp.json();
      setClasses(data.classes || []);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function loadJournal() {
    if (!token || !selectedClassId) return;
    setLoading(true);
    setErr(null);
    try {
      const url = new URL(`/api/journal/classes/${selectedClassId}/journal`, window.location.origin);
      if (selectedSubjectId) {
        url.searchParams.append("subject_id", selectedSubjectId);
      }

      const resp = await trackedFetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load journal");
      const data = await resp.json();
      setJournal(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addGrade(studentId: string, lessonKey: string, lesson: Lesson, gradeValue: number | null, present: boolean = true) {
    if (!token || !selectedClassId) return;
    setErr(null);
    try {
      const resp = await trackedFetch(`/api/journal/classes/${selectedClassId}/grades`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          student_id: studentId,
          timetable_entry_id: lesson.timetable_entry_id,
          lesson_date: lesson.date,
          grade: gradeValue,
          present: present,
          comment: newComment || null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to add grade");
      setAddingGrade(null);
      setNewGrade(5);
      setNewComment("");
      await loadJournal();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteGrade(gradeId: string) {
    // Удаление пока не реализовано для lesson_journal
    // Можно добавить отдельный endpoint если нужно
    alert("Удаление оценок временно недоступно");
  }

  async function downloadExcel() {
    if (!token || !selectedClassId) return;
    setErr(null);
    try {
      const resp = await trackedFetch(`/api/journal/classes/${selectedClassId}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to download Excel");
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `journal_${selectedClass?.name || "class"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      setErr(String(e));
    }
  }

  function openLessonEditor(lesson: Lesson) {
    setEditingLesson(lesson);
    setLessonTopic(lesson.lesson_topic || "");
    setHomework(lesson.homework || "");
  }

  async function saveLessonInfo() {
    if (!token || !selectedClassId || !editingLesson) return;
    setErr(null);
    try {
      const resp = await fetch(`/api/journal/classes/${selectedClassId}/lesson-info`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timetable_entry_id: editingLesson.timetable_entry_id,
          lesson_date: editingLesson.date,
          lesson_topic: lessonTopic || null,
          homework: homework || null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save lesson info");
      
      // Обновляем локально
      setJournal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lessons: prev.lessons.map((l) =>
            l.date === editingLesson.date && l.timetable_entry_id === editingLesson.timetable_entry_id
              ? { ...l, lesson_topic: lessonTopic, homework: homework }
              : l
          ),
        };
      });
      
      setEditingLesson(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  function calculateAverage(studentId: string): number | null {
    if (!journal) return null;
    const allGrades: number[] = [];
    for (const lesson of journal.lessons) {
      const key = `${lesson.date}_${lesson.timetable_entry_id}`;
      const cellData = journal.grades[studentId]?.[key];
      const gradesList = cellData?.grades || [];
      for (const g of gradesList) {
        allGrades.push(g.grade);
      }
    }
    if (allGrades.length === 0) return null;
    return allGrades.reduce((a, b) => a + b, 0) / allGrades.length;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <AppShell
      title={`${t("teacher.title")} → ${t("nav.journal")}`}
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ]}
    >
      <h2 style={{ fontFamily: 'Arial, sans-serif', fontWeight: 400, marginBottom: 16 }}>{t("journal.title")}</h2>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ marginBottom: 16, display: "flex", gap: "1rem", alignItems: "center" }}>
        <label style={{ fontFamily: 'Arial, sans-serif', fontSize: 14 }}>
          <strong>{t("journal.selectClass")}:</strong>
          <select
            className={styles.classSelect}
            value={selectedClassId}
            onChange={(e) => {
              setSelectedClassId(e.target.value);
              setSelectedSubjectId("");
            }}
            style={{ marginLeft: 8 }}
          >
            <option value="">-- {t("common.select")} --</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {selectedClass && selectedClass.subjects.length > 0 && (
          <label style={{ fontFamily: 'Arial, sans-serif', fontSize: 14 }}>
            <strong>Предмет:</strong>
            <select
              className={styles.classSelect}
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              style={{ marginLeft: 8 }}
            >
              <option value="">Все предметы</option>
              {selectedClass.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {selectedClassId && (
        <div className={styles.headerButtons}>
          <button onClick={loadJournal} disabled={loading}>
            {loading ? "⭮" : "↻"} {loading ? t("common.loading") : t("common.refresh")}
          </button>
          <button onClick={downloadExcel} disabled={loading}>
            ⬇ {t("journal.downloadExcel")}
          </button>
        </div>
      )}

      {loading && <Loader text={t("common.loading")} />}

      {!loading && journal && selectedClass && (
        <div className={styles.tableWrapper}>
          <table className={styles.journalTable}>
            <thead>
              <tr>
                <th className={styles.stickyCol}>{t("journal.student")}</th>
                {journal.lessons.map((lesson, idx) => {
                  const key = `${lesson.date}_${lesson.timetable_entry_id}`;
                  const colClass = idx % 2 === 0 ? styles.dateCol : styles.dateColAlt;
                  return (
                    <th key={key} className={colClass}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                        <div style={{ flex: 1 }}>
                          <div>{lesson.date}</div>
                          <div className={styles.subjectName}>{lesson.subject_name}</div>
                        </div>
                        <button
                          onClick={() => openLessonEditor(lesson)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "16px",
                            padding: "2px 4px",
                          }}
                          title="Тема и ДЗ"
                        >
                          📝
                        </button>
                      </div>
                      {lesson.lesson_topic && (
                        <div style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
                          📖 {lesson.lesson_topic}
                        </div>
                      )}
                      {lesson.homework && (
                        <div style={{ fontSize: "11px", color: "#0066cc", marginTop: "2px" }}>
                          📚 ДЗ
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className={styles.avgCol}>{t("journal.average")}</th>
              </tr>
            </thead>
            <tbody>
              {journal.students.map((student) => {
                const avg = calculateAverage(student.id);
                return (
                  <tr key={student.id}>
                    <td className={styles.stickyCol}>{student.name}</td>
                    {journal.lessons.map((lesson, idx) => {
                      const key = `${lesson.date}_${lesson.timetable_entry_id}`;
                      const cellData = journal.grades[student.id]?.[key] || { grades: [], present: null };
                      const gradesList = cellData.grades || [];
                      const isAbsent = cellData.present === false;
                      const isAdding = addingGrade?.studentId === student.id && addingGrade?.lessonKey === key;
                      const colClass = idx % 2 === 0 ? styles.dateCol : styles.dateColAlt;

                      return (
                        <td key={key} className={`${styles.gradeCell} ${colClass} ${isAbsent ? styles.absentCell : ''}`}>
                          {isAdding ? (
                            <div className={styles.addForm}>
                              <select value={newGrade} onChange={(e) => setNewGrade(Number(e.target.value))}>
                                <option value={5}>5</option>
                                <option value={4}>4</option>
                                <option value={3}>3</option>
                                <option value={2}>2</option>
                                <option value={1}>1</option>
                              </select>
                              <button onClick={() => addGrade(student.id, key, lesson, newGrade, true)}>✓</button>
                              <button 
                                className={styles.absentBtn}
                                onClick={() => addGrade(student.id, key, lesson, null, false)}
                                title="Отсутствует"
                              >
                                Н
                              </button>
                              <button onClick={() => setAddingGrade(null)}>✗</button>
                            </div>
                          ) : (
                            <div className={styles.grades}>
                              {isAbsent && <span className={styles.absentMark}>Н</span>}
                              {gradesList.map((g, i) => (
                                <span key={i} className={styles.gradeItem} title={g.comment || ""}>
                                  {g.grade}
                                </span>
                              ))}
                              <button
                                className={styles.addBtn}
                                onClick={() => setAddingGrade({ studentId: student.id, lessonKey: key, lesson })}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className={styles.avgCol}>
                      {avg !== null ? <strong>{avg.toFixed(2)}</strong> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !selectedClassId && (
        <p style={{ color: "#666" }}>{t("journal.selectClass")}</p>
      )}

      {/* Модалка для редактирования темы урока и ДЗ */}
      {editingLesson && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingLesson(null)}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "24px",
              borderRadius: "8px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              {editingLesson.subject_name} - {editingLesson.date}
            </h3>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
                Тема урока:
              </label>
              <textarea
                value={lessonTopic}
                onChange={(e) => setLessonTopic(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: "60px",
                  padding: "8px",
                  fontSize: "14px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontFamily: "inherit",
                }}
                placeholder="Введите тему урока..."
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
                Домашнее задание:
              </label>
              <textarea
                value={homework}
                onChange={(e) => setHomework(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: "80px",
                  padding: "8px",
                  fontSize: "14px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontFamily: "inherit",
                }}
                placeholder="Введите домашнее задание..."
              />
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setEditingLesson(null)}
                style={{
                  padding: "8px 16px",
                  border: "1px solid #ccc",
                  backgroundColor: "white",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
              <button
                onClick={saveLessonInfo}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  backgroundColor: "#0066cc",
                  color: "white",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
