import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Loader } from '../components/Loader';

export function DashboardPage() {
  const { state } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!state.user) return;
    
    const role = state.user.role;
    if (role === 'teacher') navigate('/app/teacher', { replace: true });
    else if (role === 'student') navigate('/app/student', { replace: true });
    else if (role === 'admin') navigate('/app/admin', { replace: true });
    else if (role === 'manager') navigate('/app/manager', { replace: true });
    else navigate('/app/profile', { replace: true });
  }, [state.user, navigate]);

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader />
    </div>
  );
}
