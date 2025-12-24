import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function StudentHomePage() {
  const { state } = useAuth();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Панель ученика"
      nav={[
        { to: "/app", label: "Dashboard" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/library", label: "Библиотека" },
      ]}
    >
      <p>Выберите раздел сверху.</p>
    </AppShell>
  );
}
