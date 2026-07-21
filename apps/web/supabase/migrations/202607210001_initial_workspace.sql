create table if not exists public.bookstores (
  id bigint primary key,
  name text not null,
  region text not null,
  address text not null default '',
  hours text not null default '',
  phone text not null default '',
  sns text not null default '',
  website text not null default '',
  introduction text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id bigint primary key,
  bookstore_id bigint not null references public.bookstores(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null check (status in ('draft', 'completed')),
  updated_at timestamptz not null,
  completed_at timestamptz,
  published_at timestamptz,
  published_url text not null default '',
  news jsonb not null default '[]'::jsonb,
  unique (bookstore_id, month)
);

create index if not exists submissions_month_idx on public.submissions(month);
create index if not exists submissions_bookstore_month_idx on public.submissions(bookstore_id, month);

alter table public.bookstores enable row level security;
alter table public.submissions enable row level security;

revoke all on public.bookstores from anon, authenticated;
revoke all on public.submissions from anon, authenticated;
grant all on public.bookstores to service_role;
grant all on public.submissions to service_role;

create or replace function public.replace_bookstore_news_workspace(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bookstores (id, name, region, address, hours, phone, sns, website, introduction, sort_order, updated_at)
  select id, name, region, address, hours, phone, sns, website, introduction, sort_order, now()
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
    sort_order = excluded.sort_order,
    updated_at = now();

  insert into public.submissions (id, bookstore_id, month, status, updated_at, completed_at, published_at, published_url, news)
  select id, bookstore_id, month, status, updated_at, completed_at, published_at, published_url, news
  from jsonb_to_recordset(coalesce(payload->'submissions', '[]'::jsonb)) as item(
    id bigint,
    bookstore_id bigint,
    month text,
    status text,
    updated_at timestamptz,
    completed_at timestamptz,
    published_at timestamptz,
    published_url text,
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
values (
  'bookstore-news',
  'bookstore-news',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
