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
import {
  apiGetClassSubjects,
  apiListTeacherClasses,
  apiTimetableWeek,
  apiGetClassJournal,
  apiGetLessonDetails,
  apiSaveLessonGrade,
  apiSaveLessonTopic,
  trackedFetch // Еще нужен для saveLessonInfo, если мы его не перенесли в API
} from "../../../api/client";
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
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Helper functions
  function getMonday(date: Date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function ymd(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function hhmm(t: string): string {
    // Format HH:MM from various string formats
    if (!t) return "";
    if (t.length >= 5) return t.slice(0, 5);
    return t;
  }

  // Auto-select based on schedule
  useEffect(() => {
    if (!token || initialLoadDone) return;

    async function autoSelect() {
      if (!token || allClasses.length === 0) return; // Wait for classes
      try {
        const today = new Date();
        const monday = getMonday(today);
        console.log("TeacherJournal: Fetching timetable for week", ymd(monday));
        const w = await apiTimetableWeek(token, ymd(monday));

        if (!w || !w.entries) {
          console.log("TeacherJournal: Timetable empty", w);
          return;
        }

        console.log("TeacherJournal: Loaded timetable entries", w.entries.length);

        // Find current or next lesson today
        const weekday = (today.getDay() + 6) % 7; // 0=Mon
        const nowMinutes = today.getHours() * 60 + today.getMinutes();

        // 1. Filter for today
        const todayEntries = w.entries.filter(e => e.weekday === weekday);

        // 2. Sort by start time
        todayEntries.sort((a, b) => a.start_time.localeCompare(b.start_time));

        // 3. Find active or next
        let target = todayEntries.find(e => {
          const [h, m] = hhmm(e.end_time).split(':').map(Number);
          const endMins = h * 60 + m;
          return endMins > nowMinutes; // Has not ended yet
        });

        // 4. If no lessons left today, maybe just pick the last one? Or first one?
        // Let's stick to "active or next". If none, try first of today.
        if (!target && todayEntries.length > 0) {
          target = todayEntries[todayEntries.length - 1]; // Last one
        }

        if (target) {
          console.log("TeacherJournal: Auto-selecting target", target);
          setSelectedClassId(target.class_id);
          if (target.subject_id) {
            setSelectedSubjectId(target.subject_id);
          }
          setInitialLoadDone(true); // Only mark done if we found something? Or always?
        } else {
          console.log("TeacherJournal: No target lesson found for auto-select");
        }
      } catch (e) {
        console.error("Auto-select failed", e);
      } finally {
        // setInitialLoadDone(true); // Don't mark done here, wait for classes?
      }
    }

    if (allClasses.length > 0 && !initialLoadDone) {
      autoSelect();
    }
  }, [token, initialLoadDone, allClasses]);

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
      const data = await apiListTeacherClasses(token);
      console.log("TeacherJournal: Loaded classes", data.classes?.length);
      setAllClasses(data.classes || []);
    } catch (e) {
      console.error("Failed to load classes:", e);
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
    students: { id: string, name: string, student_number?: number }[],
    lessons: { timetable_entry_id: string, date: string, subject_name: string }[],
    grades: Record<string, Record<string, { grades: { grade: number, comment?: string }[], present?: boolean, attendance_type?: string }>>
  } | null>(null);

  async function loadGrid() {
    if (!token || !selectedClassId || !selectedSubjectId) return;
    setLoadingLessons(true);
    try {
      const data = await apiGetClassJournal(token, selectedClassId, selectedSubjectId);
      setGridData(data);
    } catch (e) {
      console.error("Failed to load journal grid:", e);
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
      const data = await apiGetLessonDetails(token, selectedLesson.timetable_entry_id, selectedLesson.date);
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
      await apiSaveLessonTopic(token, lessonDetails.lesson.class_id, {
        timetable_entry_id: selectedLesson.timetable_entry_id,
        lesson_date: selectedLesson.date,
        lesson_topic: lessonTopic || null,
        homework: homework || null,
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

        {/* Filter Bar */}
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>
              Взвод (Класс)
            </label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className={styles.selectDropdown}
              disabled={loadingClasses}
            >
              <option value="">-- Выберите взвод --</option>
              {allClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {loadingClasses && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Загрузка...</div>}
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>
              Предмет
            </label>
            <select
              value={selectedSubjectId}
              onChange={e => setSelectedSubjectId(e.target.value)}
              className={styles.selectDropdown}
              disabled={!selectedClassId || loadingSubjects}
            >
              <option value="">-- Выберите предмет --</option>
              {classSubjects.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.is_mine ? "(Мой предмет)" : ""}
                </option>
              ))}
            </select>
            {loadingSubjects && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Загрузка...</div>}
          </div>
        </div>

        {/* Level 3: Journal Grid */}
        {selectedClassId && selectedSubjectId && (
          <div>
            {loadingLessons || !gridData ? <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Loader /></div> : (
              <div className={styles.gridContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.colStudent}>Ученик / Окуучу</th>
                      <th className={styles.cellAvg} title="Средний балл">Ср.</th>
                      {gridData.lessons.map(l => (
                        <th
                          key={`${l.date}_${l.timetable_entry_id}`}
                          className={styles.headerDate}
                          title="Нажмите, чтобы редактировать урок"
                          onClick={() => openLesson(l)}
                        >
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 13, color: '#111' }}>
                              {new Date(l.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridData.students.map((s, idx) => {
                      const sGrades = gridData.grades[s.id] || {};

                      // Calculate average
                      let total = 0;
                      let count = 0;
                      Object.values(sGrades).forEach(g => {
                        g.grades.forEach(val => { total += val.grade; count++; });
                      });
                      const avg = count ? (total / count).toFixed(2) : "—";
                      const rowClass = idx % 2 === 0 ? styles.rowEven : styles.rowOdd;

                      return (
                        <tr key={s.id} className={rowClass}>
                          <td className={styles.colStudent}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 24, textAlign: 'center', color: '#9ca3af', fontWeight: 500 }}>{s.student_number || idx + 1}</div>
                              <div style={{ fontWeight: 500, color: '#1f2937' }}>{s.name}</div>
                            </div>
                          </td>
                          <td className={styles.cellAvg} style={{ color: count ? '#111' : '#9ca3af' }}>{avg}</td>
                          {gridData.lessons.map(l => {
                            const key = `${l.date}_${l.timetable_entry_id}`;
                            const cell = sGrades[key];
                            const gradesText = cell?.grades?.map(g => g.grade).join(" ") || "";

                            let attendanceMark = null;
                            if (cell?.attendance_type) {
                              switch (cell.attendance_type) {
                                case 'absent': attendanceMark = <span style={{ color: '#ef4444', fontWeight: 'bold' }}>КЖ</span>; break;
                                case 'duty': attendanceMark = <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>К</span>; break;
                                case 'excused': attendanceMark = <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>А</span>; break;
                                case 'sick': attendanceMark = <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>О</span>; break;
                                default: attendanceMark = null;
                              }
                            } else if (cell?.present === false) {
                              attendanceMark = <span style={{ color: '#ef4444', fontWeight: 'bold' }}>КЖ</span>;
                            }

                            return (
                              <td key={key} className={styles.cellGrade} onClick={() => openLesson(l)} style={{ cursor: 'pointer' }}>
                                {attendanceMark}
                                {gradesText && <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: 4, marginLeft: attendanceMark ? 4 : 0 }}>{gradesText}</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {gridData.lessons.length === 0 && (
                  <div className={styles.emptyState}>
                    <div style={{ fontSize: 24, marginBottom: 12 }}>📅</div>
                    <div style={{ fontWeight: 600, color: '#374151' }}>Сабактар табылган жок / Уроков не найдено</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      Бул предмет боюнча расписаниеде сабактар жок.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Белгилөө / Обозначения:</h3>
              <div style={{ display: 'flex', gap: 24, padding: '16px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 'bold', color: '#ef4444', background: '#fef2f2', padding: '2px 6px', borderRadius: 4 }}>КЖ</span>
                  <span style={{ fontSize: 13, color: '#4b5563' }}>Келген жок (Отсутствует)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 'bold', color: '#f59e0b', background: '#fffbeb', padding: '2px 6px', borderRadius: 4 }}>К</span>
                  <span style={{ fontSize: 13, color: '#4b5563' }}>Кезмет (Дежурство)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 'bold', color: '#3b82f6', background: '#eff6ff', padding: '2px 6px', borderRadius: 4 }}>А</span>
                  <span style={{ fontSize: 13, color: '#4b5563' }}>Арыз (По заявлению)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 'bold', color: '#8b5cf6', background: '#f5f3ff', padding: '2px 6px', borderRadius: 4 }}>О</span>
                  <span style={{ fontSize: 13, color: '#4b5563' }}>Оруу (Болезнь)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lesson Detail Modal */}
        {selectedLesson && (
          <div className={styles.detailsContainer}>
            <div className={styles.detailsBackdrop} onClick={() => { setSelectedLesson(null); loadGrid(); }} />
            <div className={styles.detailsModal}>
              <div className={styles.detailsHeader}>
                <div className={styles.detailsTitle}>
                  <h2>{lessonDetails?.lesson.subject_name || "Редактирование урока"}</h2>
                  <div className={styles.detailsMeta}>
                    {new Date(selectedLesson.date).toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>
                <button className={styles.closeBtn} onClick={() => { setSelectedLesson(null); loadGrid(); }}>
                  <XIcon size={20} />
                </button>
              </div>

              <div className={styles.detailsContent}>
                {saving && !lessonDetails ? <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader /></div> : (
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

  // Отметки посещаемости на кыргызском
  const attendanceOptions = [
    { value: "present", label: "✓", color: "#22c55e", title: "Келди (Присутствует)" },
    { value: "absent", label: "КЖ", color: "#ef4444", title: "Келген жок (Отсутствует)" },
    { value: "duty", label: "К", color: "#f59e0b", title: "Кезмет (Дежурство)" },
    { value: "excused", label: "А", color: "#3b82f6", title: "Арыз (Уважительная причина)" },
    { value: "sick", label: "О", color: "#8b5cf6", title: "Оруу (Болезнь)" },
  ];

  async function saveGrade(studentId: string, grade: number | null, present: boolean | null, comment?: string, attendanceType?: string) {
    if (!lessonDetails) return;
    try {
      await apiSaveLessonGrade(token, lessonDetails.lesson.class_id, {
        student_id: studentId,
        timetable_entry_id: lessonDetails.lesson.timetable_entry_id,
        lesson_date: selectedDate,
        grade,
        present: present ?? (attendanceType === "present" || attendanceType === "duty"),
        comment: comment,
        attendance_type: attendanceType
      });
      onSaveGrade();
    } catch (e) { console.error(e); }
  }

  function handleAttendanceChange(studentId: string, value: string) {
    const isPresent = value === "present" || value === "duty";
    // Передаем value как attendance_type
    saveGrade(studentId, null, isPresent, undefined, value);
  }

  function handleGradeInput(studentId: string, val: string) {
    const g = val ? parseInt(val) : null;
    if (g !== null && (g < 2 || g > 5)) return; // Оценки от 2 до 5
    saveGrade(studentId, g, null);
  }

  if (!lessonDetails) return <Loader />;

  return (
    <div>
      <div className={styles.infoGrid}>
        <div className={styles.inputGroup}>
          <label>Тема / Темасы</label>
          <input className={styles.textInput} value={lessonTopic} onChange={e => setLessonTopic(e.target.value)} />
        </div>
        <div className={styles.inputGroup}>
          <label>ДЗ / Үй тапшырмасы</label>
          <input className={styles.textInput} value={homework} onChange={e => setHomework(e.target.value)} />
        </div>
        <button className={styles.saveBtn} onClick={saveLessonInfo}><Save size={16} /> Сактоо</button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Окуучу / Ученик</th>
            <th>Катышуу / Посещ.</th>
            <th>Баа (2-5)</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {lessonDetails.students.map((s: any) => {
            // Определяем текущий статус посещаемости
            let currentAttendance = "present";

            if (s.attendance_type) {
              currentAttendance = s.attendance_type;
            } else if (s.present === false) {
              // Fallback для старых данных
              if (s.comment === "duty") currentAttendance = "duty";
              else if (s.comment === "excused") currentAttendance = "excused";
              else if (s.comment === "sick") currentAttendance = "sick";
              else currentAttendance = "absent";
            }

            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <select
                    value={currentAttendance}
                    onChange={(e) => handleAttendanceChange(s.id, e.target.value)}
                    className={styles.selectDropdown}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      fontWeight: 600,
                      color: attendanceOptions.find(o => o.value === currentAttendance)?.color || '#111',
                      minWidth: 90,
                      fontSize: 13
                    }}
                  >
                    {attendanceOptions.map(opt => (
                      <option key={opt.value} value={opt.value} title={opt.title}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.grade || ""}
                    onChange={(e) => handleGradeInput(s.id, e.target.value)}
                    className={styles.gradeInput}
                    style={{ minWidth: 60 }}
                  >
                    <option value="">-</option>
                    <option value="5">5</option>
                    <option value="4">4</option>
                    <option value="3">3</option>
                    <option value="2">2</option>
                  </select>
                </td>
                <td>
                  <input className={styles.commentInput} placeholder="..." defaultValue={s.comment} onBlur={e => saveGrade(s.id, null, null, e.target.value)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

