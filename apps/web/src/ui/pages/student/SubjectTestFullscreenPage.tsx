import React, { useEffect, useState, useRef } from "react";
import { Navigate, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import {
    apiSubjectStartAttempt,
    apiSubjectSubmitAttempt,
    apiSubjectListQuestions,
    apiListClasses,
    apiGetClass,
    type SubjectTestQuestion,
    type ClassItem,
    type ClassStudent,
} from "../../../api/client";
import styles from "./SubjectTestFullscreen.module.css";

export function SubjectTestFullscreenPage() {
    const { state } = useAuth();
    const user = state.user;
    const token = state.accessToken;
    const { testId, subjectId } = useParams<{ testId: string; subjectId: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const isSharedStudent = user?.role === "student" && (user.username || "").toLowerCase() === "student";

    // Состояние для shared student
    const [classes, setClasses] = useState<ClassItem[]>([]);
    const [classId, setClassId] = useState<string>(searchParams.get("classId") || "");
    const [students, setStudents] = useState<ClassStudent[]>([]);
    const [studentId, setStudentId] = useState<string>(searchParams.get("studentId") || "");

    // Состояние теста
    const [attemptId, setAttemptId] = useState<string | null>(null);
    const [questions, setQuestions] = useState<SubjectTestQuestion[]>([]);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Результат
    const [score, setScore] = useState<number>(0);
    const [totalQuestions, setTotalQuestions] = useState<number>(0);
    const [percentage, setPercentage] = useState<number>(0);

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Защита от выхода
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (attemptId && !submitted) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [attemptId, submitted]);

    // Защита от контекстного меню и скриншотов - ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ОТЛАДКИ
    /* useEffect(() => {
        const handleContext = (e: MouseEvent) => {
            if (!submitted) {
                e.preventDefault();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            // Блокируем PrintScreen, Ctrl+P, Ctrl+C
            if (!submitted) {
                if (e.key === 'PrintScreen' ||
                    (e.ctrlKey && (e.key === 'p' || e.key === 'P' || e.key === 'c' || e.key === 'C'))) {
                    e.preventDefault();
                }
            }
        };
        document.addEventListener('contextmenu', handleContext);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('contextmenu', handleContext);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [submitted]); */

    // Загрузка классов для shared student
    useEffect(() => {
        console.log('[TEST_PAGE] useEffect triggered', { token: !!token, isSharedStudent, classId, testId });
        if (!token) return;
        if (isSharedStudent && !classId) {
            console.log('[TEST_PAGE] Loading classes for shared student...');
            setLoading(true);
            apiListClasses(token)
                .then((r) => {
                    console.log('[TEST_PAGE] Classes loaded:', r.classes?.length);
                    setClasses(r.classes || []);
                })
                .catch((e) => {
                    console.error('[TEST_PAGE] Error loading classes:', e);
                    setError(String(e));
                })
                .finally(() => {
                    console.log('[TEST_PAGE] setLoading(false)');
                    setLoading(false);
                });
        } else if (isSharedStudent && classId) {
            // Shared student with classId from URL - just make sure loading is false
            console.log('[TEST_PAGE] Shared student with classId, ensuring loading=false');
            setLoading(false);
        } else if (!isSharedStudent) {
            console.log('[TEST_PAGE] Not shared student, starting test immediately');
            startTest();
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, testId]);

    // Загрузка студентов для выбранного класса
    useEffect(() => {
        if (!token || !isSharedStudent || !classId) {
            setStudents([]);
            return;
        }
        apiGetClass(token, classId)
            .then((r) => setStudents(r.students || []))
            .catch((e) => setError(String(e)));
    }, [token, isSharedStudent, classId]);

    // Таймер
    useEffect(() => {
        if (timeLeft !== null && timeLeft > 0 && !submitted) {
            timerRef.current = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev === null || prev <= 1) {
                        if (timerRef.current) clearInterval(timerRef.current);
                        if (prev === 1) handleAutoSubmit();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, submitted]);

    async function startTest() {
        console.log('[TEST_PAGE] startTest() called', { token: !!token, testId, isSharedStudent, studentId, classId });
        if (!token || !testId) return;
        setLoading(true);
        setError(null);
        try {
            console.log('[TEST_PAGE] Calling apiSubjectStartAttempt...');
            const res = await apiSubjectStartAttempt(
                token,
                testId,
                isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
            );
            console.log('[TEST_PAGE] Start attempt response:', res);
            setAttemptId(res.attempt?.id || null);
            if (res.time_limit_seconds) {
                setTimeLeft(res.time_limit_seconds);
            }
            const qs = res.questions || (await apiSubjectListQuestions(token, testId)).questions;
            console.log('[TEST_PAGE] Questions loaded:', qs?.length);
            setQuestions(qs || []);
            const init: Record<string, string> = {};
            (qs || []).forEach((q) => (init[q.id] = ""));
            setAnswers(init);
        } catch (e) {
            console.error('[TEST_PAGE] Error starting test:', e);
            setError(String(e));
        } finally {
            console.log('[TEST_PAGE] startTest() complete, setLoading(false)');
            setLoading(false);
        }
    }

    function handleAutoSubmit() {
        submitTest(true);
    }

    async function submitTest(autoSubmit = false) {
        if (!token || !attemptId || submitting) return;
        if (!autoSubmit) {
            const unanswered = Object.values(answers).filter((v) => !v).length;
            if (unanswered > 0) {
                if (!window.confirm(`У вас ${unanswered} вопрос(ов) без ответа. Сдать тест?`)) {
                    return;
                }
            }
        }
        setSubmitting(true);
        setError(null);
        try {
            const arr = Object.entries(answers).map(([questionId, optionId]) => ({
                question_id: questionId,
                selected_option_id: optionId || null,
            }));
            const result = await apiSubjectSubmitAttempt(
                token,
                attemptId,
                arr,
                isSharedStudent && studentId && classId ? { student_id: studentId, class_id: classId } : undefined
            );
            setScore(result.score || 0);
            setTotalQuestions(result.total_questions || questions.length);
            setPercentage(result.percentage_score || 0);
            setSubmitted(true);
            if (timerRef.current) clearInterval(timerRef.current);
        } catch (e) {
            setError(String(e));
        } finally {
            setSubmitting(false);
        }
    }

    function formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }

    function handleAnswerChange(questionId: string, optionId: string) {
        setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    }

    function handleClose() {
        if (subjectId) {
            navigate(`/app/student/subjects/${subjectId}`);
        } else {
            navigate("/app/student/subjects");
        }
    }

    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== "student") return <Navigate to="/app" replace />;
    if (!testId) return <Navigate to="/app/student/subjects" replace />;

    // Экран загрузки (но не для shared student который еще не выбрал класс/ученика)
    const showLoadingScreen = loading && !(isSharedStudent && !attemptId && (!classId || !studentId));

    if (showLoadingScreen) {
        return (
            <div className={styles.fullscreenContainer}>
                <div className={styles.loadingScreen}>
                    <div className={styles.loadingSpinner} />
                    <div className={styles.loadingText}>Загрузка теста...</div>
                </div>
            </div>
        );
    }

    // Экран выбора ученика для shared student
    if (isSharedStudent && !attemptId) {
        const canStart = !!classId && !!studentId;
        return (
            <div className={styles.fullscreenContainer}>
                <div className={styles.selectScreen}>
                    <div className={styles.selectCard}>
                        <h1 className={styles.selectTitle}>Выберите себя</h1>
                        <p className={styles.selectSubtitle}>
                            Это нужно для записи результата в журнал
                        </p>

                        {error && <div className={styles.error}>{error}</div>}

                        <label className={styles.selectLabel}>Группа</label>
                        <select
                            className={styles.selectInput}
                            value={classId}
                            onChange={(e) => {
                                setClassId(e.target.value);
                                setStudentId("");
                            }}
                        >
                            <option value="">— выберите группу —</option>
                            {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>

                        <label className={styles.selectLabel}>Ученик</label>
                        <select
                            className={styles.selectInput}
                            value={studentId}
                            onChange={(e) => setStudentId(e.target.value)}
                            disabled={!classId}
                        >
                            <option value="">— выберите себя —</option>
                            {students.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.full_name || s.username}
                                </option>
                            ))}
                        </select>

                        <button
                            className={styles.startBtn}
                            onClick={startTest}
                            disabled={!canStart}
                        >
                            Начать тест
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Экран результатов
    if (submitted) {
        const passed = percentage >= 60;
        return (
            <div className={styles.fullscreenContainer}>
                <div className={styles.resultsScreen}>
                    <div className={styles.resultsCard}>
                        <h1 className={styles.resultsTitle}>
                            {passed ? "🎉 Тест пройден!" : "Тест завершён"}
                        </h1>

                        <div className={`${styles.scoreCircle} ${passed ? styles.passed : styles.failed}`}>
                            <div className={styles.scoreValue}>{Math.round(percentage)}%</div>
                            <div className={styles.scoreLabel}>Результат</div>
                        </div>

                        <div className={styles.resultDetails}>
                            <div className={styles.resultRow}>
                                <span className={styles.resultLabel}>Правильных ответов:</span>
                                <span className={styles.resultValue}>{score} из {totalQuestions}</span>
                            </div>
                            <div className={styles.resultRow}>
                                <span className={styles.resultLabel}>Процент:</span>
                                <span className={styles.resultValue}>{Math.round(percentage)}%</span>
                            </div>
                            <div className={styles.resultRow}>
                                <span className={styles.resultLabel}>Статус:</span>
                                <span className={styles.resultValue} style={{ color: passed ? '#10b981' : '#ef4444' }}>
                                    {passed ? "Зачёт" : "Не зачёт"}
                                </span>
                            </div>
                        </div>

                        <button className={styles.closeBtn} onClick={handleClose}>
                            Закрыть
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Экран теста
    const answeredCount = Object.values(answers).filter((v) => v).length;

    return (
        <div className={styles.fullscreenContainer}>
            <div className={styles.testContent}>
                {/* Шапка */}
                <div className={styles.testHeader}>
                    <h1 className={styles.testTitle}>Тестирование</h1>
                    {timeLeft !== null && (
                        <div className={`${styles.timerBox} ${timeLeft < 60 ? styles.warning : ''}`}>
                            <Clock size={24} />
                            {formatTime(timeLeft)}
                        </div>
                    )}
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {/* Вопросы */}
                <div className={styles.questionsContainer}>
                    {questions.map((q, idx) => (
                        <div key={q.id} className={styles.questionCard}>
                            <div className={styles.questionNumber}>Вопрос {idx + 1} из {questions.length}</div>
                            <p className={styles.questionText}>{q.question_text}</p>
                            <div className={styles.optionsList}>
                                {(q.options || []).map((opt) => (
                                    <div
                                        key={opt.id}
                                        className={`${styles.optionItem} ${answers[q.id] === opt.id ? styles.selected : ''}`}
                                        onClick={() => handleAnswerChange(q.id, opt.id)}
                                    >
                                        <div className={styles.optionRadio} />
                                        <span className={styles.optionText}>{opt.option_text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Футер с кнопкой сдачи */}
            <div className={styles.submitFooter}>
                <div className={styles.progressText}>
                    Отвечено: {answeredCount} из {questions.length}
                </div>
                <button
                    className={styles.submitBtn}
                    onClick={() => submitTest()}
                    disabled={submitting}
                >
                    {submitting ? "Отправка..." : "Сдать тест"}
                </button>
            </div>
        </div>
    );
}
