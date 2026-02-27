import React, { useEffect, useState, useMemo } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
import { Loader } from "../../components/Loader";
import { apiListSubjectsWithTeachers, Subject, apiGetSubjectTopics, apiGetJournalByDates, apiGetJournalBySubject, apiGetClass, apiGetClassJournal, apiDownloadBlob } from "../../../api/client";
import styles from "./AdminClassJournal.module.css";
import { ChevronLeft, Download, RefreshCw, FileSpreadsheet, Filter, CheckCircle } from "lucide-react";

type Student = {
  id: string;
  name: string;
  username: string;
};

type JournalByDates = {
  students: Student[];
  dates: string[];
  data: Record<string, Record<string, { present?: boolean; grade?: number; comment?: string }>>;
};

type JournalBySubject = {
  students: Student[];
  subjects: string[];
  data: Record<string, Record<string, { average?: number; grades: number[]; count: number }>>;
};

type Grade = {
  grade: number;
  comment: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
};

type CellData = {
  grades: Grade[];
  present: boolean | null;
  attendance_type?: string | null;
  marked_by_name?: string | null;
};

type Lesson = {
  date: string;
  timetable_entry_id: string;
  subject_name: string;
  subject_id?: string;
  lesson_topic?: string | null;
  homework?: string | null;
  subject_topic_id?: string | null;
};

type DetailedJournalData = {
  students: Student[];
  lessons: Lesson[];
  grades: Record<string, Record<string, CellData>>;
};

export function AdminClassJournalPage() {
  const { state } = useAuth();
  const { classId } = useParams<{ classId: string }>();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [viewMode, setViewMode] = useState<"dates" | "subjects">("subjects");
  const [detailViewMode, setDetailViewMode] = useState<"journal" | "topics">("journal");
  const [journalByDates, setJournalByDates] = useState<JournalByDates | null>(null);
  const [journalBySubject, setJournalBySubject] = useState<JournalBySubject | null>(null);
  const [detailedJournal, setDetailedJournal] = useState<DetailedJournalData | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [className, setClassName] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [subjectTopics, setSubjectTopics] = useState<any[]>([]);

  useEffect(() => {
    if (!token || !selectedSubjectId) {
      setSubjectTopics([]);
      return;
    }
    async function loadTopics() {
      try {
        const data = await apiGetSubjectTopics(token as string, selectedSubjectId);
        setSubjectTopics(data.topics || []);
      } catch (e) {
        console.error("Failed to load subject topics:", e);
      }
    }
    loadTopics();
  }, [token, selectedSubjectId]);

  const coveredTopicsCount = useMemo(() => {
    if (!detailedJournal || !subjectTopics.length) return 0;
    const coveredIds = new Set<string>();
    detailedJournal.lessons.forEach(l => {
      if (l.subject_topic_id) coveredIds.add(l.subject_topic_id);
    });
    return coveredIds.size;
  }, [detailedJournal, subjectTopics]);

  const progressPercentage = subjectTopics.length > 0
    ? Math.round((coveredTopicsCount / subjectTopics.length) * 100)
    : 0;

  const subjectColumns = useMemo(() => {
    const names = (allSubjects || []).map((s) => (s?.name || "").trim()).filter(Boolean);
    const unique = Array.from(new Set(names));
    unique.sort((a, b) => a.localeCompare(b, "ru"));
    return unique;
  }, [allSubjects]);

  const lessonMarkedStats = useMemo(() => {
    if (!detailedJournal) return {} as Record<string, { marked: number; total: number }>;
    const stats: Record<string, { marked: number; total: number }> = {};
    for (const lesson of detailedJournal.lessons) {
      const key = `${lesson.date}_${lesson.timetable_entry_id}`;
      let marked = 0;
      for (const student of detailedJournal.students) {
        const cell = detailedJournal.grades?.[student.id]?.[key];
        if (!cell) continue;
        const hasGrade = Array.isArray(cell.grades) && cell.grades.length > 0;
        const hasAttendance = cell.attendance_type != null || cell.present != null;
        if (hasGrade || hasAttendance) marked += 1;
      }
      stats[key] = { marked, total: detailedJournal.students.length };
    }
    return stats;
  }, [detailedJournal]);

  async function loadJournal() {
    if (!token || !classId) return;
    setLoading(true);
    setErr(null);
    try {
      const results = await Promise.allSettled([
        apiGetJournalByDates(token, classId!),
        apiGetJournalBySubject(token, classId!),
        apiGetClass(token, classId!),
        apiListSubjectsWithTeachers(token),
      ]);

      const [byDates, bySubject, classInfo, subjectsResp] = results;

      if (byDates.status === 'fulfilled') setJournalByDates(byDates.value);
      else {
        console.error("Failed to load journal by dates:", byDates.reason);
        setErr(byDates.reason?.message || "Failed to load journal by dates");
      }

      if (bySubject.status === 'fulfilled') setJournalBySubject(bySubject.value);
      else console.error("Failed to load journal by subject:", bySubject.reason);

      if (classInfo.status === 'fulfilled') setClassName(classInfo.value.class?.name || "");
      else console.error("Failed to load class info:", classInfo.reason);

      if (subjectsResp.status === 'fulfilled') setAllSubjects(subjectsResp.value.subjects || []);
      else console.error("Failed to load subjects:", subjectsResp.reason);

    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // Извлекаем detail из JSON ошибки если возможно
      let displayMsg = errMsg;
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed?.detail) displayMsg = parsed.detail;
      } catch { /* ignore */ }
      setErr(displayMsg || "Ошибка загрузки журнала");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!can) return;
    loadJournal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, classId]);

  useEffect(() => {
    if (!token || !classId || !selectedSubjectId) {
      setDetailedJournal(null);
      return;
    }

    async function loadDetailed() {
      setLoading(true);
      try {
        const data = await apiGetClassJournal(token as string, classId!, selectedSubjectId) as any;
        setDetailedJournal(data);
      } catch (e) {
        console.error(e);
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    }
    loadDetailed();
  }, [token, classId, selectedSubjectId]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Журнал" : "Админ → Журнал";

  async function downloadExcel(type: "attendance" | "grades") {
    if (!token || !classId) return;
    const endpoint =
      type === "attendance"
        ? `/gradebook/classes/${classId}/journal/export/attendance`
        : `/gradebook/classes/${classId}/journal/export/grades`;

    try {
      const blob = await apiDownloadBlob(token, endpoint);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "attendance" ? `${className}_poseschaiemost.xlsx` : `${className}_ocenki.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <AppShell
      title={title}
      nav={getAdminNavItems(base)}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <Link to={`${base}/classes`} className={styles.backBtn} style={{ display: "inline-flex", marginBottom: 8 }}>
              <ChevronLeft size={16} />
              Назад к группам
            </Link>
            <h2>Журнал группы: {className || classId}</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" onClick={() => loadJournal()} disabled={loading} title="Обновить">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {err && <div style={{ color: "var(--color-error)", marginBottom: 16, padding: 16, background: "#fee2e2", borderRadius: 8 }}>{err}</div>}

        <div className={styles.controls}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flex: 1 }}>
            <button
              className={viewMode === "subjects" && !selectedSubjectId ? "primary" : "secondary"}
              onClick={() => { setViewMode("subjects"); setSelectedSubjectId(""); }}
            >
              Сводная по предметам
            </button>
            <button
              className={viewMode === "dates" && !selectedSubjectId ? "primary" : "secondary"}
              onClick={() => { setViewMode("dates"); setSelectedSubjectId(""); }}
            >
              Сводная по датам
            </button>

            <div style={{ position: "relative" }}>
              <Filter size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-secondary)" }} />
              <select
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className={styles.select}
                style={{ paddingLeft: 32 }}
              >
                <option value="">-- Детализация по предмету --</option>
                {allSubjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" onClick={() => downloadExcel("grades")} title="Скачать оценки">
              <FileSpreadsheet size={18} style={{ marginRight: 8 }} />
              Оценки
            </button>
            <button className="secondary" onClick={() => downloadExcel("attendance")} title="Скачать посещаемость">
              <FileSpreadsheet size={18} style={{ marginRight: 8 }} />
              Посещаемость
            </button>
          </div>
        </div>

        {loading && <Loader text="Загрузка журнала..." />}

        {!loading && selectedSubjectId && detailedJournal && (
          <div className={styles.tableWrapper}>
            {subjectTopics.length > 0 && (
              <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--color-bg-secondary)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--color-border)' }}>
                <CheckCircle size={20} color="var(--color-primary)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Прогресс по учебному плану (Силлабус)</div>
                  <div style={{ width: '100%', height: 8, background: 'var(--color-bg-elevated)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    <div style={{ width: `${progressPercentage}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s' }} />
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 120, textAlign: 'right' }}>
                  {coveredTopicsCount} из {subjectTopics.length} тем ({progressPercentage}%)
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className={detailViewMode === "journal" ? "primary" : "secondary"} onClick={() => setDetailViewMode("journal")}>
                Журнал оценок
              </button>
              <button className={detailViewMode === "topics" ? "primary" : "secondary"} onClick={() => setDetailViewMode("topics")}>
                Пройденные темы
              </button>
            </div>

            {detailViewMode === "journal" && (
              <table className={styles.journalTable}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Ученик</th>
                    {detailedJournal.lessons.map((l) => {
                      const lessonKey = `${l.date}_${l.timetable_entry_id}`;
                      const stat = lessonMarkedStats[lessonKey];
                      return (
                      <th key={lessonKey} title={l.lesson_topic || ""}>
                        <div style={{ fontSize: "0.8em" }}>
                          {new Date(l.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                        </div>
                        <div className={styles.lessonMarkedMeta}>
                          {stat?.marked ?? 0}/{stat?.total ?? 0}
                        </div>
                      </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {detailedJournal.students.map((student) => (
                    <tr key={student.id}>
                      <td className={styles.stickyCol}>{student.name}</td>
                      {detailedJournal.lessons.map((l) => {
                        const key = `${l.date}_${l.timetable_entry_id}`;
                        const cell = detailedJournal.grades[student.id]?.[key];
                        const grades = cell?.grades || [];
                        const present = cell?.present;
                        const attendanceType = cell?.attendance_type;
                        const markedBy = grades[0]?.created_by_name || cell?.marked_by_name || null;

                        let attendanceLabel: string | null = null;
                        let attendanceColor: string | null = null;
                        if (attendanceType === "absent" || (attendanceType == null && present === false)) { attendanceLabel = "Н"; attendanceColor = "#ef4444"; }
                        else if (attendanceType === "duty") { attendanceLabel = "К"; attendanceColor = "#f59e0b"; }
                        else if (attendanceType === "excused") { attendanceLabel = "А"; attendanceColor = "#3b82f6"; }
                        else if (attendanceType === "sick") { attendanceLabel = "О"; attendanceColor = "#8b5cf6"; }
                        else if (attendanceType === "present" || (attendanceType == null && present === true)) { attendanceLabel = "✓"; attendanceColor = "#22c55e"; }

                        return (
                          <td key={key}>
                            {attendanceLabel && (
                              <span style={{ color: attendanceColor || undefined, fontWeight: 'bold', fontSize: 11, marginRight: grades.length > 0 ? 3 : 0 }}
                                className={attendanceLabel === "Н" ? styles.absent : undefined}
                              >{attendanceLabel}</span>
                            )}
                            {grades.length > 0 ? (
                              grades.map((g, i) => {
                                const gradeTitle = [
                                  g.comment,
                                  g.created_by_name ? `Поставил(а): ${g.created_by_name}` : null,
                                ]
                                  .filter(Boolean)
                                  .join("\n");
                                return (
                                  <span key={i} title={gradeTitle || ""} className={`${styles.grade} ${styles[`grade-${g.grade}`] || ""}`}>
                                    {g.grade}
                                  </span>
                                );
                              })
                            ) : !attendanceLabel ? (
                              <span style={{ color: "var(--color-text-light)" }}>·</span>
                            ) : null}
                            {markedBy && (
                              <div className={styles.cellAuthor} title={`Поставил(а): ${markedBy}`}>
                                {markedBy}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {detailViewMode === "topics" && (
              <table className={styles.journalTable}>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Тема из учебного плана (Силлабус)</th>
                    <th>Статус</th>
                    <th>Дата урока</th>
                    <th>Тема урока (вручную)</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectTopics.map((topic, idx) => {
                    const lesson = detailedJournal.lessons.find((l) => l.subject_topic_id === topic.id);
                    return (
                      <tr key={topic.id} style={{ opacity: lesson ? 1 : 0.6 }}>
                        <td>{topic.topic_number || idx + 1}</td>
                        <td style={{ fontWeight: lesson ? 600 : 400 }}>{topic.topic_name}</td>
                        <td>
                          {lesson ? (
                            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>Пройдена</span>
                          ) : (
                            <span style={{ color: "var(--color-text-light)" }}>Не пройдена</span>
                          )}
                        </td>
                        <td>{lesson ? new Date(lesson.date).toLocaleDateString("ru-RU") : "—"}</td>
                        <td>{lesson?.lesson_topic || "—"}</td>
                      </tr>
                    );
                  })}
                  {subjectTopics.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>
                        Учебный план для данного предмета не настроен.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {!loading && !selectedSubjectId && viewMode === "subjects" && journalBySubject && (
          <div className={styles.tableWrapper}>
            <table className={styles.journalTable}>
              <thead>
                <tr>
                  <th className={styles.stickyCol}>Ученик</th>
                  {(subjectColumns.length ? subjectColumns : journalBySubject.subjects).map((subj) => (
                    <th key={subj}>{subj}</th>
                  ))}
                  <th className={styles.avgCol}>Средний балл</th>
                </tr>
              </thead>
              <tbody>
                {journalBySubject.students.map((student) => {
                  const studentData = journalBySubject.data[student.id] || {};
                  const cols = subjectColumns.length ? subjectColumns : journalBySubject.subjects;
                  const allAverages = cols
                    .map((subj) => studentData[subj]?.average)
                    .filter((avg): avg is number => avg !== null && avg !== undefined);
                  const overallAvg = allAverages.length > 0 ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length : null;

                  return (
                    <tr key={student.id}>
                      <td className={styles.stickyCol}>{student.name}</td>
                      {cols.map((subj) => {
                        const subjData = studentData[subj];
                        return (
                          <td key={subj} title={subjData?.grades?.length ? `Оценки: ${subjData.grades.join(", ")}` : ""}>
                            {subjData?.average !== null && subjData?.average !== undefined ? (
                              <div>
                                <strong>{subjData.average.toFixed(2)}</strong>
                                <div style={{ fontSize: "0.85em", color: "var(--color-text-secondary)" }}>
                                  ({subjData.count})
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--color-text-light)" }}>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={styles.avgCol}>
                        {overallAvg !== null ? <strong>{overallAvg.toFixed(2)}</strong> : <span style={{ color: "var(--color-text-light)" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !selectedSubjectId && viewMode === "dates" && journalByDates && (
          <div className={styles.tableWrapper}>
            <table className={styles.journalTable}>
              <thead>
                <tr>
                  <th className={styles.stickyCol}>Ученик</th>
                  {journalByDates.dates.map((dt) => (
                    <th key={dt}>{dt}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journalByDates.students.map((student) => {
                  const studentData = journalByDates.data[student.id] || {};
                  return (
                    <tr key={student.id}>
                      <td className={styles.stickyCol}>{student.name}</td>
                      {journalByDates.dates.map((dt) => {
                        const dayData = studentData[dt] || {};
                        const { present, grade, comment } = dayData;

                        let content: React.ReactNode = <span style={{ color: "var(--color-text-light)" }}>—</span>;
                        if (grade) {
                          content = <span className={`${styles.grade} ${styles[`grade-${grade}`] || ""}`}>{grade}</span>;
                        } else if (present === true) {
                          content = <span style={{ color: "var(--color-success)" }}>✓</span>;
                        } else if (present === false) {
                          content = <span className={styles.absent}>Н</span>;
                        }

                        return (
                          <td key={dt} title={comment || ""}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
