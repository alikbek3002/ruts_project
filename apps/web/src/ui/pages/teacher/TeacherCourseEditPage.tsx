import React, { useEffect, useState } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Edit, Trash2, FileText, Clock, Save, X, Check, CheckCircle, Circle, Download, Upload, Link as LinkIcon } from "lucide-react";
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
  apiUpdateTest,
  apiDeleteTest,
  apiCreateQuestion,
  apiListQuestions,
  apiDeleteQuestion,
  apiCreateOption,
  apiUpdateOption,
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
  const [editingTest, setEditingTest] = useState<CourseTest | null>(null);
  const [topicFile, setTopicFile] = useState<File | null>(null);
  const [topicLinks, setTopicLinks] = useState<{ title: string; url: string }[]>([]);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newQuestionOptions, setNewQuestionOptions] = useState<{ text: string; isCorrect: boolean }[]>([
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
  ]);

  useEffect(() => {
    if (token && courseId) loadCourse();
  }, [token, courseId]);

  function handleError(e: any) {
    const msg = String(e);
    if (msg.includes("Неверный токен") || msg.includes("401")) {
      alert("Сессия истекла. Пожалуйста, войдите снова.");
      window.location.href = "/login";
    } else {
      alert(`Ошибка: ${msg}`);
    }
  }

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
      handleError(e);
    }
  }

  async function handleCreateTopic() {
    if (!token || !courseId) return;
    try {
      if (editingTopic) {
        await apiUpdateTopic(
          token,
          editingTopic.id,
          {
            title: topicTitle,
            description: topicDescription || null,
            links: topicLinks,
            presentation: topicFile,
          }
        );
      } else {
        await apiCreateTopic(
          token, 
          courseId, 
          {
            title: topicTitle,
            description: topicDescription || null,
            order_index: course?.topics?.length || 0,
            links: topicLinks,
          },
          topicFile
        );
      }
      setShowTopicModal(false);
      setEditingTopic(null);
      setTopicTitle("");
      setTopicDescription("");
      setTopicFile(null);
      setTopicLinks([]);
      await loadCourse();
    } catch (e) {
      handleError(e);
    }
  }

  function openEditTopicModal(topic: CourseTopic) {
    setEditingTopic(topic);
    setTopicTitle(topic.title);
    setTopicDescription(topic.description || "");
    setTopicLinks(topic.links || []);
    setTopicFile(null);
    setShowTopicModal(true);
  }

  async function handleDeleteTopic(topicId: string) {
    if (!token || !window.confirm("Удалить тему? Все тесты в ней также будут удалены.")) return;
    try {
      await apiDeleteTopic(token, topicId);
      await loadCourse();
    } catch (e) {
      handleError(e);
    }
  }
  async function handleSaveTest() {
    if (!token) return;
    
    try {
      if (editingTest) {
        await apiUpdateTest(token, editingTest.id, {
          title: testTitle,
          description: testDescription || null,
          time_limit_minutes: testType === "quiz" ? testTimeLimit : undefined,
        });
      } else {
        if (!selectedTopicId) return;
        if (testType === "quiz") {
          const res = await apiCreateQuizTest(token, {
            topic_id: selectedTopicId,
            title: testTitle,
            description: testDescription || null,
            time_limit_minutes: testTimeLimit,
          });
          
          // Auto-open questions modal for the new test
          setShowTestModal(false);
          setEditingTest(null);
          setTestTitle("");
          setTestDescription("");
          setTestTimeLimit(30);
          // Don't clear selectedTopicId yet if we might need it, but here we switch context
          setSelectedTopicId(null); 
          
          await loadCourse();
          
          setSelectedTestId(res.test.id);
          setQuestions([]);
          setShowQuestionModal(true);
          return; // Exit early to avoid double state updates
        } else {
          await apiCreateDocumentTest(token, selectedTopicId, {
            title: testTitle,
            description: testDescription || null,
          });
        }
      }
      
      setShowTestModal(false);
      setEditingTest(null);
      setTestTitle("");
      setTestDescription("");
      setTestTimeLimit(30);
      setSelectedTopicId(null);
      await loadCourse();
    } catch (e) {
      handleError(e);
    }
  }

  function openEditTestModal(test: CourseTest) {
    setEditingTest(test);
    setTestTitle(test.title);
    setTestDescription(test.description || "");
    setTestType(test.test_type as "quiz" | "document");
    setTestTimeLimit(test.time_limit_minutes || 30);
    setShowTestModal(true);
  }

  async function handleDeleteTest(testId: string) {
    if (!token || !window.confirm("Удалить тест?")) return;
    try {
      await apiDeleteTest(token, testId);
      await loadCourse();
    } catch (e) {
      handleError(e);
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
      const res = await apiCreateQuestion(token, selectedTestId, { question_text: questionText });
      
      // Create options if any
      if (newQuestionOptions.length > 0) {
        for (const opt of newQuestionOptions) {
          if (opt.text.trim()) {
            await apiCreateOption(token, res.question.id, {
              option_text: opt.text,
              is_correct: opt.isCorrect,
              order_index: 0,
            });
          }
        }
      }

      setQuestionText("");
      setNewQuestionOptions([
        { text: "", isCorrect: false },
        { text: "", isCorrect: false },
      ]);
      await loadQuestions(selectedTestId);
    } catch (e) {
      handleError(e);
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!token || !window.confirm("Удалить вопрос?")) return;
    try {
      await apiDeleteQuestion(token, questionId);
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      handleError(e);
    }
  }
  async function handleAddOption(questionId: string, optionText: string) {
    if (!token) return;
    try {
      await apiCreateOption(token, questionId, {
        option_text: optionText,
        is_correct: false, // Default to false
        order_index: 0,
      });
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      handleError(e);
    }
  }

  async function handleUpdateOption(optionId: string, isCorrect: boolean) {
    if (!token) return;
    try {
      await apiUpdateOption(token, optionId, { is_correct: isCorrect });
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      handleError(e);
    }
  }

  async function handleDeleteOption(optionId: string) {
    if (!token) return;
    try {
      await apiDeleteOption(token, optionId);
      if (selectedTestId) await loadQuestions(selectedTestId);
    } catch (e) {
      handleError(e);
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
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/workload", label: "Часы работы" },
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
                    <div className={styles.topicActions}>
                      <button
                        onClick={() => openEditTopicModal(topic)}
                        className={styles.editButton}
                        title="Редактировать тему"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteTopic(topic.id)}
                        className={styles.deleteButton}
                        title="Удалить тему"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {topic.description && <p className={styles.topicDescription}>{topic.description}</p>}
                  
                  {topic.presentation_storage_path && (
                    <div className={styles.presentationBlock}>
                      <div className={styles.presentationInfo}>
                        <FileText size={20} className={styles.presentationIcon} />
                        <span className={styles.presentationName}>
                          {topic.presentation_original_filename || "Презентация"}
                        </span>
                      </div>
                      <a 
                        href={`${import.meta.env.VITE_API_URL || ""}/api/courses/topics/${topic.id}/presentation/download`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className={styles.downloadButton}
                      >
                        <Download size={16} />
                        Скачать
                      </a>
                    </div>
                  )}

                  {topic.links && topic.links.length > 0 && (
                    <div className={styles.topicLinksList}>
                      {topic.links.map((link, i) => (
                        <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className={styles.topicLinkItem}>
                          <LinkIcon size={16} />
                          {link.title}
                        </a>
                      ))}
                    </div>
                  )}

                  <div className={styles.topicToolbar}>
                     <button onClick={() => openEditTopicModal(topic)} className={styles.toolbarButton}>
                        <Upload size={16} />
                        Презентация
                     </button>
                     <button onClick={() => openEditTopicModal(topic)} className={styles.toolbarButton}>
                        <FileText size={16} />
                        Описание
                     </button>
                     <button onClick={() => openEditTopicModal(topic)} className={styles.toolbarButton}>
                        <LinkIcon size={16} />
                        Ссылки
                     </button>
                     <button
                        onClick={() => {
                          setSelectedTopicId(topic.id);
                          setShowTestModal(true);
                        }}
                        className={styles.toolbarButton}
                      >
                        <Plus size={16} />
                        Тест
                      </button>
                  </div>

                  <div className={styles.testsSection}>
                    <div className={styles.testsHeader}>
                      <h4>Тесты</h4>
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
                                <button
                                  onClick={() => openEditTestModal(test)}
                                  className={styles.editButton}
                                  title="Редактировать тест"
                                >
                                  <Edit size={16} />
                                </button>
                                {test.test_type === "quiz" && (
                                  <button
                                    onClick={() => {
                                      setSelectedTestId(test.id);
                                      loadQuestions(test.id);
                                      setShowQuestionModal(true);
                                    }}
                                    className={styles.manageButton}
                                  >
                                    Вопросы
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
                <h3>{editingTopic ? "Редактировать тему" : "Добавить тему"}</h3>
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
                <div className={styles.formGroup}>
                  <label>Презентация (необязательно)</label>
                  <div className={styles.fileInputWrapper}>
                    <input
                      type="file"
                      onChange={(e) => setTopicFile(e.target.files?.[0] || null)}
                      accept=".pdf,.ppt,.pptx"
                      id="topic-presentation-upload"
                      className={styles.hiddenInput}
                    />
                    <label htmlFor="topic-presentation-upload" className={styles.fileInputLabel}>
                      <Upload size={20} />
                      {topicFile ? topicFile.name : "Выберите файл (PDF, PPTX)"}
                    </label>
                    {topicFile && (
                      <button 
                        onClick={() => setTopicFile(null)} 
                        className={styles.clearFileButton}
                        title="Удалить файл"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className={styles.linksSection}>
                  <label>Ссылки (необязательно)</label>
                  {topicLinks.map((link, index) => (
                    <div key={index} className={styles.linkItem}>
                      <input
                        type="text"
                        value={link.title}
                        onChange={(e) => {
                          const newLinks = [...topicLinks];
                          newLinks[index].title = e.target.value;
                          setTopicLinks(newLinks);
                        }}
                        placeholder="Название ссылки"
                        className={styles.linkTitleInput}
                      />
                      <input
                        type="url"
                        value={link.url}
                        onChange={(e) => {
                          const newLinks = [...topicLinks];
                          newLinks[index].url = e.target.value;
                          setTopicLinks(newLinks);
                        }}
                        placeholder="URL ссылки"
                        className={styles.linkUrlInput}
                      />
                      <button
                        onClick={() => {
                          const newLinks = topicLinks.filter((_, i) => i !== index);
                          setTopicLinks(newLinks);
                        }}
                        className={styles.removeLinkButton}
                        title="Удалить ссылку"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <div className={styles.addLinkForm}>
                    <input
                      type="text"
                      value={newLinkTitle}
                      onChange={(e) => setNewLinkTitle(e.target.value)}
                      placeholder="Название новой ссылки"
                      className={styles.newLinkTitleInput}
                    />
                    <input
                      type="url"
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      placeholder="URL новой ссылки"
                      className={styles.newLinkUrlInput}
                    />
                    <button
                      onClick={() => {
                        if (newLinkTitle.trim() && newLinkUrl.trim()) {
                          setTopicLinks([...topicLinks, { title: newLinkTitle, url: newLinkUrl }]);
                          setNewLinkTitle("");
                          setNewLinkUrl("");
                        }
                      }}
                      className={styles.addLinkButton}
                    >
                      <Plus size={16} />
                      Добавить ссылку
                    </button>
                  </div>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button onClick={() => setShowTopicModal(false)} className={styles.cancelButton}>
                  Отмена
                </button>
                <button onClick={handleCreateTopic} className={styles.saveButton} disabled={!topicTitle.trim()}>
                  {editingTopic ? "Сохранить" : "Создать"}
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
                <h3>{editingTest ? "Редактировать тест" : "Добавить тест"}</h3>
                <button onClick={() => setShowTestModal(false)} className={styles.closeButton}>
                  <X size={20} />
                </button>
              </div>
              <div className={styles.modalContent}>
                {!editingTest && (
                  <div className={styles.formGroup}>
                    <label>Тип теста</label>
                    <div className={styles.typeSelector}>
                      <button
                        className={`${styles.typeButton} ${testType === "quiz" ? styles.active : ""}`}
                        onClick={() => setTestType("quiz")}
                      >
                        <Clock size={16} />
                        Тест (вопросы)
                      </button>
                      <button
                        className={`${styles.typeButton} ${testType === "document" ? styles.active : ""}`}
                        onClick={() => setTestType("document")}
                      >
                        <FileText size={16} />
                        Документ (ДЗ)
                      </button>
                    </div>
                  </div>
                )}
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
                <button onClick={handleSaveTest} className={styles.saveButton} disabled={!testTitle.trim()}>
                  {editingTest ? "Сохранить" : "Создать"}
                </button>
              </div>
            </div>
          </div>
        )}        {/* Question Modal */}
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
                  <div className={styles.newQuestionContainer}>
                    <input
                      type="text"
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                      placeholder="Текст вопроса"
                      className={styles.questionInput}
                    />
                    
                    <div className={styles.newOptionsList}>
                      {newQuestionOptions.map((opt, idx) => (
                        <div key={idx} className={styles.newOptionItem}>
                          <button 
                            className={`${styles.optionActionButton} ${opt.isCorrect ? styles.correct : styles.incorrect}`}
                            onClick={() => {
                                const newOpts = [...newQuestionOptions];
                                newOpts[idx].isCorrect = !newOpts[idx].isCorrect;
                                setNewQuestionOptions(newOpts);
                            }}
                            title={opt.isCorrect ? "Правильный ответ" : "Пометить как правильный"}
                          >
                            {opt.isCorrect ? <CheckCircle size={18} /> : <Circle size={18} />}
                          </button>
                          <input 
                            value={opt.text}
                            onChange={(e) => {
                                const newOpts = [...newQuestionOptions];
                                newOpts[idx].text = e.target.value;
                                setNewQuestionOptions(newOpts);
                            }}
                            placeholder={`Вариант ${idx + 1}`}
                            className={styles.optionInput}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (idx === newQuestionOptions.length - 1) {
                                  setNewQuestionOptions([...newQuestionOptions, { text: "", isCorrect: false }]);
                                }
                              }
                            }}
                          />
                          <button 
                            onClick={() => {
                                const newOpts = newQuestionOptions.filter((_, i) => i !== idx);
                                setNewQuestionOptions(newOpts);
                            }}
                            className={styles.optionDeleteButton}
                            title="Удалить вариант"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                      <button 
                        className={styles.addOptionButtonText}
                        onClick={() => setNewQuestionOptions([...newQuestionOptions, { text: "", isCorrect: false }])}
                      >
                        <Plus size={14} /> Добавить вариант
                      </button>
                    </div>

                    <button
                      onClick={handleCreateQuestion}
                      className={styles.addQuestionButton}
                      disabled={!questionText.trim()}
                    >
                      <Plus size={16} />
                      Сохранить вопрос
                    </button>
                  </div>
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
                            <div className={styles.optionText}>
                              {option.option_text}
                            </div>
                            <div className={styles.optionActions}>
                              <button
                                onClick={() => handleUpdateOption(option.id, !option.is_correct)}
                                className={`${styles.optionActionButton} ${option.is_correct ? styles.correct : styles.incorrect}`}
                                title={option.is_correct ? "Правильный ответ" : "Пометить как правильный"}
                              >
                                {option.is_correct ? <CheckCircle size={18} /> : <Circle size={18} />}
                              </button>
                              <button
                                onClick={() => handleDeleteOption(option.id)}
                                className={styles.optionDeleteButton}
                                title="Удалить вариант"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <form
                          className={styles.addOptionForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const input = form.elements.namedItem("optionText") as HTMLInputElement;
                            if (input.value.trim()) {
                              handleAddOption(question.id, input.value.trim());
                              input.value = "";
                            }
                          }}
                        >
                          <input
                            name="optionText"
                            type="text"
                            placeholder="Добавить вариант ответа..."
                            className={styles.optionInput}
                          />
                          <button type="submit" className={styles.addOptionButton} title="Добавить вариант">
                            <Plus size={16} />
                          </button>
                        </form>
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

