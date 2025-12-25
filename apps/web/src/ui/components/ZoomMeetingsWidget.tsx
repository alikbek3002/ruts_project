import React, { useEffect, useState } from "react";
import { apiListZoomMeetings, apiZoomStatus, apiZoomStart, type ZoomMeeting } from "../../api/client";
import { Video, Link as LinkIcon } from "lucide-react";

interface Props {
  token: string;
  userRole: string;
}

export function ZoomMeetingsWidget({ token, userRole }: Props) {
  const [meetings, setMeetings] = useState<ZoomMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    checkStatusAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function checkStatusAndLoad() {
    try {
      setLoading(true);
      // 1. Check connection status
      const status = await apiZoomStatus(token);
      setIsConnected(status.connected);

      if (status.connected) {
        // 2. If connected, load meetings
        const r = await apiListZoomMeetings(token);
        setMeetings(r.meetings);
      }
    } catch (e) {
      console.error(e);
      setErr("Не удалось загрузить информацию о Zoom");
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    try {
      const res = await apiZoomStart(token);
      window.location.href = res.authUrl;
    } catch (e) {
      alert("Ошибка при подключении Zoom: " + e);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Video size={20} color="#2563eb" />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Zoom встречи</h3>
        </div>
        <div style={{ opacity: 0.7, fontSize: 14 }}>Загрузка...</div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Video size={20} color="#dc2626" />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Zoom встречи</h3>
        </div>
        <div style={{ color: "#dc2626", fontSize: 14 }}>{err}</div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Video size={20} color="#2563eb" />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Zoom встречи</h3>
        </div>
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#4b5563' }}>
            Аккаунт Zoom не подключен. Подключите его, чтобы создавать и видеть встречи.
          </p>
          <button
            onClick={handleConnect}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <LinkIcon size={16} />
            Подключить Zoom
          </button>
        </div>
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
    <div style={{ padding: 20, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Video size={20} color="#2563eb" />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Предстоящие встречи</h3>
      </div>
      
      {upcomingMeetings.length === 0 ? (
        <div style={{ opacity: 0.7, fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
          Нет запланированных встреч
        </div>
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
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: '#111827' }}>
                      {className && `${className} — `}{subject}
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>
                      🕐 {formatDateTime(meeting.starts_at)}
                    </div>
                  </div>
                  <a
                    href={meeting.join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "6px 12px",
                      background: "#2563eb",
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
                      color: "#2563eb",
                      textDecoration: "none",
                      fontWeight: 500
                    }}
                  >
                    Начать встречу (организатор)
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
