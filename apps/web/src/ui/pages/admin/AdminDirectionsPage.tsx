import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListDirections,
  type Direction,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";

export function AdminDirectionsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [directions, setDirections] = useState<Direction[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!token) return;
    const resp = await apiListDirections(token);
    setDirections(resp.directions || []);
  }

  useEffect(() => {
    if (can) reload().catch((e) => setErr(String(e)));
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Направления" : "Админ → Направления";

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
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      
      <h3>🏢 Направления</h3>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Направления созданы в системе и присваиваются группам при создании или редактировании.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {directions.map((d) => (
          <div
            key={d.id}
            style={{
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
              boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
            <div style={{ color: "#666", fontSize: 13 }}>Код: {d.code}</div>
          </div>
        ))}
      </div>

      {directions.length === 0 && (
        <p style={{ color: "#888" }}>
          Направления не найдены. Примените миграцию базы данных.
        </p>
      )}
    </AppShell>
  );
}
