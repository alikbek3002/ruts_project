import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, CheckCircle, ExternalLink } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import {
  apiGetClass,
  apiListClasses,
  apiSubjectContentGetSubject,
  apiSubjectContentMarkRead,
  apiSubjectGetAttempt,
  apiSubjectListQuestions,
  apiSubjectStartAttempt,
  apiSubjectSubmitAttempt,
  type ClassItem,
  type ClassStudent,
  type SubjectContentTopic,
  type SubjectTestQuestion,
} from "../../../api/client";
import styles from "./StudentSubjectView.module.css";

export function StudentSubjectViewPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();

  const isSharedStudent = user?.role === "student" && (user.username || "").toLowerCase() === "student";

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [classesLoading, setClassesLoading] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [title, setTitle] = useState<string>("Предмет");
  const [topics, setTopics] = useState<SubjectContentTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline test flow (minimal)
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SubjectTestQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resultAttempt, setResultAttempt] = useState<any>(null);
  const [resultAnswers, setResultAnswers] = useState<any[]>([]);

  const canLoadShared = useMemo(() => {
    if (!isSharedStudent) return true;
    return !!classId && !!studentId;
  }, [isSharedStudent, classId, studentId]);

  useEffect(() => {
    if (!token || !isSharedStudent) return;
    setClassesLoading(true);
    apiListClasses(token)
      .then((r) => setClasses(r.classes || []))
      .catch((e) => setError(String(e)))
      .finally(() => setClassesLoading(false));
  }, [token, isSharedStudent]);

  useEffect(() => {
    if (!token || !isSharedStudent) return;
    if (!classId) {
      setStudents([]);
      setStudentId("");
      return;
    }
    setStudentsLoading(true);
    apiGetClass(token, classId)
      .then((r) => setStudents(r.students || []))
      .catch((e) => setError(String(e)))
      .finally(() => setStudentsLoading(false));
  }, [token, isSharedStudent, classId]);

  useEffect(() => {
    if (!token || !subjectId) return;
    if (isSharedStudent && !canLoadShared) {
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, subjectId, isSharedStudent, canLoadShared]);

  async function load() {
    if (!token || !subjectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiSubjectContentGetSubject(
        token,
        subjectId,
        isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
      );
      setTitle(res.subject?.name || "Предмет");
      setTopics(res.topics || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function markRead(topicId: string) {
    if (!token) return;
    try {
      await apiSubjectContentMarkRead(
        token,
        topicId,
        isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
      );
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function startTest(testId: string) {
    if (!token) return;
    setError(null);
    setSubmitting(false);
    setSubmitted(false);
    setResultAttempt(null);
    setResultAnswers([]);
    setActiveTestId(testId);
    try {
      const res = await apiSubjectStartAttempt(
        token,
        testId,
        isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
      );
      setAttemptId(res.attempt?.id || null);
      const qs = res.questions || (await apiSubjectListQuestions(token, testId)).questions;
      setQuestions(qs || []);
      const init: Record<string, string> = {};
      (qs || []).forEach((q) => (init[q.id] = ""));
      setAnswers(init);
    } catch (e) {
      setError(String(e));
      setActiveTestId(null);
    }
  }

  async function submit() {
    if (!token || !attemptId || !activeTestId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const arr = Object.entries(answers).map(([questionId, optionId]) => ({
        question_id: questionId,
        selected_option_id: optionId || null,
      }));
      await apiSubjectSubmitAttempt(
        token,
        attemptId,
        arr,
        isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
      );
      const details = await apiSubjectGetAttempt(token, attemptId);
      const qs = (
        await apiSubjectListQuestions(
          token,
          activeTestId,
          { attempt_id: attemptId }
        )
      ).questions;
      setQuestions(qs || []);
      setSubmitted(true);
      setResultAttempt(details.attempt);
      setResultAnswers(details.answers || []);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;
  if (!subjectId) return <Navigate to="/app/student/subjects" replace />;

  if (loading) {
    return (
      <AppShell title={title} nav={[]}>
        <Loader text="Загрузка..." />
      </AppShell>
    );
  }

  if (isSharedStudent && !canLoadShared) {
    return (
      <AppShell
        title={title}
        nav={[
          { to: "/app/student", labelKey: "nav.home" },
          { to: "/app/student/timetable", labelKey: "nav.timetable" },
          { to: "/app/student/subjects", labelKey: "nav.subjects" },
        ]}
      >
        <div className={styles.container}>
          <div className={styles.card}>
            <h2 style={{ marginTop: 0 }}>Выберите группу и себя</h2>
            <p style={{ opacity: 0.8, marginTop: 0 }}>Нужно для записи результата в журнал.</p>

            {error && <div className={styles.error}>{error}</div>}

            {classesLoading ? (
              <div className={styles.muted}>Загрузка групп...</div>
            ) : classes.length === 0 ? (
              <div className={styles.muted}>Нет доступных групп</div>
            ) : null}

            <label className={styles.label}>Группа</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className={styles.select}
              disabled={classesLoading}
            >
              <option value="">— выберите группу —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div style={{ height: 12 }} />

            <label className={styles.label}>Ученик</label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className={styles.select}
              disabled={!classId || studentsLoading || classesLoading}
            >
              <option value="">— выберите себя —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.username}
                </option>
              ))}
            </select>

            {classId ? (
              studentsLoading ? (
                <div className={styles.muted} style={{ marginTop: 8 }}>
                  Загрузка учеников...
                </div>
              ) : students.length === 0 ? (
                <div className={styles.muted} style={{ marginTop: 8 }}>
                  В этой группе пока нет учеников
                </div>
              ) : null
            ) : null}

            <div style={{ height: 12 }} />

            <button
              className={styles.primaryButton}
              disabled={!classId || !studentId || classesLoading || studentsLoading}
              onClick={() => load()}
            >
              Открыть предмет
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={title}
      nav={[
        { to: "/app/student", labelKey: "nav.home" },
        { to: "/app/student/timetable", labelKey: "nav.timetable" },
        { to: "/app/student/subjects", labelKey: "nav.subjects" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.topRow}>
          <Link to="/app/student/subjects" className={styles.backLink}>
            <ArrowLeft size={16} /> Назад
          </Link>
          <button className={styles.secondaryButton} onClick={() => navigate("/app/student/subjects")}>
            Все предметы
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {topics.length === 0 ? (
          <div className={styles.card} style={{ opacity: 0.8 }}>Пока нет тем</div>
        ) : (
          <div className={styles.topics}>
            {topics.map((t) => (
              <div key={t.id} className={styles.topicCard}>
                <div className={styles.topicHeader}>
                  <div>
                    <div className={styles.topicTitle}>
                      {t.topic_number}. {t.topic_name}
                    </div>
                    {t.description && <div className={styles.topicDesc}>{t.description}</div>}
                  </div>

                  {t.is_read ? (
                    <div className={styles.readBadge}>
                      <CheckCircle size={16} /> Прочитал
                    </div>
                  ) : (
                    <button className={styles.primaryButton} onClick={() => markRead(t.id)}>
                      Прочитал
                    </button>
                  )}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Материалы</div>
                  {t.materials.length === 0 ? (
                    <div className={styles.muted}>Пока нет материалов</div>
                  ) : (
                    <div className={styles.materials}>
                      {t.materials.map((m) => (
                        <a
                          key={m.id}
                          className={styles.materialLink}
                          href={(m.kind === "link" ? m.url : m.signed_url) || "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>{m.title}</span>
                          <ExternalLink size={16} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Тест</div>

                  {t.tests.length === 0 ? (
                    <div className={styles.muted}>Пока нет теста</div>
                  ) : (
                    <div className={styles.tests}>
                      {t.tests.map((test) => {
                        const locked = !test.can_start;
                        const isPassed = test.passed;
                        return (
                          <div key={test.id} className={styles.testRow}>
                            <div className={styles.testInfo}>
                              <div className={styles.testTitle}>{test.title}</div>
                              <div className={styles.testMeta}>
                                {test.best_percentage != null ? `Лучший результат: ${Math.round(test.best_percentage)}%` : ""}
                                {test.passed ? " • Сдан" : test.best_percentage != null ? " • Не сдан" : ""}
                              </div>
                              {locked && test.locked_reason && (
                                <div className={styles.lockedReason}>
                                  <Lock size={14} /> {test.locked_reason}
                                </div>
                              )}
                            </div>
                            <div>
                              <button
                                className={styles.primaryButton}
                                disabled={locked || isPassed}
                                onClick={() => {
                                  if (isPassed) return; // Дополнительная защита
                                  // Открываем тест в новой вкладке
                                  const params = isSharedStudent && studentId && classId
                                    ? `?studentId=${studentId}&classId=${classId}`
                                    : '';
                                  window.open(`/app/student/subjects/${subjectId}/test/${test.id}${params}`, '_blank');
                                }}
                                style={{ opacity: locked || isPassed ? 0.6 : 1 }}
                              >
                                {isPassed ? "Сдано ✓" : "Начать"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTestId && attemptId && (
          <div className={styles.modalBackdrop}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>Тест</div>
                <button className={styles.secondaryButton} onClick={() => setActiveTestId(null)}>
                  Закрыть
                </button>
              </div>

              {!submitted ? (
                <>
                  <div className={styles.questions}>
                    {questions.map((q, idx) => (
                      <div key={q.id} className={styles.questionCard}>
                        <div className={styles.questionTitle}>Вопрос {idx + 1}</div>
                        <div className={styles.questionText}>{q.question_text}</div>
                        <div className={styles.options}>
                          {(q.options || []).map((o) => (
                            <label key={o.id} className={styles.option}>
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                checked={answers[q.id] === o.id}
                                onChange={() => setAnswers((p) => ({ ...p, [q.id]: o.id }))}
                              />
                              <span>{o.option_text}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.modalFooter}>
                    <button className={styles.primaryButton} disabled={submitting} onClick={() => submit()}>
                      {submitting ? "Отправка..." : "Отправить"}
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.results}>
                  <div className={styles.resultsTop}>
                    <div>
                      Результат: {Math.round(Number(resultAttempt?.percentage_score || 0))}% ({resultAttempt?.score || 0} из {resultAttempt?.total_questions || 0})
                    </div>
                  </div>

                  <div className={styles.questions}>
                    {questions.map((q, idx) => {
                      const a = resultAnswers.find((x) => x.question_id === q.id);
                      return (
                        <div key={q.id} className={styles.questionCard}>
                          <div className={styles.questionTitle}>Вопрос {idx + 1}</div>
                          <div className={styles.questionText}>{q.question_text}</div>
                          <div className={styles.options}>
                            {(q.options || []).map((o) => {
                              const isSelected = o.id === a?.selected_option_id;
                              const isCorrect = (o as any).is_correct;
                              return (
                                <div
                                  key={o.id}
                                  className={`${styles.optionReview} ${isCorrect ? styles.correct : ""} ${isSelected && !isCorrect ? styles.incorrect : ""}`}
                                >
                                  {o.option_text}
                                  {isSelected ? <span className={styles.badge}>Ваш ответ</span> : null}
                                  {isCorrect ? <span className={styles.badge}>Правильный</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.modalFooter}>
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        setActiveTestId(null);
                        setAttemptId(null);
                      }}
                    >
                      Готово
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
