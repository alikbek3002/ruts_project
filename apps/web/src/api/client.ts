// In dev, always use Vite proxy (/api -> http://localhost:8000) to avoid CORS issues
// and accidental calls to production when VITE_API_URL is set locally.
const API_BASE = import.meta.env.PROD ? ((import.meta.env.VITE_API_URL as string | undefined) ?? "") : "";

function getApiBaseProblem(): string | null {
  if (!API_BASE) return "VITE_API_URL is not set";
  try {
    if (typeof window !== "undefined" && window.location?.protocol === "https:" && /^http:\/\//i.test(API_BASE)) {
      return "VITE_API_URL uses http:// on an https site (mixed content will be blocked)";
    }
  } catch {
    // ignore
  }
  return null;
}

const API_BASE_PROBLEM = getApiBaseProblem();

if (!API_BASE && import.meta.env.PROD) {
  console.warn("VITE_API_URL is not set; API requests will fail in production.");
}
if (API_BASE_PROBLEM && API_BASE && import.meta.env.PROD) {
  console.warn(API_BASE_PROBLEM);
}
const AUTH_STORAGE_KEY = "ruts_auth";

type LoadingListener = (isLoading: boolean) => void;

let inFlightRequests = 0;
const loadingListeners = new Set<LoadingListener>();

function emitLoading() {
  const isLoading = inFlightRequests > 0;
  for (const listener of loadingListeners) listener(isLoading);
}

function withApiPrefix(path: string): string {
  // If a full URL is passed, don't modify it.
  if (/^https?:\/\//i.test(path)) return path;

  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/api" || normalized.startsWith("/api/")) return normalized;
  return `/api${normalized}`;
}

export function getApiLoading(): boolean {
  return inFlightRequests > 0;
}

export function subscribeApiLoading(listener: LoadingListener): () => void {
  loadingListeners.add(listener);
  listener(inFlightRequests > 0);
  return () => {
    loadingListeners.delete(listener);
  };
}

export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  inFlightRequests += 1;
  emitLoading();
  try {
    return await fetch(input, init);
  } finally {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    emitLoading();
  }
}

type HttpError = Error & { status?: number; bodyText?: string; detail?: any };

async function readErrorText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await trackedFetch(`${API_BASE}${withApiPrefix("/auth/refresh")}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string };
    const next = data.accessToken ?? null;
    if (next) {
      // Keep stored accessToken in sync so a page reload doesn't fall back to an expired token.
      try {
        const update = (store: Storage): boolean => {
          const raw = store.getItem(AUTH_STORAGE_KEY);
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          store.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...parsed, accessToken: next }));
          return true;
        };

        // Prefer updating whichever storage currently holds auth.
        if (!update(localStorage)) update(sessionStorage);
      } catch {
        // ignore
      }
    }
    return next;
  } catch {
    return null;
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessTokenDedup(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return await refreshPromise;
}

function hasAuthHeader(init?: RequestInit): boolean {
  const headers = init?.headers as any;
  if (!headers) return false;
  if (typeof headers.get === "function") return !!headers.get("Authorization");
  return !!headers.Authorization || !!headers.authorization;
}

async function http<T>(path: string, init?: RequestInit, _retry = true): Promise<T> {
  let res: Response;
  try {
    res = await trackedFetch(`${API_BASE}${withApiPrefix(path)}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      credentials: "include",
    });
  } catch (e: any) {
    const hint = API_BASE_PROBLEM
      ? `${API_BASE_PROBLEM}. `
      : "Не удалось подключиться к API. Проверь `VITE_API_URL`, CORS и доступность бэка. ";
    const err: HttpError = new Error(`${hint}${String(e?.message ?? e ?? "")}`.trim()) as HttpError;
    throw err;
  }

  if (res.status === 401 && _retry && hasAuthHeader(init)) {
    const newToken = await refreshAccessTokenDedup();
    if (newToken) {
      const nextInit: RequestInit = {
        ...(init ?? {}),
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${newToken}`,
        },
      };
      return await http<T>(path, nextInit, false);
    }
  }

  if (!res.ok) {
    const msg = await readErrorText(res);
    let cleanMsg = msg;
    let detailObj: any = undefined;
    try {
      const json = JSON.parse(msg);
      if (json && typeof json === "object" && json.detail) {
        detailObj = json.detail;
        if (typeof json.detail === "string") {
          cleanMsg = json.detail;
        } else if (json.detail && typeof json.detail === "object") {
          cleanMsg = String((json.detail as any).title ?? (json.detail as any).message ?? "").trim() || JSON.stringify(json.detail);
        } else {
          cleanMsg = JSON.stringify(json.detail);
        }
      }
    } catch {
      // ignore
    }
    const err: HttpError = new Error(cleanMsg || `HTTP ${res.status}`) as HttpError;
    err.status = res.status;
    err.bodyText = msg;
    if (detailObj !== undefined) err.detail = detailObj;
    throw err;
  }
  return (await res.json()) as T;
}

function apiGet<T>(path: string, accessToken: string) {
  return http<T>(path, { headers: { Authorization: `Bearer ${accessToken}` } });
}

function apiPost<T>(path: string, body: any, accessToken: string) {
  return http<T>(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

function apiPut<T>(path: string, body: any, accessToken: string) {
  return http<T>(path, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export async function apiLogin(username: string, password: string) {
  return await http<{ accessToken: string; user: any }>(`/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function apiMe(accessToken: string) {
  return await http<{ user: any }>(`/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiChangePassword(accessToken: string, oldPassword: string, newPassword: string) {
  return await http<{ ok: boolean }>(`/api/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export async function apiZoomStart(accessToken: string) {
  return await http<{ authUrl: string }>(`/api/zoom/oauth/start`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiZoomStatus(accessToken: string) {
  return await http<{ connected: boolean; zoom_user_id?: string }>(`/api/zoom/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export type UserRole = "manager" | "admin" | "teacher" | "student";

// Direction (направление)
export type Direction = {
  id: string;
  name: string;
  code: string;
};

// Subject (предмет)
export type Subject = {
  id: string;
  name: string;
  photo_url?: string | null;
};

export type SubjectTeacher = {
  id: string;
  name: string;
};

export type SubjectWithTeachers = Subject & {
  teachers: SubjectTeacher[];
};

export async function apiListDirections(token: string) {
  return apiGet<{ directions: Direction[] }>("/api/directions", token);
}

export async function apiListSubjects(token: string) {
  return apiGet<{ subjects: Subject[] }>("/api/subjects/subjects", token);
}

export async function apiListSubjectsWithTeachers(token: string) {
  return apiGet<{ subjects: SubjectWithTeachers[] }>("/api/subjects/subjects-with-teachers", token);
}

export async function apiCreateSubject(token: string, name: string, photoUrl?: string | null) {
  return apiPost<{ subject: Subject }>("/subjects/subjects", { name, photo_url: photoUrl ?? null }, token);
}

export async function apiDeleteSubject(token: string, subjectId: string) {
  return http<{ ok: boolean }>(`/subjects/subjects/${encodeURIComponent(subjectId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiGetTeacherSubjects(token: string, teacherId: string) {
  return apiGet<{ subjects: Subject[] }>(`/subjects/teachers/${encodeURIComponent(teacherId)}/subjects`, token);
}

export async function apiAssignSubjectToTeacher(token: string, teacherId: string, subjectId: string) {
  return apiPost<{ ok: boolean }>("/subjects/teachers/assign-subject", { teacher_id: teacherId, subject_id: subjectId }, token);
}

export async function apiRemoveSubjectFromTeacher(token: string, teacherId: string, subjectId: string) {
  return http<{ ok: boolean }>(`/subjects/teachers/${encodeURIComponent(teacherId)}/subjects/${encodeURIComponent(subjectId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type AdminUser = {
  id: string;
  role: UserRole;
  username: string;
  full_name: string | null;
  class?: { id: string; name: string | null } | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  photo_data_url?: string | null;
  teacher_subject?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
};

export async function apiSetTeacherSubjects(token: string, teacherId: string, subjectIds: string[]) {
  return http<{ ok: boolean; subject_ids?: string[] }>(
    `/subjects/teachers/${encodeURIComponent(teacherId)}/subjects`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subject_ids: subjectIds }),
    }
  );
}

export type AdminUserDetails = AdminUser & {
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  phone: string | null;
  birth_date: string | null;
  photo_data_url: string | null;
  teacher_subject: string | null;
};

export async function apiAdminListUsers(token: string, role?: UserRole, searchQuery?: string, limit: number = 50, offset: number = 0) {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (searchQuery && searchQuery.trim()) params.set("q", searchQuery.trim());
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const resp = await apiGet<{ users: AdminUser[] }>(`/admin/users${suffix}`, token);
  return {
    ...resp,
    users: (resp.users || []).filter((u) => u?.is_active !== false),
  };
}

export async function apiAdminGetUser(token: string, userId: string) {
  return apiGet<{ user: AdminUserDetails; class: { id: string; name: string | null } | null }>(
    `/admin/users/${encodeURIComponent(userId)}`,
    token
  );
}

export async function apiAdminUpdateUser(
  token: string,
  userId: string,
  body: {
    first_name?: string | null;
    last_name?: string | null;
    middle_name?: string | null;
    phone?: string | null;
    birth_date?: string | null; // YYYY-MM-DD
    photo_data_url?: string | null;
    class_id?: string | null;
  }
) {
  return http<{ user: AdminUserDetails; class: { id: string; name: string | null } | null }>(
    `/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
}

export async function apiAdminDeleteUser(token: string, userId: string) {
  return http<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiAdminResetStudentPassword(token: string, userId: string, actorPassword: string) {
  return apiPost<{ tempPassword: string }>(
    `/admin/users/${encodeURIComponent(userId)}/reset-student-password`,
    { actor_password: actorPassword },
    token
  );
}

export async function apiAdminResetTeacherPassword(token: string, userId: string, actorPassword: string) {
  return apiPost<{ tempPassword: string }>(
    `/admin/users/${encodeURIComponent(userId)}/reset-teacher-password`,
    { actor_password: actorPassword },
    token
  );
}

export async function apiAdminCreateUser(
  token: string,
  body: {
    role: Exclude<UserRole, "manager">;
    first_name: string;
    last_name: string;
    middle_name?: string | null;
    phone: string;
    birth_date: string; // YYYY-MM-DD
    photo_data_url?: string | null;
    class_id?: string | null;
    teacher_subject?: string | null;
    subject_ids?: string[] | null;

    username?: string | null;
    temp_password?: string | null;
  }
) {
  return apiPost<{ user: AdminUser; tempPassword: string }>("/admin/users", body, token);
}

export async function apiAdminGenerateCredentials(
  token: string,
  body: { role: Exclude<UserRole, "manager">; first_name: string; last_name: string; birth_date: string }
) {
  return apiPost<{ username: string; password: string }>("/admin/users/credentials", body, token);
}

export type ClassItem = { 
  id: string; 
  name: string; 
  direction_id?: string | null;
  direction?: Direction | null;
  student_count?: number;
  curator_id?: string | null;
};

export async function apiListClasses(token: string) {
  return apiGet<{ classes: ClassItem[] }>("/classes", token);
}

export async function apiCreateClass(token: string, body: { name: string; direction_id?: string | null; curator_id?: string | null }) {
  return apiPost<{ class: ClassItem }>("/classes", body, token);
}

export async function apiListCuratedClasses(token: string) {
  return apiGet<{ classes: ClassItem[] }>("/classes/curated", token);
}

export async function apiUpdateClass(token: string, classId: string, body: { name?: string; direction_id?: string | null; curator_id?: string | null }) {
  return http<{ class: ClassItem }>(`/classes/${encodeURIComponent(classId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function apiDeleteClass(token: string, classId: string, actorPassword: string) {
  return http<{ ok: boolean }>(`/classes/${encodeURIComponent(classId)}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ actor_password: actorPassword }),
  });
}

export type ClassStudent = { id: string; username: string; full_name: string | null; student_number?: number | null };
export async function apiGetClass(token: string, classId: string) {
  return apiGet<{ class: ClassItem | null; students: ClassStudent[] }>(`/classes/${classId}`, token);
}

export async function apiEnrollStudent(token: string, body: { class_id: string; student_id: string }) {
  return apiPost<{ ok: boolean }>(`/classes/${body.class_id}/enroll`, { student_id: body.student_id }, token);
}

export type TimetableEntry = {
  id: string;
  class_id: string;
  stream_id?: string | null;
  class_ids?: string[] | null;
  teacher_id: string | null;
  subject: string;
  subject_id?: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  room?: string;
  lesson_type?: "theoretical" | "practical" | "credit";
};

export async function apiCreateTimetableEntry(
  token: string,
  body: Omit<TimetableEntry, "id" | "teacher_id"> & { teacher_id?: string | null }
) {
  return apiPost<{ entry: TimetableEntry }>("/timetable/entries", body, token);
}

export async function apiUpdateTimetableEntry(
  token: string,
  entryId: string,
  body: {
    teacher_id?: string | null;
    subject?: string;
    subject_id?: string | null;
    room?: string | null;
    lesson_type?: "theoretical" | "practical" | "credit";
    stream_id?: string | null;
    class_ids?: string[] | null;
  }
) {
  return http<{ entry: TimetableEntry }>(`/timetable/entries/${encodeURIComponent(entryId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function apiDeleteTimetableEntry(token: string, entryId: string) {
  return http<{ ok: boolean }>(`/timetable/entries/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiListTimetableEntries(token: string, classId?: string) {
  const q = classId ? `?class_id=${encodeURIComponent(classId)}` : "";
  return apiGet<{ entries: TimetableEntry[] }>(`/timetable/entries${q}`, token);
}

export async function apiListTimetableRooms(token: string) {
  return apiGet<{ rooms: string[] }>(`/timetable/rooms`, token);
}

export type WeekTimetableItem = {
  id: string;
  class_id: string;
  class_name: string;
  teacher_id: string | null;
  teacher_name: string;
  subject: string;
  weekday: number;
  start_time: string;
  end_time: string;
  room?: string;
  zoom?: { join_url: string; starts_at: string } | null;
};

export async function apiTimetableWeek(token: string, weekStartISO: string) {
  return apiGet<{ weekStart: string; entries: WeekTimetableItem[] }>(
    `/timetable/week?weekStart=${encodeURIComponent(weekStartISO)}`,
    token
  );
}

export async function apiCreateZoomMeeting(token: string, timetableEntryId: string, startsAtLocalISO: string) {
  const body = { timetableEntryId, startsAt: startsAtLocalISO };
  return apiPost<{ zoom_meeting_id: string; join_url: string }>("/zoom/meetings", body, token);
}

export type Assessment = { id: string; class_id: string; title: string; date: string };
export async function apiCreateAssessment(token: string, body: { class_id: string; title: string; date: string }) {
  return apiPost<{ assessment: Assessment }>("/gradebook/assessments", body, token);
}
export async function apiListAssessments(token: string, classId: string) {
  return apiGet<{ assessments: Assessment[] }>(`/gradebook/classes/${encodeURIComponent(classId)}/assessments`, token);
}
export async function apiSetGrade(token: string, body: { assessment_id: string; student_id: string; value: number; comment?: string }) {
  return http<{ ok: boolean }>(`/gradebook/assessments/${encodeURIComponent(body.assessment_id)}/grades`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ grades: [{ student_id: body.student_id, value: body.value, comment: body.comment ?? null }] }),
  });
}

export async function apiMyGrades(token: string) {
  return apiGet<{ grades: any[]; lessonJournal?: LessonJournalItem[] }>("/gradebook/me", token);
}

export type LessonJournalItem = {
  timetable_entry_id: string;
  date: string; // YYYY-MM-DD
  present: boolean | null;
  grade: number | null;
  comment: string | null;
  subject: string | null;
  room?: string | null;
  class_id: string | null;
  class_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  start_time: string | null;
  end_time: string | null;
};

export type LessonJournalStudentRow = {
  id: string;
  username: string;
  full_name: string | null;
  present: boolean | null;
  grade: number | null;
  comment: string | null;
};

export type LessonJournalGetResponse = {
  lesson: {
    id: string;
    class_id: string;
    teacher_id: string;
    subject: string;
    room?: string | null;
    start_time: string;
    end_time: string;
    date: string;
  };
  students: LessonJournalStudentRow[];
};

export async function apiTeacherLessonJournalGet(token: string, timetableEntryId: string, lessonDateISO: string) {
  return apiGet<LessonJournalGetResponse>(
    `/gradebook/lessons/${encodeURIComponent(timetableEntryId)}?lesson_date=${encodeURIComponent(lessonDateISO)}`,
    token
  );
}

export async function apiTeacherLessonJournalSave(
  token: string,
  timetableEntryId: string,
  body: { lesson_date: string; rows: Array<{ student_id: string; present: boolean | null; grade: number | null; comment?: string | null }> }
) {
  return http<{ ok: boolean }>(`/gradebook/lessons/${encodeURIComponent(timetableEntryId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export type LibraryItem = {
  id: string;
  title: string;
  description: string | null;
  class_id: string | null;
  storage_path: string;
  topic_id?: string | null;
  uploaded_by?: string;
  can_delete?: boolean;
  created_at: string;
};

export type LibraryTopic = {
  id: string;
  title: string;
  description: string | null;
  class_id: string | null;
  created_at: string;
  items: LibraryItem[];
};
export async function apiListLibrary(token: string, classId?: string) {
  const q = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  return apiGet<{ items: LibraryItem[] }>(`/library${q}`, token);
}

export async function apiListLibraryTopics(token: string, classId?: string) {
  const q = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  return apiGet<{ topics: LibraryTopic[] }>(`/library/topics${q}`, token);
}

export async function apiCreateLibraryTopic(
  token: string,
  file: File | null | undefined,
  topicTitle: string,
  topicDescription?: string,
  classId?: string | null,
  onProgress?: (percent: number) => void
): Promise<{ topic: any; item: LibraryItem | null; originalFilename: string | null }> {
  const formData = new FormData();
  if (file) formData.append("file", file);
  formData.append("title", topicTitle);
  if (topicDescription) formData.append("description", topicDescription);
  if (classId) formData.append("class_id", classId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Create topic failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("POST", `${API_BASE}${withApiPrefix("/library/topics")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiUploadLibraryFileToTopic(
  token: string,
  topicId: string,
  file: File,
  title?: string,
  description?: string,
  onProgress?: (percent: number) => void
): Promise<{ item: LibraryItem; originalFilename: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  if (description) formData.append("description", description);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("POST", `${API_BASE}${withApiPrefix(`/library/topics/${encodeURIComponent(topicId)}/upload`)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}
export async function apiCreateLibraryItem(
  token: string,
  body: { title: string; description?: string; class_id?: string | null; storage_path: string }
) {
  return apiPost<{ item: any }>("/library", body, token);
}

// Upload file to library
export async function apiUploadLibraryFile(
  token: string,
  file: File,
  title: string,
  description?: string,
  classId?: string | null,
  onProgress?: (percent: number) => void
): Promise<{ item: LibraryItem; originalFilename: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  if (description) formData.append("description", description);
  if (classId) formData.append("class_id", classId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error"));
    });

    xhr.open("POST", `${API_BASE}${withApiPrefix("/library/upload")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

// Get download URL for library file
export async function apiGetLibraryDownloadUrl(token: string, itemId: string) {
  return apiGet<{ url: string }>(`/library/${encodeURIComponent(itemId)}/download-url`, token);
}

// Delete library item
export async function apiDeleteLibraryItem(token: string, itemId: string) {
  return http<{ ok: boolean }>(`/library/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Zoom meetings
export type ZoomMeeting = {
  id: string;
  timetable_entry_id: string;
  starts_at: string;
  zoom_meeting_id: string;
  join_url: string;
  start_url?: string | null;
  created_at: string;
  timetable_entries?: {
    subject: string;
    start_time: string;
    end_time: string;
    classes?: { name: string };
  };
};

export async function apiCreateZoomMeetingNew(token: string, timetableEntryId: string, startsAtLocalISO: string) {
  const body = { timetableEntryId, startsAt: startsAtLocalISO };
  return apiPost<{ meeting: ZoomMeeting }>("/zoom/meetings", body, token);
}

export async function apiListZoomMeetings(token: string) {
  return apiGet<{ meetings: ZoomMeeting[] }>("/zoom/meetings", token);
}

export async function apiDeleteZoomMeeting(token: string, meetingId: string) {
  return http<{ ok: boolean }>(`/zoom/meetings/${encodeURIComponent(meetingId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Profile
export type UserProfile = {
  id: string;
  role: string;
  username: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  photo_data_url?: string | null;
  teacher_subject?: string | null;
  teacher_subject_name?: string | null;
  class_name?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export async function apiGetProfile(token: string) {
  return apiGet<{ profile: UserProfile }>("/profile", token);
}

export async function apiUpdateProfile(token: string, data: Partial<UserProfile>) {
  return http<{ profile: UserProfile }>("/profile", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiChangePasswordProfile(token: string, currentPassword: string, newPassword: string) {
  return apiPost<{ success: boolean; message: string }>(
    "/profile/change-password",
    { current_password: currentPassword, new_password: newPassword },
    token
  );
}

export async function apiUploadProfilePhoto(
  token: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ photo_url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("photo", file);

    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error("Invalid response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error"));
    });

    xhr.open("POST", `${API_BASE}${withApiPrefix("/profile/upload-photo")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiDeleteProfilePhoto(token: string) {
  return http<{ success: boolean; message: string }>("/profile/photo", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Lesson topic and homework
export type LessonInfo = {
  lesson_topic: string | null;
  homework: string | null;
  subject: string;
  lesson_date: string;
};

export async function apiUpdateLessonInfo(
  token: string,
  classId: string,
  data: {
    timetable_entry_id: string;
    lesson_date: string;
    lesson_topic?: string | null;
    homework?: string | null;
  }
) {
  return http<{ success: boolean; message: string }>(`/journal/classes/${classId}/lesson-info`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiGetLessonInfo(
  token: string,
  classId: string,
  timetableEntryId: string,
  lessonDate: string
) {
  const params = new URLSearchParams({
    timetable_entry_id: timetableEntryId,
    lesson_date: lessonDate,
  });
  return apiGet<LessonInfo>(`/journal/classes/${classId}/lesson-info?${params}`, token);
}

export type HomeworkItem = {
  lesson_date: string;
  subject: string;
  subject_name: string;
  class_name: string;
  lesson_topic: string | null;
  homework: string;
  timetable_entry_id: string;
};

export async function apiGetStudentHomework(token: string) {
  return apiGet<{ homework: HomeworkItem[] }>("/journal/student/homework", token);
}

// Notifications
export type Notification = {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error" | "announcement";
  target_role?: string | null;
  target_user_id?: string | null;
  created_at: string;
  expires_at?: string | null;
  is_read: boolean;
};

export async function apiGetNotifications(token: string, limit: number = 30, offset: number = 0) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return apiGet<{ notifications: Notification[] }>(`/notifications?${params.toString()}`, token);
}

export async function apiGetUnreadNotificationCount(token: string) {
  return apiGet<{ count: number }>("/notifications/unread-count", token);
}

export async function apiMarkNotificationRead(token: string, notificationId: string) {
  return http<{ success: boolean }>(`/notifications/${notificationId}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiCreateNotification(
  token: string,
  data: {
    title: string;
    message: string;
    type?: "info" | "success" | "warning" | "error" | "announcement";
    target_role?: "teacher" | "student" | "admin" | "manager" | "all" | null;
    target_user_id?: string | null;
    expires_at?: string | null;
  }
) {
  return apiPost<{ notification: Notification }>("/notifications", data, token);
}

export async function apiDeleteNotification(token: string, notificationId: string) {
  return http<{ success: boolean }>(`/notifications/${notificationId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Library Topics
export interface TopicFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  created_at: string;
}

export interface Topic {
  id: string;
  title: string;
  description: string | null;
  class_id: string | null;
  subject_id: string | null;
  files: TopicFile[];
}

export async function apiLibraryListTopics(token: string) {
  return apiGet<Topic[]>("/library/topics", token);
}

export async function apiLibraryCreateTopic(token: string, data: {
  title: string;
  description?: string;
  class_id?: string;
  subject_id?: string;
}) {
  return apiPost<Topic>("/library/topics", data, token);
}

export async function apiLibraryUpdateTopic(token: string, id: string, data: { title?: string; description?: string }) {
  return apiPut<Topic>(`/library/topics/${id}`, data, token);
}

export async function apiLibraryDeleteTopic(token: string, id: string) {
  return http<{ ok: boolean }>(`/library/topics/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiLibraryUploadTopicFiles(token: string, topicId: string, formData: FormData) {
  return new Promise<TopicFile[]>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("POST", `${API_BASE}${withApiPrefix(`/library/topics/${topicId}/files`)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

// ============================================================================
// STREAMS API
// ============================================================================

export interface Stream {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  direction_id?: string;
  direction_name?: string;
  status: "draft" | "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
  class_count: number;
  student_count: number;
}

export interface StreamDetail extends Stream {
  classes: Array<{
    id: string;
    name: string;
    direction_id?: string;
    curator_id?: string;
    curator_name?: string;
    student_count: number;
  }>;
}

export interface CurriculumTemplate {
  id: string;
  name: string;
  description?: string;
  direction_id?: string;
  direction_name?: string;
  is_default: boolean;
  created_at: string;
  items: Array<{
    id: string;
    subject_id: string;
    subject_name?: string;
    hours_per_week: number;
    lesson_type: string;
  }>;
}

export interface TeacherWorkload {
  teacher_id: string;
  teacher_name: string;
  current_month_hours: number;
  current_month_lessons: number;
  three_month_hours: number;
  three_month_lessons: number;
  weekly_hours: number;
  weekly_lessons: number;
  active_streams: Array<{
    stream_id: string;
    stream_name: string;
    start_date: string;
    end_date: string;
    status: string;
    weekly_lessons: number;
    weekly_hours: number;
    total_lessons_3months: number;
    total_hours_3months: number;
  }>;
}

export async function apiGetStreams(token: string, statusFilter?: string): Promise<{ streams: Stream[] }> {
  const params = new URLSearchParams();
  if (statusFilter) params.append("status_filter", statusFilter);

  const res = await http<Stream[]>(`/streams${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { streams: res };
}

export async function apiGetStream(token: string, streamId: string): Promise<{ stream: StreamDetail }> {
  const res = await http<StreamDetail>(`/streams/${encodeURIComponent(streamId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { stream: res };
}

export async function apiCreateStream(
  token: string,
  data: {
    name: string;
    start_date: string;
    end_date: string;
    direction_id?: string;
    status?: string;
  }
): Promise<{ stream: Stream }> {
  const res = await http<Stream>("/streams", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { stream: res };
}

export async function apiUpdateStream(
  token: string,
  streamId: string,
  data: Partial<{
    name: string;
    start_date: string;
    end_date: string;
    direction_id: string;
    status: string;
  }>
): Promise<{ stream: Stream }> {
  const res = await http<Stream>(`/streams/${encodeURIComponent(streamId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { stream: res };
}

export async function apiDeleteStream(token: string, streamId: string): Promise<void> {
  await http<void>(`/streams/${encodeURIComponent(streamId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiAddClassesToStream(
  token: string,
  streamId: string,
  classIds: string[]
): Promise<{ message: string; added: number; skipped: number }> {
  return await http<{ message: string; added: number; skipped: number }>(
    `/streams/${encodeURIComponent(streamId)}/classes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ class_ids: classIds }),
    }
  );
}

export async function apiRemoveClassFromStream(
  token: string,
  streamId: string,
  classId: string
): Promise<void> {
  await http<void>(`/streams/${encodeURIComponent(streamId)}/classes/${encodeURIComponent(classId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiGetCurriculumTemplates(token: string): Promise<{ templates: CurriculumTemplate[] }> {
  const res = await http<CurriculumTemplate[]>("/streams/curriculum-templates", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { templates: res };
}

export async function apiCreateCurriculumTemplate(
  token: string,
  data: {
    name: string;
    description?: string;
    direction_id?: string;
    is_default?: boolean;
  }
): Promise<{ template: CurriculumTemplate }> {
  const res = await http<CurriculumTemplate>("/streams/curriculum-templates", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { template: res };
}

export async function apiAddCurriculumItem(
  token: string,
  templateId: string,
  data: {
    subject_id: string;
    hours_per_week: number;
    lesson_type?: string;
  }
): Promise<{ message: string; item: any }> {
  return await http<{ message: string; item: any }>(
    `/streams/curriculum-templates/${encodeURIComponent(templateId)}/items`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  );
}

export async function apiDeleteCurriculumItem(
  token: string,
  templateId: string,
  itemId: string
): Promise<void> {
  await http<void>(
    `/streams/curriculum-templates/${encodeURIComponent(templateId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

export async function apiGenerateStreamSchedule(
  token: string,
  streamId: string,
  templateId: string,
  force: boolean = false
): Promise<{
  stream_id: string;
  entries_created: number;
  journal_entries_created: number;
  message: string;
  warnings: string[];
}> {
  return await http<{
    stream_id: string;
    entries_created: number;
    journal_entries_created: number;
    message: string;
    warnings: string[];
  }>(`/streams/${encodeURIComponent(streamId)}/generate-schedule`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: templateId, force }),
  });
}

// ============================================================================
// COURSES API
// ============================================================================

export interface Course {
  id: string;
  title: string;
  description: string | null;
  teacher_id: string;
  teacher?: { id: string; full_name: string };
  created_at: string;
  updated_at: string;
  topics?: CourseTopic[];
}

export interface CourseTopic {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  presentation_storage_path: string | null;
  presentation_original_filename: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  tests?: CourseTest[];
  links?: { title: string; url: string }[];
}

export interface CourseTest {
  id: string;
  topic_id: string;
  title: string;
  description: string | null;
  document_storage_path: string | null;
  document_original_filename: string | null;
  test_type: "quiz" | "document";
  time_limit_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface TestQuestion {
  id: string;
  test_id: string;
  question_text: string;
  order_index: number;
  created_at: string;
  options?: TestQuestionOption[];
}

export interface TestQuestionOption {
  id: string;
  question_id: string;
  option_text: string;
  is_correct?: boolean; // Only visible to teachers/admins
  order_index: number;
}

export interface TestAttempt {
  id: string;
  test_id: string;
  student_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_seconds: number | null;
  score: number | null;
  total_questions: number | null;
  percentage_score: number | null;
  test?: { id: string; title: string; test_type: string };
  student?: { id: string; full_name: string };
}

export async function apiListCourses(token: string): Promise<{ courses: Course[] }> {
  return apiGet<{ courses: Course[] }>("/courses", token);
}

export async function apiGetCourse(token: string, courseId: string): Promise<{ course: Course }> {
  return apiGet<{ course: Course }>(`/courses/${encodeURIComponent(courseId)}`, token);
}

export async function apiCreateCourse(token: string, data: { title: string; description?: string | null }): Promise<{ course: Course }> {
  return apiPost<{ course: Course }>("/courses", data, token);
}

export async function apiUpdateCourse(token: string, courseId: string, data: { title?: string; description?: string | null }): Promise<{ course: Course }> {
  return http<{ course: Course }>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiDeleteCourse(token: string, courseId: string, password: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
}

export async function apiCreateTopic(
  token: string,
  courseId: string,
  data: { title: string; description?: string | null; order_index?: number; links?: { title: string; url: string }[] },
  presentation?: File | null,
  onProgress?: (percent: number) => void
): Promise<{ topic: CourseTopic }> {
  const formData = new FormData();
  formData.append("course_id", courseId);
  formData.append("title", data.title);
  if (data.description) formData.append("description", data.description);
  formData.append("order_index", String(data.order_index || 0));
  if (presentation) formData.append("presentation", presentation);
  if (data.links) formData.append("links", JSON.stringify(data.links));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Create topic failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("POST", `${API_BASE}${withApiPrefix("/courses/topics")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiUpdateTopic(
  token: string, 
  topicId: string, 
  data: { 
    title?: string; 
    description?: string | null; 
    order_index?: number;
    presentation?: File | null;
    links?: { title: string; url: string }[];
  }
): Promise<{ topic: CourseTopic }> {
  const formData = new FormData();
  if (data.title !== undefined) formData.append("title", data.title);
  if (data.description !== undefined) formData.append("description", data.description || "");
  if (data.order_index !== undefined) formData.append("order_index", String(data.order_index));
  if (data.presentation) formData.append("presentation", data.presentation);
  if (data.links) formData.append("links", JSON.stringify(data.links));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("Invalid JSON response"));
        }
      } else {
        reject(new Error(xhr.responseText || "Upload failed"));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("PUT", `${API_BASE}${withApiPrefix(`/courses/topics/${encodeURIComponent(topicId)}`)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiDeleteTopic(token: string, topicId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/courses/topics/${encodeURIComponent(topicId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiUploadTopicPresentation(
  token: string,
  topicId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ topic: CourseTopic }> {
  const formData = new FormData();
  formData.append("presentation", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("POST", `${API_BASE}${withApiPrefix(`/courses/topics/${encodeURIComponent(topicId)}/presentation`)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiCreateQuizTest(token: string, data: { topic_id: string; title: string; description?: string | null; time_limit_minutes: number }): Promise<{ test: CourseTest }> {
  return apiPost<{ test: CourseTest }>("/courses/tests/quiz", data, token);
}

export async function apiCreateDocumentTest(
  token: string,
  topicId: string,
  data: { title: string; description?: string | null },
  document?: File | null,
  onProgress?: (percent: number) => void
): Promise<{ test: CourseTest }> {
  const formData = new FormData();
  formData.append("topic_id", topicId);
  formData.append("title", data.title);
  if (data.description) formData.append("description", data.description);
  if (document) formData.append("document", document);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Failed to parse response"));
        }
      } else {
        reject(new Error(`Create test failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.open("POST", `${API_BASE}${withApiPrefix("/courses/tests/document")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function apiUpdateTest(token: string, testId: string, data: { title?: string; description?: string | null; time_limit_minutes?: number }): Promise<{ test: CourseTest }> {
  return http<{ test: CourseTest }>(`/courses/tests/${encodeURIComponent(testId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiDeleteTest(token: string, testId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/courses/tests/${encodeURIComponent(testId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiCreateQuestion(token: string, testId: string, data: { question_text: string; order_index?: number }): Promise<{ question: TestQuestion }> {
  return apiPost<{ question: TestQuestion }>(`/courses/tests/${encodeURIComponent(testId)}/questions`, { ...data, test_id: testId }, token);
}

export async function apiListQuestions(token: string, testId: string): Promise<{ questions: TestQuestion[] }> {
  return apiGet<{ questions: TestQuestion[] }>(`/courses/tests/${encodeURIComponent(testId)}/questions`, token);
}

export async function apiUpdateQuestion(token: string, questionId: string, data: { question_text?: string; order_index?: number }): Promise<{ question: TestQuestion }> {
  return http<{ question: TestQuestion }>(`/courses/questions/${encodeURIComponent(questionId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiDeleteQuestion(token: string, questionId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/courses/questions/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiCreateOption(token: string, questionId: string, data: { option_text: string; is_correct: boolean; order_index?: number }): Promise<{ option: TestQuestionOption }> {
  return apiPost<{ option: TestQuestionOption }>(`/courses/questions/${encodeURIComponent(questionId)}/options`, { ...data, question_id: questionId }, token);
}

export async function apiUpdateOption(token: string, optionId: string, data: { option_text?: string; is_correct?: boolean; order_index?: number }): Promise<{ option: TestQuestionOption }> {
  return http<{ option: TestQuestionOption }>(`/courses/options/${encodeURIComponent(optionId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function apiDeleteOption(token: string, optionId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/courses/options/${encodeURIComponent(optionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiStartTestAttempt(token: string, testId: string): Promise<{ attempt: TestAttempt; questions?: TestQuestion[]; time_limit_seconds?: number; test?: CourseTest }> {
  return apiPost<{ attempt: TestAttempt; questions?: TestQuestion[]; time_limit_seconds?: number; test?: CourseTest }>(`/courses/tests/${encodeURIComponent(testId)}/start`, {}, token);
}

export async function apiSubmitTestAttempt(token: string, attemptId: string, answers: Array<{ question_id: string; selected_option_id: string | null }>): Promise<{ attempt: TestAttempt; score: number; total_questions: number; percentage_score: number }> {
  return apiPost<{ attempt: TestAttempt; score: number; total_questions: number; percentage_score: number }>(`/courses/attempts/${encodeURIComponent(attemptId)}/submit`, { answers }, token);
}

export async function apiGetTestAttempt(token: string, attemptId: string): Promise<{ attempt: TestAttempt; answers: Array<{ question_id: string; selected_option_id: string | null; is_correct: boolean }> }> {
  return apiGet<{ attempt: TestAttempt; answers: Array<{ question_id: string; selected_option_id: string | null; is_correct: boolean }> }>(`/courses/attempts/${encodeURIComponent(attemptId)}`, token);
}

export async function apiListTestAttempts(token: string, testId: string): Promise<{ attempts: TestAttempt[] }> {
  return apiGet<{ attempts: TestAttempt[] }>(`/courses/tests/${encodeURIComponent(testId)}/attempts`, token);
}

export async function apiListStudentAttempts(token: string): Promise<{ attempts: TestAttempt[] }> {
  return apiGet<{ attempts: TestAttempt[] }>("/courses/student/attempts", token);
}

// ============================================================================
// WORKLOAD & EXPORTS
// ============================================================================

export async function apiGetTeacherWorkload(token: string, teacherId: string): Promise<TeacherWorkload> {
  return http<TeacherWorkload>(`/timetable/teachers/${encodeURIComponent(teacherId)}/workload`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiGetAllTeachersWorkload(token: string): Promise<{ teachers: Array<{
  teacher_id: string;
  teacher_name: string;
  weekly_hours: number;
  weekly_lessons: number;
  monthly_hours: number;
  three_month_hours: number;
}> }> {
  return http<{ teachers: Array<{
    teacher_id: string;
    teacher_name: string;
    weekly_hours: number;
    weekly_lessons: number;
    monthly_hours: number;
    three_month_hours: number;
  }> }>("/timetable/teachers/workload/all", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiDownloadClassesWithStreams(token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${withApiPrefix("/admin/exports/classes-with-streams.xlsx")}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }
  
  return response.blob();
}

export async function apiDownloadTeachersWorkload(token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${withApiPrefix("/timetable/exports/teachers-workload.xlsx")}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }
  
  return response.blob();
}