# Быстрый старт: Автоматическое расписание

## Что сделано

✅ Миграция БД с новыми таблицами и функциями  
✅ Python алгоритм автогенерации расписания  
✅ API endpoints для управления  
✅ Валидация жестких ограничений  
✅ Метрики качества расписания  

## Типы занятий

- **theoretical** (теория) - лекции
- **practical** (практика) - семинары  
- **credit** (зачет) - экзамен/зачет (ставится вручную)

## Основные правила

1. ✅ **Теория всегда перед практикой** для каждого предмета
2. ✅ Максимум 1 теория + 1 практика в неделю по предмету
3. ✅ **Без окон** в расписании (пары идут подряд)
4. ✅ Нет конфликтов (преподаватель/аудитория/класс)
5. ✅ 3-4 пары в день обычно

## Шаги для запуска

### 1. Применить миграцию

Откройте в Supabase SQL Editor:
```
supabase/migrations/20251230_000017_auto_schedule_system.sql
```

Скопируйте и выполните весь код.

### 2. Настроить планы занятий

```bash
curl -X POST http://localhost:8000/api/timetable/subject-lesson-plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "stream_id": "your-stream-id",
    "plans": [
      {
        "subject_id": "math-id",
        "theoretical_lessons_count": 12,
        "practical_lessons_count": 12,
        "max_per_week": 2
      }
    ]
  }'
```

### 3. Сгенерировать расписание

```bash
curl -X POST http://localhost:8000/api/timetable/auto-generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "class_id": "your-class-id",
    "stream_id": "your-stream-id",
    "allow_gaps": false,
    "clear_existing": false,
    "dry_run": true
  }'
```

### 4. Проверить результат

```bash
# Посмотреть метрики качества в ответе
# Если overall > 0.85 - отлично!

# Если всё хорошо, запустить с dry_run: false
curl -X POST http://localhost:8000/api/timetable/auto-generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "class_id": "your-class-id",
    "stream_id": "your-stream-id",
    "dry_run": false
  }'
```

### 5. Валидация

```bash
curl -X GET http://localhost:8000/api/timetable/validate/your-class-id \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Новые API endpoints

- `POST /api/timetable/subject-lesson-plans` - настроить планы занятий
- `GET /api/timetable/subject-lesson-plans/{stream_id}` - получить планы
- `POST /api/timetable/auto-generate` - сгенерировать расписание
- `GET /api/timetable/validate/{class_id}` - проверить расписание
- `GET /api/timetable/generation-logs` - история генерации

## Параметры генерации

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `max_lessons_per_day` | 4 | Максимум пар в день |
| `min_lessons_per_day` | 3 | Минимум пар в день |
| `allow_gaps` | false | Разрешить окна (false = без окон) |
| `working_days` | [0,1,2,3,4] | Рабочие дни (0=Пн, ..., 6=Вс) |
| `earliest_start_time` | "09:00" | Начало занятий |
| `latest_end_time` | "18:00" | Конец занятий |
| `lesson_duration_minutes` | 90 | Длительность пары |
| `break_duration_minutes` | 15 | Перерыв между парами |
| `clear_existing` | false | Удалить старое расписание |
| `dry_run` | false | Только проверка, не сохранять |

## Структура данных

### subject_lesson_plans
```sql
- stream_id (UUID) - поток
- subject_id (UUID) - предмет
- theoretical_lessons_count (INT) - количество теории
- practical_lessons_count (INT) - количество практики
- max_per_week (INT) - макс пар в неделю
- preferred_teacher_id (UUID) - предпочитаемый преподаватель
```

### schedule_constraints
```sql
- stream_id или class_id - для кого настройки
- max_lessons_per_day (INT)
- min_lessons_per_day (INT)
- allow_gaps (BOOL)
- working_days (INT[])
- earliest_start_time (TIME)
- latest_end_time (TIME)
- lesson_duration_minutes (INT)
- break_duration_minutes (INT)
```

## Пример типичного потока

**3 месяца = ~12 недель обучения**

```json
{
  "plans": [
    {
      "subject_id": "math",
      "theoretical_lessons_count": 12,  // 12 недель * 1 = 12 теорий
      "practical_lessons_count": 12,     // 12 недель * 1 = 12 практик
      "max_per_week": 2                  // 1 теория + 1 практика
    },
    {
      "subject_id": "physics",
      "theoretical_lessons_count": 10,
      "practical_lessons_count": 10,
      "max_per_week": 2
    },
    {
      "subject_id": "programming",
      "theoretical_lessons_count": 8,
      "practical_lessons_count": 16,     // Больше практики
      "max_per_week": 2
    }
  ]
}
```

**Итого: ~50-70 пар за 3 месяца на класс**

## Troubleshooting

### "No subject lesson plans found"
→ Создайте планы через `POST /subject-lesson-plans`

### "Schedule conflict"
→ Проверьте существующее расписание, увеличьте max_lessons_per_day

### Низкие метрики качества
→ Уменьшите количество предметов или разрешите окна (`allow_gaps: true`)

## Полная документация

См. `docs/AUTO_SCHEDULE_GUIDE.md` для детальной информации.
