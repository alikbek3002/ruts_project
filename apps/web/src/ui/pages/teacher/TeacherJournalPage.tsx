import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  Clock, 
  MapPin, 
  BookOpen, 
  Check, 
  X as XIcon, 
  Save, 
  User,
  MoreHorizontal
} from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { trackedFetch } from "../../../api/client";
import styles from "./TeacherJournalPage.module.css";

type Lesson = {
  timetable_entry_id: string;
  date: string;
  start_time: string;
  end_time: string;
  subject: string;
  subject_name: string;
  class_id: string;
  class_name: string;
  room?: string;
  has_journal_entries?: boolean;
};

type Student = {
  id: string;
  name: string;
  username: string;
  student_number: number | null;
  grade: number | null;
  present: boolean | null;
  comment: string | null;
};

type LessonDetails = {
  lesson: {
    timetable_entry_id: string;
    date: string;
    subject: string;
    subject_name: string;
    class_id: string;
    class_name: string;
    start_time: string;
    end_time: string;
    room?: string;
    lesson_topic: string | null;
    homework: string | null;
  };
  students: Student[];
};

export function TeacherJournalPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonDetails, setLessonDetails] = useState<LessonDetails | null>(null);
  
  const [lessonTopic, setLessonTopic] = useState("");
  const [homework, setHomework] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  // Local state for editing comments before blur
  const [editingComment, setEditingComment] = useState<{id: string, value: string} | null>(null);

  useEffect(() => {
    if (!token) return;
    loadLessonsForDate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, token]);

  useEffect(() => {
    if (!selectedLesson || !token) return;
    loadLessonDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLesson, token]);

  async function loadLessonsForDate() {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await trackedFetch(`/api/journal/teacher/lessons/${selectedDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load lessons");
      const data = await resp.json();
      setLessons(data.lessons || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadLessonDetails() {
    if (!token || !selectedLesson) return;
    setLoading(true);
    try {
      const resp = await trackedFetch(
        `/api/journal/lesson-details?timetable_entry_id=${selectedLesson.timetable_entry_id}&lesson_date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) throw new Error("Failed to load lesson details");
      const data = await resp.json();
      setLessonDetails(data);
      setLessonTopic(data.lesson.lesson_topic || "");
      setHomework(data.lesson.homework || "");
      setSelectedStudents(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function saveGrade(studentId: string, grade: number | null, present: boolean | null, comment?: string) {
    if (!token || !selectedLesson) return;
    // Optimistic update
    setLessonDetails(prev => {
      if (!prev) return null;
      return {
        ...prev,
        students: prev.students.map(s => {
          if (s.id === studentId) {
            return { 
              ...s, 
              grade: grade !== undefined ? grade : s.grade,
              present: present !== undefined ? present : s.present,
              comment: comment !== undefined ? comment : s.comment
            };
          }
          return s;
        })
      };
    });

    try {
      const resp = await trackedFetch(`/api/journal/classes/${lessonDetails?.lesson.class_id}/grades`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          student_id: studentId,
          timetable_entry_id: selectedLesson.timetable_entry_id,
          lesson_date: selectedDate,
          grade,
          present: present ?? true,
          comment,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save grade");
    } catch (e) {
      console.error(e);
      // Revert on error would be ideal, but for now just log
      loadLessonDetails();
    }
  }

  async function saveLessonInfo() {
    if (!token || !selectedLesson || !lessonDetails) return;
    setSaving(true);
    try {
      const resp = await trackedFetch(`/api/journal/classes/${lessonDetails.lesson.class_id}/lesson-info`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timetable_entry_id: selectedLesson.timetable_entry_id,
          lesson_date: selectedDate,
          lesson_topic: lessonTopic || null,
          homework: homework || null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save lesson info");
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function bulkMarkAttendance(present: boolean) {
    if (!token || !selectedLesson || selectedStudents.size === 0) return;
    setSaving(true);
    try {
      const resp = await trackedFetch(`/api/journal/bulk-attendance`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timetable_entry_id: selectedLesson.timetable_entry_id,
          lesson_date: selectedDate,
          student_ids: Array.from(selectedStudents),
          present,
        }),
      });
      if (!resp.ok) throw new Error("Failed to mark attendance");
      await loadLessonDetails();
      setSelectedStudents(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function toggleStudentSelection(studentId: string) {
    const newSet = new Set(selectedStudents);
    if (newSet.has(studentId)) {
      newSet.delete(studentId);
    } else {
      newSet.add(studentId);
    }
    setSelectedStudents(newSet);
  }

  function selectAll() {
    if (!lessonDetails) return;
    setSelectedStudents(new Set(lessonDetails.students.map((s) => s.id)));
  }

  function deselectAll() {
    setSelectedStudents(new Set());
  }

  function handleGradeInput(studentId: string, value: string) {
    const grade = value ? parseInt(value, 10) : null;
    if (grade !== null && (grade < 1 || grade > 5)) return;
    saveGrade(studentId, grade, null);
  }

  function handlePresentToggle(studentId: string, currentPresent: boolean | null) {
    const newPresent = currentPresent === true ? false : true;
    saveGrade(studentId, null, newPresent);
  }

  function handleCommentBlur(studentId: string, value: string) {
    setEditingComment(null);
    saveGrade(studentId, null, null, value);
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  const today = new Date().toISOString().split("T")[0];

  return (
    <AppShell
      title="Учитель → Журнал"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>
            <BookOpen size={28} />
            Классный журнал
          </h1>

          <div className={styles.dateSelector}>
            <button 
              className={styles.navBtn} 
              onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() - 86400000).toISOString().split("T")[0])}
            >
              <ChevronLeft size={20} />
            </button>
            
            <div className={styles.dateDisplay}>
              {new Date(selectedDate).toLocaleDateString("ru-RU", { 
                weekday: "short", 
                day: "numeric", 
                month: "long"
              })}
            </div>

            <button 
              className={styles.navBtn} 
              onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() + 86400000).toISOString().split("T")[0])}
            >
              <ChevronRight size={20} />
            </button>

            <button className={styles.todayBtn} onClick={() => setSelectedDate(today)}>
              Сегодня
            </button>
            
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ marginLeft: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px' }}
            />
          </div>
        </div>

        {loading && !lessonDetails && <Loader text="Загрузка..." />}

        {!selectedLesson && !loading && (
          <>
            <h3 className={styles.sectionTitle}>Уроки на сегодня:</h3>
            {lessons.length === 0 ? (
              <div className={styles.emptyState}>На эту дату уроков нет</div>
            ) : (
              <div className={styles.grid}>
                {lessons.map((lesson) => (
                  <div
                    key={lesson.timetable_entry_id}
                    className={styles.card}
                    onClick={() => setSelectedLesson(lesson)}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.timeTag}>
                        {lesson.start_time?.substring(0, 5)} - {lesson.end_time?.substring(0, 5)}
                      </div>
                      <div className={`${styles.statusTag} ${lesson.has_journal_entries ? styles.statusDone : styles.statusPending}`}>
                        {lesson.has_journal_entries ? "Заполнен" : "Ожидает"}
                      </div>
                    </div>
                    <div className={styles.subjectName}>{lesson.subject_name || lesson.subject}</div>
                    <div className={styles.className}>
                      <User size={16} /> {lesson.class_name}
                    </div>
                    {lesson.room && (
                      <div className={styles.roomInfo}>
                        <MapPin size={14} /> Ауд. {lesson.room}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {selectedLesson && (
          <div className={styles.detailsContainer}>
            <div className={styles.detailsHeader}>
              <div className={styles.detailsTitle}>
                <h2>{selectedLesson.subject_name || selectedLesson.subject}</h2>
                <div className={styles.detailsMeta}>
                  <span>{selectedLesson.class_name}</span>
                  <span>•</span>
                  <span>{new Date(selectedDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span>
                  <span>•</span>
                  <span>{selectedLesson.start_time?.substring(0, 5)} - {selectedLesson.end_time?.substring(0, 5)}</span>
                </div>
              </div>
              <button 
                className={styles.closeBtn} 
                onClick={() => { setSelectedLesson(null); setLessonDetails(null); }}
              >
                <XIcon size={20} />
              </button>
            </div>

            <div className={styles.detailsContent}>
              {loading ? (
                <Loader text="Загрузка списка..." />
              ) : lessonDetails ? (
                <>
                  <div className={styles.infoGrid}>
                    <div className={styles.inputGroup}>
                      <label>Тема урока</label>
                      <input
                        className={styles.textInput}
                        value={lessonTopic}
                        onChange={(e) => setLessonTopic(e.target.value)}
                        placeholder="Введите тему урока..."
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>Домашнее задание</label>
                      <textarea
                        className={styles.textArea}
                        rows={1}
                        value={homework}
                        onChange={(e) => setHomework(e.target.value)}
                        placeholder="Введите домашнее задание..."
                      />
                    </div>
                  </div>
                  
                  <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      className={styles.saveBtn} 
                      onClick={saveLessonInfo} 
                      disabled={saving}
                    >
                      <Save size={18} />
                      Сохранить тему и ДЗ
                    </button>
                  </div>

                  <div className={styles.tableControls}>
                    <div className={styles.bulkActions}>
                      {selectedStudents.size > 0 ? (
                        <>
                          <button className={`${styles.actionBtn} ${styles.btnGreen}`} onClick={() => bulkMarkAttendance(true)}>
                            <Check size={14} /> Присутствуют
                          </button>
                          <button className={`${styles.actionBtn} ${styles.btnRed}`} onClick={() => bulkMarkAttendance(false)}>
                            <XIcon size={14} /> Отсутствуют
                          </button>
                          <button className={`${styles.actionBtn} ${styles.btnGray}`} onClick={deselectAll}>
                            Снять выделение ({selectedStudents.size})
                          </button>
                        </>
                      ) : (
                        <button className={`${styles.actionBtn} ${styles.btnGray}`} onClick={selectAll}>
                          Выбрать всех
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>
                      Всего учеников: {lessonDetails.students.length}
                    </div>
                  </div>

                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>
                            <input
                              type="checkbox"
                              checked={selectedStudents.size === lessonDetails.students.length && lessonDetails.students.length > 0}
                              onChange={(e) => (e.target.checked ? selectAll() : deselectAll())}
                            />
                          </th>
                          <th style={{ width: 50 }}>№</th>
                          <th>Ученик</th>
                          <th style={{ width: 100, textAlign: 'center' }}>Посещ.</th>
                          <th style={{ width: 80, textAlign: 'center' }}>Оценка</th>
                          <th>Комментарий / Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lessonDetails.students.map((student) => (
                          <tr key={student.id} className={selectedStudents.has(student.id) ? styles.selected : ""}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedStudents.has(student.id)}
                                onChange={() => toggleStudentSelection(student.id)}
                              />
                            </td>
                            <td style={{ color: '#9ca3af', textAlign: 'center' }}>{student.student_number || "—"}</td>
                            <td>
                              <div className={styles.studentInfo}>
                                <div className={styles.avatar}>
                                  {student.name.charAt(0)}
                                </div>
                                <span className={styles.name}>{student.name}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <button
                                  onClick={() => handlePresentToggle(student.id, student.present)}
                                  className={`${styles.attendanceBtn} ${
                                    student.present === true ? styles.present : 
                                    student.present === false ? styles.absent : ''
                                  }`}
                                  title={student.present === true ? "Присутствует" : student.present === false ? "Отсутствует" : "Не отмечено"}
                                >
                                  {student.present === true ? <Check size={18} /> : 
                                   student.present === false ? <XIcon size={18} /> : 
                                   <MoreHorizontal size={18} />}
                                </button>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <input
                                  type="number"
                                  min="1"
                                  max="5"
                                  value={student.grade || ""}
                                  onChange={(e) => handleGradeInput(student.id, e.target.value)}
                                  className={`${styles.gradeInput} ${student.grade ? styles[`grade${student.grade}`] : ''}`}
                                  placeholder="—"
                                />
                              </div>
                            </td>
                            <td>
                              <input
                                className={styles.commentInput}
                                value={editingComment?.id === student.id ? editingComment.value : (student.comment || "")}
                                onChange={(e) => setEditingComment({ id: student.id, value: e.target.value })}
                                onFocus={() => setEditingComment({ id: student.id, value: student.comment || "" })}
                                onBlur={(e) => handleCommentBlur(student.id, e.target.value)}
                                placeholder="Примечание..."
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
