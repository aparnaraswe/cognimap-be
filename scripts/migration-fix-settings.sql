-- Fix: add missing updated_by column to platform_settings
ALTER TABLE platform_settings
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
