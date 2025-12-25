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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => {
            setErr(null);
            resetForm();
            setModalOpen(true);
          }}
        >
          Создать пользователя
        </button>
      </div>

      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "color-mix(in srgb, var(--color-text) 35%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--spacing-lg)",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-lg)",
              padding: "var(--spacing-lg)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-md)" }}>
              <h3 style={{ margin: 0 }}>Создать пользователя</h3>
              <button className="secondary" onClick={() => setModalOpen(false)}>
                Закрыть
              </button>
            </div>

            {err && (
              <div
                style={{
                  marginBottom: "var(--spacing-md)",
                  padding: "var(--spacing-sm) var(--spacing-md)",
                  border: "1px solid var(--color-border)",
                  background: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-error)",
                }}
              >
                {err}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-md)" }}>
              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Фото</label>
                <div style={{ display: "flex", gap: "var(--spacing-md)", alignItems: "center" }}>
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {photoDataUrl ? (
                      <img src={photoDataUrl} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-text-light)" }}>Нет</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
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
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Статус</label>
                <select value={role} onChange={(e) => setRole(e.target.value as any)}>
                  <option value="student">Ученик</option>
                  <option value="teacher">Преподаватель</option>
                  {canCreateAdmin && <option value="admin">Администратор</option>}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Фамилия</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия" />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Имя</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя" />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Отчество</label>
                <input value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Отчество" />
              </div>

              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Телефон</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(normalizeKgPhone(e.target.value))}
                  placeholder="+996XXXXXXXXX"
                  inputMode="numeric"
                />
              </div>

              <div>
                <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Дата рождения</label>
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
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Группа</label>
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
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Предметы (до 2)</label>
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
                          // prevent duplicates
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

              <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "var(--spacing-md)", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Логин</label>
                  <input value={generatedUsername} readOnly placeholder="Сначала нажмите “Сгенерировать”" />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: "var(--color-text-light)" }}>Пароль</label>
                  <input value={generatedPassword} readOnly placeholder="Сначала нажмите “Сгенерировать”" />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
                    {generating ? "Генерация..." : "Сгенерировать"}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "var(--spacing-lg)" }}>
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
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <hr />
      <h3>Пользователи</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className={tab === "students" ? "" : "secondary"} onClick={() => setTab("students")}>
          Студенты
        </button>
        <button className={tab === "teachers" ? "" : "secondary"} onClick={() => setTab("teachers")}>
          Учителя
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по ФИО"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="secondary" onClick={() => reload().catch((e) => setErr(String(e)))}>
          Обновить
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        {tab === "teachers" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "var(--spacing-md)",
            }}
          >
            {users.map((u) => (
              <div
                key={u.id}
                onClick={() => openUserCard(u)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openUserCard(u);
                }}
                style={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-sm)",
                  overflow: "hidden",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "64px 1fr",
                    gap: "var(--spacing-sm)",
                    alignItems: "center",
                    padding: "var(--spacing-md)",
                  }}
                >
                  <img
                    src={u.photo_data_url || "/favicon.svg"}
                    alt="Фото"
                    loading="lazy"
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                      objectFit: "cover",
                      background: "var(--color-bg)",
                    }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.src.endsWith("/favicon.svg")) return;
                      img.src = "/favicon.svg";
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--color-text)", lineHeight: 1.2 }}>
                      {u.full_name || u.username}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--color-text-light)", lineHeight: 1.2 }}>
                      📚 {u.teacher_subject || "---"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {users.length === 0 && <div style={{ color: "var(--color-text-light)" }}>Учителя не найдены</div>}
          </div>
        ) : (
          (() => {
            const assigned = users.filter((u) => !!u.class?.id);
            const unassigned = users.filter((u) => !u.class?.id);
            const borderTop = "1px solid var(--color-border)";

            const tableBaseStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-lg)" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 8 }}>
                    Не распределены ({unassigned.length})
                  </div>
                  {unassigned.length === 0 ? (
                    <div style={{ color: "var(--color-text-light)" }}>Нет</div>
                  ) : (
                    <table cellPadding={6} style={tableBaseStyle}>
                      <thead>
                        <tr>
                          <th align="left">Фото</th>
                          <th align="left">Логин</th>
                          <th align="left">ФИО</th>
                          <th align="left">Создан</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unassigned.map((u) => (
                          <tr key={u.id} style={{ borderTop, cursor: "pointer" }} onClick={() => openUserCard(u)}>
                            <td style={{ width: 50 }}>
                              <img
                                src={u.photo_data_url || "/favicon.svg"}
                                alt=""
                                loading="lazy"
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--color-border)",
                                  objectFit: "cover",
                                  background: "var(--color-bg)",
                                  display: "block",
                                }}
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  if (img.src.endsWith("/favicon.svg")) return;
                                  img.src = "/favicon.svg";
                                }}
                              />
                            </td>
                            <td>{u.username}</td>
                            <td>{u.full_name || ""}</td>
                            <td>{new Date(u.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 8 }}>
                    Распределены ({assigned.length})
                  </div>
                  {assigned.length === 0 ? (
                    <div style={{ color: "var(--color-text-light)" }}>Нет</div>
                  ) : (
                    <table cellPadding={6} style={tableBaseStyle}>
                      <thead>
                        <tr>
                          <th align="left">Фото</th>
                          <th align="left">Логин</th>
                          <th align="left">ФИО</th>
                          <th align="left">Создан</th>
                          <th align="left">Группа</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assigned.map((u) => (
                          <tr key={u.id} style={{ borderTop, cursor: "pointer" }} onClick={() => openUserCard(u)}>
                            <td style={{ width: 50 }}>
                              <img
                                src={u.photo_data_url || "/favicon.svg"}
                                alt=""
                                loading="lazy"
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--color-border)",
                                  objectFit: "cover",
                                  background: "var(--color-bg)",
                                  display: "block",
                                }}
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  if (img.src.endsWith("/favicon.svg")) return;
                                  img.src = "/favicon.svg";
                                }}
                              />
                            </td>
                            <td>{u.username}</td>
                            <td>{u.full_name || ""}</td>
                            <td>{new Date(u.created_at).toLocaleString()}</td>
                            <td>{u.class?.name || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {viewOpen && (
        <div
          onClick={() => setViewOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "color-mix(in srgb, var(--color-text) 35%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--spacing-lg)",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-lg)",
              padding: "var(--spacing-lg)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-md)" }}>
              <h3 style={{ margin: 0 }}>Карточка пользователя</h3>
              <div style={{ display: "flex", gap: 8 }}>
                {!viewLoading && !viewErr && viewUser && (
                  <button
                    className={viewEdit ? "secondary" : ""}
                    onClick={() => {
                      setViewErr(null);
                      setViewEdit((v) => !v);
                      // reset fields from current user when opening edit mode
                      if (!viewEdit) {
                        setViewEditFirstName(viewUser.first_name || "");
                        setViewEditLastName(viewUser.last_name || "");
                        setViewEditMiddleName(viewUser.middle_name || "");
                        setViewEditPhone(viewUser.phone || "+996");
                        setViewEditBirthDate(viewUser.birth_date || "");
                        setViewEditClassId(viewClass?.id || "");
                        setViewEditPhotoDataUrl(viewUser.photo_data_url || null);
                      }
                    }}
                  >
                    {viewEdit ? "Отмена" : "Редактировать"}
                  </button>
                )}
                {!viewLoading && !viewErr && viewUser && (
                  <button
                    className="danger"
                    disabled={viewSaving}
                    onClick={deleteUserFromCard}
                  >
                    Удалить
                  </button>
                )}
                <button className="secondary" onClick={() => setViewOpen(false)}>
                  Закрыть
                </button>
              </div>
            </div>

            {viewLoading && <Loader text="Загрузка..." />}
            {viewErr && <div style={{ color: "var(--color-error)" }}>{viewErr}</div>}

            {!viewLoading && !viewErr && viewUser && (
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "var(--spacing-lg)", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                  <div
                    style={{
                      width: 160,
                      height: 160,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {(viewEdit ? viewEditPhotoDataUrl : viewUser.photo_data_url) ? (
                      <img
                        src={(viewEdit ? viewEditPhotoDataUrl : viewUser.photo_data_url) || ""}
                        alt="Фото"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-text-light)" }}>Нет фото</span>
                    )}
                  </div>

                  {viewEdit && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const dataUrl = await fileToDataUrl(f);
                            setViewEditPhotoDataUrl(dataUrl);
                          } catch (err) {
                            setViewErr(String(err));
                          }
                        }}
                      />
                      <button className="danger" onClick={() => setViewEditPhotoDataUrl(null)}>
                        Удалить фото
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
                  <div
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      padding: "var(--spacing-md)",
                      background: "var(--color-card)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 8 }}>Основное</div>

                    <div>
                      <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>ФИО</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                        <input
                          placeholder="Фамилия"
                          value={viewEdit ? viewEditLastName : viewUser.last_name || ""}
                          onChange={(e) => setViewEditLastName(e.target.value)}
                          disabled={!viewEdit}
                        />
                        <input
                          placeholder="Имя"
                          value={viewEdit ? viewEditFirstName : viewUser.first_name || ""}
                          onChange={(e) => setViewEditFirstName(e.target.value)}
                          disabled={!viewEdit}
                        />
                        <input
                          placeholder="Отчество"
                          value={viewEdit ? viewEditMiddleName : viewUser.middle_name || ""}
                          onChange={(e) => setViewEditMiddleName(e.target.value)}
                          disabled={!viewEdit}
                        />
                      </div>

                      <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-text-light)" }}>Логин</div>
                      <div style={{ fontWeight: 700, marginTop: 4 }}>{viewUser.username}</div>
                    </div>
                  </div>

                  {viewUser.role === "student" && (
                    <div
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "var(--spacing-md)",
                        background: "var(--color-card)",
                        display: "flex",
                        gap: "var(--spacing-md)",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Пароль студента</div>
                        <div style={{ fontWeight: 700, marginTop: 4 }}>{viewTempPassword ? viewTempPassword : "Скрыт"}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)", marginTop: 4 }}>
                          Показывается только после подтверждения паролем админа/менеджера (пароль будет сброшен).
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!token) return;
                          const actorPassword = window.prompt("Введите пароль админа/менеджера");
                          if (!actorPassword) return;
                          try {
                            const resp = await apiAdminResetStudentPassword(token, viewUser.id, actorPassword);
                            setViewTempPassword(resp.tempPassword);
                          } catch (e) {
                            setViewErr(String(e));
                          }
                        }}
                      >
                        Показать
                      </button>
                    </div>
                  )}

                  {viewUser.role === "teacher" && (
                    <div
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "var(--spacing-md)",
                        background: "var(--color-card)",
                        display: "flex",
                        gap: "var(--spacing-md)",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Пароль учителя</div>
                        <div style={{ fontWeight: 700, marginTop: 4 }}>{viewTempPassword ? viewTempPassword : "Скрыт"}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)", marginTop: 4 }}>
                          Показывается только после подтверждения паролем админа/менеджера (пароль будет сброшен).
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!token) return;
                          const actorPassword = window.prompt("Введите пароль админа/менеджера");
                          if (!actorPassword) return;
                          try {
                            const resp = await apiAdminResetTeacherPassword(token, viewUser.id, actorPassword);
                            setViewTempPassword(resp.tempPassword);
                          } catch (e) {
                            setViewErr(String(e));
                          }
                        }}
                      >
                        Показать
                      </button>
                    </div>
                  )}

                  <div
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      padding: "var(--spacing-md)",
                      background: "var(--color-card)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 8 }}>Контакты</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-md)" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Телефон</div>
                        {!viewEdit ? (
                          <div style={{ marginTop: 4 }}>{viewUser.phone || "—"}</div>
                        ) : (
                          <input style={{ marginTop: 8 }} value={viewEditPhone} onChange={(e) => setViewEditPhone(e.target.value)} placeholder="+996..." />
                        )}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Дата рождения</div>
                        {!viewEdit ? (
                          <div style={{ marginTop: 4 }}>{viewUser.birth_date || "—"}</div>
                        ) : (
                          <input style={{ marginTop: 8 }} type="date" value={viewEditBirthDate} onChange={(e) => setViewEditBirthDate(e.target.value)} />
                        )}
                      </div>

                      {viewUser.role === "student" && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Группа</div>
                          {!viewEdit ? (
                            <div style={{ marginTop: 4 }}>{viewClass?.name || "—"}</div>
                          ) : (
                            <select style={{ marginTop: 8 }} value={viewEditClassId} onChange={(e) => setViewEditClassId(e.target.value)}>
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
                  </div>

                  {viewUser.role === "teacher" && (
                    <div
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "var(--spacing-md)",
                        background: "var(--color-card)",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "var(--color-text-light)", marginBottom: 8 }}>Предметы учителя</div>
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
                          {viewTeacherSaving ? "Сохранение..." : "Сохранить"}
                        </button>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-text-light)" }}>
                        Сейчас: {viewUser.teacher_subject || "—"}
                      </div>
                    </div>
                  )}

                  {viewEdit && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                      <button
                        disabled={viewSaving}
                        onClick={async () => {
                          if (!token) return;
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
        </div>
      )}
    </AppShell>
  );
}
