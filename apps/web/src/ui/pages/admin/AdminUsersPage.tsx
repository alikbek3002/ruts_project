import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiAdminCreateUser,
  apiAdminGenerateCredentials,
  apiAdminGetUser,
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
    const hasSearch = !!search.trim();
    const role = hasSearch ? undefined : (tab === "teachers" ? "teacher" : "student");
    const resp = await apiAdminListUsers(token, role as any, hasSearch ? search : undefined);
    setUsers(resp.users);
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
            zIndex: 50,
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
                  <option value="student">student</option>
                  <option value="teacher">teacher</option>
                  {canCreateAdmin && <option value="admin">admin</option>}
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
                    <option value="">(выберите группу)</option>
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
                  if (role === "student" && !classId) {
                    setErr("Выберите группу для ученика");
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
                      class_id: role === "student" ? classId : null,
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
        <table cellPadding={6} style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">username</th>
              {search.trim() && <th align="left">role</th>}
              <th align="left">full_name</th>
              <th align="left">created_at</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                style={{ borderTop: "1px solid #eee", cursor: "pointer" }}
                onClick={async () => {
                  if (!token) return;
                  setViewErr(null);
                  setViewUser(null);
                  setViewClass(null);
                  setViewTempPassword(null);
                  setViewTeacherSubjectIds([]);
                  setViewOpen(true);
                  setViewLoading(true);
                  try {
                    const resp = await apiAdminGetUser(token, u.id);
                    setViewUser(resp.user);
                    setViewClass(resp.class);

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
                }}
              >
                <td>{u.username}</td>
                {search.trim() && <td>{u.role}</td>}
                <td>{u.full_name || ""}</td>
                <td>{new Date(u.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            zIndex: 50,
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
              <button className="secondary" onClick={() => setViewOpen(false)}>
                Закрыть
              </button>
            </div>

            {viewLoading && <Loader text="Загрузка..." />}
            {viewErr && <div style={{ color: "var(--color-error)" }}>{viewErr}</div>}

            {!viewLoading && !viewErr && viewUser && (
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--spacing-lg)", alignItems: "start" }}>
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {viewUser.photo_data_url ? (
                    <img src={viewUser.photo_data_url} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--color-text-light)" }}>Нет фото</span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-md)" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>ФИО</div>
                    <div style={{ fontWeight: 600 }}>{viewUser.full_name || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Логин</div>
                    <div style={{ fontWeight: 600 }}>{viewUser.username}</div>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Телефон</div>
                    <div>{viewUser.phone || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Дата рождения</div>
                    <div>{viewUser.birth_date || "—"}</div>
                  </div>

                  {viewUser.role === "student" && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Группа</div>
                      <div>{viewClass?.name || "—"}</div>
                    </div>
                  )}
                  {viewUser.role === "student" && (
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Пароль студента</div>
                        <div style={{ fontWeight: 600 }}>{viewTempPassword ? viewTempPassword : "Скрыт"}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Показывается только после подтверждения паролем админа/менеджера (пароль будет сброшен).</div>
                      </div>
                      <button
                        className="secondary"
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
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Пароль учителя</div>
                        <div style={{ fontWeight: 600 }}>{viewTempPassword ? viewTempPassword : "Скрыт"}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>
                          Показывается только после подтверждения паролем админа/менеджера (пароль будет сброшен).
                        </div>
                      </div>
                      <button
                        className="secondary"
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
                  {viewUser.role === "teacher" && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-light)" }}>Предмет</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", marginTop: 4 }}>
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
                          className="secondary"
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
