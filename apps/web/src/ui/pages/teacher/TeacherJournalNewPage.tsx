import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { trackedFetch } from "../../../api/client";
import styles from "./TeacherJournalNew.module.css";

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

export function TeacherJournalNewPage() {
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
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

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
    setError(null);
    try {
      const resp = await trackedFetch(`/api/journal/teacher/lessons/${selectedDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load lessons");
      const data = await resp.json();
      setLessons(data.lessons || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadLessonDetails() {
    if (!token || !selectedLesson) return;
    setLoading(true);
    setError(null);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveGrade(studentId: string, grade: number | null, present: boolean | null, comment?: string) {
    if (!token || !selectedLesson) return;
    setSaving(true);
    setError(null);
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
      await loadLessonDetails();
      showSuccess("Оценка сохранена");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveLessonInfo() {
    if (!token || !selectedLesson || !lessonDetails) return;
    setSaving(true);
    setError(null);
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
      showSuccess("Тема и ДЗ сохранены");
      await loadLessonDetails();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function bulkMarkAttendance(present: boolean) {
    if (!token || !selectedLesson || selectedStudents.size === 0) return;
    setSaving(true);
    setError(null);
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
      showSuccess(`Отмечено: ${present ? "присутствуют" : "отсутствуют"}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function markAllPresent() {
    if (!token || !selectedLesson || !lessonDetails) return;
    const allStudentIds = lessonDetails.students.map((s) => s.id);
    setSaving(true);
    setError(null);
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
          student_ids: allStudentIds,
          present: true,
        }),
      });
      if (!resp.ok) throw new Error("Failed to mark all present");
      await loadLessonDetails();
      showSuccess("Все отмечены присутствующими");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
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

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  const today = new Date().toISOString().split("T")[0];

  return (
    <AppShell
      title="Учитель → Журнал оценок"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "📓 Журнал" },
        { to: "/app/teacher/my-vzvody", label: "Мои взводы" },
      ]}
    >
      <div className={styles.container}>
        <h2>📓 Классный журнал</h2>

        {error && <div className={styles.error}>{error}</div>}
        {successMsg && <div className={styles.success}>{successMsg}</div>}

        {/* Выбор даты */}
        <div className={styles.dateSelector}>
          <button onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() - 86400000).toISOString().split("T")[0])}>
            ← Пред. день
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={styles.dateInput}
          />
          <button onClick={() => setSelectedDate(today)}>Сегодня</button>
          <button onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() + 86400000).toISOString().split("T")[0])}>
            След. день →
          </button>
        </div>

        {/* Список уроков на выбранную дату */}
        {loading && !lessonDetails && <Loader text="Загрузка уроков..." />}

        {!loading && lessons.length === 0 && (
          <div className={styles.noLessons}>На эту дату у вас нет уроков</div>
        )}

        {!loading && lessons.length > 0 && !selectedLesson && (
          <div className={styles.lessonsList}>
            <h3>📅 Выберите урок для заполнения журнала:</h3>
            <p className={styles.dateHeader}>
              {new Date(selectedDate).toLocaleDateString("ru-RU", { 
                weekday: "long", 
                day: "numeric", 
                month: "long",
                year: "numeric"
              })}
            </p>
            <div className={styles.lessonsGrid}>
              {lessons.map((lesson) => (
                <div
                  key={lesson.timetable_entry_id}
                  className={`${styles.lessonCard} ${lesson.has_journal_entries ? styles.lessonFilled : ""}`}
                  onClick={() => setSelectedLesson(lesson)}
                >
                  <div className={styles.lessonTime}>
                    🕐 {lesson.start_time?.substring(0, 5)} - {lesson.end_time?.substring(0, 5)}
                  </div>
                  <div className={styles.lessonSubject}>{lesson.subject_name || lesson.subject}</div>
                  <div className={styles.lessonClass}>👥 {lesson.class_name}</div>
                  {lesson.room && <div className={styles.lessonRoom}>📍 Ауд. {lesson.room}</div>}
                  {lesson.has_journal_entries && <div className={styles.lessonBadge}>✓ Заполнен</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Детали выбранного урока */}
        {selectedLesson && (
          <div className={styles.lessonDetailsContainer}>
            <div className={styles.lessonHeader}>
              <button onClick={() => { setSelectedLesson(null); setLessonDetails(null); }} className={styles.backBtn}>
                ← Назад к списку уроков
              </button>
              <div className={styles.lessonInfo}>
                <h3>
                  📚 {selectedLesson.subject_name || selectedLesson.subject} • {selectedLesson.class_name}
                </h3>
                <p>
                  🕐 {selectedLesson.start_time?.substring(0, 5)} - {selectedLesson.end_time?.substring(0, 5)}
                  {selectedLesson.room && ` | 📍 Ауд. ${selectedLesson.room}`}
                  {" | "}📅 {new Date(selectedDate).toLocaleDateString("ru-RU", { 
                    day: "numeric", 
                    month: "long",
                    year: "numeric"
                  })}
                </p>
              </div>
            </div>

            {loading && <Loader text="Загрузка студентов..." />}

            {!loading && lessonDetails && (
              <>
                {/* Тема урока и ДЗ */}
                <div className={styles.lessonInfoSection}>
                  <div className={styles.inputGroup}>
                    <label>📖 Тема урока:</label>
                    <input
                      type="text"
                      value={lessonTopic}
                      onChange={(e) => setLessonTopic(e.target.value)}
                      placeholder="Введите тему урока"
                      className={styles.topicInput}
                    />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>📚 Домашнее задание:</label>
                    <textarea
                      value={homework}
                      onChange={(e) => setHomework(e.target.value)}
                      placeholder="Введите домашнее задание"
                      className={styles.homeworkInput}
                      rows={3}
                    />
                  </div>
                  <button onClick={saveLessonInfo} disabled={saving} className={styles.saveInfoBtn}>
                    {saving ? "Сохранение..." : "💾 Сохранить тему и ДЗ"}
                  </button>
                </div>

                {/* Массовые операции */}
                <div className={styles.bulkActions}>
                  <div className={styles.bulkLeft}>
                    <span className={styles.selectedCount}>Выбрано: {selectedStudents.size}</span>
                    {selectedStudents.size > 0 && (
                      <>
                        <button onClick={() => bulkMarkAttendance(true)} disabled={saving} className={styles.btnPresent}>
                          ✓ Присутствуют
                        </button>
                        <button onClick={() => bulkMarkAttendance(false)} disabled={saving} className={styles.btnAbsent}>
                          ✗ Отсутствуют
                        </button>
                        <button onClick={deselectAll} className={styles.btnSecondary}>Снять выделение</button>
                      </>
                    )}
                    {selectedStudents.size === 0 && (
                      <>
                        <button onClick={selectAll} className={styles.btnSecondary}>Выбрать всех</button>
                        <button onClick={markAllPresent} disabled={saving} className={styles.btnPrimary}>
                          ✓ Отметить всех присутствующими
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Таблица студентов */}
                <div className={styles.studentsTable}>
                  <div className={styles.tableHeader}>
                    <h4>👥 Список учащихся ({lessonDetails.students.length} чел.)</h4>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: "40px" }}>
                          <input
                            type="checkbox"
                            checked={selectedStudents.size === lessonDetails.students.length && lessonDetails.students.length > 0}
                            onChange={(e) => (e.target.checked ? selectAll() : deselectAll())}
                          />
                        </th>
                        <th style={{ width: "60px" }}>№</th>
                        <th>Студент</th>
                        <th style={{ width: "140px" }}>Присутствие</th>
                        <th style={{ width: "100px" }}>Оценка</th>
                        <th>Комментарий</th>
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
                          <td className={styles.studentNumber}>{student.student_number || "—"}</td>
                          <td className={styles.studentName}>{student.name}</td>
                          <td className={styles.attendance}>
                            <button
                              onClick={() => handlePresentToggle(student.id, student.present)}
                              className={
                                student.present === true
                                  ? styles.presentBtn
                                  : student.present === false
                                  ? styles.absentBtn
                                  : styles.unknownBtn
                              }
                              disabled={saving}
                            >
                              {student.present === true ? "✓ Присутствует" : student.present === false ? "✗ Отсутствует" : "— Не отмечено"}
                            </button>
                          </td>
                          <td className={styles.gradeCell}>
                            <input
                              type="number"
                              min="1"
                              max="5"
                              value={student.grade || ""}
                              onChange={(e) => handleGradeInput(student.id, e.target.value)}
                              placeholder="—"
                              className={styles.gradeInput}
                              disabled={saving}
                            />
                          </td>
                          <td className={styles.commentCell}>
                            <span title={student.comment || ""}>{student.comment || ""}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
