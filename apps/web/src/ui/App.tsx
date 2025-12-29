import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../ui/auth/AuthProvider';
import { Loader } from './components/Loader';

// Lazy load pages
const LoginPage = React.lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ChangePasswordPage = React.lazy(() => import('./pages/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));

// Admin Pages
const AdminHomePage = React.lazy(() => import('./pages/admin/AdminHomePage').then(m => ({ default: m.AdminHomePage })));
const AdminUsersPage = React.lazy(() => import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminClassesPage = React.lazy(() => import('./pages/admin/AdminClassesPage').then(m => ({ default: m.AdminClassesPage })));
const AdminClassJournalPage = React.lazy(() => import('./pages/admin/AdminClassJournalPage').then(m => ({ default: m.AdminClassJournalPage })));
const AdminTimetablePage = React.lazy(() => import('./pages/admin/AdminTimetablePage').then(m => ({ default: m.AdminTimetablePage })));
const AdminSubjectsPage = React.lazy(() => import('./pages/admin/AdminSubjectsPage').then(m => ({ default: m.AdminSubjectsPage })));
const AdminDirectionsPage = React.lazy(() => import('./pages/admin/AdminDirectionsPage').then(m => ({ default: m.AdminDirectionsPage })));
const AdminNotificationsPage = React.lazy(() => import('./pages/admin/AdminNotificationsPage').then(m => ({ default: m.AdminNotificationsPage })));
const AdminStreamsPage = React.lazy(() => import('./pages/admin/AdminStreamsPage').then(m => ({ default: m.AdminStreamsPage })));
const AdminStreamDetailPage = React.lazy(() => import('./pages/admin/AdminStreamDetailPage').then(m => ({ default: m.AdminStreamDetailPage })));

// Teacher Pages
const TeacherHomePage = React.lazy(() => import('./pages/teacher/TeacherHomePage').then(m => ({ default: m.TeacherHomePage })));
const TeacherJournalPage = React.lazy(() => import('./pages/teacher/TeacherJournalPage').then(m => ({ default: m.TeacherJournalPage })));
const TeacherMyVzvodyPage = React.lazy(() => import('./pages/teacher/TeacherMyVzvodyPage').then(m => ({ default: m.TeacherMyVzvodyPage })));
const TeacherTimetablePage = React.lazy(() => import('./pages/teacher/TeacherTimetablePage').then(m => ({ default: m.TeacherTimetablePage })));
const TeacherLibraryPage = React.lazy(() => import('./pages/teacher/TeacherLibraryPage').then(m => ({ default: m.TeacherLibraryPage })));
const TeacherCoursesPage = React.lazy(() => import('./pages/teacher/TeacherCoursesPage').then(m => ({ default: m.TeacherCoursesPage })));
const TeacherCourseEditPage = React.lazy(() => import('./pages/teacher/TeacherCourseEditPage').then(m => ({ default: m.TeacherCourseEditPage })));
const TeacherCourseNewPage = React.lazy(() => import('./pages/teacher/TeacherCourseNewPage').then(m => ({ default: m.TeacherCourseNewPage })));

// Student Pages
const StudentHomePage = React.lazy(() => import('./pages/student/StudentHomePage').then(m => ({ default: m.StudentHomePage })));
const StudentTimetablePage = React.lazy(() => import('./pages/student/StudentTimetablePage').then(m => ({ default: m.StudentTimetablePage })));
const StudentGradesPage = React.lazy(() => import('./pages/student/StudentGradesPage').then(m => ({ default: m.StudentGradesPage })));
const StudentLibraryPage = React.lazy(() => import('./pages/student/StudentLibraryPage').then(m => ({ default: m.StudentLibraryPage })));
const StudentHomeworkPage = React.lazy(() => import('./pages/student/StudentHomeworkPage')); // Default export
const StudentCoursesPage = React.lazy(() => import('./pages/student/StudentCoursesPage').then(m => ({ default: m.StudentCoursesPage })));
const StudentCourseViewPage = React.lazy(() => import('./pages/student/StudentCourseViewPage').then(m => ({ default: m.StudentCourseViewPage })));
const StudentTestPage = React.lazy(() => import('./pages/student/StudentTestPage').then(m => ({ default: m.StudentTestPage })));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { state } = useAuth();
  if (!state.accessToken) return <Navigate to="/login" replace />;
  if (state.user?.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Loader fullScreen text="Загрузка..." />}>
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
            path="/app/admin/streams"
            element={
              <RequireAuth>
                <AdminStreamsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/manager/streams"
            element={
              <RequireAuth>
                <AdminStreamsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/admin/streams/:streamId"
            element={
              <RequireAuth>
                <AdminStreamDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/manager/streams/:streamId"
            element={
              <RequireAuth>
                <AdminStreamDetailPage />
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
          path="/app/admin/notifications"
          element={
            <RequireAuth>
              <AdminNotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/manager/notifications"
          element={
            <RequireAuth>
              <AdminNotificationsPage />
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
          path="/app/teacher/library"
          element={
            <RequireAuth>
              <TeacherLibraryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/courses"
          element={
            <RequireAuth>
              <TeacherCoursesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/courses/new"
          element={
            <RequireAuth>
              <TeacherCourseNewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/teacher/courses/:courseId"
          element={
            <RequireAuth>
              <TeacherCourseEditPage />
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
        <Route
          path="/app/student/homework"
          element={
            <RequireAuth>
              <StudentHomeworkPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/courses"
          element={
            <RequireAuth>
              <StudentCoursesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/courses/:courseId"
          element={
            <RequireAuth>
              <StudentCourseViewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/student/courses/:courseId/test/:testId"
          element={
            <RequireAuth>
              <StudentTestPage />
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
      </Suspense>
    </AuthProvider>
  );
}
