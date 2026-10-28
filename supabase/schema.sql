-- 우리집 시세 신호 · 회원과 광고 (Supabase)
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 실행한다. 여러 번 실행해도 안전하다.
-- 첫 관리자 지정: 가입 후 아래 한 줄을 SQL Editor 에서 실행
--   update public.profiles set role = 'admin' where id = (select id from auth.users where email = '관리자이메일');

-- =========================================================
-- 회원
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  kind text check (kind in ('personal', 'business')),          -- 가입 직후에는 비어 있고, 온보딩에서 고른다
  role text not null default 'user' check (role in ('user', 'admin')),
  nickname text check (char_length(nickname) <= 30),
  phone text check (char_length(phone) <= 20),
  interest_region text check (char_length(interest_region) <= 40),
  age14_confirmed boolean not null default false,
  terms_agreed_at timestamptz,
  privacy_agreed_at timestamptz,
  marketing_opt_in boolean not null default false,
  marketing_agreed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  biz_type text not null check (biz_type in ('agent', 'sales_agency', 'other')),  -- 공인중개사, 분양대행사, 기타
  company text not null check (char_length(company) between 1 and 60),
  ceo text check (char_length(ceo) <= 30),
  brn text not null check (brn ~ '^[0-9]{10}$'),                                -- 사업자등록번호 숫자 10자리
  agent_reg_no text check (char_length(agent_reg_no) <= 30),                    -- 중개사무소 등록번호
  office_address text check (char_length(office_address) <= 120),
  office_phone text check (char_length(office_phone) <= 20),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text check (char_length(reject_reason) <= 200),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_profiles_status_idx on public.business_profiles (status);

-- 관리자 여부 (권한 규칙 안에서 profiles 를 다시 읽을 때 무한 반복을 막으려고 security definer)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 가입하면 프로필 행을 자동으로 만든다
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)), 30))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 일반 회원이 스스로 관리자 권한을 주지 못하게, 동의 시각은 서버 시간으로
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() 가 없으면 SQL Editor·서버 작업이므로 막지 않는다
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.created_at := old.created_at;
    if new.kind is distinct from old.kind and old.kind is not null then
      raise exception '회원 유형은 고객센터를 통해 바꿀 수 있어요';
    end if;
  end if;
  if new.terms_agreed_at is distinct from old.terms_agreed_at and new.terms_agreed_at is not null then new.terms_agreed_at := now(); end if;
  if new.privacy_agreed_at is distinct from old.privacy_agreed_at and new.privacy_agreed_at is not null then new.privacy_agreed_at := now(); end if;
  if new.marketing_opt_in and not coalesce(old.marketing_opt_in, false) then new.marketing_agreed_at := now(); end if;
  if not new.marketing_opt_in then new.marketing_agreed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- 기업 회원: 본인은 심사 상태를 바꿀 수 없고, 정보를 고치면 다시 심사 대기로 간다
create or replace function public.guard_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    null;  -- SQL Editor·서버 작업
  elsif public.is_admin() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  else
    new.status := 'pending';
    new.reject_reason := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_business on public.business_profiles;
create trigger guard_business before insert or update on public.business_profiles
  for each row execute function public.guard_business();

alter table public.profiles enable row level security;
alter table public.business_profiles enable row level security;

drop policy if exists "본인 프로필 보기" on public.profiles;
create policy "본인 프로필 보기" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "본인 프로필 수정" on public.profiles;
create policy "본인 프로필 수정" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists "본인 기업정보 보기" on public.business_profiles;
create policy "본인 기업정보 보기" on public.business_profiles for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "본인 기업정보 등록" on public.business_profiles;
create policy "본인 기업정보 등록" on public.business_profiles for insert with check (
  user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.kind = 'business'));
drop policy if exists "본인 기업정보 수정" on public.business_profiles;
create policy "본인 기업정보 수정" on public.business_profiles for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "관리자 기업정보 삭제" on public.business_profiles;
create policy "관리자 기업정보 삭제" on public.business_profiles for delete using (public.is_admin());

-- =========================================================
-- 광고
-- =========================================================
create table if not exists public.ad_slots (
  key text primary key,
  name text not null,
  description text,
  size_hint text,
  sort int not null default 0
);
insert into public.ad_slots (key, name, description, size_hint, sort) values
  ('top_banner', '최상단 메인 배너', '모든 화면 맨 위. 여러 개를 등록하면 6초마다 순서대로 바뀜', 'PC 1440×120 · 휴대폰 750×200', 1),
  ('agent_box', '매물 문의 (공인중개사 전용)', '단지 결론 카드 바로 아래. 보고 있는 단지에서 가까운 중개사 순. 얼굴·사무소·등록번호·전화·홈페이지', '얼굴 사진 400×400', 2),
  ('side_box', '분양 홍보 박스 (분양·대행사 전용)', 'PC 오른쪽 칸 생활 인프라 아래, 휴대폰은 근거 카드 아래', '600×400', 3),
  ('list_native', '단지 랭킹 중간', '지역 단지 목록 4번째 줄. 그 시군구의 중개사·분양 광고', '텍스트 + 작은 이미지 160×160', 4),
  ('region_box', '지역 지도 아래 박스', '지역 지도 카드 아래 빈 공간', '600×300', 5)
on conflict (key) do update set name = excluded.name, description = excluded.description, size_hint = excluded.size_hint, sort = excluded.sort;

create table if not exists public.ads (
  id bigint generated always as identity primary key,
  slot text not null references public.ad_slots (key),
  title text not null check (char_length(title) between 1 and 60),
  body text check (char_length(body) <= 120),
  cta text check (char_length(cta) <= 16),
  image_url text,
  theme text not null default 'teal' check (theme in ('teal', 'ink', 'sand', 'rose')),  -- 이미지 없는 광고의 바탕색
  link_url text check (link_url ~ '^https://'),
  advertiser_id uuid references public.profiles (id) on delete set null,
  advertiser_name text not null check (char_length(advertiser_name) between 1 and 60),
  target_sido text,          -- 비우면 전국
  target_sgg text,           -- 비우면 시도 전체
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  weight int not null default 1 check (weight between 1 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ads add column if not exists theme text not null default 'teal' check (theme in ('teal', 'ink', 'sand', 'rose'));
-- 위치 기반 광고: 광고 종류와 사무소·현장 위치. 박스 광고는 보고 있는 단지에서 가까운 순으로 고른다
alter table public.ads add column if not exists category text not null default 'other' check (category in ('agent', 'sales', 'other'));  -- 공인중개사, 분양, 기타
alter table public.ads add column if not exists lat double precision check (lat between 33 and 39);
alter table public.ads add column if not exists lng double precision check (lng between 124 and 132);
alter table public.ads add column if not exists loc_label text check (char_length(loc_label) <= 60);   -- 예: 동구 계림동 (그랜드센트럴 근처)
alter table public.ads add column if not exists loc_sgg text;
alter table public.ads add column if not exists loc_umd text;
alter table public.ads add column if not exists radius_km numeric not null default 3 check (radius_km between 0.5 and 30);
-- 매물 문의(중개사) 카드: 얼굴, 이름, 등록번호, 전화. 홈페이지는 link_url
alter table public.ads add column if not exists agent_name text check (char_length(agent_name) <= 20);
alter table public.ads add column if not exists agent_photo_url text check (agent_photo_url is null or agent_photo_url ~ '^https://');
alter table public.ads add column if not exists agent_reg_no text check (char_length(agent_reg_no) <= 30);
alter table public.ads add column if not exists phone text check (phone is null or phone ~ '^[0-9-]{8,15}$');
-- 자리별 광고 종류: 매물 문의는 공인중개사만, 오른쪽 박스는 분양·대행사만
alter table public.ads drop constraint if exists ads_slot_category;
alter table public.ads add constraint ads_slot_category check (
  (slot <> 'agent_box' or (category = 'agent' and agent_name is not null and agent_reg_no is not null and phone is not null))
  and (slot <> 'side_box' or category = 'sales'));
create index if not exists ads_live_idx on public.ads (slot, active, starts_at, ends_at);

create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  ad_id bigint not null references public.ads (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
-- imp 노출, click 클릭, call 전화 연결, web 홈페이지 이동
alter table public.ad_events drop constraint if exists ad_events_kind_check;
alter table public.ad_events add constraint ad_events_kind_check check (kind in ('imp', 'click', 'call', 'web'));
create index if not exists ad_events_ad_at_idx on public.ad_events (ad_id, at);

alter table public.ad_slots enable row level security;
alter table public.ads enable row level security;
alter table public.ad_events enable row level security;

drop policy if exists "광고 자리 공개" on public.ad_slots;
create policy "광고 자리 공개" on public.ad_slots for select using (true);
drop policy if exists "광고 자리 관리" on public.ad_slots;
create policy "광고 자리 관리" on public.ad_slots for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "게재 중 광고 공개" on public.ads;
create policy "게재 중 광고 공개" on public.ads for select using (
  (active and starts_at <= now() and (ends_at is null or ends_at > now())) or public.is_admin());
drop policy if exists "광고 관리" on public.ads;
create policy "광고 관리" on public.ads for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "광고 기록 관리자" on public.ad_events;
create policy "광고 기록 관리자" on public.ad_events for select using (public.is_admin());
-- 노출·클릭 기록은 아래 함수로만 넣는다 (게재 중인 광고만, 테이블 직접 쓰기 금지)

create or replace function public.log_ad_event(p_ad_id bigint, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('imp', 'click', 'call', 'web') then return; end if;
  insert into public.ad_events (ad_id, kind)
  select id, p_kind from public.ads
  where id = p_ad_id and active and starts_at <= now() and (ends_at is null or ends_at > now());
end $$;
revoke all on function public.log_ad_event(bigint, text) from public;
grant execute on function public.log_ad_event(bigint, text) to anon, authenticated;

drop trigger if exists ads_touch on public.ads;
create or replace function public.touch_updated() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger ads_touch before update on public.ads for each row execute function public.touch_updated();

-- =========================================================
-- 사진: 지역 풍경(지도 타일), 단지 전경(단지 카드)
-- 관광공사 사진은 수집기가 정적 파일로 넣고, 이 테이블은 관리자가 올린 사진(우선 적용)을 담는다
-- =========================================================
create table if not exists public.photos (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('region', 'complex')),
  ref text not null check (char_length(ref) between 1 and 80),   -- region: '시도|시군구', complex: 단지 고정 키(12자리)
  url text not null check (url ~ '^https://'),
  credit text not null check (char_length(credit) between 1 and 80),   -- 촬영자·제공처 (화면에 표시)
  license text not null check (char_length(license) between 1 and 60), -- 예: 공공누리 제1유형, 직접 촬영, 제공자 허락
  source_url text check (source_url is null or source_url ~ '^https://'),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists photos_one_active on public.photos (kind, ref) where active;
alter table public.photos enable row level security;
drop policy if exists "사진 공개" on public.photos;
create policy "사진 공개" on public.photos for select using (active or public.is_admin());
drop policy if exists "사진 관리" on public.photos;
create policy "사진 관리" on public.photos for all using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- 관리자용 조회
-- =========================================================
create or replace function public.admin_overview(p_days int default 7) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  select json_build_object(
    'members', (select count(*) from profiles),
    'personal', (select count(*) from profiles where kind = 'personal'),
    'business', (select count(*) from profiles where kind = 'business'),
    'onboarding', (select count(*) from profiles where kind is null),
    'pending', (select count(*) from business_profiles where status = 'pending'),
    'new_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'live_ads', (select count(*) from ads where active and starts_at <= now() and (ends_at is null or ends_at > now())),
    'imp', (select count(*) from ad_events where kind = 'imp' and at > now() - make_interval(days => p_days)),
    'click', (select count(*) from ad_events where kind = 'click' and at > now() - make_interval(days => p_days))
  ) into r;
  return r;
end $$;

create or replace function public.admin_members(p_filter text default 'all', p_search text default '') returns table (
  id uuid, email text, kind text, role text, nickname text, phone text, created_at timestamptz, provider text,
  biz_type text, company text, ceo text, brn text, agent_reg_no text, office_address text, office_phone text,
  status text, reject_reason text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return query
  select p.id, u.email::text, p.kind, p.role, p.nickname, p.phone, p.created_at, (u.raw_app_meta_data ->> 'provider')::text,
         b.biz_type, b.company, b.ceo, b.brn, b.agent_reg_no, b.office_address, b.office_phone, b.status, b.reject_reason
  from profiles p join auth.users u on u.id = p.id
  left join business_profiles b on b.user_id = p.id
  where (p_filter = 'all' or (p_filter = 'pending' and b.status = 'pending') or p.kind = p_filter)
    and (p_search = '' or u.email ilike '%' || p_search || '%' or p.nickname ilike '%' || p_search || '%' or b.company ilike '%' || p_search || '%')
  order by (b.status = 'pending') desc nulls last, p.created_at desc
  limit 500;
end $$;

drop function if exists public.admin_ad_stats(int);
create or replace function public.admin_ad_stats(p_days int default 30) returns table (ad_id bigint, imp bigint, click bigint, call bigint, web bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  return query
  select e.ad_id, count(*) filter (where e.kind = 'imp'), count(*) filter (where e.kind in ('click', 'call', 'web')),
         count(*) filter (where e.kind = 'call'), count(*) filter (where e.kind = 'web')
  from ad_events e where e.at > now() - make_interval(days => p_days) group by e.ad_id;
end $$;
revoke all on function public.admin_overview(int), public.admin_members(text, text), public.admin_ad_stats(int) from public, anon;
grant execute on function public.admin_overview(int), public.admin_members(text, text), public.admin_ad_stats(int) to authenticated;

-- =========================================================
-- 광고 이미지 저장소 (공개 읽기, 관리자만 올리기)
-- =========================================================
insert into storage.buckets (id, name, public) values ('ads', 'ads', true) on conflict (id) do nothing;
drop policy if exists "광고 이미지 관리자 업로드" on storage.objects;
create policy "광고 이미지 관리자 업로드" on storage.objects for insert to authenticated with check (bucket_id = 'ads' and public.is_admin());
drop policy if exists "광고 이미지 관리자 수정" on storage.objects;
create policy "광고 이미지 관리자 수정" on storage.objects for update to authenticated using (bucket_id = 'ads' and public.is_admin());
drop policy if exists "광고 이미지 관리자 삭제" on storage.objects;
create policy "광고 이미지 관리자 삭제" on storage.objects for delete to authenticated using (bucket_id = 'ads' and public.is_admin());
