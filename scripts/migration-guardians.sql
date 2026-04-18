-- ═══════════════════════════════════════════════════
-- MIGRATION: Guardian/Teacher roles + student assignment
-- ═══════════════════════════════════════════════════

-- 1. Expand user roles to include guardian and teacher
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'super_admin', 'psychologist', 'client_admin',
    'student', 'employee',
    'guardian', 'teacher'
));

-- 2. Many-to-many: which guardians/teachers are assigned to which students
CREATE TABLE IF NOT EXISTS student_guardians (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship    VARCHAR(30) DEFAULT 'guardian' CHECK (relationship IN (
                        'parent', 'guardian', 'teacher', 'counselor'
                    )),
    can_view_reports BOOLEAN DEFAULT true,
    assigned_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, guardian_id)
);

CREATE INDEX IF NOT EXISTS idx_sg_student ON student_guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_sg_guardian ON student_guardians(guardian_id);

-- 3. Per-report access control (multi-select: who can view each report)
CREATE TABLE IF NOT EXISTS report_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ra_report ON report_access(report_id);
CREATE INDEX IF NOT EXISTS idx_ra_user ON report_access(user_id);
