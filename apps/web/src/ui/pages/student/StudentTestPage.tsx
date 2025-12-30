import React, { useEffect, useState, useRef } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import { Clock, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import {
  apiStartTestAttempt,
  apiSubmitTestAttempt,
  apiGetTestAttempt,
  type TestAttempt,
  type TestQuestion,
  type CourseTest,
} from "../../../api/client";
import styles from "./StudentTest.module.css";

export function StudentTestPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const { courseId, testId } = useParams<{ courseId: string; testId: string }>();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState<TestAttempt | null>(null);
  const [test, setTest] = useState<CourseTest | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (token && testId) {
      startTest();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [token, testId]);

  useEffect(() => {
    if (timeLeft !== null && timeLeft > 0 && !submitted) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            if (prev === 1 && attempt) {
              handleAutoSubmit();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timeLeft === 0 && attempt && !submitted) {
      handleAutoSubmit();
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [timeLeft, submitted, attempt]);

  async function startTest() {
    if (!token || !testId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiStartTestAttempt(token, testId);
      setAttempt(res.attempt);
      if (res.test) setTest(res.test);
      if (res.questions) {
        setQuestions(res.questions);
        // Initialize answers
        const initialAnswers: Record<string, string> = {};
        res.questions.forEach((q) => {
          initialAnswers[q.id] = "";
        });
        setAnswers(initialAnswers);
      }
      if (res.time_limit_seconds) {
        setTimeLeft(res.time_limit_seconds);
        startTimeRef.current = Date.now();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoSubmit() {
    if (submitted || submitting || !attempt) return;
    await submitTest(true);
  }

  async function submitTest(autoSubmit = false) {
    if (!token || !attempt || submitting) return;
    setSubmitting(true);
    try {
      const answerArray = Object.entries(answers).map(([questionId, optionId]) => ({
        question_id: questionId,
        selected_option_id: optionId || null,
      }));

      const res = await apiSubmitTestAttempt(token, attempt.id, answerArray);
      setSubmitted(true);
      setResults(res);
      
      // Load full attempt details to see correct answers
      const attemptDetails = await apiGetTestAttempt(token, attempt.id);
      setResults(attemptDetails);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  function handleAnswerChange(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "student") return <Navigate to="/app" replace />;
  if (!testId || !courseId) return <Navigate to="/app/student/courses" replace />;

  if (loading) {
    return (
      <AppShell title="Тест" nav={[]}>
        <Loader text="Загрузка теста..." />
      </AppShell>
    );
  }

  if (error && !attempt) {
    return (
      <AppShell title="Тест" nav={[]}>
        <div className={styles.error}>{error}</div>
        <button onClick={() => navigate(`/app/student/courses/${courseId}`)} className={styles.backButton}>
          <ArrowLeft size={16} />
          Назад к курсу
        </button>
      </AppShell>
    );
  }

  if (!attempt) {
    return (
      <AppShell title="Тест" nav={[]}>
        <div className={styles.error}>Не удалось начать тест</div>
      </AppShell>
    );
  }

  // Document test
  if (test?.test_type === "document") {
    return (
      <AppShell title="Домашнее задание" nav={[]}>
        <div className={styles.container}>
          <div className={styles.testHeader}>
            <h1>{test.title}</h1>
            {test.description && <p className={styles.testDescription}>{test.description}</p>}
          </div>
          {test.document_storage_path && (
            <div className={styles.documentSection}>
              <p>Документ: {test.document_original_filename || "Файл"}</p>
              <p className={styles.infoText}>
                Это домашнее задание. Выполните его согласно инструкциям преподавателя.
              </p>
            </div>
          )}
          <button onClick={() => navigate(`/app/student/courses/${courseId}`)} className={styles.backButton}>
            <ArrowLeft size={16} />
            Назад к курсу
          </button>
        </div>
      </AppShell>
    );
  }

  // Quiz test - show results if submitted
  if (submitted && results) {
    const score = results.attempt?.score || 0;
    const total = results.attempt?.total_questions || 0;
    const percentage = results.attempt?.percentage_score || 0;

    return (
      <AppShell title="Результаты теста" nav={[]}>
        <div className={styles.container}>
          <div className={styles.resultsCard}>
            <h1>Результаты теста</h1>
            <div className={styles.scoreSection}>
              <div className={styles.scoreCircle}>
                <div className={styles.scoreValue}>{percentage.toFixed(0)}%</div>
                <div className={styles.scoreLabel}>
                  {score} из {total}
                </div>
              </div>
            </div>

            <div className={styles.questionsReview}>
              <h2>Ваши ответы</h2>
              {questions.map((question, index) => {
                const answer = results.answers?.find((a: any) => a.question_id === question.id);
                const selectedOption = question.options?.find((o) => o.id === answer?.selected_option_id);
                const isCorrect = answer?.is_correct;

                return (
                  <div key={question.id} className={styles.questionReviewCard}>
                    <div className={styles.questionReviewHeader}>
                      <h3>
                        Вопрос {index + 1}
                        {isCorrect ? (
                          <span className={styles.correctBadge}>
                            <CheckCircle size={16} />
                            Правильно
                          </span>
                        ) : (
                          <span className={styles.incorrectBadge}>
                            <XCircle size={16} />
                            Неправильно
                          </span>
                        )}
                      </h3>
                    </div>
                    <p className={styles.questionText}>{question.question_text}</p>
                    <div className={styles.optionsReview}>
                      {question.options?.map((option) => {
                        const isSelected = option.id === answer?.selected_option_id;
                        const isCorrectOption = option.is_correct;
                        return (
                          <div
                            key={option.id}
                            className={`${styles.optionReviewItem} ${
                              isCorrectOption ? styles.correctOption : ""
                            } ${isSelected && !isCorrectOption ? styles.incorrectSelected : ""}`}
                          >
                            {option.option_text}
                            {isSelected && <span className={styles.selectedLabel}>Ваш ответ</span>}
                            {isCorrectOption && <span className={styles.correctLabel}>Правильный ответ</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={() => navigate(`/app/student/courses/${courseId}`)} className={styles.backButton}>
              <ArrowLeft size={16} />
              Назад к курсу
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Quiz test - in progress
  return (
    <AppShell title="Прохождение теста" nav={[]}>
      <div className={styles.container}>
        <div className={styles.testHeader}>
          <div>
            <h1>{test?.title || "Тест"}</h1>
            {timeLeft !== null && (
              <div className={styles.timer}>
                <Clock size={20} />
                <span className={timeLeft < 60 ? styles.timerWarning : ""}>
                  {formatTime(timeLeft)}
                </span>
              </div>
            )}
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.questionsSection}>
          {questions.map((question, index) => (
            <div key={question.id} className={styles.questionCard}>
              <h3>
                Вопрос {index + 1} из {questions.length}
              </h3>
              <p className={styles.questionText}>{question.question_text}</p>
              <div className={styles.optionsList}>
                {question.options?.map((option) => (
                  <label
                    key={option.id}
                    className={`${styles.optionItem} ${
                      answers[question.id] === option.id ? styles.optionSelected : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name={`question-${question.id}`}
                      value={option.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => handleAnswerChange(question.id, option.id)}
                    />
                    <span>{option.option_text}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <div className={styles.progressInfo}>
            Отвечено: {Object.values(answers).filter((a) => a).length} из {questions.length}
          </div>
          <button
            onClick={() => submitTest(false)}
            className={styles.submitButton}
            disabled={submitting || submitted}
          >
            {submitting ? "Отправка..." : "Завершить тест"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

