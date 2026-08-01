# TalentFlow — HR Recruitment Dashboard

Applicant tracking for the SETIAHUB careers pipeline. React front end, Google Sheets as the database, Apps Script as the API.

```
Applicant → Careers form → Apps Script → Google Sheet → Dashboard (Vercel)
```

## What it does

- **Pipeline board** — Kanban across the stages defined in your Settings sheet, drag-free stage moves via dropdown
- **Table view** — the same applicants, sortable and filterable
- **Applicant drawer** — full profile, embedded resume preview, notes, and an audit trail
- **Interview scheduling** — booked against a candidate, listed upcoming vs past
- **Analytics** — stage distribution, branch and position breakdowns, six-month trend, all computed from live rows
- **Roles** — accounts marked `Viewer` in the Users sheet get read-only access

