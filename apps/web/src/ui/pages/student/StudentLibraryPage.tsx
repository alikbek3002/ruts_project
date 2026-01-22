import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiListLibrary, apiGetLibraryDownloadUrl, type LibraryItem } from "../../../api/client";
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

  const handleDownload = async (item: LibraryItem) => {
    if (!token) return;
    try {
      const { url } = await apiGetLibraryDownloadUrl(token, item.id);
      window.open(url, "_blank");
    } catch (e) {
      setErr(`Ошибка скачивания: ${String(e)}`);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Ученик → Библиотека"
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
      ]}
    >
      {err && <div style={{ padding: "12px", background: "#fee", color: "#c00", borderRadius: 8, marginBottom: 16 }}>{err}</div>}
      
      <h3 style={{ marginBottom: 16 }}>📚 Учебные материалы</h3>
      
      {items.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Пока нет доступных материалов.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 16,
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                background: "var(--color-card)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                  📄 {item.title}
                </div>
                {item.description && (
                  <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>{item.description}</div>
                )}
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  Добавлено: {new Date(item.created_at).toLocaleDateString("ru-RU")}
                </div>
              </div>
              <button
                onClick={() => handleDownload(item)}
                style={{
                  padding: "8px 16px",
                  background: "var(--color-primary)",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ⬇️ Скачать
              </button>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
