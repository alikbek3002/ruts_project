import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  apiAdminListUsers,
  apiBulkEnrollStudents,
  apiCreateClass,
  apiDeleteClass,
  apiEnrollStudent,
  apiGetClass,
  apiListClasses,
  apiListDirections,
  apiRemoveStudent,
  apiUpdateClass,
  type AdminUser,
  type ClassItem,
  type Direction,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { getAdminNavItems } from "../../layout/navigation";
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
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Create vzvod modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDirection, setCreateDirection] = useState("");
  const [createCuratorId, setCreateCuratorId] = useState("");
  const [createStudentsList, setCreateStudentsList] = useState("");

  // Модальное окно для редактирования группы
  const [editingClass, setEditingClass] = useState<ClassItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirection, setEditDirection] = useState("");
  const [editCuratorId, setEditCuratorId] = useState("");

  // Модальное для добавления студентов
  const [enrollingClassId, setEnrollingClassId] = useState<string | null>(null);
  const [classStudents, setClassStudents] = useState<Array<{ id: string; username: string; full_name: string | null; student_number?: number | null }>>([]);
  const [newStudentName, setNewStudentName] = useState("");
  const [bulkStudentsList, setBulkStudentsList] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  async function reloadAll() {
    if (!token) return;
    const [c, d, t] = await Promise.all([
      apiListClasses(token),
      apiListDirections(token),
      apiAdminListUsers(token, "teacher"),
    ]);
    setClasses(c.classes);
    setDirections(d.directions || []);
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
    setCreateStudentsList("");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!token || !createName.trim()) return;
    const studentLines = createStudentsList.split("\n").map(s => s.trim()).filter(Boolean);
    if (studentLines.length > 35) {
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

      // Bulk enroll students by FIO list
      if (studentLines.length > 0) {
        await apiBulkEnrollStudents(token, created.class.id, studentLines);
      }

      setCreateOpen(false);
      void reloadAll();
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
      void reloadAll();
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
      void reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleEnrollByName = async () => {
    if (!token || !enrollingClassId || !newStudentName.trim()) return;
    if (classStudents.length >= 35) {
      setErr("Максимум 35 учеников");
      return;
    }
    setErr(null);
    try {
      await apiEnrollStudent(token, { class_id: enrollingClassId, student_full_name: newStudentName.trim() });
      setNewStudentName("");
      void reloadClassStudents(enrollingClassId);
      void reloadAll();
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleBulkEnroll = async () => {
    if (!token || !enrollingClassId || !bulkStudentsList.trim()) return;
    const lines = bulkStudentsList.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    if (classStudents.length + lines.length > 35) {
      setErr(`Превышен лимит 35 учеников. Текущий: ${classStudents.length}, добавляется: ${lines.length}`);
      return;
    }
    setErr(null);
    setBulkLoading(true);
    try {
      const result = await apiBulkEnrollStudents(token, enrollingClassId, lines);
      setBulkStudentsList("");
      void reloadClassStudents(enrollingClassId);
      void reloadAll();
      alert(`Добавлено учеников: ${result.count}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <AppShell
      title={title}
      nav={getAdminNavItems(base)}
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
                <p style={{ fontSize: "0.9em", color: "var(--color-text-secondary)", marginBottom: 8 }}>Введите список ФИО учеников (каждое на новой строке):</p>
                <textarea
                  value={createStudentsList}
                  onChange={(e) => setCreateStudentsList(e.target.value)}
                  placeholder="Иванов Иван Иванович&#10;Петров Петр Петрович&#10;Сидорова Мария Ивановна"
                  style={{ width: "100%", minHeight: 160, resize: "vertical", fontFamily: "inherit", padding: 8 }}
                />
                {createStudentsList.trim() && (
                  <p style={{ fontSize: "0.85em", color: "var(--color-text-secondary)", marginTop: 4 }}>
                    Учеников в списке: {createStudentsList.split("\n").map(s => s.trim()).filter(Boolean).length}
                  </p>
                )}
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
                <h4 className={styles.sectionTitle} style={{ marginTop: 0 }}>Добавить ученика</h4>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <input
                    type="text"
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    placeholder="Введите ФИО ученика"
                    style={{ flex: 1 }}
                    disabled={classStudents.length >= 35}
                    onKeyDown={(e) => e.key === "Enter" && handleEnrollByName()}
                  />
                  <button onClick={handleEnrollByName} disabled={!newStudentName.trim() || classStudents.length >= 35}>
                    Добавить
                  </button>
                </div>

                <h4 className={styles.sectionTitle}>Массовая загрузка</h4>
                <p style={{ fontSize: "0.9em", color: "var(--color-text-secondary)", marginBottom: 8 }}>Вставьте список ФИО (каждое на новой строке):</p>
                <textarea
                  value={bulkStudentsList}
                  onChange={(e) => setBulkStudentsList(e.target.value)}
                  placeholder="Иванов Иван Иванович\nПетров Петр Петрович\nСидорова Мария Ивановна"
                  style={{ width: "100%", minHeight: 120, resize: "vertical", fontFamily: "inherit", padding: 8 }}
                  disabled={classStudents.length >= 35 || bulkLoading}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, marginBottom: 16 }}>
                  <button
                    onClick={handleBulkEnroll}
                    disabled={!bulkStudentsList.trim() || classStudents.length >= 35 || bulkLoading}
                  >
                    {bulkLoading ? "Загрузка..." : "Загрузить список"}
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
                          <th style={{ width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {classStudents.map((s, idx) => (
                          <tr key={s.id}>
                            <td>{s.student_number ?? idx + 1}</td>
                            <td>{s.full_name || s.username}</td>
                            <td>
                              <button
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}
                                title="Удалить ученика"
                                onClick={async () => {
                                  if (!token || !enrollingClassId) return;
                                  if (!confirm(`Удалить "${s.full_name || s.username}" из группы?`)) return;
                                  try {
                                    await apiRemoveStudent(token, enrollingClassId, s.id);
                                    void reloadClassStudents(enrollingClassId);
                                    void reloadAll();
                                  } catch (e) {
                                    setErr(String(e));
                                  }
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
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
