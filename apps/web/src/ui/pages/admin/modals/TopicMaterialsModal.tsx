import React, { useState, useEffect } from "react";
import {
    X,
    Plus,
    Trash2,
    FileText,
    Paperclip,
    FlaskConical,
    Link as LinkIcon,
    Check,
    ChevronLeft
} from "lucide-react";
import styles from "../AdminSubjects.module.css";
import { Loader } from "../../../components/Loader";
import {
    type SubjectTopic,
    type SubjectContentMaterial,
    type SubjectContentTest,
    type SubjectTestQuestion,
    apiSubjectContentUploadFile,
    apiSubjectContentCreateLink,
    apiSubjectContentDeleteMaterial,
    apiSubjectContentCreateQuiz,
    apiSubjectContentCreateDocumentTest,
    apiSubjectContentDeleteTest,
    apiSubjectContentCreateQuestion,
    apiSubjectContentCreateOption,
    apiSubjectContentDeleteQuestion,
    apiSubjectListQuestions,
} from "../../../../api/client";

type ExtendedSubjectTopic = SubjectTopic & {
    materials?: SubjectContentMaterial[];
    tests?: SubjectContentTest[];
};

type Props = {
    topic: ExtendedSubjectTopic;
    token: string;
    onClose: () => void;
};

export const TopicMaterialsModal: React.FC<Props> = ({ topic, token, onClose }) => {
    const [activeTab, setActiveTab] = useState<"files" | "tests">("files");

    // State
    const [materials, setMaterials] = useState<SubjectContentMaterial[]>(topic.materials || []);
    const [tests, setTests] = useState<SubjectContentTest[]>(topic.tests || []);

    // -- Files --
    const [newMaterialType, setNewMaterialType] = useState<"file" | "link">("file");
    const [newMaterialFile, setNewMaterialFile] = useState<File | null>(null);
    const [newMaterialTitle, setNewMaterialTitle] = useState("");
    const [newMaterialUrl, setNewMaterialUrl] = useState("");
    const [loadingFile, setLoadingFile] = useState(false);

    // -- Tests --
    const [isCreatingTest, setIsCreatingTest] = useState(false);
    const [newTestTitle, setNewTestTitle] = useState("");
    const [newTestType, setNewTestType] = useState<"quiz" | "document">("quiz");
    const [newTestFile, setNewTestFile] = useState<File | null>(null);
    const [loadingTest, setLoadingTest] = useState(false);

    // -- Quiz Editor --
    const [editingTestId, setEditingTestId] = useState<string | null>(null);
    const [editingTestTitle, setEditingTestTitle] = useState("");
    const [questions, setQuestions] = useState<SubjectTestQuestion[]>([]);
    const [loadingQuiz, setLoadingQuiz] = useState(false);

    // New Question
    const [newQText, setNewQText] = useState("");
    const [newQOptions, setNewQOptions] = useState<{ id: string; text: string }[]>([
        { id: "opt-1", text: "" },
        { id: "opt-2", text: "" },
    ]);
    const [correctOptionIdx, setCorrectOptionIdx] = useState<number>(0);
    const [savingQuestion, setSavingQuestion] = useState(false);

    useEffect(() => {
        setMaterials(topic.materials || []);
        setTests(topic.tests || []);
    }, [topic]);

    // --- Handlers: Files ---
    const handleAddMaterial = async () => {
        setLoadingFile(true);
        try {
            if (newMaterialType === "file") {
                if (!newMaterialFile) return;
                const res = await apiSubjectContentUploadFile(token, topic.id, newMaterialFile, newMaterialTitle || undefined);
                setMaterials([...materials, res.material]);
            } else {
                if (!newMaterialUrl || !newMaterialTitle) return;
                const res = await apiSubjectContentCreateLink(token, topic.id, newMaterialTitle, newMaterialUrl);
                setMaterials([...materials, res.material]);
            }
            setNewMaterialFile(null);
            setNewMaterialTitle("");
            setNewMaterialUrl("");
        } catch (e) {
            alert(String(e));
        } finally {
            setLoadingFile(false);
        }
    };

    const handleDeleteMaterial = async (id: string) => {
        if (!window.confirm("Удалить материал?")) return;
        try {
            await apiSubjectContentDeleteMaterial(token, id);
            setMaterials(materials.filter((m) => m.id !== id));
        } catch (e) {
            alert(String(e));
        }
    };

    // --- Handlers: Tests ---
    const handleCreateTest = async () => {
        if (!newTestTitle.trim()) return;
        setLoadingTest(true);
        try {
            if (newTestType === "quiz") {
                const res = await apiSubjectContentCreateQuiz(token, topic.id, newTestTitle, 30);
                setTests([...tests, res.test]);
                if (res.test.id) {
                    openQuizEditor(res.test.id, res.test.title);
                }
            } else {
                if (!newTestFile) {
                    alert("Выберите файл");
                    return;
                }
                const res = await apiSubjectContentCreateDocumentTest(token, topic.id, newTestTitle, newTestFile);
                setTests([...tests, res.test]);
            }
            setIsCreatingTest(false);
            setNewTestTitle("");
            setNewTestFile(null);
        } catch (e) {
            alert(String(e));
        } finally {
            setLoadingTest(false);
        }
    };

    const handleDeleteTest = async (id: string) => {
        if (!window.confirm("Удалить тест?")) return;
        try {
            await apiSubjectContentDeleteTest(token, id);
            setTests(tests.filter((t) => t.id !== id));
            if (editingTestId === id) setEditingTestId(null);
        } catch (e) {
            alert(String(e));
        }
    };

    // --- Handlers: Quiz Editor ---
    const openQuizEditor = async (testId: string, title: string) => {
        setEditingTestId(testId);
        setEditingTestTitle(title);
        setLoadingQuiz(true);
        resetQuestionForm();
        try {
            const res = await apiSubjectListQuestions(token, testId);
            setQuestions(res.questions || []);
        } catch (e) {
            alert(String(e));
        } finally {
            setLoadingQuiz(false);
        }
    };

    const closeQuizEditor = () => {
        setEditingTestId(null);
        setEditingTestTitle("");
        setQuestions([]);
        resetQuestionForm();
    };

    const resetQuestionForm = () => {
        setNewQText("");
        setNewQOptions([
            { id: "opt-" + Date.now() + "-1", text: "" },
            { id: "opt-" + Date.now() + "-2", text: "" },
        ]);
        setCorrectOptionIdx(0);
    };

    const handleAddQuestion = async () => {
        if (!newQText.trim()) {
            alert("Введите текст вопроса");
            return;
        }
        const validOptions = newQOptions.filter((o) => o.text.trim());
        if (validOptions.length < 2) {
            alert("Минимум 2 варианта ответа");
            return;
        }
        const actualCorrectIdx = Math.min(correctOptionIdx, validOptions.length - 1);

        setSavingQuestion(true);
        try {
            const order = questions.length;
            const qRes = await apiSubjectContentCreateQuestion(token, editingTestId!, newQText.trim(), order);
            const qId = qRes.question.id;

            for (let i = 0; i < validOptions.length; i++) {
                const isCorrect = i === actualCorrectIdx;
                await apiSubjectContentCreateOption(token, qId, validOptions[i].text.trim(), isCorrect, i);
            }

            const res = await apiSubjectListQuestions(token, editingTestId!);
            setQuestions(res.questions || []);
            resetQuestionForm();
        } catch (e) {
            alert(String(e));
        } finally {
            setSavingQuestion(false);
        }
    };

    const handleDeleteQuestion = async (qId: string) => {
        if (!window.confirm("Удалить вопрос?")) return;
        setLoadingQuiz(true);
        try {
            await apiSubjectContentDeleteQuestion(token, qId);
            setQuestions(questions.filter((q) => q.id !== qId));
        } catch (e) {
            alert(String(e));
        } finally {
            setLoadingQuiz(false);
        }
    };

    const addOptionField = () => {
        setNewQOptions([...newQOptions, { id: "opt-" + Date.now(), text: "" }]);
    };

    const removeOptionField = (idx: number) => {
        if (newQOptions.length <= 2) return;
        const next = newQOptions.filter((_, i) => i !== idx);
        setNewQOptions(next);
        if (correctOptionIdx >= next.length) {
            setCorrectOptionIdx(0);
        }
    };

    const updateOptionText = (idx: number, text: string) => {
        const next = [...newQOptions];
        next[idx] = { ...next[idx], text };
        setNewQOptions(next);
    };

    // --- Render: Quiz Editor ---
    if (editingTestId) {
        return (
            <div className={styles.modalBackdrop} onClick={onClose}>
                <div className={styles.quizEditorModal} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.quizEditorHeader}>
                        <div className={styles.quizEditorTitle}>
                            <button className={styles.backBtn} onClick={closeQuizEditor} title="Назад">
                                <ChevronLeft size={20} />
                            </button>
                            <div>
                                <h2>Редактор вопросов</h2>
                                <span className={styles.quizTestName}>{editingTestTitle}</span>
                            </div>
                        </div>
                        <button className={styles.closeBtn} onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className={styles.quizEditorBody}>
                        <div className={styles.quizEditorLeft}>
                            <h3>Вопросы ({questions.length})</h3>
                            {loadingQuiz && <Loader />}
                            {!loadingQuiz && questions.length === 0 && (
                                <div className={styles.emptyState}>
                                    <FlaskConical size={48} strokeWidth={1} />
                                    <p>Нет вопросов</p>
                                    <span>Добавьте первый вопрос справа</span>
                                </div>
                            )}
                            <div className={styles.questionsList}>
                                {questions.map((q, idx) => (
                                    <div key={q.id} className={styles.questionItem}>
                                        <div className={styles.questionContent}>
                                            <div className={styles.questionNumber}>{idx + 1}</div>
                                            <div className={styles.questionText}>{q.question_text}</div>
                                        </div>
                                        <div className={styles.questionOptions}>
                                            {q.options?.map((opt: any, oi: number) => (
                                                <div
                                                    key={opt.id}
                                                    className={`${styles.optionBadge} ${opt.is_correct ? styles.correctBadge : ""}`}
                                                >
                                                    <span className={styles.optionLetter}>{String.fromCharCode(65 + oi)}</span>
                                                    {opt.option_text}
                                                    {opt.is_correct && <Check size={12} />}
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            className={styles.deleteQuestionBtn}
                                            onClick={() => handleDeleteQuestion(q.id)}
                                            title="Удалить вопрос"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.quizEditorRight}>
                            <h3>Новый вопрос</h3>
                            <div className={styles.questionForm}>
                                <label>Текст вопроса</label>
                                <textarea
                                    value={newQText}
                                    onChange={(e) => setNewQText(e.target.value)}
                                    placeholder="Введите текст вопроса..."
                                    rows={3}
                                />

                                <label>Варианты ответов</label>
                                <p className={styles.hint}>Выберите правильный вариант</p>

                                <div className={styles.optionsForm}>
                                    {newQOptions.map((opt, idx) => (
                                        <div key={opt.id} className={styles.optionFormRow}>
                                            <input
                                                type="radio"
                                                name="correctOption"
                                                checked={correctOptionIdx === idx}
                                                onChange={() => setCorrectOptionIdx(idx)}
                                                className={styles.radioInput}
                                            />
                                            <span className={styles.optionLabel}>{String.fromCharCode(65 + idx)}</span>
                                            <input
                                                type="text"
                                                value={opt.text}
                                                onChange={(e) => updateOptionText(idx, e.target.value)}
                                                placeholder={`Вариант ${String.fromCharCode(65 + idx)}`}
                                                className={styles.optionTextInput}
                                            />
                                            {newQOptions.length > 2 && (
                                                <button
                                                    type="button"
                                                    className={styles.removeOptionBtn}
                                                    onClick={() => removeOptionField(idx)}
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <button type="button" className={styles.addOptionBtn} onClick={addOptionField}>
                                    <Plus size={16} /> Добавить вариант
                                </button>

                                <button
                                    className={styles.saveQuestionBtn}
                                    onClick={handleAddQuestion}
                                    disabled={savingQuestion || !newQText.trim()}
                                >
                                    {savingQuestion ? "Сохранение..." : "Добавить вопрос"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- Render: Main Materials View ---
    return (
        <div className={styles.modalBackdrop} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ width: 700 }}>
                <div className={styles.modalHeader}>
                    <h2>Материалы: {topic.topic_name}</h2>
                    <button onClick={onClose} className={styles.closeBtn}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.tabs}>
                    <button className={activeTab === "files" ? styles.tabActive : styles.tab} onClick={() => setActiveTab("files")}>
                        <Paperclip size={16} /> Файлы и ссылки
                    </button>
                    <button className={activeTab === "tests" ? styles.tabActive : styles.tab} onClick={() => setActiveTab("tests")}>
                        <FlaskConical size={16} /> Тесты ({tests.length}/3)
                    </button>
                </div>

                <div className={styles.modalBody}>
                    {activeTab === "files" && (
                        <div className={styles.tabContent}>
                            <div className={styles.list}>
                                {materials.length === 0 && <div className={styles.empty}>Нет материалов</div>}
                                {materials.map((m) => (
                                    <div key={m.id} className={styles.itemRow}>
                                        <div className={styles.itemInfo}>
                                            {m.kind === "link" ? <LinkIcon size={18} className={styles.iconLink} /> : <FileText size={18} className={styles.iconFile} />}
                                            <div>
                                                <a href={m.kind === "link" ? m.url! : m.signed_url!} target="_blank" rel="noreferrer" className={styles.link}>
                                                    {m.title || "Без названия"}
                                                </a>
                                                {m.kind === "link" && <div className={styles.subText}>{m.url}</div>}
                                            </div>
                                        </div>
                                        <button onClick={() => handleDeleteMaterial(m.id)} className={styles.iconBtnDanger}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className={styles.addForm}>
                                <h4>Добавить материал</h4>
                                <div className={styles.typeToggle}>
                                    <label>
                                        <input type="radio" checked={newMaterialType === "file"} onChange={() => setNewMaterialType("file")} /> Файл
                                    </label>
                                    <label>
                                        <input type="radio" checked={newMaterialType === "link"} onChange={() => setNewMaterialType("link")} /> Ссылка
                                    </label>
                                </div>
                                {newMaterialType === "file" ? (
                                    <div className={styles.fileInputs}>
                                        <input type="text" placeholder="Название (опционально)" value={newMaterialTitle} onChange={(e) => setNewMaterialTitle(e.target.value)} />
                                        <input type="file" onChange={(e) => setNewMaterialFile(e.target.files?.[0] || null)} />
                                    </div>
                                ) : (
                                    <div className={styles.linkInputs}>
                                        <input type="text" placeholder="Название*" value={newMaterialTitle} onChange={(e) => setNewMaterialTitle(e.target.value)} />
                                        <input type="url" placeholder="URL*" value={newMaterialUrl} onChange={(e) => setNewMaterialUrl(e.target.value)} />
                                    </div>
                                )}
                                <button className={styles.primaryBtn} onClick={handleAddMaterial} disabled={loadingFile}>
                                    {loadingFile ? "Загрузка..." : "Добавить"}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === "tests" && (
                        <div className={styles.tabContent}>
                            <div className={styles.list}>
                                {tests.length === 0 && <div className={styles.empty}>Нет тестов</div>}
                                {tests.map((t) => (
                                    <div key={t.id} className={styles.itemRow}>
                                        <div className={styles.itemInfo}>
                                            <FlaskConical size={18} className={styles.iconTest} />
                                            <div>
                                                <div className={styles.itemTitle}>{t.title}</div>
                                                <div className={styles.subText}>{t.test_type === "quiz" ? "Онлайн-квиз" : "Документ"}</div>
                                            </div>
                                        </div>
                                        <div className={styles.actions}>
                                            {t.test_type === "quiz" && (
                                                <button className={styles.editTestBtn} onClick={() => openQuizEditor(t.id, t.title)}>
                                                    Редактировать
                                                </button>
                                            )}
                                            <button onClick={() => handleDeleteTest(t.id)} className={styles.iconBtnDanger}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {isCreatingTest ? (
                                <div className={styles.addForm}>
                                    <h4>Новый тест</h4>
                                    <input type="text" placeholder="Название теста" value={newTestTitle} onChange={(e) => setNewTestTitle(e.target.value)} />
                                    <div className={styles.typeToggle}>
                                        <label>
                                            <input type="radio" checked={newTestType === "quiz"} onChange={() => setNewTestType("quiz")} /> Онлайн-квиз
                                        </label>
                                        <label>
                                            <input type="radio" checked={newTestType === "document"} onChange={() => setNewTestType("document")} /> Файл
                                        </label>
                                    </div>
                                    {newTestType === "document" && <input type="file" onChange={(e) => setNewTestFile(e.target.files?.[0] || null)} />}

                                    <div className={styles.formActions}>
                                        <button className={styles.primaryBtn} onClick={handleCreateTest} disabled={loadingTest}>
                                            Создать
                                        </button>
                                        <button className={styles.secondaryBtn} onClick={() => setIsCreatingTest(false)}>
                                            Отмена
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button className={styles.dashedBtn} onClick={() => setIsCreatingTest(true)} disabled={tests.length >= 3}>
                                    <Plus size={16} /> Добавить тест
                                </button>
                            )}
                            {tests.length >= 3 && <div className={styles.limitWarn}>Максимум 3 теста на тему</div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
