create table if not exists public.editing_leases (
  resource_key text primary key,
  session_hash text not null,
  role text not null check (role in ('input', 'html')),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

revoke all on public.editing_leases from anon, authenticated;
grant all on public.editing_leases to service_role;

create or replace function public.acquire_editing_lease(
  requested_resource_key text,
  requested_session_hash text,
  requested_role text,
  lease_seconds integer default 180
)
returns table (owned boolean, active_role text, active_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_lease public.editing_leases%rowtype;
begin
  if requested_role not in ('input', 'html')
    or requested_resource_key !~ '^(submission:[0-9]{4}-(0[1-9]|1[0-2]):[1-9][0-9]*|digest:[0-9]{4}-(0[1-9]|1[0-2]))$'
    or length(requested_session_hash) <> 64
    or lease_seconds < 60
    or lease_seconds > 300 then
    raise exception 'invalid editing lease request';
  end if;

  insert into public.editing_leases (resource_key, session_hash, role, expires_at, updated_at)
  values (requested_resource_key, requested_session_hash, requested_role, now() + make_interval(secs => lease_seconds), now())
  on conflict (resource_key) do update set
    session_hash = excluded.session_hash,
    role = excluded.role,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at
  where public.editing_leases.expires_at <= now()
     or public.editing_leases.session_hash = excluded.session_hash;

  select * into active_lease
  from public.editing_leases
  where resource_key = requested_resource_key;

  return query select
    active_lease.session_hash = requested_session_hash,
    active_lease.role,
    active_lease.expires_at;
end;
$$;

revoke all on function public.acquire_editing_lease(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.acquire_editing_lease(text, text, text, integer) to service_role;
