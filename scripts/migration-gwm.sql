-- Migration: Add 'gwm' (Working Memory) domain to items_domain_check constraint
-- Run this against the live database once to unblock GWM item uploads.

BEGIN;

-- Drop the existing check constraint
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_domain_check;

-- Re-add it with 'gwm' included
ALTER TABLE items
  ADD CONSTRAINT items_domain_check CHECK (domain IN (
    'gf',
    'gv',
    'gq',
    'gc',
    'gs',
    'gwm',
    'personality',
    'interest',
    'aptitude_numerical',
    'aptitude_verbal',
    'aptitude_attention',
    'domain_knowledge'
  ));

COMMIT;
