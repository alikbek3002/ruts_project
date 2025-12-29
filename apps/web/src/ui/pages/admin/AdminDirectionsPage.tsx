import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiListDirections,
  type Direction,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminDirections.module.css";
import { Map, Hash } from "lucide-react";

export function AdminDirectionsPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [directions, setDirections] = useState<Direction[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await apiListDirections(token);
      setDirections(resp.directions || []);
    } finally {
      setLoading(false);
    }
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
        { to: base, label: "Главная" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/streams`, label: "Потоки" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
        { to: `${base}/notifications`, label: "Уведомления" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Направления</h2>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        {loading && <Loader text="Загрузка..." />}

        <div className={styles.cardsGrid}>
          {!loading && directions.map((d) => (
            <div key={d.id} className={styles.card}>
              <div className={styles.cardTitle}>
                <Map size={18} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 8 }} />
                {d.name}
              </div>
              <div className={styles.cardCode}>
                <Hash size={14} style={{ display: "inline-block", verticalAlign: "text-bottom", marginRight: 4 }} />
                {d.code}
              </div>
            </div>
          ))}

          {directions.length === 0 && !loading && (
            <div className={styles.empty}>
              Направления не найдены. Примените миграцию базы данных.
            </div>
          )}
        </div>

        <div className={styles.infoBox}>
          <h3>🏢 О направлениях</h3>
          <p>
            Направления (факультеты/специальности) создаются администратором базы данных.
            Они используются при создании групп.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
