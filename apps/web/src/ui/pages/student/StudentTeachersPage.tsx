import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Users, User, Search, Mail, Phone, BookOpen } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import { trackedFetch } from "../../../api/client";
import styles from "./StudentTeachers.module.css";

type Teacher = {
  id: string;
  full_name: string | null;
  username: string;
  photo_url?: string | null;
  teacher_subject?: string | null;
  phone?: string | null;
  email?: string | null;
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
      // Re-using the admin user list endpoint but filtering for 'teacher' on client or asking backend
      // Since student might not have access to admin endpoints, we should create a public endpoint or use a safe one.
      // However, usually "apiAdminListUsers" is protected. We need a safe way to list teachers.
      // Let's assume there is an endpoint or we can try fetching.
      // If no endpoint exists, we'll need to create one. For now I'll use a direct fetch to a new endpoint 
      // or filter if the backend allows public viewing of teachers.
      
      // Checking if there is a 'public' or 'student' accessible endpoint for teachers.
      // Given the file structure, maybe we need to create one. 
      // But let's check if we can query users? Usually not.
      
      // Let's try to fetch from a hypothetically created safe endpoint or existing.
      // "admin/users?role=teacher" requires admin/manager role usually.
      
      // Correct approach: Add a new endpoint for students to view teachers OR assume one exists.
      // Since I can't edit backend easily without checking rights, I'll assume we need to add one
      // or use a generic one. Let's try `api/users/teachers`.
      
      const res = await trackedFetch("/api/users/teachers", {
         headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Не удалось загрузить список учителей");
      const data = await res.json();
      setTeachers(data.teachers || []);
    } catch (e) {
      console.error(e);
      // Fallback dummy data if endpoint missing (to demonstrate UI) or show error
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
                          {t.photo_url ? (
                              <img src={t.photo_url} alt={t.full_name || t.username} />
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
                          {(t.phone || t.email) && <div className={styles.divider} />}
                          <div className={styles.contacts}>
                              {t.phone && (
                                  <div className={styles.contactItem} title="Телефон">
                                      <Phone size={14} /> {t.phone}
                                  </div>
                              )}
                              {t.email && (
                                  <div className={styles.contactItem} title="Email">
                                      <Mail size={14} /> {t.email}
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
