# 우리집 AI시세 — Claude Code 작업 안내

이 파일은 Claude Code가 이 저장소에서 일할 때 매번 먼저 읽는 규칙이다. 사람이 읽어도 된다.

## 제품
- 지역별 아파트 실거래 기반 AI 시세 서비스. 지역 페이지 하나에 다음 기능이 있다.
  - 단지 시세 신호
  - 호가 판단 ("이 가격에 사도 될까요?")
  - 브랜드 종합지수 순위
  - 생활 인프라
  - 광고 자리
- 지금 열린 지역은 `전남광주`(slug `jeonnam-gwangju`) 하나다. 지역은 `regions.json`에 추가하는 방식으로 늘린다.
- 사용자 대부분은 휴대폰으로 본다. 모든 화면은 휴대폰(≤560px), 태블릿(760px~), PC(1180px~)에서 확인한다.

## 구조
| 경로 | 역할 |
| --- | --- |
| `pipeline/collect.py` | 공공데이터포털 실거래 API 수집 (매일, 최근 3개월 재수집 + 과거 이어 받기) |
| `pipeline/import_files.py` | 실거래가 공개시스템 엑셀/CSV 가져오기 |
| `pipeline/clean.py` | 해제·이상 거래 제거, 면적대, 단지 키 |
| `pipeline/scoring.py` | AI 시세 점수 (시도 안 상대 점수, 가중치 W) |
| `pipeline/brands.py` | 단지명→브랜드 사전, 브랜드 종합지수 |
| `pipeline/infra.py` | 카카오 로컬 API: 단지 좌표(먼저) → 생활 인프라 |
| `pipeline/media.py` | 한국관광공사 관광사진 API: 시군구 풍경 사진 |
| `pipeline/build.py` | 지역별 화면 데이터 `site/data/{slug}/` 생성 |
| `pipeline/site.py` | `web/index.html` 템플릿 → `site/{slug}.html` 지역 페이지 + 허브 `site/index.html` |
| `web/` | 화면. `index.html`은 지역 템플릿이고 `{{REGION_LABEL}}`, `{{REGION_JSON}}`을 site.py가 채운다 |
| `web/backend.js` | 회원·광고 저장소. config.js가 비면 DemoBackend(브라우저 저장), 채우면 LiveBackend(Supabase) |
| `web/account.js` | 간편가입·일반/기업 회원·내 정보 |
| `web/geo.js` | 위치 규칙: 첫 화면 단지 고르기(pickDefault), 광고 순서(rankAds). 브라우저·Node 테스트 공용 |
| `web/media.js` | 지역 풍경·단지 전경 사진, 사진 없을 때 그림 |
| `web/ads.js` | 광고 자리: top_banner, agent_box(중개사 전용), side_box(분양 전용), list_native, region_box |
| `web/admin.*` | 관리자: 대시보드, 회원(기업 승인), 광고 관리 |
| `supabase/schema.sql` | DB·권한(RLS). 바꾸면 반드시 `supabase/test/run.sh` 통과 |
| `research/` | 백테스트 연구 코드 (서비스 경로 아님) |

## 꼭 지킬 것
- **데이터 정직성:** 화면 수치는 실제 데이터에서만 나온다. 예시 값을 넣으면 화면에 "예시"라고 표시한다.
- **점수의 성격:** 점수는 "같은 지역 다른 아파트 대비 상대 신호"다. "오른다"고 단정하는 문구, 수익 보장 표현, "AI가 예측한 상승 단지" 같은 광고 문구는 쓰지 않는다 (표시광고법).
- **광고 표시:** 광고에는 항상 '광고' 라벨을 붙인다. 링크에는 `rel="sponsored noopener"`를 넣고, https만 허용한다.
- **자리 규칙:** 매물 문의(agent_box)는 공인중개사만 쓴다(이름·등록번호·전화 필수). 오른쪽 박스(side_box)는 분양·대행사만 쓴다. DB 제약(ads_slot_category)과 backend.js slotRule이 같아야 한다.
- **사진:** 출처와 이용 조건이 확인된 사진만 쓰고 화면에 출처를 표시한다. 포털·앱 단지 사진은 쓰지 않는다. 사진이 없을 때 쓰는 그림에는 "그림"이라고 밝힌다.
- **권한:** 권한은 클라이언트가 아니라 RLS가 지킨다. 화면에서만 막는 코드는 보안이 아니다.
- **키 관리:** service_role 키, API 키는 코드와 커밋에 넣지 않는다. GitHub Secrets와 config.js의 anon key만 쓴다.
- **문구와 디자인:**
  - 화면 문구는 쉬운 한국어 해요체로 쓴다.
  - 색은 style.css 토큰만 쓰고, 라이트·다크 모두 확인한다.
  - 지역 이름 색은 `--region`이다.
- **스크래핑 금지:** 네이버 부동산 등 타사 매물을 크롤링하지 않는다 (DB권 침해 판례 있음). 매물은 제휴로만 확보한다.

## 확인 명령
```bash
python -m tests.test_collect                      # API 응답 해석
node tests/test_geo.js                            # 위치 규칙
bash supabase/test/run.sh                         # 권한(RLS) 테스트, 로컬 Postgres 16 필요
python -m pipeline.build && python -m pipeline.site
(cd site && python -m http.server 8765) & node tests/e2e_demo.js shots   # 체험 모드 화면 흐름
python3 tests/make_geo_fixture.py && (cd site_geo && python -m http.server 8766) & node tests/e2e_geo.js   # 위치 흉내 (가짜 좌표)
```
작업을 끝내기 전에 위 테스트 중 바뀐 부분과 관련된 것을 돌리고 결과를 알려 준다.

## 작업 방식
- 기능 단위로 플랜 모드에서 계획을 먼저 세운다. 계획에는 다음을 넣는다.
  - 바꿀 파일
  - DB 변경 여부
  - 테스트 방법
  - 휴대폰 화면 영향
- DB 스키마를 바꾸면 `schema.sql`은 여러 번 실행해도 안전하게 유지한다 (`if not exists`, `drop policy if exists`). 테스트도 함께 추가한다.
- 새 지역을 열 때는 다음 순서를 따른다.
  1. `regions.json` 수정
  2. `python -m pipeline.brands unmatched site/data/{slug}`로 브랜드 사전 보강
  3. build
  4. site
  5. e2e 테스트
