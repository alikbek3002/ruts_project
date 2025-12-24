import React, { useEffect, useState, useMemo } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { apiListSubjects, Subject, trackedFetch } from "../../../api/client";
import styles from "./AdminClassJournal.module.css";

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

export function AdminClassJournalPage() {
  const { state } = useAuth();
  const { classId } = useParams<{ classId: string }>();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [viewMode, setViewMode] = useState<"dates" | "subjects">("subjects");
  const [journalByDates, setJournalByDates] = useState<JournalByDates | null>(null);
  const [journalBySubject, setJournalBySubject] = useState<JournalBySubject | null>(null);
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
      <div style={{ marginBottom: 16 }}>
        <Link to={`${base}/classes`}>← Назад к группам</Link>
      </div>

      <h2>Журнал группы: {className || classId}</h2>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setViewMode("subjects")} disabled={viewMode === "subjects"}>
          По предметам
        </button>
        <button onClick={() => setViewMode("dates")} disabled={viewMode === "dates"}>
          По датам
        </button>
        <button onClick={() => downloadExcel("grades")}>📥 Скачать оценки (Excel)</button>
        <button onClick={() => downloadExcel("attendance")}>📥 Скачать посещаемость (Excel)</button>
        <button onClick={() => loadJournal()} disabled={loading}>
          {loading ? "⭮ Загрузка..." : "Обновить"}
        </button>
      </div>

      {loading && <Loader text="Загрузка журнала..." />}

      {!loading && viewMode === "subjects" && journalBySubject && (
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
                              <div style={{ fontSize: "0.85em", color: "#666" }}>
                                ({subjData.count} {subjData.count === 1 ? "оценка" : "оценок"})
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "#999" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={styles.avgCol}>
                      {overallAvg !== null ? <strong>{overallAvg.toFixed(2)}</strong> : <span style={{ color: "#999" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && viewMode === "dates" && journalByDates && (
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

                      let content: React.ReactNode = <span style={{ color: "#999" }}>—</span>;
                      if (grade) {
                        content = <strong>{grade}</strong>;
                      } else if (present === true) {
                        content = <span style={{ color: "green" }}>✓</span>;
                      } else if (present === false) {
                        content = <span style={{ color: "red" }}>✗</span>;
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
    </AppShell>
  );
}
