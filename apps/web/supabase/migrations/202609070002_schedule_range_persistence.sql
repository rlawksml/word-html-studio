-- v1.1 기간 일정: 기존 submissions.news JSON을 변경하지 않고 별도 테이블에 원자적으로 저장합니다.
alter table public.news_schedule_ranges
  add column if not exists is_active boolean not null default true;

create index if not exists news_schedule_ranges_active_dates_idx
  on public.news_schedule_ranges(is_active, start_date, end_date);

create or replace function public.save_submission_with_schedule_ranges(
  p_submission_id bigint,
  p_bookstore_id bigint,
  p_month text,
  p_status text,
  p_expected_updated_at timestamptz,
  p_updated_at timestamptz,
  p_completed_at timestamptz,
  p_published_at timestamptz,
  p_published_url text,
  p_monthly_notice text,
  p_news jsonb,
  p_schedule_ranges jsonb,
  p_sync_ranges boolean
)
returns setof public.submissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_rows integer;
begin
  if p_expected_updated_at is null then
    insert into public.submissions (
      id, bookstore_id, month, status, updated_at, completed_at,
      published_at, published_url, monthly_notice, news
    ) values (
      p_submission_id, p_bookstore_id, p_month, p_status, p_updated_at, p_completed_at,
      p_published_at, p_published_url, p_monthly_notice, p_news
    );
  else
    update public.submissions set
      bookstore_id = p_bookstore_id,
      month = p_month,
      status = p_status,
      updated_at = p_updated_at,
      completed_at = p_completed_at,
      published_at = p_published_at,
      published_url = p_published_url,
      monthly_notice = p_monthly_notice,
      news = p_news
    where id = p_submission_id
      and updated_at = p_expected_updated_at;

    get diagnostics affected_rows = row_count;
    if affected_rows = 0 then
      return;
    end if;
  end if;

  if p_sync_ranges then
    -- 삭제 대신 비활성화해 롤백·감사 시 기존 기간 값을 복원할 수 있게 합니다.
    update public.news_schedule_ranges
      set is_active = false, updated_at = p_updated_at
      where submission_id = p_submission_id and is_active = true;

    insert into public.news_schedule_ranges (
      submission_id, news_item_id, start_date, end_date, is_active, updated_at
    )
    select
      p_submission_id,
      item.news_item_id,
      item.start_date,
      item.end_date,
      true,
      p_updated_at
    from jsonb_to_recordset(coalesce(p_schedule_ranges, '[]'::jsonb)) as item(
      news_item_id bigint,
      start_date date,
      end_date date
    )
    on conflict (submission_id, news_item_id) do update set
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_active = true,
      updated_at = excluded.updated_at;
  end if;

  return query
    select submission.* from public.submissions as submission
    where submission.id = p_submission_id and submission.updated_at = p_updated_at;
end;
$$;

revoke all on function public.save_submission_with_schedule_ranges(
  bigint, bigint, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated;

grant execute on function public.save_submission_with_schedule_ranges(
  bigint, bigint, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, text, text, jsonb, jsonb, boolean
) to service_role;

insert into public.app_schema_versions (component, version, applied_at)
values ('workspace', 202609070002, now())
on conflict (component) do update set
  version = greatest(public.app_schema_versions.version, excluded.version),
  applied_at = case
    when public.app_schema_versions.version < excluded.version then excluded.applied_at
    else public.app_schema_versions.applied_at
  end;
