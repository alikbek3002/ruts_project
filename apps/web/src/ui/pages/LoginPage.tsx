import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import styles from "./Login.module.css";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const user = await login(username.trim(), password, rememberMe);

      if (user?.must_change_password) {
        navigate('/change-password', { replace: true });
        return;
      }

      const panelLink =
        user?.role === 'manager'
          ? '/app/manager'
          : user?.role === 'admin'
          ? '/app/admin'
          : user?.role === 'teacher'
          ? '/app/teacher'
          : '/app/student';

      navigate(panelLink, { replace: true });
    } catch (err: any) {
      setError(err.message || "Ошибка авторизации");
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <div className={styles.loginHeader}>
          <div className={styles.logo}>
            <img src="/assets/rob-logo.png" alt="РОБ" className={styles.logoImage} />
          </div>
          <h1 className={styles.loginTitle}>Электронный журнал</h1>
          <p className={styles.loginSubtitle}>Учебный центр МВД КР</p>
        </div>
        <form onSubmit={handleSubmit} className={styles.loginForm}>
          {error && <div className={styles.errorMessage}>{error}</div>}
          <div className={styles.formGroup}>
            <label htmlFor="username" className={styles.formLabel}>Логин</label>
            <input
              id="username"
              type="text"
              className={styles.formInput}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Введите логин"
              autoComplete="username"
              name="username"
              autoFocus
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="password" className={styles.formLabel}>Пароль</label>
            <input
              id="password"
              type="password"
              className={styles.formInput}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
              autoComplete="current-password"
              name="password"
              required
            />
          </div>
          <div className={styles.rememberMe}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span>Запомнить меня</span>
            </label>
          </div>
          <button type="submit" className={styles.loginButton} disabled={isLoading}>
            {isLoading ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
