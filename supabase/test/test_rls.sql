-- 권한 규칙 테스트. 실패하면 예외가 나며 멈춘다.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  if u is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception '실패: %', msg; end if; raise notice '통과: %', msg; end $$;

-- 사용자 셋: 일반 A, 기업 B, 관리자 C
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.kr', '{"name":"김일반"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.kr', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.kr', '{}');
select pg_temp.ok((select count(*) = 3 from public.profiles), '가입하면 프로필이 자동으로 생김');
select pg_temp.ok((select nickname = '김일반' from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), '소셜 이름이 닉네임으로 들어감');
-- SQL Editor 에서 첫 관리자 지정
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select role = 'admin' from public.profiles where id = '00000000-0000-0000-0000-00000000000c'), 'SQL Editor 에서 관리자 지정 가능');

-- 일반 회원 A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.profiles set kind = 'personal', age14_confirmed = true, terms_agreed_at = '2000-01-01', privacy_agreed_at = now(), role = 'admin' where id = auth.uid();
select pg_temp.ok((select role = 'user' and kind = 'personal' from public.profiles where id = auth.uid()), '본인이 관리자 권한을 줄 수 없음');
select pg_temp.ok((select terms_agreed_at > now() - interval '1 minute' from public.profiles where id = auth.uid()), '약관 동의 시각은 서버 시간으로 기록');
select pg_temp.ok((select count(*) = 1 from public.profiles), '다른 회원 프로필은 안 보임');
update public.profiles set nickname = '해킹' where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.ok((select nickname is distinct from '해킹' from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), '다른 회원 프로필을 고칠 수 없음');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin update public.profiles set kind = 'business' where id = auth.uid(); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 회원 유형 변경이 막히지 않음'; end if; end;
  raise notice '통과: 정해진 회원 유형은 본인이 바꿀 수 없음';
end $$;
do $$ begin
  begin insert into public.business_profiles (user_id, biz_type, company, brn) values (auth.uid(), 'agent', '가짜', '1234567890'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 일반 회원이 기업정보를 넣음'; end if; end;
  raise notice '통과: 일반 회원은 기업정보를 등록할 수 없음';
end $$;
do $$ begin
  begin perform public.admin_overview(); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 일반 회원이 관리자 통계를 봄'; end if; end;
  raise notice '통과: 일반 회원은 관리자 통계를 볼 수 없음';
end $$;

-- 기업 회원 B
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update public.profiles set kind = 'business', age14_confirmed = true, terms_agreed_at = now(), privacy_agreed_at = now() where id = auth.uid();
insert into public.business_profiles (user_id, biz_type, company, ceo, brn, agent_reg_no, status)
  values (auth.uid(), 'agent', '한빛공인중개사사무소', '박대표', '1234567891', '29110-2020-00012', 'approved');
select pg_temp.ok((select status = 'pending' from public.business_profiles where user_id = auth.uid()), '기업 회원이 스스로 승인할 수 없음');
reset role;

-- 관리자 C
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 3 from public.profiles), '관리자는 모든 회원을 봄');
select pg_temp.ok((select (public.admin_overview() ->> 'pending')::int = 1), '관리자 통계에 승인 대기 1건');
select pg_temp.ok((select count(*) = 1 from public.admin_members('pending', '')), '승인 대기 목록 조회');
update public.business_profiles set status = 'approved' where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select status = 'approved' and reviewed_by = auth.uid() and reviewed_at is not null from public.business_profiles where user_id = '00000000-0000-0000-0000-00000000000b'), '관리자 승인과 심사자 기록');
insert into public.ads (slot, title, advertiser_name, link_url, advertiser_id) values
  ('top_banner', '게재 중 광고', '한빛공인중개사사무소', 'https://example.com', '00000000-0000-0000-0000-00000000000b');
insert into public.ads (slot, title, advertiser_name, starts_at, category) values ('side_box', '예약 광고', '새솔분양', now() + interval '3 days', 'sales');
insert into public.ads (slot, title, advertiser_name, active, category) values ('side_box', '중지 광고', '새솔분양', false, 'sales');
do $$ begin
  begin insert into public.ads (slot, title, advertiser_name, category) values ('side_box', '중개사가 분양 자리에', '누구', 'agent'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 오른쪽 박스에 중개사 광고'; end if; end;
  raise notice '통과: 오른쪽 박스는 분양·대행사 광고만';
end $$;
do $$ begin
  begin insert into public.ads (slot, title, advertiser_name, category, agent_name) values ('agent_box', '등록번호 없음', '누구', 'agent', '김중개'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 등록번호·전화 없는 매물 문의 광고'; end if; end;
  raise notice '통과: 매물 문의 광고는 중개사 이름·등록번호·전화 필수';
end $$;
insert into public.ads (slot, title, advertiser_name, category, agent_name, agent_reg_no, phone) values ('agent_box', '매물 문의', '한빛공인중개사사무소', 'agent', '박중개', '29110-2024-00012', '062-000-0000');
do $$ begin
  begin insert into public.ads (slot, title, advertiser_name, active, lat, lng) values ('side_box', '잘못된 좌표', '누구', false, 10, 10); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 한국 밖 좌표가 들어감'; end if; end;
  raise notice '통과: 광고 위치는 한국 좌표 범위만 허용';
end $$;
do $$ begin
  begin insert into public.ads (slot, title, advertiser_name, link_url) values ('side_box', '나쁜 링크', '누구', 'javascript:alert(1)'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: https 가 아닌 링크가 들어감'; end if; end;
  raise notice '통과: 광고 링크는 https 만 허용';
end $$;
select pg_temp.ok((select count(*) = 4 from public.ads), '관리자는 모든 광고를 봄');
insert into public.photos (kind, ref, url, credit, license) values ('region', '전남광주통합특별시|동구', 'https://example.com/a.jpg', '한국관광공사', '공공누리 제1유형');
do $$ begin
  begin insert into public.photos (kind, ref, url, credit, license) values ('region', '전남광주통합특별시|동구', 'https://example.com/b.jpg', 'x', 'y'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 같은 지역 사진이 두 장 활성'; end if; end;
  raise notice '통과: 지역·단지마다 사용 중인 사진은 한 장';
end $$;
reset role;

-- 기업 회원 B 가 정보를 고치면 다시 심사 대기
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update public.business_profiles set office_phone = '062-000-0000' where user_id = auth.uid();
select pg_temp.ok((select status = 'pending' from public.business_profiles where user_id = auth.uid()), '기업정보를 고치면 다시 승인 대기');
reset role;

-- 손님(비로그인)
select pg_temp.as_user(null);
select pg_temp.ok((select count(*) = 2 from public.ads), '손님에게는 게재 중 광고만 보임');
select pg_temp.ok((select count(*) = 0 from public.profiles), '손님은 회원 정보를 볼 수 없음');
select pg_temp.ok((select count(*) = 1 from public.photos), '손님도 사진은 봄');
do $$ begin
  begin insert into public.photos (kind, ref, url, credit, license) values ('complex', 'abc', 'https://example.com/c.jpg', 'x', 'y'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 손님이 사진을 등록'; end if; end;
  raise notice '통과: 손님은 사진을 등록할 수 없음';
end $$;
select public.log_ad_event((select id from public.ads where slot = 'top_banner'), 'imp');
select public.log_ad_event((select id from public.ads where slot = 'agent_box'), 'call');
select public.log_ad_event(999999, 'imp');
do $$ begin
  begin insert into public.ad_events (ad_id, kind) values (1, 'click'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 손님이 기록 테이블에 직접 씀'; end if; end;
  raise notice '통과: 기록 테이블에 직접 쓸 수 없음';
end $$;
do $$ begin
  begin update public.ads set title = '변조'; if found then raise exception 'X'; end if;
  exception when others then if sqlerrm = 'X' then raise exception '실패: 손님이 광고를 고침'; end if; end;
  raise notice '통과: 손님은 광고를 고칠 수 없음';
end $$;
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('ads', 'x.png'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 손님이 이미지를 올림'; end if; end;
  raise notice '통과: 손님은 광고 이미지를 올릴 수 없음';
end $$;
reset role;
select pg_temp.ok((select count(*) = 2 from public.ad_events), '게재 중 광고의 노출·전화 연결만 기록됨 (없는 광고는 무시)');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('ads', 'x.png'); raise exception 'X';
  exception when others then if sqlerrm = 'X' then raise exception '실패: 일반 회원이 이미지를 올림'; end if; end;
  raise notice '통과: 일반 회원은 광고 이미지를 올릴 수 없음';
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into storage.objects (bucket_id, name) values ('ads', 'ok.png');
select pg_temp.ok((select count(*) = 2 and sum(call) = 1 from public.admin_ad_stats(30)), '관리자 광고 성과 조회 (전화 연결 집계)');
reset role;
\echo 모든 권한 테스트 통과
