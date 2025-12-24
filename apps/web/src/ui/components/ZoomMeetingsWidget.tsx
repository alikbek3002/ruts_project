import React, { useEffect, useState } from "react";
import { apiListZoomMeetings, type ZoomMeeting } from "../../api/client";

interface Props {
  token: string;
  userRole: string;
}

export function ZoomMeetingsWidget({ token, userRole }: Props) {
  const [meetings, setMeetings] = useState<ZoomMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiListZoomMeetings(token)
      .then((r) => {
        setMeetings(r.meetings);
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e));
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-card)" }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>📹 Zoom встречи</h3>
        <div style={{ opacity: 0.7 }}>Загрузка...</div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-card)" }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>📹 Zoom встречи</h3>
        <div style={{ color: "#c00", fontSize: 14 }}>{err}</div>
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <div style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-card)" }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>📹 Zoom встречи</h3>
        <div style={{ opacity: 0.7, fontSize: 14 }}>Предстоящих встреч нет</div>
      </div>
    );
  }

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month} в ${hours}:${minutes}`;
  };

  const isUpcoming = (isoString: string) => {
    return new Date(isoString) > new Date();
  };

  const upcomingMeetings = meetings.filter(m => isUpcoming(m.starts_at));

  return (
    <div style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-card)" }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>📹 Предстоящие Zoom встречи</h3>
      
      {upcomingMeetings.length === 0 ? (
        <div style={{ opacity: 0.7, fontSize: 14 }}>Нет предстоящих встреч</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {upcomingMeetings.slice(0, 5).map((meeting) => {
            const timetable = meeting.timetable_entries;
            const className = timetable?.classes?.name || "";
            const subject = timetable?.subject || "Урок";
            
            return (
              <div
                key={meeting.id}
                style={{
                  padding: 12,
                  background: "var(--color-background)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {className && `${className} — `}{subject}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>
                      🕐 {formatDateTime(meeting.starts_at)}
                    </div>
                  </div>
                  <a
                    href={meeting.join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "6px 12px",
                      background: "#0066cc",
                      color: "white",
                      textDecoration: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Войти
                  </a>
                </div>
                {userRole === "teacher" && meeting.start_url && (
                  <a
                    href={meeting.start_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      color: "#0066cc",
                      textDecoration: "underline",
                    }}
                  >
                    Начать встречу (как организатор)
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
