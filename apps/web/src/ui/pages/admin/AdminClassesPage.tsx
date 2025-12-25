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
import { 
  Plus, 
  RefreshCw, 
  Users, 
  MapPin, 
  User, 
  BookOpen, 
  Edit2, 
  Trash2, 
  X, 
  Save,
  UserPlus
} from "lucide-react";

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

  const curatorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) {
      map.set(t.id, t.full_name || t.username);
    }
    return map;
  }, [teachers]);

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
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Группы</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Plus size={18} />
              Создать взвод
            </button>
            <button className="secondary" onClick={() => reloadAll().catch((e) => setErr(String(e)))}>
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.cardsGrid}>
          {classes.map((cls) => (
            <div key={cls.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>{cls.name}</span>
                <span className={styles.studentCount}>
                  <Users size={12} />
                  {cls.student_count ?? 0}
                </span>
              </div>
              
              <div className={styles.cardBody}>
                {cls.direction && (
                  <div className={styles.infoRow}>
                    <MapPin className={styles.infoIcon} />
                    {cls.direction.name}
                  </div>
                )}

                <div className={styles.infoRow}>
                  <User className={styles.infoIcon} />
                  Куратор: {cls.curator_id ? curatorNameById.get(cls.curator_id) || "—" : "—"}
                </div>
              </div>

              <div className={styles.cardActions}>
                <Link to={`${base}/classes/${cls.id}/journal`} title="Журнал">
                  <button className="secondary" style={{ padding: 8 }}>
                    <BookOpen size={18} />
                  </button>
                </Link>
                <button className="secondary" onClick={() => handleOpenEnroll(cls.id)} title="Студенты" style={{ padding: 8 }}>
                  <UserPlus size={18} />
                </button>
                <button className="secondary" onClick={() => handleEditClass(cls)} title="Редактировать" style={{ padding: 8 }}>
                  <Edit2 size={18} />
                </button>
                <button 
                  className="secondary" 
                  style={{ color: "var(--color-error)", borderColor: "var(--color-error)", padding: 8 }}
                  onClick={() => handleDeleteClass(cls)} 
                  title="Удалить взвод"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
          {classes.length === 0 && (
            <p style={{ color: "var(--color-text-light)", gridColumn: "1 / -1", textAlign: "center", padding: "var(--spacing-xl)" }}>
              Группы не созданы
            </p>
          )}
        </div>

        {/* Модальное окно редактирования */}
        {editingClass && (
          <div className={styles.modalOverlay} onClick={() => setEditingClass(null)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>Редактировать группу</h3>
                <button className={styles.closeButton} onClick={() => setEditingClass(null)}>
                  <X size={20} />
                </button>
              </div>
              
              <div className={styles.modalContent}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Название</label>
                  <input
                    placeholder="Название"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup} style={{ marginTop: "var(--spacing-md)" }}>
                  <label className={styles.label}>Направление</label>
                  <select
                    value={editDirection}
                    onChange={(e) => setEditDirection(e.target.value)}
                  >
                    <option value="">— Без направления —</option>
                    {directions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup} style={{ marginTop: "var(--spacing-md)" }}>
                  <label className={styles.label}>Куратор</label>
                  <select value={editCuratorId} onChange={(e) => setEditCuratorId(e.target.value)}>
                    <option value="">— Куратор (не выбран) —</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name || t.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className="secondary" onClick={() => setEditingClass(null)}>Отмена</button>
                <button onClick={handleSaveEdit}>
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно создания взвода */}
        {createOpen && (
          <div className={styles.modalOverlay} onClick={() => setCreateOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800 }}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>Создать взвод</h3>
                <button className={styles.closeButton} onClick={() => setCreateOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className={styles.modalContent}>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Название взвода</label>
                    <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Например: Взвод 1" />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Направление</label>
                    <select value={createDirection} onChange={(e) => setCreateDirection(e.target.value)}>
                      <option value="">— Направление —</option>
                      {directions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                    <label className={styles.label}>Куратор взвода</label>
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

                <h4 className={styles.sectionTitle}>Ученики (максимум 35)</h4>
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

                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>№</th>
                        <th>ФИО</th>
                        <th style={{ width: 60 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {createStudentIds.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ color: "var(--color-text-light)", textAlign: "center" }}>Пока нет учеников</td>
                        </tr>
                      ) : (
                        createStudentIds.map((sid, idx) => {
                          const s = students.find((x) => x.id === sid);
                          return (
                            <tr key={sid}>
                              <td>{idx + 1}</td>
                              <td>{s?.full_name || s?.username || sid}</td>
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() => setCreateStudentIds((prev) => prev.filter((x) => x !== sid))}
                                  title="Убрать"
                                  style={{ padding: 4, height: "auto", color: "var(--color-error)" }}
                                >
                                  <X size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.modalFooter}>
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
          <div className={styles.modalOverlay} onClick={() => setEnrollingClassId(null)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>Управление составом группы</h3>
                <button className={styles.closeButton} onClick={() => setEnrollingClassId(null)}>
                  <X size={20} />
                </button>
              </div>
              
              <div className={styles.modalContent}>
                <h4 className={styles.sectionTitle} style={{ marginTop: 0 }}>Записать студента</h4>
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

                <h4 className={styles.sectionTitle}>Состав группы ({classStudents.length})</h4>
                {classStudents.length === 0 ? (
                  <p style={{ color: "var(--color-text-light)" }}>Пусто</p>
                ) : (
                  <div className={styles.tableContainer} style={{ maxHeight: 300, overflowY: "auto" }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th style={{ width: 60 }}>№</th>
                          <th>ФИО</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classStudents.map((s, idx) => (
                          <tr key={s.id}>
                            <td>{s.student_number ?? idx + 1}</td>
                            <td>{s.full_name || s.username}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button onClick={() => setEnrollingClassId(null)}>Закрыть</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
