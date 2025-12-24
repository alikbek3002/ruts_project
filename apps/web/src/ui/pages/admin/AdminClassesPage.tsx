import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  apiAdminListUsers,
  apiCreateClass,
  apiDeleteClass,
  apiEnrollStudent,
  apiGetClass,
  apiListClasses,
  apiListDirections,
  apiUpdateClass,
  type AdminUser,
  type ClassItem,
  type Direction,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import styles from "./AdminClasses.module.css";

export function AdminClassesPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [students, setStudents] = useState<AdminUser[]>([]);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Create vzvod modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDirection, setCreateDirection] = useState("");
  const [createCuratorId, setCreateCuratorId] = useState("");
  const [createPickStudentId, setCreatePickStudentId] = useState("");
  const [createStudentIds, setCreateStudentIds] = useState<string[]>([]);

  // Модальное окно для редактирования группы
  const [editingClass, setEditingClass] = useState<ClassItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirection, setEditDirection] = useState("");
  const [editCuratorId, setEditCuratorId] = useState("");

  // Модальное для добавления студентов
  const [enrollingClassId, setEnrollingClassId] = useState<string | null>(null);
  const [classStudents, setClassStudents] = useState<Array<{ id: string; username: string; full_name: string | null; student_number?: number | null }>>([]);
  const [studentId, setStudentId] = useState("");

  async function reloadAll() {
    if (!token) return;
    const [c, d, s, t] = await Promise.all([
      apiListClasses(token),
      apiListDirections(token),
      apiAdminListUsers(token, "student"),
      apiAdminListUsers(token, "teacher"),
    ]);
    setClasses(c.classes);
    setDirections(d.directions || []);
    setStudents(s.users);
    setTeachers(t.users);
  }

  async function reloadClassStudents(classId: string) {
    if (!token) return;
    const resp = await apiGetClass(token, classId);
    setClassStudents(resp.students);
  }

  useEffect(() => {
    if (!can) return;
    reloadAll().catch((e) => setErr(String(e)));
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const base = user.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user.role === "manager" ? "Менеджер → Группы" : "Админ → Группы";

  function openCreate() {
    setErr(null);
    setCreateName("");
    setCreateDirection("");
    setCreateCuratorId("");
    setCreatePickStudentId("");
    setCreateStudentIds([]);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!token || !createName.trim()) return;
    if (createStudentIds.length > 35) {
      setErr("Максимум 35 учеников");
      return;
    }
    setErr(null);
    try {
      const created = await apiCreateClass(token, {
        name: createName.trim(),
        direction_id: createDirection || null,
        curator_id: createCuratorId || null,
      });

      // Enroll students in selected order (API assigns numbers 1..)
      for (const sid of createStudentIds) {
        await apiEnrollStudent(token, { class_id: created.class.id, student_id: sid });
      }

      setCreateOpen(false);
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  }

  const handleEditClass = (cls: ClassItem) => {
    setEditingClass(cls);
    setEditName(cls.name);
    setEditDirection(cls.direction_id || "");
    setEditCuratorId(cls.curator_id || "");
  };

  const handleSaveEdit = async () => {
    if (!token || !editingClass) return;
    setErr(null);
    try {
      await apiUpdateClass(token, editingClass.id, {
        name: editName.trim() || undefined,
        direction_id: editDirection || null,
        curator_id: editCuratorId || null,
      });
      setEditingClass(null);
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleOpenEnroll = async (classId: string) => {
    setEnrollingClassId(classId);
    await reloadClassStudents(classId);
  };

  const handleDeleteClass = async (cls: ClassItem) => {
    if (!token) return;
    const ok = window.confirm(
      `Удалить взвод "${cls.name}"?\n\nБудут удалены записи расписания/журнала этого взвода. Ученики останутся, но будут отвязаны от взвода.`
    );
    if (!ok) return;

    const actorPassword = window.prompt("Введите ваш пароль для подтверждения удаления:") || "";
    if (!actorPassword.trim()) return;

    setErr(null);
    try {
      await apiDeleteClass(token, cls.id, actorPassword.trim());
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleEnroll = async () => {
    if (!token || !enrollingClassId || !studentId) return;
    if (classStudents.length >= 35) {
      setErr("Максимум 35 учеников");
      return;
    }
    setErr(null);
    try {
      await apiEnrollStudent(token, { class_id: enrollingClassId, student_id: studentId });
      setStudentId("");
      await reloadClassStudents(enrollingClassId);
      await reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <AppShell
      title={title}
      nav={[
        { to: base, label: user.role === "manager" ? "Менеджер" : "Админ" },
        { to: `${base}/users`, label: "Пользователи" },
        { to: `${base}/classes`, label: "Группы" },
        { to: `${base}/subjects`, label: "Предметы" },
        { to: `${base}/directions`, label: "Направления" },
        { to: `${base}/timetable`, label: "Расписание" },
      ]}
    >
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
        <button onClick={openCreate}>Создать взвод</button>
        <button onClick={() => reloadAll().catch((e) => setErr(String(e)))}>🔄 Обновить</button>
      </div>

      <h3>Группы</h3>
      <div className={styles.cardsGrid}>
        {classes.map((cls) => (
          <div key={cls.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{cls.name}</span>
              <span className={styles.studentCount}>
                👤 {cls.student_count ?? 0}
              </span>
            </div>
            
            {cls.direction && (
              <div className={styles.direction}>
                📍 {cls.direction.name}
              </div>
            )}

            <div className={styles.cardActions}>
              <Link to={`${base}/classes/${cls.id}/journal`}>
                <button>📊 Журнал</button>
              </Link>
              <button className="secondary" onClick={() => handleOpenEnroll(cls.id)}>
                ➕ Студенты
              </button>
              <button className="secondary" onClick={() => handleEditClass(cls)}>
                ✏️
              </button>
              <button className="danger" onClick={() => handleDeleteClass(cls)} title="Удалить взвод">
                Удалить
              </button>
            </div>
          </div>
        ))}
        {classes.length === 0 && (
          <p style={{ color: "#888", gridColumn: "1 / -1" }}>Группы не созданы</p>
        )}
      </div>

      {/* Модальное окно редактирования */}
      {editingClass && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h3>Редактировать группу</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                placeholder="Название"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <select
                value={editDirection}
                onChange={(e) => setEditDirection(e.target.value)}
              >
                <option value="">— Без направления —</option>
                {directions.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              <select value={editCuratorId} onChange={(e) => setEditCuratorId(e.target.value)}>
                <option value="">— Куратор (не выбран) —</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name || t.username}
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="secondary" onClick={() => setEditingClass(null)}>Отмена</button>
                <button onClick={handleSaveEdit}>
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно создания взвода */}
      {createOpen && (
        <div className={styles.modal}>
          <div className={styles.modalContent} style={{ maxWidth: 760 }}>
            <h3>Создать взвод</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 4 }}>Название взвода</div>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Например: Взвод 1" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 4 }}>Направление</div>
                <select value={createDirection} onChange={(e) => setCreateDirection(e.target.value)}>
                  <option value="">— Направление —</option>
                  {directions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 4 }}>Куратор взвода</div>
                <select value={createCuratorId} onChange={(e) => setCreateCuratorId(e.target.value)}>
                  <option value="">— Выберите куратора —</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name || t.username}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <h4 style={{ marginTop: 8 }}>Ученики (максимум 35)</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <select
                value={createPickStudentId}
                onChange={(e) => setCreatePickStudentId(e.target.value)}
                style={{ flex: 1 }}
                disabled={createStudentIds.length >= 35}
              >
                <option value="">— Выберите ученика —</option>
                {students
                  .filter((s) => !createStudentIds.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name || s.username}
                    </option>
                  ))}
              </select>
              <button
                disabled={!createPickStudentId || createStudentIds.length >= 35}
                onClick={() => {
                  if (!createPickStudentId) return;
                  setCreateStudentIds((prev) => (prev.includes(createPickStudentId) ? prev : [...prev, createPickStudentId]));
                  setCreatePickStudentId("");
                }}
              >
                Добавить
              </button>
            </div>

            <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <table cellPadding={8} style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg)" }}>
                    <th align="left" style={{ width: 60 }}>№</th>
                    <th align="left">ФИО</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {createStudentIds.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ color: "var(--color-text-light)" }}>Пока нет учеников</td>
                    </tr>
                  ) : (
                    createStudentIds.map((sid, idx) => {
                      const s = students.find((x) => x.id === sid);
                      return (
                        <tr key={sid} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td>{idx + 1}</td>
                          <td>{s?.full_name || s?.username || sid}</td>
                          <td>
                            <button
                              className="secondary"
                              onClick={() => setCreateStudentIds((prev) => prev.filter((x) => x !== sid))}
                              title="Убрать"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button className="secondary" onClick={() => setCreateOpen(false)}>
                Отмена
              </button>
              <button disabled={!createName.trim()} onClick={handleCreate}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно записи студентов */}
      {enrollingClassId && (
        <div className={styles.modal}>
          <div className={styles.modalContent} style={{ maxWidth: 500 }}>
            <h3>Управление составом группы</h3>
            
            <h4>Записать студента</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                style={{ flex: 1 }}
                disabled={classStudents.length >= 35}
              >
                <option value="">— Выберите студента —</option>
                {students
                  .filter((s) => !classStudents.find((cs) => cs.id === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name || s.username}
                    </option>
                  ))}
              </select>
              <button onClick={handleEnroll} disabled={!studentId || classStudents.length >= 35}>
                Записать
              </button>
            </div>

            <h4>Состав группы ({classStudents.length})</h4>
            {classStudents.length === 0 ? (
              <p style={{ color: "#888" }}>Пусто</p>
            ) : (
              <div style={{ maxHeight: 240, overflow: "auto" }}>
                <table cellPadding={6} style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left" style={{ width: 60 }}>№</th>
                      <th align="left">ФИО</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classStudents.map((s, idx) => (
                      <tr key={s.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td>{s.student_number ?? idx + 1}</td>
                        <td>{s.full_name || s.username}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEnrollingClassId(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
