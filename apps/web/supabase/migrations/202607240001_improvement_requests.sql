create table if not exists public.improvement_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  content text not null check (char_length(content) between 5 and 4000),
  status text not null default 'received'
    check (status in ('received', 'checking', 'in_progress', 'resolved')),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists improvement_requests_status_created_idx
  on public.improvement_requests(status, created_at desc);

alter table public.improvement_requests enable row level security;

revoke all on public.improvement_requests from anon, authenticated;
grant all on public.improvement_requests to service_role;
