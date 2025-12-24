import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../ui/auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { AdminHomePage } from './pages/admin/AdminHomePage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminClassesPage } from './pages/admin/AdminClassesPage';
import { AdminClassJournalPage } from './pages/admin/AdminClassJournalPage';
import { AdminTimetablePage } from './pages/admin/AdminTimetablePage';
import { AdminSubjectsPage } from './pages/admin/AdminSubjectsPage';
import { AdminDirectionsPage } from './pages/admin/AdminDirectionsPage';
import { TeacherHomePage } from './pages/teacher/TeacherHomePage';
import { TeacherJournalPage } from './pages/teacher/TeacherJournalPage';
import { TeacherMyVzvodyPage } from './pages/teacher/TeacherMyVzvodyPage';
import { TeacherTimetablePage } from './pages/teacher/TeacherTimetablePage';
import { TeacherGradebookPage } from './pages/teacher/TeacherGradebookPage';
import { TeacherLibraryPage } from './pages/teacher/TeacherLibraryPage';
import { StudentHomePage } from './pages/student/StudentHomePage';
import { StudentTimetablePage } from './pages/student/StudentTimetablePage';
import { StudentGradesPage } from './pages/student/StudentGradesPage';
import { StudentLibraryPage } from './pages/student/StudentLibraryPage';
import { ProfilePage } from './pages/ProfilePage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { state } = useAuth();
  if (!state.accessToken) return <Navigate to="/login" replace />;
  if (state.user?.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route path="/" element={<Navigate to="/app" replace />} />

        <Route
          path="/app/admin"
          element={
            <RequireAuth>
              <AdminHomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager"
          element={
            <RequireAuth>
              <AdminHomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/users"
          element={
            <RequireAuth>
              <AdminUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/users"
          element={
            <RequireAuth>
              <AdminUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/classes"
          element={
            <RequireAuth>
              <AdminClassesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/classes"
          element={
            <RequireAuth>
              <AdminClassesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/timetable"
          element={
            <RequireAuth>
              <AdminTimetablePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/timetable"
          element={
            <RequireAuth>
              <AdminTimetablePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/subjects"
          element={
            <RequireAuth>
              <AdminSubjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/subjects"
          element={
            <RequireAuth>
              <AdminSubjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/directions"
          element={
            <RequireAuth>
              <AdminDirectionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/directions"
          element={
            <RequireAuth>
              <AdminDirectionsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/admin/classes/:classId/journal"
          element={
            <RequireAuth>
              <AdminClassJournalPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/classes/:classId/journal"
          element={
            <RequireAuth>
              <AdminClassJournalPage />
            </RequireAuth>
          }
        />

        <Route
          path="/app/teacher"
          element={
            <RequireAuth>
              <TeacherHomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/timetable"
          element={
            <RequireAuth>
              <TeacherTimetablePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/vzvody"
          element={
            <RequireAuth>
              <TeacherMyVzvodyPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/journal"
          element={
            <RequireAuth>
              <TeacherJournalPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/gradebook"
          element={
            <RequireAuth>
              <TeacherGradebookPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/library"
          element={
            <RequireAuth>
              <TeacherLibraryPage />
            </RequireAuth>
          }
        />

        <Route
          path="/app/student"
          element={
            <RequireAuth>
              <StudentHomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/timetable"
          element={
            <RequireAuth>
              <StudentTimetablePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/grades"
          element={
            <RequireAuth>
              <StudentGradesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/library"
          element={
            <RequireAuth>
              <StudentLibraryPage />
            </RequireAuth>
          }
        />

        {/* Profile page - available for all roles */}
        <Route
          path="/app/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AuthProvider>
  );
}
