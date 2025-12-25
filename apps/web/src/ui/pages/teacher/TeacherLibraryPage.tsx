import React, { useState, useEffect } from 'react';
import { 
  apiLibraryListTopics, 
  apiLibraryCreateTopic, 
  apiLibraryDeleteTopic, 
  apiLibraryUploadTopicFiles,
  apiListClasses,
  apiListSubjects,
  type Topic,
  type TopicFile,
  type ClassItem,
  type Subject
} from '../../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { AppShell } from '../../layout/AppShell';
import styles from './TeacherLibrary.module.css';
import { Search, Plus, FileText, Download, Trash2, X, Upload, Filter } from 'lucide-react';

export const TeacherLibraryPage: React.FC = () => {
  const { state } = useAuth();
  const token = state.accessToken;

  const [topics, setTopics] = useState<Topic[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDesc, setNewTopicDesc] = useState('');
  const [newTopicClassId, setNewTopicClassId] = useState<string | null>(null);
  const [newTopicSubjectId, setNewTopicSubjectId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const [topicsData, classesData, subjectsData] = await Promise.all([
        apiLibraryListTopics(token),
        apiListClasses(token),
        apiListSubjects(token)
      ]);
      setTopics(Array.isArray(topicsData) ? topicsData : []);
      setClasses(classesData.classes || []);
      setSubjects(subjectsData.subjects || []);
    } catch (error) {
      console.error('Failed to load library data:', error);
      setTopics([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newTopicTitle || !newTopicClassId || !newTopicSubjectId) {
      alert('Пожалуйста, заполните все обязательные поля');
      return;
    }

    try {
      setUploading(true);
      
      // 1. Create topic
      const topic = await apiLibraryCreateTopic(token, {
        title: newTopicTitle,
        description: newTopicDesc,
        class_id: newTopicClassId,
        subject_id: newTopicSubjectId
      });
      
      // 2. Upload files if any
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach(file => {
          formData.append('files', file);
        });
        
        await apiLibraryUploadTopicFiles(token, topic.id, formData);
      }

      // Reset and reload
      setIsModalOpen(false);
      setNewTopicTitle('');
      setNewTopicDesc('');
      setNewTopicClassId(null);
      setNewTopicSubjectId(null);
      setSelectedFiles([]);
      loadData();
    } catch (error) {
      console.error('Failed to create topic:', error);
      alert('Не удалось создать тему');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteTopic = async (id: string) => {
    if (!token) return;
    if (!confirm('Вы уверены, что хотите удалить эту тему?')) return;
    try {
      await apiLibraryDeleteTopic(token, id);
      setTopics(topics.filter(t => t.id !== id));
    } catch (error) {
      console.error('Failed to delete topic:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const filteredTopics = topics.filter(topic => {
    const matchesSearch = topic.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         topic.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClass = selectedClassId ? topic.class_id === selectedClassId : true;
    return matchesSearch && matchesClass;
  });

  const getClassName = (id: string | null) => classes.find(c => c.id === id)?.name || 'Неизвестный класс';
  const getSubjectName = (id: string | null) => subjects.find(s => s.id === id)?.name || 'Неизвестный предмет';

  return (
    <AppShell
      title="Учитель → Библиотека"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/gradebook", label: "Контрольные" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/library", label: "Библиотека" },
      ]}
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Библиотека</h1>
          <button className={styles.addButton} onClick={() => setIsModalOpen(true)}>
            <Plus size={20} />
            Добавить тему
          </button>
        </div>

        <div className={styles.controls}>
          <div className={styles.searchWrapper}>
            <Search className={styles.searchIcon} size={20} />
            <input
              type="text"
              placeholder="Поиск тем..."
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className={styles.filterWrapper}>
            <Filter className={styles.filterIcon} size={20} />
            <select 
              className={styles.filterSelect}
              value={selectedClassId || ''}
              onChange={(e) => setSelectedClassId(e.target.value || null)}
            >
              <option value="">Все классы</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Загрузка библиотеки...</div>
        ) : (
          <div className={styles.grid}>
            {filteredTopics.map(topic => (
              <div key={topic.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardMeta}>
                    <span className={styles.badge}>{getClassName(topic.class_id)}</span>
                    <span className={styles.badgeSecondary}>{getSubjectName(topic.subject_id)}</span>
                  </div>
                  <button 
                    className={styles.deleteButton}
                    onClick={() => handleDeleteTopic(topic.id)}
                    title="Удалить тему"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <h3 className={styles.cardTitle}>{topic.title}</h3>
                {topic.description && (
                  <p className={styles.cardDescription}>{topic.description}</p>
                )}

                <div className={styles.fileList}>
                  {topic.files && topic.files.map(file => (
                    <a 
                      key={file.id}
                      href={file.file_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.fileLink}
                    >
                      <FileText size={16} />
                      <span className={styles.fileName}>{file.file_name}</span>
                      <Download size={14} className={styles.downloadIcon} />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {isModalOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2>Добавить новую тему</h2>
                <button onClick={() => setIsModalOpen(false)} className={styles.closeButton}>
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={handleCreateTopic} className={styles.form}>
                <div className={styles.formGroup}>
                  <label>Название</label>
                  <input
                    type="text"
                    value={newTopicTitle}
                    onChange={(e) => setNewTopicTitle(e.target.value)}
                    required
                    placeholder="например, Глава 1: Введение"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Описание</label>
                  <textarea
                    value={newTopicDesc}
                    onChange={(e) => setNewTopicDesc(e.target.value)}
                    placeholder="Необязательное описание..."
                    rows={3}
                  />
                </div>

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Класс</label>
                    <select
                      value={newTopicClassId || ''}
                      onChange={(e) => setNewTopicClassId(e.target.value)}
                      required
                    >
                      <option value="">Выберите класс</option>
                      {classes.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Предмет</label>
                    <select
                      value={newTopicSubjectId || ''}
                      onChange={(e) => setNewTopicSubjectId(e.target.value)}
                      required
                    >
                      <option value="">Выберите предмет</option>
                      {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Файлы</label>
                  <div className={styles.fileUpload}>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileChange}
                      id="file-upload"
                      className={styles.fileInput}
                    />
                    <label htmlFor="file-upload" className={styles.fileLabel}>
                      <Upload size={20} />
                      <span>{selectedFiles.length ? `${selectedFiles.length} файлов выбрано` : 'Выберите файлы'}</span>
                    </label>
                  </div>
                </div>

                <div className={styles.modalActions}>
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className={styles.cancelButton}
                  >
                    Отмена
                  </button>
                  <button 
                    type="submit" 
                    className={styles.submitButton}
                    disabled={uploading}
                  >
                    {uploading ? 'Создание...' : 'Создать тему'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
