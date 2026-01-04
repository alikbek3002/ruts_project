import { useEffect, useState } from "react";
import { AppShell } from "../../layout/AppShell";
import { useAuth } from "../../auth/AuthProvider";
import { apiGetStudentHomework, HomeworkItem } from "../../../api/client";

export default function StudentHomeworkPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHomework();
  }, []);

  async function loadHomework() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetStudentHomework(token);
      setHomework(data.homework);
    } catch (err: any) {
      console.error("Failed to load homework:", err);
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      title="Домашнее задание"
      nav={[
        { to: "/app/student", label: "Главная" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/homework", label: "Домашнее задание" },
        { to: "/app/student/library", label: "Библиотека" },
        { to: "/app/student/courses", label: "Курсы" },
      ]}
    >
      <h2>Домашнее задание</h2>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading && <p>Загрузка...</p>}

      {!loading && homework.length === 0 && (
        <p style={{ color: "#666" }}>Домашних заданий нет</p>
      )}

      {!loading && homework.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {homework.map((item, idx) => (
            <div
              key={idx}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "#f9f9f9",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <strong style={{ fontSize: "16px" }}>{item.subject_name}</strong>
                  <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
                    Класс: {item.class_name}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "14px", color: "#666" }}>
                  {item.lesson_date}
                </div>
              </div>

              {item.lesson_topic && (
                <div style={{ marginBottom: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>Тема урока:</strong>
                  <div style={{ fontSize: "14px", marginTop: "4px" }}>{item.lesson_topic}</div>
                </div>
              )}

              {item.homework && (
                <div style={{ marginTop: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>Домашнее задание:</strong>
                  <div
                    style={{
                      fontSize: "14px",
                      marginTop: "4px",
                      padding: "8px",
                      backgroundColor: "white",
                      borderRadius: "4px",
                      border: "1px solid #e0e0e0",
                    }}
                  >
                    {item.homework}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
