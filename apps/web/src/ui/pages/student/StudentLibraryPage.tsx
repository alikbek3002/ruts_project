import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiListLibrary, type LibraryItem } from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function StudentLibraryPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && user.role === "student" && !!token, [user, token]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!can || !token) return;
    apiListLibrary(token)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(String(e)));
  }, [can, token]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Ученик → Библиотека"
      nav={[
        { to: "/app/student", label: "Панель" },
        { to: "/app/student/timetable", label: "Расписание" },
        { to: "/app/student/grades", label: "Оценки" },
        { to: "/app/student/library", label: "Библиотека" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {items.length === 0 ? (
        <p>Пока пусто.</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <b>{i.title}</b> {i.description ? `— ${i.description}` : ""}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
