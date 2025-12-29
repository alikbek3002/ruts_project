import React, { useEffect, useState } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Edit, Trash2, FileText, Clock, Save, X } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { AppShell } from "../../layout/AppShell";
import { Loader } from "../../components/Loader";
import {
  apiGetCourse,
  apiUpdateCourse,
  apiCreateTopic,
  apiUpdateTopic,
  apiDeleteTopic,
  apiCreateQuizTest,
  apiCreateDocumentTest,
  apiDeleteTest,
  apiCreateQuestion,
  apiListQuestions,
  apiDeleteQuestion,
  apiCreateOption,
  apiDeleteOption,
  type Course,
  type CourseTopic,
  type CourseTest,
  type TestQuestion,
} from "../../../api/client";
import styles from "./TeacherCourseEdit.module.css";

export function TeacherCourseEditPage() {
  const { state } = useAuth();
  const user = state.user;
  const token = state.accessToken;
  const { courseId } = useParams<{ courseId: string }>();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [editingTopic, setEditingTopic] = useState<CourseTopic | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [showTestModal, setShowTestModal] = useState(false);
  const [testType, setTestType] = useState<"quiz" | "document">("quiz");
  const [testTitle, setTestTitle] = useState("");
  const [testDescription, setTestDescription] = useState("");
  const [testTimeLimit, setTestTimeLimit] = useState(30);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [editingQuestion, setEditingQuestion] = useState<TestQuestion | null>(null);

  useEffect(() => {
    if (token && courseId) loadCourse();
  }, [token, courseId]);

  async function loadCourse() {
    if (!token || !courseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetCourse(token, courseId);
      setCourse(res.course);
      setNewTitle(res.course.title);
      setNewDescription(res.course.description || "");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCourse() {
    if (!token || !courseId) return;
    try {
      await apiUpdateCourse(token, courseId, { title: newTitle, description: newDescription });
      setEditingTitle(false);
      await loadCourse();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleCreateTopic() {
    if (!token || !courseId) return;
    try {
      await apiCreateTopic(token, courseId, {
        title: topicTitle,
        description: topicDescription || null,
        order_index: course?.topics?.length || 0,
      });
      setShowTopicModal(false);
      setTopicTitle("");
      setTopicDescription("");
      await loadCourse();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleDeleteTopic(topicId: string) {
    if (!token || !window.confirm("Удалить тему? Все тесты в ней также будут удалены.")) return;
    try {
      await apiDeleteTopic(token, topicId);
      await loadCourse();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleCreateTest() {
    if (!token || !selectedTopicId) return;
    try {
      if (testType === "quiz") {
        await apiCreateQuizTest(token, {
          topic_id: selectedTopicId,
          title: testTitle,
          description: testDescription || null,
          time_limit_minutes: testTimeLimit,
        });
      } else {
        await apiCreateDocumentTest(token, selectedTopicId, {
          title: testTitle,
          description: testDescription || null,
        });
      }
      setShowTestModal(false);
      setTestTitle("");
      setTestDescription("");
      setTestTimeLimit(30);
      setSelectedTopicId(null);
      await loadCourse();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleDeleteTest(testId: string) {
    if (!token || !window.confirm("Удалить тест?")) return;
    try {
      await apiDeleteTest(token, testId);
      await loadCourse();
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function loadQuestions(testId: string) {
    if (!token) return;
    try {
      const res = await apiListQuestions(token, testId);
      setQuestions(res.questions);
    } catch (e) {
      console.error("Failed to load questions", e);
    }
  }

  async function handleCreateQuestion() {
    if (!token || !selectedTestId) return;
    try {
      await apiCreateQuestion(token, selectedTestId, { question_text: questionText });
      setShowQuestionModal(false);
      setQuestionText("");
      await loadQuestions(selectedTestId);
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!token || !window.confirm("Удалить вопрос?")) return;
    try {
      await apiDeleteQuestion(token, questionId);
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  async function handleAddOption(questionId: string, optionText: string, isCorrect: boolean) {
    if (!token) return;
    try {
      await apiCreateOption(token, questionId, {
        option_text: optionText,
        is_correct: isCorrect,
        order_index: 0,
      });
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      alert(`Ошибка: ${String(e)}`);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "teacher") return <Navigate to="/app" replace />;
  if (!courseId) return <Navigate to="/app/teacher/courses" replace />;

  if (loading) {
    return (
      <AppShell title="Редактирование курса" nav={[]}>
        <Loader text="Загрузка курса..." />
      </AppShell>
    );
  }

  if (!course) {
    return (
      <AppShell title="Редактирование курса" nav={[]}>
        <div className={styles.error}>Курс не найден</div>
      </AppShell>
    );
  }

  // Check ownership
  if (course.teacher_id !== user.id) {
    return (
      <AppShell title="Редактирование курса" nav={[]}>
        <div className={styles.error}>У вас нет доступа к редактированию этого курса</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Редактирование курса"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/courses", label: "Курсы" },
      ]}
    >
      <div className={styles.container}>
        <Link to="/app/teacher/courses" className={styles.backLink}>
          <ArrowLeft size={20} />
          Назад к курсам
        </Link>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.courseHeader}>
          {editingTitle ? (
            <div className={styles.editForm}>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className={styles.titleInput}
                placeholder="Название курса"
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className={styles.descriptionInput}
                placeholder="Описание курса"
                rows={3}
              />
              <div className={styles.editActions}>
                <button onClick={handleSaveCourse} className={styles.saveButton}>
                  <Save size={16} />
                  Сохранить
                </button>
                <button onClick={() => setEditingTitle(false)} className={styles.cancelButton}>
                  <X size={16} />
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h1>{course.title}</h1>
              {course.description && <p className={styles.description}>{course.description}</p>}
              <button onClick={() => setEditingTitle(true)} className={styles.editButton}>
                <Edit size={16} />
                Редактировать
              </button>
            </div>
          )}
        </div>

        <div className={styles.topicsSection}>
          <div className={styles.sectionHeader}>
            <h2>Темы курса</h2>
            <button onClick={() => setShowTopicModal(true)} className={styles.addButton}>
              <Plus size={20} />
              Добавить тему
            </button>
          </div>

          {course.topics && course.topics.length > 0 ? (
            <div className={styles.topicsList}>
              {course.topics.map((topic) => (
                <div key={topic.id} className={styles.topicCard}>
                  <div className={styles.topicHeader}>
                    <h3>{topic.title}</h3>
                    <button
                      onClick={() => handleDeleteTopic(topic.id)}
                      className={styles.deleteButton}
                      title="Удалить тему"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {topic.description && <p className={styles.topicDescription}>{topic.description}</p>}

                  <div className={styles.testsSection}>
                    <div className={styles.testsHeader}>
                      <h4>Тесты</h4>
                      <button
                        onClick={() => {
                          setSelectedTopicId(topic.id);
                          setShowTestModal(true);
                        }}
                        className={styles.addTestButton}
                      >
                        <Plus size={16} />
                        Добавить тест
                      </button>
                    </div>

                    {topic.tests && topic.tests.length > 0 ? (
                      <div className={styles.testsList}>
                        {topic.tests.map((test) => (
                          <div key={test.id} className={styles.testCard}>
                            <div className={styles.testHeader}>
                              <div>
                                <h5>
                                  {test.title}
                                  {test.test_type === "quiz" && (
                                    <span className={styles.testBadge}>
                                      <Clock size={12} />
                                      {test.time_limit_minutes} мин
                                    </span>
                                  )}
                                  {test.test_type === "document" && (
                                    <span className={styles.testBadge}>
                                      <FileText size={12} />
                                      Документ
                                    </span>
                                  )}
                                </h5>
                                {test.description && <p className={styles.testDescription}>{test.description}</p>}
                              </div>
                              <div className={styles.testActions}>
                                {test.test_type === "quiz" && (
                                  <button
                                    onClick={() => {
                                      setSelectedTestId(test.id);
                                      loadQuestions(test.id);
                                      setShowQuestionModal(true);
                                    }}
                                    className={styles.manageButton}
                                  >
                                    Управление вопросами
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteTest(test.id)}
                                  className={styles.deleteButton}
                                  title="Удалить тест"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.emptyText}>Нет тестов</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyText}>Пока нет тем</p>
          )}
        </div>

        {/* Topic Modal */}
        {showTopicModal && (
          <div className={styles.modalOverlay} onClick={() => setShowTopicModal(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Добавить тему</h3>
                <button onClick={() => setShowTopicModal(false)} className={styles.closeButton}>
                  <X size={20} />
                </button>
              </div>
              <div className={styles.modalContent}>
                <div className={styles.formGroup}>
                  <label>Название темы</label>
                  <input
                    type="text"
                    value={topicTitle}
                    onChange={(e) => setTopicTitle(e.target.value)}
                    placeholder="Название темы"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Описание (необязательно)</label>
                  <textarea
                    value={topicDescription}
                    onChange={(e) => setTopicDescription(e.target.value)}
                    placeholder="Описание темы"
                    rows={3}
                  />
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button onClick={() => setShowTopicModal(false)} className={styles.cancelButton}>
                  Отмена
                </button>
                <button onClick={handleCreateTopic} className={styles.saveButton} disabled={!topicTitle.trim()}>
                  Создать
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Test Modal */}
        {showTestModal && (
          <div className={styles.modalOverlay} onClick={() => setShowTestModal(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Добавить тест</h3>
                <button onClick={() => setShowTestModal(false)} className={styles.closeButton}>
                  <X size={20} />
                </button>
              </div>
              <div className={styles.modalContent}>
                <div className={styles.formGroup}>
                  <label>Тип теста</label>
                  <select value={testType} onChange={(e) => setTestType(e.target.value as "quiz" | "document")}>
                    <option value="quiz">Тест с вопросами</option>
                    <option value="document">Документ/Домашнее задание</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Название теста</label>
                  <input
                    type="text"
                    value={testTitle}
                    onChange={(e) => setTestTitle(e.target.value)}
                    placeholder="Название теста"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Описание (необязательно)</label>
                  <textarea
                    value={testDescription}
                    onChange={(e) => setTestDescription(e.target.value)}
                    placeholder="Описание теста"
                    rows={3}
                  />
                </div>
                {testType === "quiz" && (
                  <div className={styles.formGroup}>
                    <label>Время на прохождение (минуты)</label>
                    <input
                      type="number"
                      value={testTimeLimit}
                      onChange={(e) => setTestTimeLimit(parseInt(e.target.value) || 30)}
                      min={1}
                    />
                  </div>
                )}
              </div>
              <div className={styles.modalFooter}>
                <button onClick={() => setShowTestModal(false)} className={styles.cancelButton}>
                  Отмена
                </button>
                <button onClick={handleCreateTest} className={styles.saveButton} disabled={!testTitle.trim()}>
                  Создать
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Question Modal */}
        {showQuestionModal && selectedTestId && (
          <div className={styles.modalOverlay} onClick={() => setShowQuestionModal(false)}>
            <div className={styles.modalLarge} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Управление вопросами</h3>
                <button onClick={() => setShowQuestionModal(false)} className={styles.closeButton}>
                  <X size={20} />
                </button>
              </div>
              <div className={styles.modalContent}>
                <div className={styles.addQuestionForm}>
                  <input
                    type="text"
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                    placeholder="Текст вопроса"
                    className={styles.questionInput}
                  />
                  <button
                    onClick={handleCreateQuestion}
                    className={styles.addQuestionButton}
                    disabled={!questionText.trim()}
                  >
                    <Plus size={16} />
                    Добавить вопрос
                  </button>
                </div>

                <div className={styles.questionsList}>
                  {questions.map((question) => (
                    <div key={question.id} className={styles.questionCard}>
                      <div className={styles.questionHeader}>
                        <h5>{question.question_text}</h5>
                        <button
                          onClick={() => handleDeleteQuestion(question.id)}
                          className={styles.deleteButton}
                          title="Удалить вопрос"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className={styles.optionsList}>
                        {question.options?.map((option) => (
                          <div key={option.id} className={styles.optionItem}>
                            <span className={option.is_correct ? styles.correctOption : ""}>
                              {option.option_text}
                              {option.is_correct && " ✓"}
                            </span>
                          </div>
                        ))}
                        <div className={styles.addOptionForm}>
                          <input
                            type="text"
                            placeholder="Вариант ответа"
                            className={styles.optionInput}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                                const text = e.currentTarget.value;
                                const isCorrect = window.confirm("Это правильный ответ?");
                                handleAddOption(question.id, text, isCorrect);
                                e.currentTarget.value = "";
                              }
                            }}
                          />
                          <small>Нажмите Enter для добавления</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

