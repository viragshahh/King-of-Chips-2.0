-- King of Chips 2.0 timed poker-hand quiz schema
-- Quiz questions and answer keys are generated deterministically by the koc-quiz Edge Function.
-- Client roles cannot read or write quiz attempts/settings directly; all quiz actions go through the server function.

create table if not exists public.quiz_settings (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','live','completed')),
  question_seconds integer not null default 20 check (question_seconds between 5 and 120),
  question_count integer not null default 20 check (question_count between 1 and 20),
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at timestamptz not null default now(),
  question_started_at timestamptz not null default now(),
  current_index integer not null default 0 check (current_index between 0 and 20),
  score integer not null default 0,
  correct_count integer not null default 0,
  total_time_ms bigint not null default 0,
  answers jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, team_id),
  unique (tournament_id, user_id)
);

create index if not exists quiz_attempts_leaderboard_idx
  on public.quiz_attempts(tournament_id, score desc, correct_count desc, total_time_ms asc);

alter table public.quiz_settings enable row level security;
alter table public.quiz_attempts enable row level security;
revoke all on public.quiz_settings, public.quiz_attempts from anon, authenticated;
grant all on public.quiz_settings, public.quiz_attempts to service_role;

insert into public.quiz_settings(tournament_id, status, question_seconds, question_count)
select id, 'draft', 20, 20 from public.tournaments order by created_at limit 1
on conflict (tournament_id) do nothing;
