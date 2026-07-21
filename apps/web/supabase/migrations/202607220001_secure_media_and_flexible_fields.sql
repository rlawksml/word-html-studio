alter table public.bookstores
  add column if not exists contacts jsonb not null default '[]'::jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb;

alter table public.submissions
  add column if not exists monthly_notice text not null default '';

create or replace function public.replace_bookstore_news_workspace(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bookstores (id, name, region, address, hours, phone, sns, website, introduction, contacts, links, sort_order, updated_at)
  select id, name, region, address, hours, phone, sns, website, introduction, contacts, links, sort_order, now()
  from jsonb_to_recordset(coalesce(payload->'bookstores', '[]'::jsonb)) as item(
    id bigint,
    name text,
    region text,
    address text,
    hours text,
    phone text,
    sns text,
    website text,
    introduction text,
    contacts jsonb,
    links jsonb,
    sort_order integer
  )
  on conflict (id) do update set
    name = excluded.name,
    region = excluded.region,
    address = excluded.address,
    hours = excluded.hours,
    phone = excluded.phone,
    sns = excluded.sns,
    website = excluded.website,
    introduction = excluded.introduction,
    contacts = excluded.contacts,
    links = excluded.links,
    sort_order = excluded.sort_order,
    updated_at = now();

  insert into public.submissions (id, bookstore_id, month, status, updated_at, completed_at, published_at, published_url, monthly_notice, news)
  select id, bookstore_id, month, status, updated_at, completed_at, published_at, published_url, monthly_notice, news
  from jsonb_to_recordset(coalesce(payload->'submissions', '[]'::jsonb)) as item(
    id bigint,
    bookstore_id bigint,
    month text,
    status text,
    updated_at timestamptz,
    completed_at timestamptz,
    published_at timestamptz,
    published_url text,
    monthly_notice text,
    news jsonb
  )
  on conflict (id) do update set
    bookstore_id = excluded.bookstore_id,
    month = excluded.month,
    status = excluded.status,
    updated_at = excluded.updated_at,
    completed_at = excluded.completed_at,
    published_at = excluded.published_at,
    published_url = excluded.published_url,
    monthly_notice = excluded.monthly_notice,
    news = excluded.news;

  delete from public.submissions
  where id not in (
    select (item->>'id')::bigint
    from jsonb_array_elements(coalesce(payload->'submissions', '[]'::jsonb)) as item
  );

  delete from public.bookstores
  where id not in (
    select (item->>'id')::bigint
    from jsonb_array_elements(coalesce(payload->'bookstores', '[]'::jsonb)) as item
  );
end;
$$;

revoke all on function public.replace_bookstore_news_workspace(jsonb) from public, anon, authenticated;
grant execute on function public.replace_bookstore_news_workspace(jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'bookstore-news-originals',
    'bookstore-news-originals',
    false,
    20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  ),
  (
    'bookstore-news-previews',
    'bookstore-news-previews',
    true,
    5242880,
    array['image/jpeg']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 초기 프로토타입 버킷이 남아 있더라도 원본 경로가 공개되지 않게 전환합니다.
update storage.buckets set public = false where id = 'bookstore-news';
