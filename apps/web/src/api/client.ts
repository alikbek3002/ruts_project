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

const DEFAULT_FETCH_TIMEOUT_MS = 20000;

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
  const hasSignal = !!init?.signal;
  const controller = hasSignal ? null : new AbortController();
  const timeoutId = controller
    ? (globalThis.setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, DEFAULT_FETCH_TIMEOUT_MS) as unknown as number)
    : null;
  try {
    return await fetch(input, {
      ...(init ?? {}),
      signal: init?.signal ?? controller?.signal,
    });
  } finally {
    if (timeoutId != null) {
      try {
        globalThis.clearTimeout(timeoutId);
      } catch {
        // ignore
      }
    }
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
  console.log('[API] Request:', init?.method || 'GET', path, init?.body ? JSON.parse(init.body as string) : null);
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
    console.error('[API] Error:', init?.method || 'GET', path, err);
    throw err;
  }
  const result = (await res.json()) as T;
  console.log('[API] Success:', init?.method || 'GET', path, result);
  return result;
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

async function apiPostForm<T>(path: string, formData: FormData, accessToken: string, _retry = true): Promise<T> {
  let res: Response;
  try {
    res = await trackedFetch(`${API_BASE}${withApiPrefix(path)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      credentials: "include",
    });
  } catch (e: any) {
    const hint = API_BASE_PROBLEM
      ? `${API_BASE_PROBLEM}. `
      : "Не удалось подключиться к API. Проверь `VITE_API_URL`, CORS и доступность бэка. ";
    const err: HttpError = new Error(`${hint}${String(e?.message ?? e ?? "")}`.trim()) as HttpError;
    throw err;
  }

  if (res.status === 401 && _retry) {
    const newToken = await refreshAccessTokenDedup();
    if (newToken) return await apiPostForm<T>(path, formData, newToken, false);
  }

  if (!res.ok) {
    const msg = await readErrorText(res);
    let cleanMsg = msg;
    try {
      const json = JSON.parse(msg);
      if (json && typeof json === "object" && (json as any).detail) {
        const detail = (json as any).detail;
        cleanMsg = typeof detail === "string" ? detail : JSON.stringify(detail);
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

export async function apiListDirections(token: string) {
  return apiGet<{ directions: Direction[] }>("/directions", token);
}

// Subject (предмет)
export type Subject = {
  id: string;
  name: string;
  photo_url?: string | null;
  open_to_all_teachers?: boolean;
};

export type SubjectContentMaterial = {
  id: string;
  topic_id: string;
  kind: "file" | "link";
  title: string;
  url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_filename?: string | null;
  signed_url?: string | null;
  created_at?: string;
};

export type SubjectContentTest = {
  id: string;
  topic_id: string;
  title: string;
  description?: string | null;
  test_type: "quiz" | "document";
  time_limit_minutes?: number | null;
  created_at?: string;
  best_percentage?: number | null;
  passed?: boolean;
  can_start?: boolean;
  locked_reason?: string | null;
};

export type SubjectContentTopic = {
  id: string;
  subject_id: string;
  topic_number: number;
  topic_name: string;
  description?: string | null;
  is_read?: boolean;
  materials: SubjectContentMaterial[];
  tests: SubjectContentTest[];
};

export type SubjectContentSubject = {
  id: string;
  name: string;
  photo_url?: string | null;
};

export type SubjectTestAttempt = {
  id: string;
  test_id: string;
  student_id: string;
  started_at?: string;
  submitted_at?: string | null;
  time_limit_seconds?: number | null;
  score?: number | null;
  total_questions?: number | null;
  percentage_score?: number | null;
};

export type SubjectTestQuestionOption = {
  id: string;
  option_text: string;
  order_index?: number;
  is_correct?: boolean;
};

export type SubjectTestQuestion = {
  id: string;
  question_text: string;
  order_index?: number;
  options?: SubjectTestQuestionOption[];
};

export type SubjectTestAttemptAnswer = {
  id: string;
  question_id: string;
  selected_option_id?: string | null;
  is_correct?: boolean | null;
};

export async function apiSubjectContentListSubjects(accessToken: string) {
  return await apiGet<{ subjects: SubjectContentSubject[] }>(`/api/subject-content/subjects`, accessToken);
}

export async function apiSubjectContentGetSubject(
  accessToken: string,
  subjectId: string,
  params?: { student_id?: string; class_id?: string }
) {
  const qs = new URLSearchParams();
  if (params?.student_id) qs.set("student_id", params.student_id);
  if (params?.class_id) qs.set("class_id", params.class_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return await apiGet<{ subject: SubjectContentSubject; topics: SubjectContentTopic[] }>(
    `/api/subject-content/subjects/${subjectId}${suffix}`,
    accessToken
  );
}

export async function apiSubjectContentMarkRead(
  accessToken: string,
  topicId: string,
  payload?: { student_id?: string; class_id?: string }
) {
  return apiPost<{ ok: boolean }>(`/api/subject-content/topics/${topicId}/read`, payload || {}, accessToken);
}

export async function apiTeacherGetSubject(token: string, subjectId: string) {
  return await apiGet<{ subject: SubjectContentSubject; topics: SubjectContentTopic[] }>(
    `/api/subject-content/teacher/subjects/${subjectId}`,
    token
  );
}

export async function apiSubjectContentUploadFile(
  token: string,
  topicId: string,
  file: File,
  title?: string
) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);

  return await apiPostForm<{ material: SubjectContentMaterial }>(
    `/api/subject-content/topics/${topicId}/materials/file`,
    formData,
    token
  );
}

export async function apiSubjectContentCreateLink(
  token: string,
  topicId: string,
  title: string,
  url: string
) {
  return apiPost<{ material: SubjectContentMaterial }>(
    `/api/subject-content/topics/${topicId}/materials/link`,
    { title, url },
    token
  );
}

export async function apiSubjectContentDeleteMaterial(token: string, materialId: string) {
  return http<{ ok: boolean }>(`/api/subject-content/materials/${materialId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSubjectContentCreateQuiz(
  token: string,
  topicId: string,
  title: string,
  timeLimitMinutes: number,
  description?: string
) {
  return apiPost<{ test: SubjectContentTest }>(
    `/api/subject-content/tests/quiz`,
    { topic_id: topicId, title, time_limit_minutes: timeLimitMinutes, description },
    token
  );
}

export async function apiSubjectContentCreateQuestion(
  token: string,
  testId: string,
  questionText: string,
  orderIndex: number
) {
  return apiPost<{ question: SubjectTestQuestion }>(
    `/api/subject-content/tests/${encodeURIComponent(testId)}/questions`,
    { question_text: questionText, order_index: orderIndex },
    token
  );
}

export async function apiSubjectContentDeleteQuestion(token: string, questionId: string) {
  return http<{ ok: boolean }>(`/api/subject-content/questions/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSubjectContentCreateOption(
  token: string,
  questionId: string,
  optionText: string,
  isCorrect: boolean,
  orderIndex: number
) {
  return apiPost<{ option: SubjectTestQuestionOption }>(
    `/api/subject-content/questions/${encodeURIComponent(questionId)}/options`,
    { option_text: optionText, is_correct: isCorrect, order_index: orderIndex },
    token
  );
}

export async function apiSubjectContentDeleteOption(token: string, optionId: string) {
  return http<{ ok: boolean }>(`/api/subject-content/options/${encodeURIComponent(optionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSubjectContentCreateDocumentTest(
  token: string,
  topicId: string,
  title: string,
  file: File,
  description?: string
) {
  const formData = new FormData();
  formData.append("topic_id", topicId);
  formData.append("title", title);
  formData.append("document", file);
  if (description) formData.append("description", description);

  return await apiPostForm<{ test: SubjectContentTest }>(
    `/api/subject-content/tests/document`,
    formData,
    token
  );
}

export async function apiSubjectContentDeleteTest(token: string, testId: string) {
  return http<{ ok: boolean }>(`/api/subject-content/tests/${testId}`, {
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

export async function apiGetTeacherSubjects(token: string, teacherId: string) {
  return apiGet<{ subjects: Subject[] }>(
    `/subjects/teachers/${encodeURIComponent(teacherId)}/subjects`,
    token
  );
}

// Subject management
export type SubjectWithTeachers = Subject & {
  teachers?: { id: string; name: string }[];
};

export async function apiListSubjectsWithTeachers(token: string) {
  return await apiGet<{ subjects: SubjectWithTeachers[] }>("/subjects/subjects-with-teachers", token);
}

export const apiListSubjects = apiListSubjectsWithTeachers;

export async function apiCreateSubject(
  token: string,
  name: string,
  photo_url: string | null,
  open_to_all_teachers?: boolean | null,
) {
  return await apiPost<{ subject: Subject }>(
    "/subjects/subjects",
    { name, photo_url, open_to_all_teachers: open_to_all_teachers ?? undefined },
    token
  );
}

export async function apiUpdateSubject(
  token: string,
  subjectId: string,
  name: string,
  photo_url: string | null,
  open_to_all_teachers?: boolean | null,
) {
  return await apiPut<{ subject: Subject }>(
    `/subjects/subjects/${subjectId}`,
    { name, photo_url, open_to_all_teachers: open_to_all_teachers ?? undefined },
    token
  );
}

export async function apiDeleteSubject(token: string, subjectId: string) {
  return await http<{ ok: boolean }>(`/subjects/subjects/${subjectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Syllabus functionality
export type SubjectTopic = {
  id: string;
  subject_id: string;
  topic_number: number;
  topic_name: string;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  exam_hours: number;
  total_hours: number;
  description?: string | null;
};

export type SubjectTopicInput = {
  topic_number: number;
  topic_name: string;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  exam_hours: number;
  description?: string | null;
};

export async function apiGetSubjectTopics(token: string, subjectId: string) {
  return apiGet<{
    subject: { id: string; name: string };
    topics: SubjectTopic[];
    totals: {
      lecture_hours: number;
      seminar_hours: number;
      practical_hours: number;
      exam_hours: number;
      total_hours: number;
    }
  }>(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics`, token);
}

export async function apiCreateSubjectTopic(token: string, subjectId: string, topic: SubjectTopicInput) {
  return apiPost<{ topic: SubjectTopic }>(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics`, topic, token);
}

export async function apiUpdateSubjectTopic(token: string, subjectId: string, topicId: string, topic: SubjectTopicInput) {
  return apiPut<{ topic: SubjectTopic }>(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}`, topic, token);
}

export async function apiDeleteSubjectTopic(token: string, subjectId: string, topicId: string) {
  return http<{ ok: boolean }>(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiBulkUpdateSubjectTopics(token: string, subjectId: string, topics: SubjectTopicInput[]) {
  return apiPost<{ ok: boolean; count: number }>(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics/bulk-update`, topics, token);
}

export function getSubjectTopicsExportUrl(subjectId: string, token: string): string {
  return withApiPrefix(`/syllabus/subjects/${encodeURIComponent(subjectId)}/topics/export?token=${encodeURIComponent(token)}`);
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

export type ClassStudent = { id: string; username: string; full_name: string | null; student_number?: number | null; legacy_student_id?: string | null };
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
  lesson_type?: "lecture" | "seminar" | "exam";
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
    lesson_type?: "lecture" | "seminar" | "credit";
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

export async function apiTimetableWeek(token: string, weekStartISO: string, classId?: string) {
  let url = `/timetable/week?weekStart=${encodeURIComponent(weekStartISO)}`;
  if (classId) {
    url += `&classId=${encodeURIComponent(classId)}`;
  }
  return apiGet<{ weekStart: string; entries: WeekTimetableItem[] }>(url, token);
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
  title?: string;
  target_audience?: "teachers" | "students" | "class";
  class_id?: string;
  timetable_entries?: {
    subject: string;
    start_time: string;
    end_time: string;
    classes?: { name: string };
  };
};

export type ZoomMeetingPayload = {
  timetableEntryId?: string;
  startsAt: string;
  title?: string;
  targetAudience?: "teachers" | "students" | "class";
  classId?: string;
};

export async function apiCreateZoomMeetingNew(token: string, timetableEntryId: string, startsAtLocalISO: string) {
  const body = { timetableEntryId, startsAt: startsAtLocalISO };
  return apiPost<{ meeting: ZoomMeeting }>("/zoom/meetings", body, token);
}

export async function apiCreateCustomZoomMeeting(token: string, payload: ZoomMeetingPayload) {
  return apiPost<{ meeting: ZoomMeeting }>("/zoom/meetings", payload, token);
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
    lesson_type?: "lecture" | "seminar" | "credit";
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
// --- Archive API ---

export interface ArchivedItem {
  id: string;
  name: string;
  archived_at: string;
  metadata?: any;
}

export interface ArchivedListResponse {
  items: ArchivedItem[];
}

export interface ArchiveActionResponse {
  ok: boolean;
  message: string;
}

export async function apiGetArchivedSubjects(token: string): Promise<ArchivedItem[]> {
  const res = await fetch(`${API_BASE}/archive/subjects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch archived subjects");
  const data: ArchivedListResponse = await res.json();
  return data.items;
}

export async function apiRestoreSubject(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/subjects/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to restore subject");
}

export async function apiArchiveSubject(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/subjects/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to archive subject");
}

export async function apiGetArchivedTeachers(token: string): Promise<ArchivedItem[]> {
  const res = await fetch(`${API_BASE}/archive/teachers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch archived teachers");
  const data: ArchivedListResponse = await res.json();
  return data.items;
}

export async function apiRestoreTeacher(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/teachers/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to restore teacher");
}

export async function apiArchiveTeacher(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/teachers/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to archive teacher");
}

export async function apiGetArchivedClasses(token: string): Promise<ArchivedItem[]> {
  const res = await fetch(`${API_BASE}/archive/classes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch archived classes");
  const data: ArchivedListResponse = await res.json();
  return data.items;
}

export async function apiRestoreClass(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/classes/${id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to restore class");
}

export async function apiArchiveClass(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archive/classes/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to archive class");
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

export async function apiStartTestAttempt(
  token: string,
  testId: string,
  opts?: { student_id?: string; class_id?: string }
): Promise<{ attempt: TestAttempt; questions?: TestQuestion[]; time_limit_seconds?: number; test?: CourseTest }> {
  return apiPost<{ attempt: TestAttempt; questions?: TestQuestion[]; time_limit_seconds?: number; test?: CourseTest }>(
    `/courses/tests/${encodeURIComponent(testId)}/start`,
    { ...(opts || {}) },
    token
  );
}

export async function apiSubmitTestAttempt(
  token: string,
  attemptId: string,
  answers: Array<{ question_id: string; selected_option_id: string | null }>,
  opts?: { student_id?: string; class_id?: string }
): Promise<{ attempt: TestAttempt; score: number; total_questions: number; percentage_score: number }> {
  return apiPost<{ attempt: TestAttempt; score: number; total_questions: number; percentage_score: number }>(
    `/courses/attempts/${encodeURIComponent(attemptId)}/submit`,
    { answers, ...(opts || {}) },
    token
  );
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

export async function apiGetAllTeachersWorkload(token: string): Promise<{
  teachers: Array<{
    teacher_id: string;
    teacher_name: string;
    weekly_hours: number;
    weekly_lessons: number;
    monthly_hours: number;
    three_month_hours: number;
  }>
}> {
  return http<{
    teachers: Array<{
      teacher_id: string;
      teacher_name: string;
      weekly_hours: number;
      weekly_lessons: number;
      monthly_hours: number;
      three_month_hours: number;
    }>
  }>("/timetable/teachers/workload/all", {
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

// Student API functions for Subject Tests
export async function apiSubjectListQuestions(
  token: string,
  testId: string,
  params?: { attempt_id?: string; student_id?: string }
) {
  const qs = new URLSearchParams();
  if (params?.attempt_id) qs.set("attempt_id", params.attempt_id);
  if (params?.student_id) qs.set("student_id", params.student_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<{ questions: SubjectTestQuestion[] }>(`/api/subject-content/tests/${testId}/questions${suffix}`, token);
}

export async function apiSubjectStartAttempt(token: string, testId: string, params?: { student_id?: string; class_id?: string }) {
  return apiPost<{ attempt: SubjectTestAttempt; questions?: SubjectTestQuestion[]; time_limit_seconds?: number }>(
    `/api/subject-content/tests/${testId}/start`,
    params || {},
    token
  );
}

export async function apiSubjectSubmitAttempt(
  token: string,
  attemptId: string,
  answers: { question_id: string; selected_option_id: string | null }[],
  params?: { student_id?: string; class_id?: string }
) {
  return apiPost<{ attempt: SubjectTestAttempt; score: number; percentage_score: number; total_questions: number }>(
    `/api/subject-content/attempts/${attemptId}/submit`,
    { answers, ...(params || {}) },
    token
  );
}

export async function apiSubjectGetAttempt(token: string, attemptId: string) {
  return apiGet<{ attempt: SubjectTestAttempt; answers?: SubjectTestAttemptAnswer[] }>(
    `/api/subject-content/attempts/${attemptId}`,
    token
  );
}
// --- Direction Subjects (Curriculum) ---
export type DirectionSubject = {
  id: string;
  direction_id: string;
  subject_id: string;
  subject_name: string;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  exam_hours: number;
  total_hours: number;
};

export type DirectionSubjectInput = {
  subject_id: string;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  exam_hours: number;
  total_hours: number;
};

export async function apiListDirectionSubjects(token: string, directionId: string): Promise<{ subjects: DirectionSubject[] }> {
  return apiGet<{ subjects: DirectionSubject[] }>(`/directions/${directionId}/subjects`, token);
}

export async function apiAddDirectionSubject(token: string, directionId: string, payload: DirectionSubjectInput): Promise<{ subject: DirectionSubject }> {
  return apiPost<{ subject: DirectionSubject }>(`/directions/${directionId}/subjects`, payload, token);
}

export async function apiUpdateDirectionSubject(token: string, directionId: string, itemId: string, payload: DirectionSubjectInput): Promise<{ subject: DirectionSubject }> {
  return apiPut<{ subject: DirectionSubject }>(`/directions/${directionId}/subjects/${itemId}`, payload, token);
}

export async function apiDeleteDirectionSubject(token: string, directionId: string, itemId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/directions/${directionId}/subjects/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}


// ============================================================
// Curriculum Plan (structured curriculum with sections)
// ============================================================

export type CurriculumItem = {
  id: string;
  direction_id: string;
  subject_id: string;
  subject_name: string;
  section: 'general' | 'special_legal' | 'special';
  total_hours: number;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  credit_hours: number;
  exam_hours: number;
  test_hours: number;
};

export type CurriculumItemInput = {
  subject_id: string;
  section: 'general' | 'special_legal' | 'special';
  total_hours: number;
  lecture_hours: number;
  seminar_hours: number;
  practical_hours: number;
  credit_hours: number;
  exam_hours: number;
  test_hours: number;
};

export async function apiListCurriculum(token: string, directionId: string): Promise<{ items: CurriculumItem[] }> {
  return apiGet<{ items: CurriculumItem[] }>(`/directions/${directionId}/curriculum`, token);
}

export async function apiAddCurriculumItem(token: string, directionId: string, payload: CurriculumItemInput): Promise<{ item: CurriculumItem }> {
  return apiPost<{ item: CurriculumItem }>(`/directions/${directionId}/curriculum`, payload, token);
}

export async function apiUpdateCurriculumItem(token: string, directionId: string, itemId: string, payload: CurriculumItemInput): Promise<{ item: CurriculumItem }> {
  return apiPut<{ item: CurriculumItem }>(`/directions/${directionId}/curriculum/${itemId}`, payload, token);
}

export async function apiDeleteCurriculumItem(token: string, directionId: string, itemId: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/directions/${directionId}/curriculum/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function apiDuplicateCurriculum(token: string, sourceDirectionId: string, targetDirectionId: string, overwrite: boolean = false): Promise<{ ok: boolean; copied_count: number }> {
  return http<{ ok: boolean; copied_count: number }>(`/directions/${sourceDirectionId}/curriculum/duplicate?target_direction_id=${targetDirectionId}&overwrite=${overwrite}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// ============================================================
// ARCHIVE API - работа с архивом потоков
// ============================================================

export interface ArchivedStreamStats {
  stream_id: string;
  stream_name: string;
  start_date: string;
  end_date: string;
  archived_at: string | null;
  direction_id?: string | null;
  direction_name?: string | null;
  total_classes: number;
  total_students: number;
  avg_attendance_percentage: number | null;
  avg_lesson_grade: number | null;
  total_lesson_grades: number;
  avg_subject_grade: number | null;
  total_subject_grades: number;
  total_test_attempts: number;
  avg_test_score: number | null;
  total_subject_test_attempts: number;
  avg_subject_test_score: number | null;
  total_timetable_entries: number;
}

export interface ArchivedStudentPerformance {
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  total_lessons: number;
  lessons_attended: number;
  attendance_percentage: number | null;
  avg_lesson_grade: number | null;
  lesson_grades_count: number;
  avg_subject_grade: number | null;
  subject_grades_count: number;
  test_attempts_count: number;
  tests_completed: number;
  avg_test_score: number | null;
  subject_test_attempts_count: number;
  subject_tests_completed: number;
  avg_subject_test_score: number | null;
  passed_course: boolean;
}

export interface ArchiveSummary {
  total_archived_streams: number;
  total_students_in_archive: number;
  total_classes_in_archive: number;
  avg_attendance_overall: number;
  avg_grade_overall: number;
  oldest_archived: string | null;
  newest_archived: string | null;
}

// Получить список архивированных потоков
export async function apiGetArchivedStreams(token: string, directionId?: string): Promise<ArchivedStreamStats[]> {
  const params = new URLSearchParams();
  if (directionId) params.append("direction_id", directionId);

  return http<ArchivedStreamStats[]>(`/streams/archived${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Получить детальную статистику архивированного потока
export async function apiGetArchivedStreamDetails(token: string, streamId: string): Promise<ArchivedStreamStats> {
  return http<ArchivedStreamStats>(`/streams/archived/${encodeURIComponent(streamId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Получить студентов архивированного потока с их успеваемостью
export async function apiGetArchivedStreamStudents(
  token: string,
  streamId: string,
  classId?: string,
  passedOnly?: boolean
): Promise<ArchivedStudentPerformance[]> {
  const params = new URLSearchParams();
  if (classId) params.append("class_id", classId);
  if (passedOnly !== undefined) params.append("passed_only", String(passedOnly));

  return http<ArchivedStudentPerformance[]>(
    `/streams/archived/${encodeURIComponent(streamId)}/students${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

// Получить расписание архивированного потока
export async function apiGetArchivedStreamSchedule(token: string, streamId: string): Promise<any[]> {
  return http<any[]>(`/streams/archived/${encodeURIComponent(streamId)}/schedule`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Архивировать поток вручную (только админ)
export async function apiArchiveStream(token: string, streamId: string): Promise<{
  stream_id: string;
  stream_name: string;
  archived_at: string;
  class_count: number;
  student_count: number;
}> {
  return http<{
    stream_id: string;
    stream_name: string;
    archived_at: string;
    class_count: number;
    student_count: number;
  }>(`/streams/${encodeURIComponent(streamId)}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Восстановить поток из архива (только админ)
export async function apiRestoreStream(token: string, streamId: string): Promise<{
  stream_id: string;
  stream_name: string;
  restored_at: string;
  new_status: string;
  message: string;
}> {
  return http<{
    stream_id: string;
    stream_name: string;
    restored_at: string;
    new_status: string;
    message: string;
  }>(`/streams/archived/${encodeURIComponent(streamId)}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Автоматическое архивирование (только админ, вызывается по расписанию)
export async function apiAutoArchiveStreams(token: string): Promise<{
  message: string;
  archived_count: number;
  archived_streams: Array<{ id: string; name: string; archived_at: string }>;
}> {
  return http<{
    message: string;
    archived_count: number;
    archived_streams: Array<{ id: string; name: string; archived_at: string }>;
  }>("/streams/auto-archive", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Получить общую статистику архива
export async function apiGetArchiveSummary(token: string): Promise<ArchiveSummary> {
  return http<ArchiveSummary>("/streams/archive/summary", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Принудительно заархивировать нагрузку за месяц (только админ)
export async function apiArchiveTeacherWorkloadMonthly(token: string, year: number, month: number): Promise<{ message: string }> {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  return http<{ message: string }>(`/streams/archive/workload/monthly?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
