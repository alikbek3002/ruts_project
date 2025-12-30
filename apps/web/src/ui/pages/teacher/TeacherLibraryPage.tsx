import React, { useState, useEffect } from 'react';
import { 
  apiLibraryListTopics, 
  apiLibraryCreateTopic, 
  apiLibraryUpdateTopic,
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
import { Search, Plus, FileText, Download, Trash2, X, Upload, Edit2 } from 'lucide-react';

export const TeacherLibraryPage: React.FC = () => {
  const { state } = useAuth();
  const token = state.accessToken;

  const [topics, setTopics] = useState<Topic[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDesc, setNewTopicDesc] = useState('');
  const [newTopicClassId, setNewTopicClassId] = useState<string | null>(null);
  const [newTopicSubjectId, setNewTopicSubjectId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  
  // Edit state
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  const loadData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      console.log('Loading library data...');
      
      // Load data independently to avoid one failure blocking everything
      try {
        const response = await apiLibraryListTopics(token);
        console.log('Topics received:', response);
        // Handle both array and object response formats
        const topicsList = Array.isArray(response) ? response : (response as any).topics || [];
        setTopics(topicsList);
      } catch (e) {
        console.error('Failed to load topics:', e);
      }

      try {
        const classesData = await apiListClasses(token);
        setClasses(classesData.classes || []);
      } catch (e) {
        console.error('Failed to load classes:', e);
      }

      try {
        const subjectsData = await apiListSubjects(token);
        setSubjects(subjectsData.subjects || []);
      } catch (e) {
        console.error('Failed to load subjects:', e);
      }

    } catch (error) {
      console.error('Failed to load library data (general error):', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newTopicTitle) {
      alert('Пожалуйста, введите название темы');
      return;
    }

    try {
      setUploading(true);
      
      // Create FormData for topic creation
      const formData = new FormData();
      formData.append('title', newTopicTitle);
      if (newTopicDesc) {
        formData.append('description', newTopicDesc);
      }
      
      // Create topic with files (if no files, backend will create topic without files)
      const response = await fetch('/api/library/topics', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Failed to create topic');
      }
      
      const topic = await response.json();
      const topicId = topic.id;
      
      // Upload additional files if any
      if (selectedFiles.length > 0) {
        const filesFormData = new FormData();
        selectedFiles.forEach(file => {
          filesFormData.append('files', file);
        });
        
        await apiLibraryUploadTopicFiles(token, topicId, filesFormData);
      }

      // Reset and reload
      setIsModalOpen(false);
      setNewTopicTitle('');
      setNewTopicDesc('');
      setSelectedFiles([]);
      loadData();
    } catch (error) {
      console.error('Failed to create topic:', error);
      alert('Не удалось создать тему');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingTopic || !newTopicTitle) return;

    try {
      setUploading(true);
      await apiLibraryUpdateTopic(token, editingTopic.id, {
        title: newTopicTitle,
        description: newTopicDesc
      });
      
      setTopics(topics.map(t => t.id === editingTopic.id ? {
        ...t,
        title: newTopicTitle,
        description: newTopicDesc
      } : t));
      
      setEditingTopic(null);
      setNewTopicTitle('');
      setNewTopicDesc('');
    } catch (error) {
      console.error('Failed to update topic:', error);
      alert('Не удалось обновить тему');
    } finally {
      setUploading(false);
    }
  };

  const openEditModal = (topic: Topic) => {
    setEditingTopic(topic);
    setNewTopicTitle(topic.title);
    setNewTopicDesc(topic.description || '');
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
    return matchesSearch;
  });

  const getSubjectName = (id: string | null) => subjects.find(s => s.id === id)?.name || 'Неизвестный предмет';

  return (
    <AppShell
      title="Учитель → Библиотека"
      nav={[
        { to: "/app/teacher", label: "Главная" },
        { to: "/app/teacher/journal", label: "Журнал" },
        { to: "/app/teacher/vzvody", label: "Мои взводы" },
        { to: "/app/teacher/timetable", label: "Расписание" },
        { to: "/app/teacher/workload", label: "Часы работы" },
        { to: "/app/teacher/library", label: "Библиотека" },
        { to: "/app/teacher/courses", label: "Курсы" },
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
        </div>

        {loading ? (
          <div className={styles.loading}>Загрузка библиотеки...</div>
        ) : filteredTopics.length === 0 ? (
          <div className={styles.empty}>
            <p>Нет тем для отображения</p>
            <p style={{fontSize: '14px', color: '#6b7280', marginTop: '8px'}}>Всего тем: {topics.length}</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {filteredTopics.map(topic => (
              <div key={topic.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardMeta}>
                    <span className={styles.badge}>{getSubjectName(topic.subject_id)}</span>
                  </div>
                  <div className={styles.cardActionsHeader}>
                    <button 
                      className={styles.editButton}
                      onClick={() => openEditModal(topic)}
                      title="Редактировать тему"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      className={styles.deleteButton}
                      onClick={() => handleDeleteTopic(topic.id)}
                      title="Удалить тему"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
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
                
                <div className={styles.cardActions}>
                  <label className={styles.uploadButton}>
                    <Upload size={16} />
                    <span>Загрузить файлы</span>
                    <input 
                      type="file" 
                      multiple 
                      style={{display: 'none'}}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (!files.length || !token) return;
                        try {
                          const formData = new FormData();
                          files.forEach(f => formData.append('files', f));
                          await apiLibraryUploadTopicFiles(token, topic.id, formData);
                          loadData();
                        } catch (err) {
                          console.error('Upload failed:', err);
                          alert('Ошибка загрузки файлов');
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {(isModalOpen || editingTopic) && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2>{editingTopic ? 'Редактировать тему' : 'Добавить новую тему'}</h2>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingTopic(null);
                  }} 
                  className={styles.closeButton}
                >
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={editingTopic ? handleUpdateTopic : handleCreateTopic} className={styles.form}>
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

                {!editingTopic && (
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
                    <small style={{ color: '#666', fontSize: '13px' }}>
                      Тема будет доступна всем классам по вашему предмету
                    </small>
                  </div>
                )}

                <div className={styles.modalActions}>
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsModalOpen(false);
                      setEditingTopic(null);
                    }}
                    className={styles.cancelButton}
                  >
                    Отмена
                  </button>
                  <button 
                    type="submit" 
                    className={styles.submitButton}
                    disabled={uploading}
                  >
                    {uploading ? 'Сохранение...' : (editingTopic ? 'Сохранить' : 'Создать тему')}
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
