-- Drop existing table if exists (to start fresh)
DROP TABLE IF EXISTS curriculum_plan CASCADE;

-- Create new curriculum plan table with sections and assessment types
CREATE TABLE curriculum_plan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  direction_id UUID REFERENCES directions(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  
  -- Section (category)
  section TEXT NOT NULL DEFAULT 'general',
  -- Options: 'general' (Общеобразовательные и общеправовые дисциплины)
  --          'special_legal' (Специальные юридические дисциплины)
  --          'special' (Специальные дисциплины)
  
  -- Hours breakdown
  total_hours FLOAT DEFAULT 0,
  lecture_hours FLOAT DEFAULT 0,  -- л/з (лекционные занятия)
  seminar_hours FLOAT DEFAULT 0,  -- с/з (семинарские занятия)
  practical_hours FLOAT DEFAULT 0, -- пр/з (практические занятия)
  
  -- Assessment types
  has_credit BOOLEAN DEFAULT FALSE,  -- Зачет
  has_exam BOOLEAN DEFAULT FALSE,    -- Экзамен
  has_test BOOLEAN DEFAULT FALSE,    -- Комп. тест
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(direction_id, subject_id)
);

-- Enable RLS
ALTER TABLE curriculum_plan ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admins and managers can do everything on curriculum_plan" ON curriculum_plan;
DROP POLICY IF EXISTS "Public read access for curriculum_plan" ON curriculum_plan;

-- Create policies
CREATE POLICY "Admins and managers can do everything on curriculum_plan"
  ON curriculum_plan FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Public read access for curriculum_plan"
  ON curriculum_plan FOR SELECT
  USING (TRUE);

-- Comments
COMMENT ON TABLE curriculum_plan IS 'Structured curriculum plan with sections and assessment types';
COMMENT ON COLUMN curriculum_plan.section IS 'Section: general, special_legal, special';
COMMENT ON COLUMN curriculum_plan.lecture_hours IS 'Лекционные занятия (л/з)';
COMMENT ON COLUMN curriculum_plan.seminar_hours IS 'Семинарские занятия (с/з)';
COMMENT ON COLUMN curriculum_plan.practical_hours IS 'Практические занятия (пр/з)';
COMMENT ON COLUMN curriculum_plan.has_credit IS 'Зачет';
COMMENT ON COLUMN curriculum_plan.has_exam IS 'Экзамен';
COMMENT ON COLUMN curriculum_plan.has_test IS 'Компьютерный тест';
