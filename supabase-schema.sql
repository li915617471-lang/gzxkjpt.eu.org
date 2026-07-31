-- 信息分享平台 Supabase 数据库、权限与存储初始化（规范化数据表 v3）
-- 可重复执行。请在 Supabase Dashboard -> SQL Editor 中运行。

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 保留旧表，仅用于从 v1 自动迁移和旧版适配器兼容。
create table if not exists public.site_content (
  id text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  id text primary key,
  site jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  site_id text not null references public.site_settings(id) on delete cascade,
  name text not null,
  color text not null default '#6ee7a8',
  icon text not null default 'folder',
  enabled boolean not null default true,
  keywords jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (site_id, name),
  check (jsonb_typeof(keywords) = 'array')
);

create table if not exists public.articles (
  site_id text not null references public.site_settings(id) on delete cascade,
  id bigint not null,
  category text not null,
  title text not null,
  excerpt text not null default '',
  image text not null default '',
  source text not null default '',
  source_url text not null default '',
  author text not null default '',
  language text not null default 'zh-CN',
  status text not null default 'draft',
  scheduled_at timestamptz,
  confidence integer not null default 0,
  body text not null default '',
  time_label text not null default '',
  read_minutes integer not null default 8,
  heat integer not null default 0,
  published_date date,
  tags jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  check (status in ('draft', 'review', 'scheduled', 'published', 'archived')),
  check (confidence between 0 and 100),
  check (jsonb_typeof(tags) = 'array')
);

create index if not exists articles_public_feed_idx
on public.articles (site_id, status, scheduled_at, position);

create index if not exists articles_category_idx
on public.articles (site_id, category, position);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.site_settings(id) on delete cascade,
  article_id bigint,
  article_url text not null,
  report_type text not null default 'other',
  details text not null,
  contact text,
  status text not null default 'new',
  resolution_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (report_type in ('inaccuracy', 'copyright', 'source', 'privacy', 'other')),
  check (status in ('new', 'processing', 'resolved', 'rejected')),
  check (char_length(article_url) between 8 and 500),
  check (char_length(details) between 10 and 2000),
  check (contact is null or char_length(contact) <= 120)
);

create index if not exists content_reports_queue_idx
on public.content_reports (site_id, status, created_at desc);

alter table public.admin_users enable row level security;
alter table public.site_content enable row level security;
alter table public.site_settings enable row level security;
alter table public.categories enable row level security;
alter table public.articles enable row level security;
alter table public.content_reports enable row level security;

-- Keep table privileges explicit. RLS remains the final authorization layer.
revoke all on table
  public.admin_users,
  public.site_content,
  public.site_settings,
  public.categories,
  public.articles,
  public.content_reports
from anon, authenticated;

grant select on table
  public.site_settings,
  public.categories,
  public.articles
to anon;
grant insert on table public.content_reports to anon;

grant select on table public.admin_users to authenticated;
grant select, insert, update, delete on table
  public.site_content,
  public.site_settings,
  public.categories,
  public.articles,
  public.content_reports
to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

drop policy if exists "users can read own admin record" on public.admin_users;
create policy "users can read own admin record"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can manage legacy content" on public.site_content;
create policy "admins can manage legacy content"
on public.site_content for all
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()))
with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "public can read site settings" on public.site_settings;
create policy "public can read site settings"
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists "admins can manage site settings" on public.site_settings;
create policy "admins can manage site settings"
on public.site_settings for all
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()))
with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "public can read categories" on public.categories;
create policy "public can read categories"
on public.categories for select
to anon, authenticated
using (true);

drop policy if exists "admins can manage categories" on public.categories;
create policy "admins can manage categories"
on public.categories for all
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()))
with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "public can read visible articles" on public.articles;
create policy "public can read visible articles"
on public.articles for select
to anon, authenticated
using (
  status = 'published'
  or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
);

drop policy if exists "admins can read all articles" on public.articles;
create policy "admins can read all articles"
on public.articles for select
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "admins can manage articles" on public.articles;
create policy "admins can manage articles"
on public.articles for all
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()))
with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "public can submit content reports" on public.content_reports;
create policy "public can submit content reports"
on public.content_reports for insert
to anon, authenticated
with check (
  status = 'new'
  and resolution_note = ''
  and char_length(details) between 10 and 2000
  and char_length(article_url) between 8 and 500
);

drop policy if exists "admins can read content reports" on public.content_reports;
create policy "admins can read content reports"
on public.content_reports for select
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "admins can update content reports" on public.content_reports;
create policy "admins can update content reports"
on public.content_reports for update
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()))
with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "admins can delete content reports" on public.content_reports;
create policy "admins can delete content reports"
on public.content_reports for delete
to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create or replace function public.save_site_snapshot(p_site_id text, p_payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  item_position bigint;
  normalized_status text;
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  insert into public.site_settings (id, site, theme, extra, updated_at)
  values (
    p_site_id,
    coalesce(p_payload -> 'site', '{}'::jsonb),
    coalesce(p_payload -> 'theme', '{}'::jsonb),
    p_payload - array['site', 'theme', 'categories', 'categorySettings', 'stories']::text[],
    now()
  )
  on conflict (id) do update set
    site = excluded.site,
    theme = excluded.theme,
    extra = excluded.extra,
    updated_at = excluded.updated_at;

  delete from public.categories where site_id = p_site_id;
  for item, item_position in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_payload -> 'categorySettings', '[]'::jsonb)) with ordinality
  loop
    insert into public.categories (site_id, name, color, icon, enabled, keywords, position, updated_at)
    values (
      p_site_id,
      item ->> 'name',
      coalesce(nullif(item ->> 'color', ''), '#6ee7a8'),
      coalesce(nullif(item ->> 'icon', ''), 'folder'),
      coalesce((item ->> 'enabled')::boolean, true),
      coalesce(item -> 'keywords', '[]'::jsonb),
      item_position - 1,
      now()
    );
  end loop;

  delete from public.articles where site_id = p_site_id;
  for item, item_position in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_payload -> 'stories', '[]'::jsonb)) with ordinality
  loop
    normalized_status := case
      when item ->> 'status' in ('draft', 'review', 'scheduled', 'published', 'archived')
        then item ->> 'status'
      else 'published'
    end;

    insert into public.articles (
      site_id, id, category, title, excerpt, image, source, source_url,
      author, language, status, scheduled_at, confidence, body, time_label,
      read_minutes, heat, published_date, tags, extra, position, updated_at
    )
    values (
      p_site_id,
      (item ->> 'id')::bigint,
      coalesce(item ->> 'category', ''),
      coalesce(item ->> 'title', ''),
      coalesce(item ->> 'excerpt', ''),
      coalesce(item ->> 'image', ''),
      coalesce(item ->> 'source', ''),
      coalesce(item ->> 'sourceUrl', item ->> 'url', ''),
      coalesce(item ->> 'author', ''),
      coalesce(nullif(item ->> 'language', ''), 'zh-CN'),
      normalized_status,
      case when nullif(item ->> 'scheduledAt', '') is null then null else (item ->> 'scheduledAt')::timestamptz end,
      greatest(0, least(100, coalesce((item ->> 'confidence')::integer, 0))),
      case
        when jsonb_typeof(item -> 'body') = 'array'
          then array_to_string(array(select jsonb_array_elements_text(item -> 'body')), E'\n\n')
        else coalesce(item ->> 'body', '')
      end,
      coalesce(item ->> 'time', ''),
      greatest(1, coalesce((item ->> 'readMinutes')::integer, 8)),
      greatest(0, coalesce((item ->> 'heat')::integer, 0)),
      case when nullif(item ->> 'date', '') is null then null else (item ->> 'date')::date end,
      coalesce(item -> 'tags', '[]'::jsonb),
      item - array[
        'id', 'category', 'title', 'excerpt', 'image', 'source', 'sourceUrl',
        'author', 'language', 'status', 'scheduledAt', 'confidence', 'body',
        'time', 'readMinutes', 'heat', 'date', 'tags'
      ]::text[],
      item_position - 1,
      now()
    );
  end loop;
end;
$$;

revoke all on function public.save_site_snapshot(text, jsonb) from public;
grant execute on function public.save_site_snapshot(text, jsonb) to authenticated;

-- 从 v1 的 site_content 自动迁移。已有 v2 数据时不会覆盖。
do $$
declare
  legacy record;
begin
  for legacy in
    select id, content from public.site_content
    where jsonb_typeof(content) = 'object'
      and content ? 'stories'
      and not exists (select 1 from public.site_settings where site_settings.id = site_content.id)
  loop
    insert into public.site_settings (id, site, theme, extra, updated_at)
    values (
      legacy.id,
      coalesce(legacy.content -> 'site', '{}'::jsonb),
      coalesce(legacy.content -> 'theme', '{}'::jsonb),
      legacy.content - array['site', 'theme', 'categories', 'categorySettings', 'stories']::text[],
      now()
    );

    insert into public.categories (site_id, name, color, icon, enabled, keywords, position)
    select
      legacy.id,
      value ->> 'name',
      coalesce(nullif(value ->> 'color', ''), '#6ee7a8'),
      coalesce(nullif(value ->> 'icon', ''), 'folder'),
      coalesce((value ->> 'enabled')::boolean, true),
      coalesce(value -> 'keywords', '[]'::jsonb),
      ordinality - 1
    from jsonb_array_elements(coalesce(legacy.content -> 'categorySettings', '[]'::jsonb)) with ordinality;

    insert into public.articles (
      site_id, id, category, title, excerpt, image, source, source_url,
      author, language, status, scheduled_at, confidence, body, time_label,
      read_minutes, heat, published_date, tags, extra, position
    )
    select
      legacy.id,
      (value ->> 'id')::bigint,
      coalesce(value ->> 'category', ''),
      coalesce(value ->> 'title', ''),
      coalesce(value ->> 'excerpt', ''),
      coalesce(value ->> 'image', ''),
      coalesce(value ->> 'source', ''),
      coalesce(value ->> 'sourceUrl', value ->> 'url', ''),
      coalesce(value ->> 'author', ''),
      coalesce(nullif(value ->> 'language', ''), 'zh-CN'),
      case when value ->> 'status' in ('draft', 'review', 'scheduled', 'published', 'archived') then value ->> 'status' else 'published' end,
      case when nullif(value ->> 'scheduledAt', '') is null then null else (value ->> 'scheduledAt')::timestamptz end,
      greatest(0, least(100, coalesce((value ->> 'confidence')::integer, 80))),
      case
        when jsonb_typeof(value -> 'body') = 'array'
          then array_to_string(array(select jsonb_array_elements_text(value -> 'body')), E'\n\n')
        else coalesce(value ->> 'body', '')
      end,
      coalesce(value ->> 'time', ''),
      greatest(1, coalesce((value ->> 'readMinutes')::integer, 8)),
      greatest(0, coalesce((value ->> 'heat')::integer, 0)),
      case when nullif(value ->> 'date', '') is null then null else (value ->> 'date')::date end,
      coalesce(value -> 'tags', '[]'::jsonb),
      value - array[
        'id', 'category', 'title', 'excerpt', 'image', 'source', 'sourceUrl',
        'author', 'language', 'status', 'scheduledAt', 'confidence', 'body',
        'time', 'readMinutes', 'heat', 'date', 'tags'
      ]::text[],
      ordinality - 1
    from jsonb_array_elements(coalesce(legacy.content -> 'stories', '[]'::jsonb)) with ordinality;
  end loop;
end;
$$;

-- v2 启用后，旧 JSON 整包不再允许公开读取，避免草稿通过旧表泄露。
drop policy if exists "public can read site content" on public.site_content;
drop policy if exists "admins can insert site content" on public.site_content;
drop policy if exists "admins can update site content" on public.site_content;

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "public can read media" on storage.objects;
create policy "public can read media"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'media');

drop policy if exists "admins can upload media" on storage.objects;
create policy "admins can upload media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
);

drop policy if exists "admins can update media" on storage.objects;
create policy "admins can update media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
)
with check (
  bucket_id = 'media'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
);

drop policy if exists "admins can delete media" on storage.objects;
create policy "admins can delete media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media'
  and exists (select 1 from public.admin_users where user_id = auth.uid())
);

-- 创建管理员账号后，将下面的邮箱替换成管理员邮箱并执行：
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = '你的管理员邮箱'
-- on conflict (user_id) do nothing;
