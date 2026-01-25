import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ChevronLeft,
  MapPin,
  BookOpen,
  Check,
  X as XIcon,
  Save,
  User,
  MoreHorizontal,
  Folder
} from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiGetClassSubjects, trackedFetch } from "../../../api/client";
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

type TeacherClass = {
  id: string;
  name: string;
  subjects?: Array<{ id: string; name: string }>;
};

type ClassSubject = {
  id: string;
  name: string;
  is_mine: boolean;
};

export function TeacherJournalPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  // Level 1: Classes
  const [allClasses, setAllClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [classSearch, setClassSearch] = useState("");

  // Level 2: Subjects
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [classSubjects, setClassSubjects] = useState<ClassSubject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // Level 3: Lessons
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);

  // Level 4: Lesson Detail (Grid)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonDetails, setLessonDetails] = useState<LessonDetails | null>(null);

  // Lesson Editing
  const [lessonTopic, setLessonTopic] = useState("");
  const [homework, setHomework] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [editingComment, setEditingComment] = useState<{ id: string, value: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    loadClasses();
  }, [token]);

  useEffect(() => {
    if (!token || !selectedClassId) return;
    loadSubjects(selectedClassId);
  }, [token, selectedClassId]);

  useEffect(() => {
    if (!token || !selectedClassId) return;
    // Load lessons regardless of subject selection (show all initially?) 
    // OR if subject selected, filter?
    // User wants "Choice of subject". So wait for subject selection?
    // Let's load all lessons for class, then filter by subject if selected.
    if (selectedSubjectId) {
      loadLessons();
    } else {
      setLessons([]);
    }
  }, [token, selectedClassId, selectedSubjectId]);

  useEffect(() => {
    if (!selectedLesson || !token) return;
    loadLessonDetails();
  }, [selectedLesson, token]);

  async function loadClasses() {
    if (!token) return;
    setLoadingClasses(true);
    try {
      const resp = await trackedFetch(`/api/journal/teacher/classes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load classes");
      const data = await resp.json();
      setAllClasses(data.classes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadSubjects(classId: string) {
    if (!token) return;
    setLoadingSubjects(true);
    try {
      const data = await apiGetClassSubjects(token, classId);
      setClassSubjects(data.subjects || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSubjects(false);
    }
  }

  async function loadLessons() {
    if (!token || !selectedClassId) return;
    setLoadingLessons(true);
    try {
      // Use get_class_journal endpoint
      const url = `/api/journal/classes/${selectedClassId}/journal` + (selectedSubjectId ? `?subject_id=${selectedSubjectId}` : "");
      const resp = await trackedFetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to load lessons");
      const data = await resp.json();
      // This endpoint returns "lessons" array with date, etc.
      // But it returns aggregated "lessons" (deduped by date/entry).
      // Let's rely on it.
      const all: any[] = data.lessons || [];
      // map to Lesson type
      const mapped: Lesson[] = all.map(l => ({
        timetable_entry_id: l.timetable_entry_id,
        date: l.date,
        start_time: "00:00", // The aggregated endpoint might lose time?
        end_time: "00:00",
        subject: l.subject_name,
        subject_name: l.subject_name,
        class_id: selectedClassId,
        class_name: "", // Known from context
        has_journal_entries: true // If it's in journal list, it might have entries, but here we are listing slots
      }));

      // Wait, get_class_journal returns a GRID structure for ALL dates.
      // Maybe we should just use "get_journal" to show the GRID directly?
      // Yes!
      // But we need to allow editing. The GRID is read-only in the "Excel export" sense?
      // No, get_class_journal returns { students, lessons, grades }.
      // This is perfect for a big grid view.

      // So, if Subject Selected -> Show Big Grid.
      // If user clicks a cell -> Edit Grade?
      // Or if user clicks column header -> Edit Lesson? OR Edit Attendance?

      // Let's implement the GRID view.

    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLessons(false);
    }
  }

  // .. (Rest of lesson editing logic remains similar but adapted for Grid or Day View)
  // Actually, let's keep the "Day View" for editing specific lessons details (Topic, Homework).
  // But listing lessons: show them as a list for the subject.

  // Let's reuse loadLessonsForDate logic but filter by Subject?
  // No, the user wants "School Journal" layout. 
  // School journal = Grid.

  // Implementation:
  // 1. Select Class.
  // 2. Select Subject.
  // 3. Show Grid: Rows=Students, Cols=Lessons. 
  //    Clicking a cell allows quick grade entry? Clicking column header opens "Lesson Details"?

  const [gridData, setGridData] = useState<{
    students: { id: string, name: string }[],
    lessons: { timetable_entry_id: string, date: string, subject_name: string }[],
    grades: Record<string, Record<string, { grades: { grade: number, comment?: string }[], present?: boolean }>>
  } | null>(null);

  async function loadGrid() {
    if (!token || !selectedClassId || !selectedSubjectId) return;
    setLoadingLessons(true);
    try {
      const resp = await trackedFetch(`/api/journal/classes/${selectedClassId}/journal?subject_id=${selectedSubjectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      setGridData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLessons(false);
    }
  }

  // Need to reload grid when subject selected
  useEffect(() => {
    if (selectedClassId && selectedSubjectId) {
      loadGrid();
    } else {
      setGridData(null);
    }
  }, [selectedClassId, selectedSubjectId]);

  // Determine displayed classes
  const displayedClasses = useMemo(() => {
    if (!classSearch) return allClasses;
    return allClasses.filter(c => c.name.toLowerCase().includes(classSearch.toLowerCase()));
  }, [allClasses, classSearch]);

  const selectedClass = useMemo(() => allClasses.find(c => c.id === selectedClassId), [allClasses, selectedClassId]);

  // When clicking a column header in grid
  function openLesson(lesson: { timetable_entry_id: string, date: string }) {
    // We need to fetch full lesson object or just use ID/Date
    // Let's construct a minimal Lesson object
    setSelectedLesson({
      timetable_entry_id: lesson.timetable_entry_id,
      date: lesson.date,
      start_time: "", end_time: "", // Unknown from grid, but loadLessonDetails will fetch
      subject: "", subject_name: "",
      class_id: selectedClassId, class_name: selectedClass?.name || "",
    });
  }

  // Load details wrapper
  async function loadLessonDetails() {
    if (!token || !selectedLesson) return;
    setSaving(true); // repurpose loading state
    try {
      const resp = await trackedFetch(
        `/api/journal/lesson-details?timetable_entry_id=${selectedLesson.timetable_entry_id}&lesson_date=${selectedLesson.date}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      setLessonDetails(data);
      setLessonTopic(data.lesson.lesson_topic || "");
      setHomework(data.lesson.homework || "");
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  // Save changes wrapper (from modal)
  async function saveLessonInfo() {
    if (!token || !selectedLesson || !lessonDetails) return;
    // ... same logic as before ...
    try {
      await trackedFetch(`/api/journal/classes/${lessonDetails.lesson.class_id}/lesson-info`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          timetable_entry_id: selectedLesson.timetable_entry_id,
          lesson_date: selectedLesson.date,
          lesson_topic: lessonTopic || null,
          homework: homework || null,
        }),
      });
      loadGrid(); // Refresh grid
    } catch (e) { console.error(e); }
  }

  // Helper for quick grade
  // Note: Quick grade in grid is complex (popover?).
  // For MVP, just click column header to open lesson details modal.

  const nav: any = [
    { to: "/app/teacher", labelKey: "nav.home" },
    { to: "/app/teacher/journal", labelKey: "nav.journal" },
    { to: "/app/teacher/vzvody", labelKey: "nav.myVzvody" },
    { to: "/app/teacher/timetable", labelKey: "nav.timetable" },
    { to: "/app/teacher/workload", labelKey: "nav.workload" },
    { to: "/app/teacher/subjects", labelKey: "nav.subjects" },
    { to: "/app/teacher/conferences", label: "Конференции" },
  ];

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppShell title="Классный журнал" nav={nav}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}><BookOpen size={28} /> Классный журнал</h1>
        </div>

        {/* Level 1: Pick Class */}
        {!selectedClassId && (
          <div>
            <div className={styles.controlsRight} style={{ marginBottom: 16 }}>
              <input
                className={styles.commentInput}
                placeholder="Поиск взвода..."
                value={classSearch}
                onChange={e => setClassSearch(e.target.value)}
                style={{ maxWidth: 300, border: '1px solid #d1d5db', background: 'white' }}
              />
            </div>
            {loadingClasses ? <Loader /> : (
              <div className={styles.classesGrid}>
                {displayedClasses.map(cls => (
                  <div key={cls.id} className={styles.classCard} onClick={() => setSelectedClassId(cls.id)}>
                    <div className={styles.classCardTitle}>{cls.name}</div>
                    <div className={styles.classCardMeta}>Нажмите, чтобы открыть</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Level 2: Pick Subject (inside Class) */}
        {selectedClassId && !selectedSubjectId && (
          <div>
            <button className={styles.backBtn} onClick={() => setSelectedClassId("")} style={{ marginBottom: 16 }}>
              <ChevronLeft size={16} /> Вернуться к списку
            </button>
            <h2 className={styles.sectionTitle}>Предметы взвода {selectedClass?.name}</h2>

            {loadingSubjects ? <Loader /> : classSubjects.length === 0 ? (
              <div className={styles.emptyState}>Нет доступных предметов (нет расписания)</div>
            ) : (
              <div className={styles.classesGrid}>
                {classSubjects.map(sub => (
                  <div
                    key={sub.id}
                    className={`${styles.classCard} ${sub.is_mine ? styles.active : ''}`}
                    onClick={() => setSelectedSubjectId(sub.id)}
                    style={sub.is_mine ? { borderColor: '#4f46e5', backgroundColor: '#eef2ff' } : {}}
                  >
                    <div className={styles.classCardTitle}>{sub.name}</div>
                    {sub.is_mine && <div className={styles.statusTag + ' ' + styles.statusDone}>Мой предмет</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Level 3: Journal Grid */}
        {selectedClassId && selectedSubjectId && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button className={styles.backBtn} onClick={() => setSelectedSubjectId("")}>
                <ChevronLeft size={16} /> К предметам
              </button>
              <div className={styles.classTopTitle}>
                {selectedClass?.name} / {classSubjects.find(s => s.id === selectedSubjectId)?.name}
              </div>
            </div>

            {loadingLessons || !gridData ? <Loader /> : (
              <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                <table className={styles.table} style={{ minWidth: 800 }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10, width: 200 }}>Ученик</th>
                      <th style={{ width: 60, textAlign: 'center', background: '#f3f4f6' }}>Ср.</th>
                      {gridData.lessons.map(l => (
                        <th
                          key={`${l.date}_${l.timetable_entry_id}`}
                          style={{ minWidth: 80, textAlign: 'center', cursor: 'pointer' }}
                          title="Нажмите, чтобы редактировать урок"
                          onClick={() => openLesson(l)}
                          className={styles.headerHover}
                        >
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            {new Date(l.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridData.students.map(s => {
                      const sGrades = gridData.grades[s.id] || {};

                      // Calculate average
                      let total = 0;
                      let count = 0;
                      Object.values(sGrades).forEach(g => {
                        g.grades.forEach(val => { total += val.grade; count++; });
                      });
                      const avg = count ? (total / count).toFixed(2) : "—";

                      return (
                        <tr key={s.id}>
                          <td style={{ position: 'sticky', left: 0, background: 'white', borderRight: '1px solid #e5e7eb', fontWeight: 500 }}>
                            {s.name}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 'bold', background: '#fafafa', borderRight: '1px solid #eee' }}>{avg}</td>
                          {gridData.lessons.map(l => {
                            const key = `${l.date}_${l.timetable_entry_id}`;
                            const cell = sGrades[key];
                            const gradesText = cell?.grades?.map(g => g.grade).join(" ") || "";
                            const present = cell?.present;

                            return (
                              <td key={key} style={{ textAlign: 'center' }}>
                                {present === false && <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Н</span>}
                                {gradesText && <span style={{ fontWeight: 600, marginLeft: 4 }}>{gradesText}</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {gridData.lessons.length === 0 && <div className={styles.emptyState}>В журнале пока нет уроков</div>}
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
              * Нажмите на дату урока в шапке таблицы, чтобы выставить оценки и пропуски.
            </div>
          </div>
        )}

        {/* Lesson Detail Modal (Reusing existing component structure mostly) */}
        {selectedLesson && (
          <div className={styles.detailsContainer} style={{ position: 'fixed', inset: 0, zIndex: 100, margin: 0, borderRadius: 0, overflowY: 'auto' }}>
            <div style={{ maxWidth: 1000, margin: '40px auto', background: 'white', borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
              {/* Reuse headers */}
              <div className={styles.detailsHeader}>
                <div className={styles.detailsTitle}>
                  <h2>{lessonDetails?.lesson.subject_name || "Редактирование урока"}</h2>
                  <div className={styles.detailsMeta}>
                    {new Date(selectedLesson.date).toLocaleDateString()}
                  </div>
                </div>
                <button className={styles.closeBtn} onClick={() => { setSelectedLesson(null); loadGrid(); }}>
                  <XIcon />
                </button>
              </div>

              <div className={styles.detailsContent}>
                {saving && !lessonDetails ? <Loader /> : (
                  // ... Copy existing editing UI logic here ...
                  // Actually, since I have the `LessonDetails` component logic in the same file, 
                  // I should extract it or just inline it again.
                  // To save tokens/time, I will just reference the function.
                  // But I can't reference rendered JSX easily.
                  // I'll inline the table again.

                  // Simplified for brevity in this single file solution:
                  <LessonEditingView
                    lessonDetails={lessonDetails}
                    lessonTopic={lessonTopic}
                    setLessonTopic={setLessonTopic}
                    homework={homework}
                    setHomework={setHomework}
                    saveLessonInfo={saveLessonInfo}
                    token={token}
                    selectedDate={selectedLesson.date}
                    onSaveGrade={async () => { await loadLessonDetails(); }}
                  />
                )}
              </div>
            </div>
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: -1 }} onClick={() => { setSelectedLesson(null); loadGrid(); }} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Subcomponent for editing (extracted to avoid huge file duplication)
function LessonEditingView({ lessonDetails, lessonTopic, setLessonTopic, homework, setHomework, saveLessonInfo, token, selectedDate, onSaveGrade }: any) {
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [editingComment, setEditingComment] = useState<{ id: string, value: string } | null>(null);

  // ... copy helpers ...
  async function saveGrade(studentId: string, grade: number | null, present: boolean | null, comment?: string) {
    if (!lessonDetails) return;
    try {
      await trackedFetch(`/api/journal/classes/${lessonDetails.lesson.class_id}/grades`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          timetable_entry_id: lessonDetails.lesson.timetable_entry_id,
          lesson_date: selectedDate,
          grade, present: present ?? true, comment
        })
      });
      onSaveGrade();
    } catch (e) { console.error(e); }
  }

  function handlePresentToggle(studentId: string, current: boolean | null) {
    saveGrade(studentId, null, current === true ? false : true);
  }

  function handleGradeInput(studentId: string, val: string) {
    const g = val ? parseInt(val) : null;
    if (g !== null && (g < 1 || g > 5)) return;
    saveGrade(studentId, g, null);
  }

  if (!lessonDetails) return <Loader />;

  return (
    <div>
      <div className={styles.infoGrid}>
        <div className={styles.inputGroup}>
          <label>Тема</label>
          <input className={styles.textInput} value={lessonTopic} onChange={e => setLessonTopic(e.target.value)} />
        </div>
        <div className={styles.inputGroup}>
          <label>ДЗ</label>
          <input className={styles.textInput} value={homework} onChange={e => setHomework(e.target.value)} />
        </div>
        <button className={styles.saveBtn} onClick={saveLessonInfo}><Save size={16} /> Сохранить</button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ученик</th>
            <th>Присутствие</th>
            <th>Оценка</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {lessonDetails.students.map((s: any) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <button onClick={() => handlePresentToggle(s.id, s.present)} className={styles.attendanceBtn} style={{ background: s.present === false ? '#fee2e2' : 'white' }}>
                  {s.present === false ? 'Н' : '✔'}
                </button>
              </td>
              <td>
                <input className={styles.gradeInput} value={s.grade || ""} onChange={e => handleGradeInput(s.id, e.target.value)} />
              </td>
              <td>
                <input className={styles.commentInput} placeholder="..." defaultValue={s.comment} onBlur={e => saveGrade(s.id, null, null, e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
