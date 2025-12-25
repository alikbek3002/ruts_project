import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiAdminCreateUser,
  apiAdminGenerateCredentials,
  apiAdminDeleteUser,
  apiAdminGetUser,
  apiAdminUpdateUser,
  apiAdminResetStudentPassword,
  apiAdminResetTeacherPassword,
  apiAdminListUsers,
  apiListClasses,
  apiListSubjects,
  apiGetTeacherSubjects,
  apiSetTeacherSubjects,
  type AdminUser,
  type AdminUserDetails,
  type ClassItem,
  type Subject,
  type UserRole,
} from "../../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import styles from "./AdminUsers.module.css";
import { 
  Search, 
  Plus, 
  X, 
  User, 
  Calendar, 
  Phone, 
  BookOpen, 
  GraduationCap, 
  Trash2, 
  Edit2, 
  RefreshCw, 
  Camera, 
  Save,
  Briefcase,
  Shield
} from "lucide-react";

function normalizeKgPhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  let rest = digits;
  if (rest.startsWith("996")) rest = rest.slice(3);
  rest = rest.slice(0, 9);
  return "+996" + rest;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function AdminUsersPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const [tab, setTab] = useState<"teachers" | "students">("students");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewUser, setViewUser] = useState<AdminUserDetails | null>(null);
  const [viewClass, setViewClass] = useState<{ id: string; name: string | null } | null>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);
  const [viewTempPassword, setViewTempPassword] = useState<string | null>(null);
  const [viewTeacherSubjectIds, setViewTeacherSubjectIds] = useState<string[]>([]);
  const [viewTeacherSaving, setViewTeacherSaving] = useState(false);
  const [viewEdit, setViewEdit] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);

  const [viewEditFirstName, setViewEditFirstName] = useState("");
  const [viewEditLastName, setViewEditLastName] = useState("");
  const [viewEditMiddleName, setViewEditMiddleName] = useState("");
  const [viewEditPhone, setViewEditPhone] = useState("+996");
  const [viewEditBirthDate, setViewEditBirthDate] = useState("");
  const [viewEditClassId, setViewEditClassId] = useState("");
  const [viewEditPhotoDataUrl, setViewEditPhotoDataUrl] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [role, setRole] = useState<Exclude<UserRole, "manager">>("student");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("+996");
  const [birthDate, setBirthDate] = useState("");
  const [classId, setClassId] = useState("");
  const [teacherSubjectIds, setTeacherSubjectIds] = useState<string[]>([]);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [generatedUsername, setGeneratedUsername] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const can = useMemo(() => !!user && (user.role === "admin" || user.role === "manager") && !!token, [user, token]);

  const base = user?.role === "manager" ? "/app/manager" : "/app/admin";
  const title = user?.role === "manager" ? "Менеджер → Пользователи" : "Админ → Пользователи";

  function resetForm() {
    setRole("student");
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setPhone("+996");
    setBirthDate("");
    setClassId("");
    setTeacherSubjectIds([]);
    setPhotoDataUrl(null);
    setGeneratedUsername("");
    setGeneratedPassword("");
  }

  async function loadClasses() {
    if (!token) return;
    const c = await apiListClasses(token);
    setClasses(c.classes);
  }

  async function loadSubjects() {
    if (!token) return;
    const s = await apiListSubjects(token);
    setSubjects(s.subjects || []);
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  async function reload() {
    if (!token) return;
    const role = tab === "teachers" ? "teacher" : "student";
    const resp = await apiAdminListUsers(token, role as any, search.trim() ? search : undefined);
    setUsers(resp.users);
  }

  async function openUserCard(u: AdminUser) {
    if (!token) return;
    setViewErr(null);
    setViewUser(null);
    setViewClass(null);
    setViewTempPassword(null);
    setViewTeacherSubjectIds([]);
    setViewEdit(false);
    setViewSaving(false);
    setViewEditFirstName("");
    setViewEditLastName("");
    setViewEditMiddleName("");
    setViewEditPhone("+996");
    setViewEditBirthDate("");
    setViewEditClassId("");
    setViewEditPhotoDataUrl(null);
    setViewOpen(true);
    setViewLoading(true);
    try {
      const resp = await apiAdminGetUser(token, u.id);
      setViewUser(resp.user);
      setViewClass(resp.class);

      setViewEditFirstName(resp.user.first_name || "");
      setViewEditLastName(resp.user.last_name || "");
      setViewEditMiddleName(resp.user.middle_name || "");
      setViewEditPhone(resp.user.phone || "+996");
      setViewEditBirthDate(resp.user.birth_date || "");
      setViewEditClassId(resp.class?.id || "");
      setViewEditPhotoDataUrl(resp.user.photo_data_url || null);

      if (resp.user.role === "teacher") {
        try {
          const ts = await apiGetTeacherSubjects(token, resp.user.id);
          const ids = (ts.subjects || []).map((s) => s.id).filter(Boolean);
          setViewTeacherSubjectIds(ids.slice(0, 2));
        } catch {
          setViewTeacherSubjectIds([]);
        }
      }
    } catch (e) {
      setViewErr(String(e));
    } finally {
      setViewLoading(false);
    }
  }

  async function deleteUserFromCard() {
    if (!token || !viewUser) return;
    const label = viewUser.full_name || viewUser.username || "этого пользователя";
    if (!window.confirm(`Удалить ${label}?`)) return;

    setViewErr(null);
    setViewSaving(true);
    try {
      await apiAdminDeleteUser(token, viewUser.id);
      setViewOpen(false);
      await reload();
    } catch (e) {
      setViewErr(String(e));
    } finally {
      setViewSaving(false);
    }
  }

  useEffect(() => {
    if (!can) return;
    reload().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, tab, search]);

  useEffect(() => {
    if (!can) return;
    loadClasses().catch(() => {
      // ignore; classes are only needed for student creation
    });
    loadSubjects().catch(() => {
      // ignore; subjects needed for teacher creation
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "manager") return <Navigate to="/app" replace />;

  const canCreateAdmin = user.role === "manager";

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
          <h2>Пользователи</h2>
          <button
            onClick={() => {
              setErr(null);
              resetForm();
              setModalOpen(true);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <Plus size={18} />
            Создать пользователя
          </button>
        </div>

        <div className={styles.controls}>
          <div className={styles.tabs}>
            <button 
              className={tab === "students" ? "" : "secondary"} 
              onClick={() => setTab("students")}
            >
              <GraduationCap size={16} style={{ marginRight: 8 }} />
              Студенты
            </button>
            <button 
              className={tab === "teachers" ? "" : "secondary"} 
              onClick={() => setTab("teachers")}
            >
              <Briefcase size={16} style={{ marginRight: 8 }} />
              Учителя
            </button>
          </div>
          
          <div className={styles.searchBar}>
            <Search className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ФИО"
            />
          </div>
          
          <button className="secondary" onClick={() => reload().catch((e) => setErr(String(e)))}>
            <RefreshCw size={16} />
          </button>
        </div>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.grid}>
          {users.map((u) => (
            <div
              key={u.id}
              className={styles.card}
              onClick={() => openUserCard(u)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openUserCard(u);
              }}
            >
              <div className={styles.cardHeader}>
                {u.photo_url ? (
                  <img src={u.photo_url} alt={u.full_name} className={styles.avatar} />
                ) : (
                  <div className={styles.avatarPlaceholder}>
                    {u.first_name?.[0] || u.username?.[0] || "?"}
                  </div>
                )}
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{u.full_name || u.username}</div>
                  <div className={styles.userRole}>
                    {u.role === "student" ? "Студент" : u.role === "teacher" ? "Преподаватель" : "Админ"}
                  </div>
                </div>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.infoRow}>
                  <User className={styles.infoIcon} />
                  <span>{u.username}</span>
                </div>
                {u.role === "student" && u.class_name && (
                  <div className={styles.infoRow}>
                    <GraduationCap className={styles.infoIcon} />
                    <span>{u.class_name}</span>
                  </div>
                )}
                {u.role === "teacher" && u.teacher_subject && (
                  <div className={styles.infoRow}>
                    <BookOpen className={styles.infoIcon} />
                    <span>{u.teacher_subject}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Create User Modal */}
        {modalOpen && (
          <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>Создать пользователя</h3>
                <button className={styles.closeButton} onClick={() => setModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className={styles.modalContent}>
                {err && <div className={styles.error}>{err}</div>}

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Фото</label>
                    <div className={styles.photoUpload}>
                      {photoDataUrl ? (
                        <img src={photoDataUrl} alt="Preview" className={styles.photoPreview} />
                      ) : (
                        <Camera size={32} color="var(--color-text-light)" />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        id="photo-upload"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const url = await fileToDataUrl(f);
                            setPhotoDataUrl(url);
                          } catch (err) {
                            setErr(String(err));
                          }
                        }}
                      />
                      <label htmlFor="photo-upload" style={{ cursor: "pointer", color: "var(--color-primary)", fontSize: 13 }}>
                        {photoDataUrl ? "Изменить фото" : "Загрузить фото"}
                      </label>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Роль</label>
                    <select value={role} onChange={(e) => setRole(e.target.value as any)}>
                      <option value="student">Ученик</option>
                      <option value="teacher">Преподаватель</option>
                      {canCreateAdmin && <option value="admin">Администратор</option>}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Фамилия</label>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия" />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Имя</label>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя" />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Отчество</label>
                    <input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Отчество" />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Телефон</label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(normalizeKgPhone(e.target.value))}
                      placeholder="+996XXXXXXXXX"
                      inputMode="numeric"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Дата рождения</label>
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => {
                        setBirthDate(e.target.value);
                        setGeneratedUsername("");
                        setGeneratedPassword("");
                      }}
                    />
                  </div>

                  {role === "student" && (
                    <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                      <label className={styles.label}>Группа</label>
                      <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                        <option value="">— Не определена —</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {role === "teacher" && (
                    <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                      <label className={styles.label}>Предметы (до 2)</label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-md)" }}>
                        <select
                          value={teacherSubjectIds[0] || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTeacherSubjectIds((prev) => {
                              const next = [...prev];
                              if (!v) {
                                next[0] = "";
                              } else {
                                next[0] = v;
                              }
                              return next.filter(Boolean).slice(0, 2);
                            });
                          }}
                        >
                          <option value="">(предмет 1)</option>
                          {subjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={teacherSubjectIds[1] || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTeacherSubjectIds((prev) => {
                              const first = prev[0] || "";
                              const second = v || "";
                              const next = [first, second].filter(Boolean);
                              return Array.from(new Set(next)).slice(0, 2);
                            });
                          }}
                        >
                          <option value="">(предмет 2 — необязательно)</option>
                          {subjects
                            .filter((s) => s.id !== (teacherSubjectIds[0] || ""))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className={`${styles.fullWidth} ${styles.formGrid}`} style={{ alignItems: "end" }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Логин</label>
                      <input value={generatedUsername} readOnly placeholder="Сначала нажмите “Сгенерировать”" />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Пароль</label>
                      <input value={generatedPassword} readOnly placeholder="Сначала нажмите “Сгенерировать”" />
                    </div>
                  </div>
                  
                  <div className={styles.fullWidth} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="secondary"
                      disabled={generating || !firstName.trim() || !lastName.trim() || !birthDate}
                      onClick={async () => {
                        if (!token) return;
                        setErr(null);
                        if (!isIsoDate(birthDate)) {
                          setErr("Дата рождения должна быть в формате YYYY-MM-DD");
                          return;
                        }
                        setGenerating(true);
                        try {
                          const resp = await apiAdminGenerateCredentials(token, {
                            role,
                            first_name: firstName.trim(),
                            last_name: lastName.trim(),
                            birth_date: birthDate,
                          });
                          setGeneratedUsername(resp.username);
                          setGeneratedPassword(resp.password);
                        } catch (e) {
                          setErr(String(e));
                          setGeneratedUsername("");
                          setGeneratedPassword("");
                        } finally {
                          setGenerating(false);
                        }
                      }}
                    >
                      <RefreshCw size={16} style={{ marginRight: 8 }} />
                      {generating ? "Генерация..." : "Сгенерировать"}
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  onClick={async () => {
                    if (!token) return;
                    setErr(null);

                    const ln = lastName.trim();
                    const fn = firstName.trim();
                    const mn = middleName.trim();
                    const ph = phone.trim();
                    if (!ln || !fn) {
                      setErr("Введите фамилию и имя");
                      return;
                    }
                    if (!ph.startsWith("+996")) {
                      setErr("Телефон должен начинаться с +996");
                      return;
                    }
                    if (!birthDate) {
                      setErr("Выберите дату рождения");
                      return;
                    }
                    if (!generatedUsername || !generatedPassword) {
                      setErr("Нажмите “Сгенерировать” для логина и пароля");
                      return;
                    }
                    if (role === "teacher" && teacherSubjectIds.length < 1) {
                      setErr("Выберите хотя бы 1 предмет для преподавателя");
                      return;
                    }

                    setSaving(true);
                    try {
                      const teacherSubjectNames = teacherSubjectIds
                        .map((id) => subjects.find((s) => s.id === id)?.name)
                        .filter(Boolean) as string[];

                      const resp = await apiAdminCreateUser(token, {
                        role,
                        first_name: fn,
                        last_name: ln,
                        middle_name: mn || null,
                        phone: ph,
                        birth_date: birthDate,
                        photo_data_url: photoDataUrl,
                        class_id: (role === "student" && classId) ? classId : null,
                        teacher_subject: role === "teacher" ? teacherSubjectNames.join(", ") : null,
                        subject_ids: role === "teacher" ? teacherSubjectIds : null,
                        username: generatedUsername,
                        temp_password: generatedPassword,
                      });
                      setModalOpen(false);
                      await reload();
                    } catch (e) {
                      setErr(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  {saving ? "Создание..." : "Создать"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View/Edit User Modal */}
        {viewOpen && (
          <div className={styles.modalOverlay} onClick={() => setViewOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  {viewLoading ? "Загрузка..." : viewUser?.full_name || "Пользователь"}
                </h3>
                <div style={{ display: "flex", gap: 8 }}>
                  {!viewLoading && viewUser && (
                    <>
                      <button 
                        className="secondary" 
                        onClick={() => setViewEdit(!viewEdit)}
                        title="Редактировать"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        className="secondary" 
                        style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
                        onClick={deleteUserFromCard}
                        title="Удалить"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                  <button className={styles.closeButton} onClick={() => setViewOpen(false)}>
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className={styles.modalContent}>
                {viewLoading ? (
                  <Loader />
                ) : !viewUser ? (
                  <p>Не удалось загрузить данные</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
                    {viewErr && <div className={styles.error}>{viewErr}</div>}

                    <div style={{ display: "flex", gap: "var(--spacing-lg)", alignItems: "flex-start" }}>
                      <div style={{ flexShrink: 0 }}>
                        {viewEdit ? (
                          <div className={styles.photoUpload} style={{ width: 120, height: 120, padding: 0, justifyContent: "center" }}>
                            {viewEditPhotoDataUrl ? (
                              <img src={viewEditPhotoDataUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--radius-lg)" }} />
                            ) : (
                              <Camera size={32} color="var(--color-text-light)" />
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              id="edit-photo-upload"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                try {
                                  const url = await fileToDataUrl(f);
                                  setViewEditPhotoDataUrl(url);
                                } catch (err) {
                                  setViewErr(String(err));
                                }
                              }}
                            />
                            <label htmlFor="edit-photo-upload" style={{ position: "absolute", inset: 0, cursor: "pointer" }} />
                          </div>
                        ) : (
                          <img 
                            src={viewUser.photo_url || ""} 
                            alt={viewUser.full_name} 
                            style={{ 
                              width: 120, 
                              height: 120, 
                              borderRadius: "var(--radius-lg)", 
                              objectFit: "cover",
                              background: "var(--color-bg)",
                              border: "1px solid var(--color-border)"
                            }} 
                          />
                        )}
                      </div>

                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                        <div className={styles.infoRow}>
                          <User size={16} className={styles.infoIcon} />
                          <span style={{ fontWeight: 500 }}>{viewUser.username}</span>
                        </div>
                        <div className={styles.infoRow}>
                          <Shield size={16} className={styles.infoIcon} />
                          <span>{viewUser.role === "student" ? "Студент" : viewUser.role === "teacher" ? "Преподаватель" : "Админ"}</span>
                        </div>
                        
                        {/* Password Reset Section */}
                        <div style={{ marginTop: "var(--spacing-md)", padding: "var(--spacing-md)", background: "var(--color-bg-subtle)", borderRadius: "var(--radius-md)" }}>
                          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Сброс пароля</div>
                          {viewTempPassword ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--color-card)", padding: 8, borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                              <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 600 }}>{viewTempPassword}</span>
                              <button className="secondary" style={{ padding: 4, height: "auto" }} onClick={() => navigator.clipboard.writeText(viewTempPassword)}>
                                Копировать
                              </button>
                            </div>
                          ) : (
                            <button 
                              className="secondary" 
                              style={{ fontSize: 13 }}
                              onClick={async () => {
                                if (!token) return;
                                if (!window.confirm("Сбросить пароль?")) return;
                                setViewErr(null);
                                try {
                                  let resp;
                                  if (viewUser.role === "student") {
                                    resp = await apiAdminResetStudentPassword(token, viewUser.id);
                                  } else {
                                    resp = await apiAdminResetTeacherPassword(token, viewUser.id);
                                  }
                                  setViewTempPassword(resp.temp_password);
                                } catch (e) {
                                  setViewErr(String(e));
                                }
                              }}
                            >
                              Сбросить пароль
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Фамилия</label>
                        {!viewEdit ? (
                          <div>{viewUser.last_name}</div>
                        ) : (
                          <input value={viewEditLastName} onChange={(e) => setViewEditLastName(e.target.value)} />
                        )}
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Имя</label>
                        {!viewEdit ? (
                          <div>{viewUser.first_name}</div>
                        ) : (
                          <input value={viewEditFirstName} onChange={(e) => setViewEditFirstName(e.target.value)} />
                        )}
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Отчество</label>
                        {!viewEdit ? (
                          <div>{viewUser.middle_name || "—"}</div>
                        ) : (
                          <input value={viewEditMiddleName} onChange={(e) => setViewEditMiddleName(e.target.value)} />
                        )}
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Телефон</label>
                        {!viewEdit ? (
                          <div>{viewUser.phone || "—"}</div>
                        ) : (
                          <input value={viewEditPhone} onChange={(e) => setViewEditPhone(e.target.value)} placeholder="+996..." />
                        )}
                      </div>
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Дата рождения</label>
                        {!viewEdit ? (
                          <div>{viewUser.birth_date || "—"}</div>
                        ) : (
                          <input type="date" value={viewEditBirthDate} onChange={(e) => setViewEditBirthDate(e.target.value)} />
                        )}
                      </div>

                      {viewUser.role === "student" && (
                        <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                          <label className={styles.label}>Группа</label>
                          {!viewEdit ? (
                            <div>{viewClass?.name || "—"}</div>
                          ) : (
                            <select value={viewEditClassId} onChange={(e) => setViewEditClassId(e.target.value)}>
                              <option value="">(без группы)</option>
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>

                    {viewUser.role === "teacher" && (
                      <div style={{ 
                        border: "1px solid var(--color-border)", 
                        borderRadius: "var(--radius-md)", 
                        padding: "var(--spacing-md)",
                        background: "var(--color-bg-subtle)"
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: "var(--spacing-md)" }}>Предметы учителя</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                          <select
                            value={viewTeacherSubjectIds[0] || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setViewTeacherSubjectIds((prev) => {
                                const second = prev[1] || "";
                                const next = [v || "", second].filter(Boolean);
                                return Array.from(new Set(next)).slice(0, 2);
                              });
                            }}
                          >
                            <option value="">(предмет 1)</option>
                            {subjects.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={viewTeacherSubjectIds[1] || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setViewTeacherSubjectIds((prev) => {
                                const first = prev[0] || "";
                                const next = [first, v || ""].filter(Boolean);
                                return Array.from(new Set(next)).slice(0, 2);
                              });
                            }}
                          >
                            <option value="">(предмет 2 — необязательно)</option>
                            {subjects
                              .filter((s) => s.id !== (viewTeacherSubjectIds[0] || ""))
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                          </select>

                          <button
                            disabled={viewTeacherSaving || viewTeacherSubjectIds.length < 1}
                            onClick={async () => {
                              if (!token || !viewUser) return;
                              setViewErr(null);
                              setViewTeacherSaving(true);
                              try {
                                await apiSetTeacherSubjects(token, viewUser.id, viewTeacherSubjectIds);
                                const refreshed = await apiAdminGetUser(token, viewUser.id);
                                setViewUser(refreshed.user);
                              } catch (e) {
                                setViewErr(String(e));
                              } finally {
                                setViewTeacherSaving(false);
                              }
                            }}
                          >
                            {viewTeacherSaving ? "..." : <Save size={16} />}
                          </button>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-light)" }}>
                          Сейчас: {viewUser.teacher_subject || "—"}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {viewEdit && (
                <div className={styles.modalFooter}>
                  <button
                    disabled={viewSaving}
                    onClick={async () => {
                      if (!token || !viewUser) return;
                      setViewErr(null);
                      setViewSaving(true);
                      try {
                        const resp = await apiAdminUpdateUser(token, viewUser.id, {
                          first_name: viewEditFirstName.trim() || null,
                          last_name: viewEditLastName.trim() || null,
                          middle_name: viewEditMiddleName.trim() || null,
                          phone: viewEditPhone.trim() || null,
                          birth_date: viewEditBirthDate || null,
                          photo_data_url: viewEditPhotoDataUrl,
                          class_id: viewUser.role === "student" ? (viewEditClassId || null) : undefined,
                        });
                        setViewUser(resp.user);
                        setViewClass(resp.class);
                        setViewEdit(false);
                      } catch (e) {
                        setViewErr(String(e));
                      } finally {
                        setViewSaving(false);
                      }
                    }}
                  >
                    {viewSaving ? "Сохранение..." : "Сохранить изменения"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
