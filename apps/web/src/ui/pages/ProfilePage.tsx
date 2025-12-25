import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, X, Edit2 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import {
  apiGetProfile,
  apiUpdateProfile,
  type UserProfile,
} from "../../api/client";
import styles from "./ProfilePage.module.css";

export function ProfilePage() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const token = state.accessToken;
  const authUser = state.user;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Edit mode states
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});

  useEffect(() => {
    if (token) {
      loadProfile();
    }
  }, [token]);

  async function loadProfile() {
    try {
      setLoading(true);
      setError("");
      const data = await apiGetProfile(token!);
      setProfile(data.profile);
      setEditData({
        full_name: data.profile.full_name || "",
        first_name: data.profile.first_name || "",
        last_name: data.profile.last_name || "",
        middle_name: data.profile.middle_name || "",
        phone: data.profile.phone || "",
        birth_date: data.profile.birth_date || "",
      });
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveInfo() {
    try {
      setError("");
      setSuccess("");
      const data = await apiUpdateProfile(token!, editData);
      setProfile(data.profile);
      setIsEditingInfo(false);
      setSuccess("Профиль успешно обновлен");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Не удалось обновить профиль");
    }
  }

  if (loading) {
    return (
      <div className={styles.profilePage}>
        <p>Загрузка профиля...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.profilePage}>
        <div className={styles.error}>Профиль не найден</div>
      </div>
    );
  }

  const isStudent = authUser?.role === "student";
  const initials = profile.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : profile.username[0].toUpperCase();

  return (
    <div className={styles.profilePage}>
      <div className={styles.topBar}>
        <button className={styles.backButton} onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
          <span>Назад</span>
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* Header with Avatar */}
      <div className={styles.header}>
        <div className={styles.avatarSection}>
          {profile.photo_data_url ? (
            <img src={profile.photo_data_url} alt="Profile" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials}</div>
          )}
        </div>

        <div className={styles.headerInfo}>
          <h1>{profile.full_name || profile.username}</h1>
          <span className={`${styles.role} ${styles[profile.role]}`}>
            {profile.role === "admin" ? "Администратор" : 
             profile.role === "manager" ? "Менеджер" :
             profile.role === "teacher" ? "Преподаватель" : "Студент"}
          </span>
          {profile.teacher_subject_name && (
            <p style={{ marginTop: "0.5rem", color: "var(--color-text-secondary)" }}>
              Предмет: {profile.teacher_subject_name}
            </p>
          )}
        </div>
      </div>

      {/* Personal Information */}
      <div className={styles.section}>
        <h2>Личная информация</h2>

        {!isEditingInfo ? (
          <div>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Имя</span>
                <span className={styles.infoValue}>{profile.first_name || "—"}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Фамилия</span>
                <span className={styles.infoValue}>{profile.last_name || "—"}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Отчество</span>
                <span className={styles.infoValue}>{profile.middle_name || "—"}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Телефон</span>
                <span className={styles.infoValue}>{profile.phone || "—"}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Дата рождения</span>
                <span className={styles.infoValue}>{profile.birth_date || "—"}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Логин</span>
                <span className={styles.infoValue}>{profile.username}</span>
              </div>
            </div>

            {authUser?.role !== "teacher" && (
              <div className={styles.formActions}>
                <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setIsEditingInfo(true)}>
                  <Edit2 size={16} style={{ marginRight: 8 }} />
                  Редактировать
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.form}>
            <div className={styles.formGroup}>
              <label>Имя</label>
              <input
                type="text"
                value={editData.first_name || ""}
                onChange={(e) => setEditData({ ...editData, first_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Фамилия</label>
              <input
                type="text"
                value={editData.last_name || ""}
                onChange={(e) => setEditData({ ...editData, last_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Отчество</label>
              <input
                type="text"
                value={editData.middle_name || ""}
                onChange={(e) => setEditData({ ...editData, middle_name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Телефон</label>
              <input
                type="tel"
                value={editData.phone || ""}
                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                disabled={isStudent}
              />
              {isStudent && <p className={styles.infoText}>Студенты не могут менять номер телефона</p>}
            </div>

            <div className={styles.formGroup}>
              <label>Дата рождения</label>
              <input
                type="date"
                value={editData.birth_date || ""}
                onChange={(e) => setEditData({ ...editData, birth_date: e.target.value })}
              />
            </div>

            <div className={styles.formActions}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setIsEditingInfo(false)}
              >
                <X size={16} style={{ marginRight: 8 }} />
                Отмена
              </button>
              <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={handleSaveInfo}>
                <Save size={16} style={{ marginRight: 8 }} />
                Сохранить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
