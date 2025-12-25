import React, { useEffect, useState, useMemo } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiListSubjects, Subject, trackedFetch } from "../../../api/client";
import styles from "./AdminClassJournal.module.css";
import { ChevronLeft, Download, RefreshCw, FileSpreadsheet, Filter } from "lucide-react";

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
  const [journalByDates, setJournalByDates] = useState<JournalByDates | null>(null);
  const [journalBySubject, setJournalBySubject] = useState<JournalBySubject | null>(null);
  const [detailedJournal, setDetailedJournal] = useState<DetailedJournalData | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [className, setClassName] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const subjectColumns = useMemo(() => {
    const names = (allSubjects || []).map((s) => (s?.name || "").trim()).filter(Boolean);
    const unique = Array.from(new Set(names));
    unique.sort((a, b) => a.localeCompare(b, "ru"));
    return unique;
  }, [allSubjects]);

  async function loadJournal() {
    if (!token || !classId) return;
    setLoading(true);
    setErr(null);
    try {
      const [byDates, bySubject, classInfo, subjectsResp] = await Promise.all([
        trackedFetch(`/api/gradebook/classes/${classId}/journal`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => {
          if (!r.ok) throw new Error("Failed to load journal by dates");
          return r.json();
        }),
        trackedFetch(`/api/gradebook/classes/${classId}/journal/by-subject`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => {
          if (!r.ok) throw new Error("Failed to load journal by subject");
          return r.json();
        }),
        trackedFetch(`/api/classes/${classId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => {
          if (!r.ok) throw new Error("Failed to load class info");
          return r.json();
        }),
        apiListSubjects(token),
      ]);

      setJournalByDates(byDates);
      setJournalBySubject(bySubject);
      setClassName(classInfo.class?.name || "");
      setAllSubjects(subjectsResp.subjects || []);
    } catch (e) {
      setErr(String(e));
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
        const url = new URL(`/api/journal/classes/${classId}/journal`, window.location.origin);
        url.searchParams.append("subject_id", selectedSubjectId);
        const resp = await trackedFetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error("Failed to load detailed journal");
        const data = await resp.json();
        setDetailedJournal(data);
      } catch (e) {
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
        ? `/api/gradebook/classes/${classId}/journal/export/attendance`
        : `/api/gradebook/classes/${classId}/journal/export/grades`;

    try {
      const response = await trackedFetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to download Excel");

      const blob = await response.blob();
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
      nav={[
        { to: base, label: user.role === "manager" ? "Менеджер" : "Админ" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
      ]}
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
            <table className={styles.journalTable}>
              <thead>
                <tr>
                  <th className={styles.stickyCol}>Ученик</th>
                  {detailedJournal.lessons.map((l) => (
                    <th key={l.timetable_entry_id} title={l.lesson_topic || ""}>
                      <div style={{ fontSize: "0.8em" }}>
                          {new Date(l.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      </div>
                    </th>
                  ))}
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

                      return (
                        <td key={l.timetable_entry_id}>
                          {grades.length > 0 ? (
                            grades.map((g, i) => (
                              <span key={i} title={g.comment || ""} className={`${styles.grade} ${styles[`grade-${g.grade}`] || ""}`}>
                                {g.grade}
                              </span>
                            ))
                          ) : present === false ? (
                            <span className={styles.absent}>Н</span>
                          ) : present === true ? (
                            <span style={{ color: "var(--color-success)" }}>✓</span>
                          ) : (
                            <span style={{ color: "var(--color-text-light)" }}>·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
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
