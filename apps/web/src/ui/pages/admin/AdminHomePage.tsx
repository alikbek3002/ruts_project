import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function AdminHomePage() {
  const { state } = useAuth();
  const user = state.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Панель менеджера" : "Админ панель";

  return (
    <AppShell
      title={title}
      nav={[
        { to: "/app", label: "Dashboard" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
      ]}
    >
      <div style={{ maxWidth: 520 }}>
        <div style={{ marginBottom: 'var(--spacing-md)', fontSize: 14, color: 'var(--color-text-light)' }}>
          Данные пользователя
        </div>
        <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-md)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
            {user.photo_data_url ? (
              <img
                src={user.photo_data_url}
                alt="Фото"
                style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--color-border)' }}
              />
            ) : (
              <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{user.full_name || user.username}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-light)' }}>{user.username}</div>
              {user.phone && <div style={{ marginTop: 'var(--spacing-xs)', fontSize: 13 }}>{user.phone}</div>}
              {user.birth_date && <div style={{ fontSize: 13, color: 'var(--color-text-light)' }}>Дата рождения: {user.birth_date}</div>}
              {user.teacher_subject && <div style={{ fontSize: 13, color: 'var(--color-text-light)' }}>Предмет: {user.teacher_subject}</div>}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
