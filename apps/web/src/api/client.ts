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

type HttpError = Error & { status?: number; bodyText?: string };

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
    const newToken = await refreshAccessToken();
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
    try {
      const json = JSON.parse(msg);
      if (json && typeof json === "object" && json.detail) {
        cleanMsg = typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail);
      }
    } catch {
      // ignore
    }
    const err: HttpError = new Error(cleanMsg || `HTTP ${res.status}`) as HttpError;
    err.status = res.status;
    err.bodyText = msg;
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

export async function apiAdminListUsers(token: string, role?: UserRole, searchQuery?: string) {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (searchQuery && searchQuery.trim()) params.set("q", searchQuery.trim());
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
  teacher_id: string | null;
  subject: string;
  subject_id?: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  room?: string;
  lesson_type?: "lecture" | "credit";
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
  body: { teacher_id?: string | null; subject?: string; subject_id?: string | null; room?: string | null; lesson_type?: "lecture" | "credit" }
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

export async function apiGetNotifications(token: string) {
  return apiGet<{ notifications: Notification[] }>("/notifications", token);
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
  description: string;
  class_id: string;
  subject_id: string;
}) {
  return apiPost<Topic>("/library/topics", data, token);
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
