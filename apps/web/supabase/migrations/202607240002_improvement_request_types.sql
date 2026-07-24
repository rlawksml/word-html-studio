alter table public.improvement_requests
  add column if not exists request_type text not null default 'improvement',
  add column if not exists location text,
  add column if not exists reason text;

alter table public.improvement_requests
  drop constraint if exists improvement_requests_request_type_check;

alter table public.improvement_requests
  add constraint improvement_requests_request_type_check
  check (request_type in ('bug', 'improvement'));
