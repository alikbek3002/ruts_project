import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function TeacherHomePage() {
  const { state } = useAuth();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Панель преподавателя"
      nav={[
        { to: "/app", label: "🏠 Dashboard" },
        { to: "/app/teacher/journal", label: "📖 Журнал" },
          { to: "/app/teacher/vzvody", label: "👥 Мои взводы" },
        { to: "/app/teacher/timetable", label: "📅 Расписание" },
        { to: "/app/teacher/library", label: "📚 Библиотека" },
      ]}
    >
      <p>Выберите раздел сверху.</p>
    </AppShell>
  );
}
