# Система автоматической генерации расписания

## Обзор

Система автоматически генерирует расписание для классов/потоков с учетом всех ограничений и правил университета.

## Типы занятий

1. **Теоретическое (theoretical)** - лекции, теория
2. **Практическое (practical)** - практические занятия, семинары
3. **Зачет (credit)** - экзамен/зачет (устанавливается администратором вручную)

## Правила генерации

### Жесткие ограничения (обязательные):

✅ Один преподаватель не может вести две пары одновременно  
✅ Одна аудитория не может быть занята дважды  
✅ Группа не может иметь две пары одновременно  
✅ **Теория всегда идет ДО практики** для каждого предмета  
✅ Максимум 1 теория + 1 практика по предмету в неделю  

### Мягкие ограничения (желательные):

📊 Равномерное распределение нагрузки по дням недели  
📊 Обычно 3-4 пары в день  
📊 **Без окон в расписании** (занятия идут последовательно)  

## Установка и применение миграции

```bash
# 1. Применить миграцию в Supabase
# Откройте файл supabase/migrations/20251230_000017_auto_schedule_system.sql
# Скопируйте содержимое и выполните в SQL редакторе Supabase Dashboard

# 2. Перезапустите API сервер
# Сервер автоматически подхватит новые изменения
```

## Использование API

### 1. Настройка планов занятий для потока

Сначала нужно настроить, сколько теории и практики по каждому предмету:

```bash
POST /api/timetable/subject-lesson-plans
Content-Type: application/json
Authorization: Bearer <token>

{
  "stream_id": "uuid-потока",
  "plans": [
    {
      "subject_id": "uuid-математики",
      "theoretical_lessons_count": 12,  # 12 теоретических занятий
      "practical_lessons_count": 12,     # 12 практических занятий
      "max_per_week": 2,                 # Максимум 2 пары в неделю
      "preferred_teacher_id": "uuid-преподавателя"  # опционально
    },
    {
      "subject_id": "uuid-физики",
      "theoretical_lessons_count": 10,
      "practical_lessons_count": 10,
      "max_per_week": 2
    }
    // ... другие предметы
  ]
}
```

**Ответ:**
```json
{
  "plans": [...],
  "count": 2
}
```

### 2. Автогенерация расписания

```bash
POST /api/timetable/auto-generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "class_id": "uuid-класса",
  "stream_id": "uuid-потока",
  
  // Опциональные настройки (можно пропустить, будут использованы значения по умолчанию)
  "max_lessons_per_day": 4,
  "min_lessons_per_day": 3,
  "allow_gaps": false,              // false = без окон
  "working_days": [0, 1, 2, 3, 4],  // Пн-Пт (0=Пн, 6=Вс)
  "earliest_start_time": "09:00",
  "latest_end_time": "18:00",
  "lesson_duration_minutes": 90,
  "break_duration_minutes": 15,
  
  // Опции генерации
  "clear_existing": false,  // true = удалить старое расписание
  "dry_run": false          // true = только проверка, не сохранять
}
```

**Ответ (успешная генерация):**
```json
{
  "success": true,
  "class_id": "uuid",
  "lessons_scheduled": 48,
  "quality_metrics": {
    "balance_score": 0.95,      // насколько равномерно по дням (0-1)
    "gap_score": 1.0,            // есть ли окна (1 = нет окон)
    "load_score": 0.88,          // соответствие целевой нагрузке
    "overall": 0.94              // общая оценка (0-1)
  },
  "dry_run": false,
  "schedule": [
    {
      "id": "uuid",
      "subject": "Математика",
      "lesson_type": "theoretical",
      "weekday": 0,              // Понедельник
      "start_time": "09:00",
      "end_time": "10:30",
      "teacher_id": "uuid",
      "room": "201"
    },
    // ... остальные занятия
  ]
}
```

**Ответ (ошибка конфликта):**
```json
{
  "detail": "Schedule conflict: Teacher uuid has overlapping lessons"
}
```

### 3. Проверка существующего расписания

```bash
GET /api/timetable/validate/{class_id}
Authorization: Bearer <token>
```

**Ответ:**
```json
{
  "class_id": "uuid",
  "valid": false,
  "violations": [
    {
      "constraint_type": "no_teacher_overlap",
      "violated": true,
      "message": "Teacher has overlapping lessons"
    },
    {
      "constraint_type": "theory_before_practice",
      "violated": true,
      "message": "Practice lesson found before theory lesson for same subject"
    }
  ]
}
```

### 4. Просмотр истории генерации

```bash
GET /api/timetable/generation-logs?limit=20&stream_id=uuid
Authorization: Bearer <token>
```

**Ответ:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "stream_id": "uuid",
      "class_id": "uuid",
      "started_at": "2025-12-30T10:00:00Z",
      "completed_at": "2025-12-30T10:00:15Z",
      "status": "success",
      "total_lessons_planned": 48,
      "lessons_scheduled": 48,
      "conflicts_found": 0,
      "config": {
        "constraints": {...},
        "quality": {...}
      }
    }
  ]
}
```

### 5. Получение планов занятий

```bash
GET /api/timetable/subject-lesson-plans/{stream_id}
Authorization: Bearer <token>
```

## Примеры использования

### Пример 1: Генерация расписания на 3 месяца

```bash
# 1. Создаем поток на 3 месяца
POST /api/streams
{
  "name": "Поток Январь-Март 2025",
  "start_date": "2025-01-01",
  "end_date": "2025-03-31",
  "direction_id": "uuid"
}

# 2. Добавляем классы в поток
POST /api/streams/{stream_id}/classes
{
  "class_ids": ["uuid1", "uuid2", "uuid3"]
}

# 3. Настраиваем предметы (12 недель * 2 = 24 пары максимум)
POST /api/timetable/subject-lesson-plans
{
  "stream_id": "uuid",
  "plans": [
    {
      "subject_id": "математика-uuid",
      "theoretical_lessons_count": 12,
      "practical_lessons_count": 12,
      "max_per_week": 2
    },
    {
      "subject_id": "физика-uuid",
      "theoretical_lessons_count": 10,
      "practical_lessons_count": 10,
      "max_per_week": 2
    }
  ]
}

# 4. Генерируем расписание для каждого класса
POST /api/timetable/auto-generate
{
  "class_id": "uuid1",
  "stream_id": "uuid",
  "clear_existing": true,
  "allow_gaps": false
}
```

### Пример 2: Пробная генерация (dry run)

```bash
# Проверяем, сможет ли система сгенерировать расписание
POST /api/timetable/auto-generate
{
  "class_id": "uuid",
  "stream_id": "uuid",
  "dry_run": true  # Не сохранять в БД
}

# Смотрим результат и quality_metrics
# Если все хорошо, запускаем с dry_run: false
```

### Пример 3: Обновление расписания

```bash
# Очистить старое и создать новое
POST /api/timetable/auto-generate
{
  "class_id": "uuid",
  "stream_id": "uuid",
  "clear_existing": true  # Удалить старое
}
```

## Алгоритм работы

1. **Приоритизация**: Теория → Практика → Зачет
2. **Поиск слота**: Для каждого занятия:
   - Проверка правила "теория перед практикой"
   - Поиск свободного времени (нет конфликтов)
   - Учет дневных лимитов
   - Заполнение без окон (если `allow_gaps=false`)
3. **Валидация**: Проверка всех жестких ограничений
4. **Сохранение**: Запись в `timetable_entries`

## Таблицы БД

### schedule_constraints
Настройки генерации для потока/класса:
- `max_lessons_per_day`: макс пар в день (обычно 4)
- `min_lessons_per_day`: мин пар в день (обычно 3)
- `allow_gaps`: разрешить окна (обычно `false`)
- `working_days`: рабочие дни недели

### subject_lesson_plans
План занятий по предметам:
- `theoretical_lessons_count`: количество теории
- `practical_lessons_count`: количество практики
- `max_per_week`: макс пар в неделю по предмету

### schedule_generation_logs
История генерации (аудит):
- Кто и когда запускал
- Статус (success/failed/partial)
- Статистика и метрики качества

## SQL функции

### is_teacher_available
Проверка доступности преподавателя:
```sql
SELECT is_teacher_available(
  'teacher-uuid', 
  1,              -- вторник
  '10:00'::time, 
  '11:30'::time
);
```

### is_class_available
Проверка доступности класса:
```sql
SELECT is_class_available('class-uuid', 1, '10:00'::time, '11:30'::time);
```

### validate_schedule_constraints
Полная валидация расписания:
```sql
SELECT * FROM validate_schedule_constraints('class-uuid');
```

## Метрики качества

- **balance_score** (0-1): Равномерность распределения по дням
- **gap_score** (0-1): Наличие окон (1 = нет окон)
- **load_score** (0-1): Соответствие целевой нагрузке
- **overall** (0-1): Общая оценка

Хорошее расписание: overall > 0.85

## Troubleshooting

### Ошибка: "No subject lesson plans found"
**Решение**: Создайте планы занятий через `/subject-lesson-plans`

### Ошибка: "Schedule conflict: Teacher has overlapping lessons"
**Решение**: 
- Проверьте существующее расписание преподавателя
- Увеличьте `max_lessons_per_day`
- Добавьте больше рабочих дней

### Ошибка: "Practice before theory for subject"
**Решение**: Система автоматически соблюдает это правило. Если ошибка появляется, проверьте существующее расписание.

### Низкая оценка качества (overall < 0.7)
**Решение**:
- Уменьшите количество предметов
- Увеличьте `max_lessons_per_day`
- Установите `allow_gaps: true` (разрешить окна)

## Права доступа

- **admin, manager**: Полный доступ (генерация, настройка, просмотр)
- **teacher**: Только просмотр логов и планов
- **student**: Нет доступа к генерации

## Что дальше?

1. ✅ Применить миграцию `20251230_000017_auto_schedule_system.sql`
2. ✅ Настроить планы занятий для потоков
3. ✅ Запустить автогенерацию с `dry_run: true`
4. ✅ Проверить метрики качества
5. ✅ Запустить реальную генерацию
6. ✅ Проверить результат через `/validate/{class_id}`

## Дополнительно

Зачеты (`credit`) **не генерируются автоматически** - их должен устанавливать администратор вручную через обычное API создания занятий:

```bash
POST /api/timetable/entries
{
  "class_id": "uuid",
  "subject_id": "uuid",
  "lesson_type": "credit",
  "weekday": 5,  # Пятница
  "start_time": "14:00",
  "end_time": "15:30"
}
```
