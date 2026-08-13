-- Run once in Supabase Dashboard -> SQL Editor.
-- A branch listed here is denied even when allowed_branches contains 'ALL'.

alter table public.users
  add column if not exists excluded_branches text[] not null default '{}';

-- Example only: replace the email before running this UPDATE.
-- The stored HQ branch value is exactly 'HQ - Jenjarom'.
--
-- update public.users
-- set role = 'Manager',
--     allowed_branches = array['ALL'],
--     excluded_branches = array['HQ - Jenjarom'],
--     allowed_positions = array['ALL'],
--     active = true
-- where lower(email) = 'manager@company.com';

-- Verification query: confirm the final user configuration.
select
  email,
  name,
  role,
  active,
  allowed_branches,
  excluded_branches,
  allowed_positions
from public.users
order by role, email;
