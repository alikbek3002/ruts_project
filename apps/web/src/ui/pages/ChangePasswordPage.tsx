import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiChangePassword } from "../../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Header } from "../layout/Header";
import styles from "../../styles/common.module.css";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { state, refreshMe } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      await apiChangePassword(state.accessToken!, oldPassword, newPassword);
      await refreshMe();
      setSuccess(true);
      const role = state.user?.role;
      const panelLink =
        role === 'manager'
          ? '/app/manager'
          : role === 'admin'
          ? '/app/admin'
          : role === 'teacher'
          ? '/app/teacher'
          : role === 'student'
          ? '/app/student'
          : '/app';
      setTimeout(() => navigate(panelLink, { replace: true }), 1500);
    } catch (err: any) {
      setError(err.message || "Ошибка смены пароля");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header title="Смена пароля" />
      <div style={{ flex: 1, maxWidth: 600, width: "100%", margin: "0 auto", padding: "var(--spacing-lg)" }}>
        <div className={styles.page}>
          <div className={styles.card}>
            <form onSubmit={handleSubmit} className={styles.form}>
              {error && <div className={styles.errorMessage}>{error}</div>}
              {success && <div className={styles.successMessage}>Пароль успешно изменен! Переход на главную...</div>}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Текущий пароль</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Введите текущий пароль"
                  required
                  autoFocus
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Новый пароль</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Введите новый пароль"
                  required
                  minLength={8}
                />
              </div>
              <div className={styles.formActions}>
                <button type="button" onClick={() => navigate(-1)} className={styles.buttonSecondary}>
                  Отмена
                </button>
                <button type="submit" disabled={!state.accessToken}>
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
