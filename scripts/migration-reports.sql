-- Migration: Add support for compiled reports and sharing
-- Run: psql -U postgres -d cognimap -f migration-reports.sql

-- Add shared_with tracking to reports
ALTER TABLE reports ADD COLUMN IF NOT EXISTS shared_with JSONB DEFAULT '[]'::jsonb;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS share_expires TIMESTAMPTZ;

-- Expand report_type to include new types
-- (PostgreSQL doesn't support ALTER CHECK directly, so we drop and recreate)
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_report_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_report_type_check
    CHECK (report_type IN ('comprehensive', 'aptitude', 'personality', 'interest', 'compiled', 'screening'));

-- Index for student report lookups
CREATE INDEX IF NOT EXISTS idx_reports_user_status ON reports(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);
CREATE INDEX IF NOT EXISTS idx_reports_share_token ON reports(share_token) WHERE share_token IS NOT NULL;
