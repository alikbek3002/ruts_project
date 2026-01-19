import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { useI18n } from "../../i18n/I18nProvider";

export function StudentHomePage() {
  const { state } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
        <AppShell
      title={t("nav.home")}
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h2 style={{ margin: 0, marginBottom: 8 }}>{t("home.welcome", { name: user.full_name || user.username })}</h2>
          <p style={{ margin: 0, opacity: 0.8 }}>{t("student.homeIntro")}</p>
        </div>
      </div>
    </AppShell>
  );
}
