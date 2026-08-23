# TalentFlow — Public HR Recruitment Demo

A portfolio-safe applicant tracking demo for the SETIAHUB careers pipeline. It uses React, Cloudflare Pages Functions, Supabase, and a short-lived HS256 JWT stored in an HttpOnly cookie.

```
Demo login → JWT cookie → Cloudflare Pages Function → synthetic Supabase data
```

The public deployment contains no real applicant information. Resume uploads, external application submission, Google Drive, and Google Calendar side effects are disabled when `DEMO_MODE=true`.

## What it does

- **Pipeline board** — Kanban across the stages defined in your Settings sheet, drag-free stage moves via dropdown
- **Table view** — the same applicants, sortable and filterable
- **Applicant drawer** — full profile, embedded resume preview, notes, and an audit trail
- **Interview scheduling** — booked against a candidate, listed upcoming vs past
- **Analytics** — stage distribution, branch and position breakdowns, six-month trend, all computed from live rows
- **Roles** — Supabase user roles enforce read-only and scoped access server-side

## Demo setup

1. Run `supabase/schema.sql`, `supabase/demo-user.sql`, then `supabase/demo-data.sql` in Supabase.
2. Copy `.env.example` to `.env.local` and set the Supabase keys and a private `SESSION_SECRET`.
3. Keep `DEMO_MODE=true` for every public portfolio deployment.
4. Use the credentials prefilled on the login screen.

