-- Synthetic portfolio data for TalentFlow. Safe to re-run.
-- Every identity and contact detail below is fictional.

insert into public.settings (category, value, active, sort_order)
select seed.category, seed.value, true, seed.sort_order
from (values
  ('Stage', 'Applied', 10),
  ('Stage', 'Screening', 20),
  ('Stage', 'Interview', 30),
  ('Stage', 'Assessment', 40),
  ('Stage', 'Offer', 50),
  ('Stage', 'Hired', 60),
  ('Stage', 'Rejected', 70),
  ('InterviewType', 'Screening', 100),
  ('InterviewType', 'Technical', 110),
  ('InterviewType', 'Final', 120),
  ('AssessmentCriteria', 'Role-specific Skills', 200),
  ('AssessmentCriteria', 'Communication', 210),
  ('AssessmentCriteria', 'Attitude & Motivation', 220),
  ('RejectionReason', 'Position filled', 300),
  ('RejectionReason', 'Not a fit', 310),
  ('ArchiveAfterDays', '30', 400),
  ('StaleAfterDays', '90', 410)
) as seed(category, value, sort_order)
where not exists (
  select 1 from public.settings current
  where lower(current.category) = lower(seed.category)
    and lower(current.value) = lower(seed.value)
);

insert into public.applications (
  application_id, submitted_at, full_name, email, phone, city, state,
  position, available_date, expected_salary, experience, cover_message,
  preferred_state, preferred_branch, relocation, stage, rating, tags,
  last_activity, archived_at
)
values
  ('APP-20260801-A1000001', now() - interval '2 days', 'Aina Rahman', 'aina.rahman@example.test', '+60 12-000 1001', 'Shah Alam', 'Selangor', 'Sales Assistant', 'Two weeks', '2500', '2', 'Synthetic portfolio candidate.', 'Selangor', 'Branch Shah Alam', 'Yes', 'Applied', 0, array['New'], now() - interval '2 days', null),
  ('APP-20260802-A1000002', now() - interval '4 days', 'Daniel Tan', 'daniel.tan@example.test', '+60 12-000 1002', 'Kota Bharu', 'Kelantan', 'Cashier', 'Immediately', '2300', '1', 'Synthetic portfolio candidate.', 'Kelantan', 'Branch Kota Bharu', 'No', 'Screening', 4, array['Retail'], now() - interval '1 day', null),
  ('APP-20260803-A1000003', now() - interval '7 days', 'Nur Izzati', 'nur.izzati@example.test', '+60 12-000 1003', 'Machang', 'Kelantan', 'Store Supervisor', 'One month', '3600', '5', 'Synthetic portfolio candidate.', 'Kelantan', 'Branch Machang', 'Yes', 'Interview', 5, array['Leadership'], now() - interval '1 day', null),
  ('APP-20260804-A1000004', now() - interval '9 days', 'Marcus Lee', 'marcus.lee@example.test', '+60 12-000 1004', 'Petaling Jaya', 'Selangor', 'Inventory Assistant', 'Immediately', '2800', '3', 'Synthetic portfolio candidate.', 'Selangor', 'Branch Shah Alam', 'No', 'Assessment', 4, array['Warehouse'], now() - interval '2 hours', null),
  ('APP-20260805-A1000005', now() - interval '12 days', 'Siti Hajar', 'siti.hajar@example.test', '+60 12-000 1005', 'Tumpat', 'Kelantan', 'Sales Assistant', 'Two weeks', '2600', '2', 'Synthetic portfolio candidate.', 'Kelantan', 'Branch Tumpat', 'Yes', 'Offer', 5, array['Recommended'], now() - interval '1 day', null),
  ('APP-20260806-A1000006', now() - interval '15 days', 'Harith Zain', 'harith.zain@example.test', '+60 12-000 1006', 'Klang', 'Selangor', 'Cashier', 'Immediately', '2400', '2', 'Synthetic portfolio candidate.', 'Selangor', 'Branch Shah Alam', 'No', 'Hired', 5, array['Hired'], now() - interval '3 days', null),
  ('APP-20260807-A1000007', now() - interval '18 days', 'Priya Nair', 'priya.nair@example.test', '+60 12-000 1007', 'Kuala Lumpur', 'Kuala Lumpur', 'Marketing Executive', 'One month', '4200', '4', 'Synthetic portfolio candidate.', 'Selangor', 'Branch Jenjarom', 'Yes', 'Rejected', 3, array['Portfolio'], now() - interval '4 days', null),
  ('APP-20260808-A1000008', now() - interval '5 days', 'Faris Hakim', 'faris.hakim@example.test', '+60 12-000 1008', 'Kota Bharu', 'Kelantan', 'Inventory Assistant', 'Two weeks', '2900', '3', 'Synthetic portfolio candidate.', 'Kelantan', 'Branch Kota Bharu', 'No', 'Screening', 3, array['Operations'], now() - interval '2 days', null)
on conflict (application_id) do update set
  submitted_at = excluded.submitted_at,
  full_name = excluded.full_name,
  email = excluded.email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  position = excluded.position,
  available_date = excluded.available_date,
  expected_salary = excluded.expected_salary,
  experience = excluded.experience,
  cover_message = excluded.cover_message,
  preferred_state = excluded.preferred_state,
  preferred_branch = excluded.preferred_branch,
  relocation = excluded.relocation,
  stage = excluded.stage,
  rating = excluded.rating,
  tags = excluded.tags,
  last_activity = excluded.last_activity,
  archived_at = null;

delete from public.interviews
where application_id in ('APP-20260803-A1000003', 'APP-20260805-A1000005');

insert into public.interviews (
  application_id, candidate_name, title, interviewer, interviewer_role,
  scheduled_at, duration_minutes, type, status, meeting_link,
  calendar_sync_status, created_by
)
values
  ('APP-20260803-A1000003', 'Nur Izzati', 'Supervisor Interview', 'Demo Recruiter', 'Admin', now() + interval '2 days', 45, 'Technical', 'Scheduled', 'Demo Meeting Room A', 'Demo', 'demo@talentflow.app'),
  ('APP-20260805-A1000005', 'Siti Hajar', 'Final Discussion', 'Demo Recruiter', 'Admin', now() - interval '2 days', 30, 'Final', 'Completed', 'Demo Meeting Room B', 'Demo', 'demo@talentflow.app');

delete from public.assessments
where application_id = 'APP-20260804-A1000004';

insert into public.assessments (
  application_id, criterion, score, comment, assessor, assessor_email, assessed_at
)
values
  ('APP-20260804-A1000004', 'Role-specific Skills', 4, 'Strong synthetic demonstration score.', 'Demo Recruiter', 'demo@talentflow.app', now() - interval '1 day'),
  ('APP-20260804-A1000004', 'Communication', 4, 'Clear and structured responses.', 'Demo Recruiter', 'demo@talentflow.app', now() - interval '1 day'),
  ('APP-20260804-A1000004', 'Attitude & Motivation', 5, 'Highly engaged throughout the demo.', 'Demo Recruiter', 'demo@talentflow.app', now() - interval '1 day');

delete from public.audit_log
where application_id in (
  'APP-20260802-A1000002',
  'APP-20260803-A1000003',
  'APP-20260804-A1000004'
);

insert into public.audit_log (
  created_at, user_email, user_name, action, application_id, remarks
)
values
  (now() - interval '3 days', 'demo@talentflow.app', 'Demo Recruiter', 'NOTE', 'APP-20260802-A1000002', '[Retail] Friendly customer-service experience.'),
  (now() - interval '2 days', 'demo@talentflow.app', 'Demo Recruiter', 'INTERVIEW_SCHEDULED', 'APP-20260803-A1000003', 'Supervisor Interview — synthetic demo event'),
  (now() - interval '1 day', 'demo@talentflow.app', 'Demo Recruiter', 'ASSESSMENT', 'APP-20260804-A1000004', '3 criteria scored');
