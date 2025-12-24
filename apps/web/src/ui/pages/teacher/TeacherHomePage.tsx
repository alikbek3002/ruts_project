import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { ZoomMeetingsWidget } from "../../components/ZoomMeetingsWidget";

export function TeacherHomePage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Панель преподавателя"
      nav={[
        { to: "/app", label: "🏠 Dashboard" },
        { to: "/app/teacher/journal", label: "📓 Журнал" },
          { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Добро пожаловать, {user.full_name || user.username}!</h2>
          <p style={{ margin: 0, opacity: 0.8 }}>Выберите раздел в меню выше для работы.</p>
        </div>

        {token && <ZoomMeetingsWidget token={token} userRole={user.role} />}
      </div>
    </AppShell>
  );
}
