-- Run once against a new Supabase project (SQL Editor -> New Query -> paste -> Run).
-- See docs/2026-07-04-meeting-history-design.md and docs/adr/0005-meeting-history-and-consolidation.md.

create table meeting_history (
  id uuid primary key default gen_random_uuid(),
  series_key text not null,
  meeting_id text not null unique,
  meeting_date timestamptz not null default now(),
  title text,
  attendees text[],
  raw_overview text,
  raw_action_items text,
  condensed_overview text,
  condensed_action_items text,
  created_at timestamptz not null default now()
);

create table series_state (
  series_key text primary key,
  open_items jsonb not null default '[]'::jsonb,
  narrative text not null default '',
  last_meeting_id text,
  updated_at timestamptz not null default now()
);
