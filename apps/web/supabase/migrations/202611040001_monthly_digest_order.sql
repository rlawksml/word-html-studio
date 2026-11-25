-- 통합본 순서만 추가합니다. 기존 소식/기간/사진/workspace marker는 변경하지 않습니다.
begin;
set local lock_timeout = '2s';

-- 같은 component의 migration은 동일 advisory key를 사용해 병렬 적용을 직렬화합니다.
do $precondition$
declare
  workspace_version bigint;
  digest_version bigint;
  order_table regclass;
  ids_function regprocedure;
  save_function regprocedure;
begin
  perform pg_advisory_xact_lock(20261104, 1);
  if to_regclass('public.app_schema_versions') is null then
    raise exception using errcode = 'PDS01', message = 'DIGEST_ORDER_BASE_SCHEMA_REQUIRED';
  end if;
  select version into workspace_version from public.app_schema_versions
  where component = 'workspace' for share;
  if workspace_version is null or workspace_version < 202609070002 then
    raise exception using errcode = 'PDS01', message = 'DIGEST_ORDER_BASE_SCHEMA_REQUIRED';
  end if;
  select version into digest_version from public.app_schema_versions
  where component = 'digest_order' for update;
  if digest_version is not null and digest_version <> 202611040001 then
    raise exception using errcode = 'PDS01', message = 'DIGEST_ORDER_SCHEMA_VERSION_UNSUPPORTED';
  end if;
  order_table := to_regclass('public.monthly_digest_orders');
  ids_function := to_regprocedure('public.valid_monthly_digest_ids(bigint[])');
  save_function := to_regprocedure('public.save_monthly_digest_order(text,bigint[],bigint,text)');
  if digest_version is null and (order_table is not null or ids_function is not null or save_function is not null) then
    raise exception using errcode = 'PDS02', message = 'DIGEST_ORDER_UNOWNED_SCHEMA_OBJECTS';
  end if;
  if digest_version is not null and (order_table is null or ids_function is null or save_function is null) then
    raise exception using errcode = 'PDS03', message = 'DIGEST_ORDER_SCHEMA_OBJECTS_MISSING';
  end if;
end;
$precondition$;

create or replace function public.valid_monthly_digest_ids(p_ids bigint[])
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    p_ids is not null
    and cardinality(p_ids) <= 500
    and (cardinality(p_ids) = 0 or (array_ndims(p_ids) = 1 and array_lower(p_ids, 1) = 1))
    and not exists (
      select 1 from unnest(p_ids) as item(id)
      where item.id is null or item.id < 1 or item.id > 9007199254740991
    )
    and (select count(distinct item.id) from unnest(p_ids) as item(id)) = cardinality(p_ids),
    false
  );
$$;

create table if not exists public.monthly_digest_orders (
  month text primary key check (char_length(month) = 7 and month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  submission_ids bigint[] not null check (public.valid_monthly_digest_ids(submission_ids)),
  revision bigint not null check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);

alter table public.monthly_digest_orders enable row level security;
revoke all on public.monthly_digest_orders from public, anon, authenticated;
grant all on public.monthly_digest_orders to service_role;
revoke all on function public.valid_monthly_digest_ids(bigint[]) from public, anon, authenticated;
grant execute on function public.valid_monthly_digest_ids(bigint[]) to service_role;

create or replace function public.save_monthly_digest_order(
  p_month text,
  p_submission_ids bigint[],
  p_expected_revision bigint,
  p_session_hash text
)
returns setof public.monthly_digest_orders
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set lock_timeout = '2s'
as $$
declare
  current_lease public.editing_leases%rowtype;
  saved public.monthly_digest_orders%rowtype;
  locked_count integer;
begin
  if p_month is null or char_length(p_month) <> 7
    or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or not public.valid_monthly_digest_ids(p_submission_ids)
    or p_expected_revision is null or p_expected_revision < 0
    or p_expected_revision >= 9007199254740991
    or p_session_hash is null or char_length(p_session_hash) <> 64
    or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PDI01', message = 'DIGEST_ORDER_INVALID';
  end if;

  -- 임대 검사와 CAS를 한 트랜잭션에 묶어 확인 이후 다른 소유자가 끼어들지 못하게 합니다.
  select lease.* into current_lease
  from public.editing_leases as lease
  where lease.resource_key = 'digest:' || p_month
  for update;
  if not found or current_lease.role is distinct from 'html'
    or current_lease.session_hash is distinct from p_session_hash
    or current_lease.expires_at is null or current_lease.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PDL01', message = 'DIGEST_ORDER_LEASE_REQUIRED';
  end if;

  -- ID 검증 중 삭제/월 이동과 경합하지 않게 읽기 잠금만 잡습니다. 상태가 draft여도 유지합니다.
  perform submission.id from public.submissions as submission
  where submission.id = any(p_submission_ids)
  order by submission.id
  for share;
  -- A missing ID inserted after this statement must not pass the following JOIN unlocked.
  get diagnostics locked_count = row_count;
  if locked_count <> cardinality(p_submission_ids) then
    raise exception using errcode = 'PDI01', message = 'DIGEST_ORDER_INVALID';
  end if;
  if exists (
    select 1 from unnest(p_submission_ids) as requested(id)
    left join public.submissions as submission on submission.id = requested.id
    where submission.id is null or submission.month <> p_month
  ) then
    raise exception using errcode = 'PDI01', message = 'DIGEST_ORDER_INVALID';
  end if;
  if current_lease.expires_at <= clock_timestamp() then
    raise exception using errcode = 'PDL01', message = 'DIGEST_ORDER_LEASE_REQUIRED';
  end if;

  if p_expected_revision = 0 then
    insert into public.monthly_digest_orders as target (month, submission_ids, revision, updated_at)
    values (p_month, p_submission_ids, 1, clock_timestamp())
    on conflict (month) do nothing
    returning target.* into saved;
  else
    update public.monthly_digest_orders as target set
      submission_ids = p_submission_ids,
      revision = target.revision + 1,
      updated_at = clock_timestamp()
    where target.month = p_month and target.revision = p_expected_revision
    returning target.* into saved;
  end if;
  if not found then
    raise exception using errcode = 'PDC01', message = 'DIGEST_ORDER_CONFLICT';
  end if;
  return next saved;
  return;
end;
$$;

revoke all on function public.save_monthly_digest_order(text, bigint[], bigint, text) from public, anon, authenticated;
grant execute on function public.save_monthly_digest_order(text, bigint[], bigint, text) to service_role;

insert into public.app_schema_versions (component, version, applied_at)
values ('digest_order', 202611040001, now())
on conflict (component) do update set
  version = greatest(public.app_schema_versions.version, excluded.version),
  applied_at = case
    when public.app_schema_versions.version < excluded.version then excluded.applied_at
    else public.app_schema_versions.applied_at
  end;

commit;
