-- Миграция: изменить колонки зачет/экзамен/тест с boolean на числовые (часы)
-- Дата: 2026-01-22

-- Шаг 1: Удалить DEFAULT значения
ALTER TABLE curriculum_plan 
  ALTER COLUMN has_credit DROP DEFAULT,
  ALTER COLUMN has_exam DROP DEFAULT,
  ALTER COLUMN has_test DROP DEFAULT;

-- Шаг 2: Изменить типы колонок с BOOLEAN на FLOAT
-- При конвертации: TRUE -> 1.0, FALSE -> 0.0
ALTER TABLE curriculum_plan 
  ALTER COLUMN has_credit TYPE FLOAT USING (CASE WHEN has_credit THEN 1.0 ELSE 0.0 END),
  ALTER COLUMN has_exam TYPE FLOAT USING (CASE WHEN has_exam THEN 1.0 ELSE 0.0 END),
  ALTER COLUMN has_test TYPE FLOAT USING (CASE WHEN has_test THEN 1.0 ELSE 0.0 END);

-- Шаг 3: Установить новые DEFAULT значения
ALTER TABLE curriculum_plan 
  ALTER COLUMN has_credit SET DEFAULT 0,
  ALTER COLUMN has_exam SET DEFAULT 0,
  ALTER COLUMN has_test SET DEFAULT 0;

-- Шаг 4: Переименовать колонки для большей ясности
ALTER TABLE curriculum_plan 
  RENAME COLUMN has_credit TO credit_hours;

ALTER TABLE curriculum_plan 
  RENAME COLUMN has_exam TO exam_hours;

ALTER TABLE curriculum_plan 
  RENAME COLUMN has_test TO test_hours;

-- Шаг 5: Обновить комментарии
COMMENT ON COLUMN curriculum_plan.credit_hours IS 'Зачет (часы)';
COMMENT ON COLUMN curriculum_plan.exam_hours IS 'Экзамен (часы)';
COMMENT ON COLUMN curriculum_plan.test_hours IS 'Компьютерный тест (часы)';
