import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { apiZoomStart, apiZoomStatus } from '../../api/client';
import { Header } from '../layout/Header';
import styles from '../../styles/common.module.css';

export function DashboardPage() {
  const { state, refreshMe } = useAuth();
  const [zoom, setZoom] = useState<{ connected: boolean; zoom_user_id?: string } | null>(null);
  const token = state.accessToken!;

  const panelLink =
    state.user?.role === 'manager'
      ? '/app/manager'
      : state.user?.role === 'admin'
      ? '/app/admin'
      : state.user?.role === 'teacher'
      ? '/app/teacher'
      : '/app/student';

  useEffect(() => {
    refreshMe();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const z = await apiZoomStatus(token);
        setZoom(z);
      } catch {
        setZoom(null);
      }
    })();
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header title="Главная панель" />
      <div style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'var(--spacing-lg)' }}>
        <div className={styles.page}>
          <div className={styles.pageHeader}>
            <h2 className={styles.pageTitle}>Добро пожаловать!</h2>
          </div>
          
          <div className={styles.card}>
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <div style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 'var(--spacing-xs)' }}>Пользователь</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{state.user?.username}</div>
              {state.user?.full_name && (
                <div style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 'var(--spacing-xs)' }}>{state.user.full_name}</div>
              )}
            </div>
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <div style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 'var(--spacing-xs)' }}>Роль</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-primary)' }}>
                {state.user?.role === 'manager'
                  ? 'Менеджер'
                  : state.user?.role === 'admin'
                  ? 'Администратор'
                  : state.user?.role === 'teacher'
                  ? 'Преподаватель'
                  : 'Ученик'}
              </div>
            </div>
            <Link to={panelLink}>
              <button style={{ width: '100%', padding: 'var(--spacing-md)', fontSize: 16, fontWeight: 600 }}>
                Открыть рабочую панель
              </button>
            </Link>
          </div>

          {(state.user?.role === 'teacher' || state.user?.role === 'admin') && (
            <div className={styles.card} style={{ marginTop: 'var(--spacing-md)' }}>
              <h3 style={{ marginBottom: 'var(--spacing-md)', fontSize: 16, fontWeight: 600 }}>Zoom</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: 'var(--color-text-light)' }}>
                    Статус: <span style={{ fontWeight: 600, color: zoom?.connected ? 'var(--color-success)' : 'var(--color-text)' }}>{zoom?.connected ? 'Подключен' : 'Не подключен'}</span>
                  </div>
                </div>
                {!zoom?.connected && (
                  <button
                    onClick={async () => {
                      const res = await apiZoomStart(token);
                      window.location.href = res.authUrl;
                    }}
                  >
                    Подключить Zoom
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
