import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { User, Search, Phone, BookOpen } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { trackedFetch } from "../../../api/client";
import styles from "./StudentTeachers.module.css";

type Teacher = {
  id: string;
  full_name: string | null;
  username: string;
  photo_data_url?: string | null;
  teacher_subject?: string | null;
  phone?: string | null;
};

export function StudentTeachersPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      console.log("[StudentTeachersPage] Fetching teachers from /api/users/teachers");
      
      const res = await trackedFetch("/api/users/teachers", {
         headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log("[StudentTeachersPage] Response status:", res.status);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("[StudentTeachersPage] Error response:", errorText);
        throw new Error("Не удалось загрузить список учителей");
      }
      
      const data = await res.json();
      console.log("[StudentTeachersPage] Received data:", data);
      console.log("[StudentTeachersPage] Teachers count:", data.teachers?.length || 0);
      
      if (data.teachers && data.teachers.length > 0) {
        console.log("[StudentTeachersPage] Sample teacher:", {
          username: data.teachers[0].username,
          has_photo_data_url: !!data.teachers[0].photo_data_url,
          has_phone: !!data.teachers[0].phone
        });
      }
      
      setTeachers(data.teachers || []);
    } catch (e) {
      console.error("[StudentTeachersPage] Load error:", e);
      setError("Список учителей временно недоступен");
    } finally {
      setLoading(false);
    }
  }

  const filtered = teachers.filter(t => {
      const s = search.toLowerCase();
      return (
          (t.full_name || "").toLowerCase().includes(s) || 
          (t.username || "").toLowerCase().includes(s) ||
          (t.teacher_subject || "").toLowerCase().includes(s)
      );
  });

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;

  return (
    <AppShell
      title="Учителя"
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
        { to: "/app/student/teachers", labelKey: "nav.teachers" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
            <h2>Наши учителя</h2>
            <div className={styles.searchBox}>
                <Search size={18} className={styles.searchIcon} />
                <input 
                    type="text" 
                    placeholder="Поиск учителя..." 
                    value={search} 
                    onChange={(e) => setSearch(e.target.value)}
                    className={styles.searchInput}
                />
            </div>
        </div>

        {loading ? (
           <Loader text="Загрузка списка учителей..." />
        ) : error ? (
           <div className={styles.error}>{error}</div>
        ) : filtered.length === 0 ? (
           <div className={styles.empty}>Учителя не найдены</div>
        ) : (
           <div className={styles.grid}>
              {filtered.map(t => (
                  <div key={t.id} className={styles.card}>
                      <div className={styles.avatar}>
                          {t.photo_data_url ? (
                              <img src={t.photo_data_url} alt={t.full_name || t.username} />
                          ) : (
                              <User size={32} />
                          )}
                      </div>
                      <div className={styles.info}>
                          <h3 className={styles.name}>{t.full_name || t.username}</h3>
                          {t.teacher_subject && (
                              <div className={styles.subject}>
                                  <BookOpen size={14} /> {t.teacher_subject}
                              </div>
                          )}
                          {t.phone && <div className={styles.divider} />}
                          <div className={styles.contacts}>
                              {t.phone && (
                                  <div className={styles.contactItem} title="Телефон">
                                      <Phone size={14} /> {t.phone}
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              ))}
           </div>
        )}
      </div>
    </AppShell>
  );
}
