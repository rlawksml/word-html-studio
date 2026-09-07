-- v1.0.1 호환성 기반: 기존 컬럼과 JSON을 변경하지 않고 새 저장소만 추가합니다.
create table if not exists public.app_schema_versions (
  component text primary key,
  version bigint not null check (version > 0),
  applied_at timestamptz not null default now()
);

create table if not exists public.news_schedule_ranges (
  submission_id bigint not null references public.submissions(id) on delete cascade,
  news_item_id bigint not null check (news_item_id > 0),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (submission_id, news_item_id),
  check (end_date >= start_date)
);

create index if not exists news_schedule_ranges_dates_idx
  on public.news_schedule_ranges(start_date, end_date);

alter table public.app_schema_versions enable row level security;
alter table public.news_schedule_ranges enable row level security;

revoke all on public.app_schema_versions from anon, authenticated;
revoke all on public.news_schedule_ranges from anon, authenticated;
grant all on public.app_schema_versions to service_role;
grant all on public.news_schedule_ranges to service_role;

insert into public.app_schema_versions (component, version, applied_at)
values ('workspace', 202609070001, now())
on conflict (component) do update set
  version = greatest(public.app_schema_versions.version, excluded.version),
  applied_at = case
    when public.app_schema_versions.version < excluded.version then excluded.applied_at
    else public.app_schema_versions.applied_at
  end;
