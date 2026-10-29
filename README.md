# 우리집 AI시세

지역별 아파트 실거래로 단지별 AI 시세 신호, 호가 판단, 브랜드 순위, 생활 인프라를 보여주는 반응형 웹 서비스입니다. 회원가입(일반·기업), 광고 자리, 관리자 화면이 포함돼 있습니다.

- 데이터 수집과 화면 배포: GitHub Actions가 매일 새벽 자동으로 처리합니다. GitHub Pages라 서버 비용이 들지 않습니다.
- 회원과 광고: Supabase(무료 요금제로 시작 가능)를 씁니다. 설정 전에는 브라우저 안에서만 도는 **체험 모드**로 동작합니다.

```
공공데이터포털 ─ collect ─┐                         ┌─ site/index.html (지역 허브)
카카오 로컬 ── infra ────┼─ build ─ site/data/{지역}/ ├─ site/{지역}.html (지역 페이지, 템플릿 1개로 찍어냄)
실거래 엑셀 ── import ───┘                         └─ site/admin.html (관리자)
                                  Supabase (회원·광고·노출 기록) ←→ 브라우저
```

## 1. 데이터 자동 수집 설정 (약 20분)

1. **API 키 발급**
   - [공공데이터포털](https://www.data.go.kr)에서 아래 세 서비스를 각각 활용신청하고, **일반 인증키(Decoding)**를 받습니다.
     - 국토교통부_아파트 매매 실거래가 상세 자료
     - 국토교통부_아파트 전월세 실거래가 자료
     - 행정안전부_법정동코드
   - [카카오 개발자](https://developers.kakao.com)에서 **REST API 키**를 받습니다. 생활 인프라용이고, 없어도 나머지 기능은 동작합니다.
2. **GitHub 저장소**를 만들고 이 폴더를 올립니다.
3. **Settings → Secrets and variables → Actions**에 `DATA_GO_KR_KEY`, `KAKAO_REST_KEY`를 등록합니다.
4. **Settings → Pages → Source**를 `GitHub Actions`로 바꿉니다.
5. **Actions → 매일 수집·빌드·배포 → Run workflow**로 첫 실행을 합니다. 이후에는 매일 새벽 4시 17분(한국 시간)에 자동으로 돕니다.

호출량은 매일 갱신에 1,500~2,500회, 2020년부터 과거 적재에 약 4만 회입니다. 과거 적재는 하루 한도 안에서 며칠에 나눠 자동으로 이어 받습니다. 한도에 닿으면 수집기가 멈췄다가 다음 날 이어 받으니, 한도가 부족하면 공공데이터포털에서 운영계정으로 트래픽 증설을 신청하세요.

### 지역 부동산 뉴스 (선택)
화면 오른쪽 '○○ 부동산 뉴스' 칸은 네이버 뉴스 검색 API로 채워요. 크롤링이 아니라 공식 API라서 이용 약관 안에서 써요. 기사 제목·언론사·시각·원문 링크만 저장하고 본문은 저장하지 않아요.
1. [네이버 개발자센터](https://developers.naver.com) → Application → 애플리케이션 등록 → 사용 API에서 **검색** 선택, 환경은 **WEB 설정**에 사이트 주소 입력
2. 발급된 **Client ID**, **Client Secret**을 GitHub **Settings → Secrets and variables → Actions**에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`으로 등록
3. **Actions → 지역 부동산 뉴스 → Run workflow**. 이후 한국 시간 07~23시에 2시간마다 자동으로 갱신돼요 (news 브랜치)
4. 지역별 검색어·제외어는 `regions.json`의 `news`에서 바꿔요 (예: 경기 광주 기사 제외)

## 2. 회원·광고 서버 연결 (Supabase, 약 30분)

1. [Supabase](https://supabase.com)에서 프로젝트를 만듭니다. 서울 리전을 고르세요.
2. **SQL Editor**에 `supabase/schema.sql` 전체를 붙여 넣고 실행합니다. 테이블, 권한 규칙, 광고 이미지 저장소가 만들어집니다.
3. **Authentication → Providers**에서 로그인 방법을 켭니다.
   - **Kakao:** 카카오 개발자 앱의 REST API 키를 Client ID로, Client Secret을 넣습니다. 카카오 앱의 Redirect URI에는 Supabase가 보여주는 Callback URL을 등록합니다. 이메일 동의 항목을 받으려면 카카오 비즈 앱 전환이 필요할 수 있습니다.
   - **Google:** Google Cloud Console에서 OAuth 클라이언트를 만들고, Callback URL을 등록합니다.
   - **Email:** 기본으로 켜져 있습니다. 매직 링크로 로그인합니다.
4. **Authentication → URL Configuration**의 Site URL과 Redirect URLs에 GitHub Pages 주소(예: `https://아이디.github.io/저장소/`)를 넣습니다.
5. **Project Settings → API**의 Project URL과 anon public key를 `web/config.js`에 넣고 커밋합니다. anon key는 공개돼도 되는 키입니다. service_role 키는 절대 넣지 마세요.
6. 서비스에서 한 번 로그인한 뒤, SQL Editor에서 첫 관리자를 지정합니다.
   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = '내이메일@example.com');
   ```
7. `사이트주소/admin.html`로 들어가면 관리자 화면이 열립니다.

## 3. 지역 페이지 늘리기

`regions.json`에서 지역의 `status`를 `live`로 바꾸고, `sidos`에 실거래 자료의 시도 이름을 그대로 적습니다. 다음 빌드부터 `{slug}.html` 페이지가 생기고, 허브에 링크가 걸립니다. 화면 템플릿(`web/index.html`)은 모든 지역이 함께 씁니다.

새 지역 단지명에 브랜드 사전이 모르는 이름이 많으면 아래 명령으로 확인해 `pipeline/brands.py`에 추가합니다.
```bash
python -m pipeline.brands unmatched site/data/{slug}
```

## 4. 기능 요약

| 기능 | 내용 |
| --- | --- |
| AI 시세 신호 | 같은 지역 다른 아파트 대비 상대 점수 (시군구 흐름 50%, 전세가율 30%, 단지 거래량 변화 20%) |
| 호가 판단 | 입력 가격을 같은 평형 최근 1년 실거래(지역 시세 변화 반영)와 비교 |
| 브랜드 순위 | 가격 프리미엄 45%, AI 점수 35%, 거래 활발도 20%. 단지 3곳·거래 10건 이상인 브랜드만, 단지가 적으면 보정 |
| 간편가입 | 카카오·Google·이메일. 첫 로그인 때 일반/기업 선택, 약관 동의(만 14세 이상 확인 포함) |
| 기업회원 | 공인중개사, 분양대행사, 기타. 사업자번호 형식 검증, 관리자 승인·반려(사유), 정보 수정 시 재심사 |
| 첫 화면 단지 | 내 위치 → 가장 가까운 단지의 동(없으면 읍면 → 시군구)에서 AI 점수 최고 단지(최근 6개월 거래 3건 이상). 위치가 없으면 거래가 가장 많은 시군구 기준 |
| 광고 자리 | 최상단 메인 배너(순환) · **매물 문의**(공인중개사 전용: 얼굴·사무소·등록번호·전화·홈페이지, 보고 있는 단지에서 가까운 순) · **오른쪽 박스**(분양·대행사 전용) · **단지 랭킹 중간**(그 시군구의 중개사·분양) · 지역 지도 아래 박스. 노출·클릭·전화·홈페이지 기록 |
| 사진 | 지도 타일: 지역 풍경 사진에 오름·보합·내림 색을 덮어 같은 톤으로(사진 없으면 도시·바다·산 실루엣). 단지 카드: 전경 사진(없으면 층수·준공연도로 그린 그림). 출처 표시 |
| 관리자 | 대시보드(회원·승인 대기·광고 성과), 회원 관리, 광고 등록·수정·미리보기·이미지 업로드 |

## 5. 사진과 위치 데이터

- **단지 좌표:** `pipeline.infra`가 카카오 로컬 API로 단지 좌표부터 채웁니다(단지당 1~2회 호출). 좌표가 생기면 "내 위치 근처 단지", "가까운 중개사 순 광고"가 켜집니다. 좌표가 없는 동안에는 같은 동 → 같은 시군구 순서로 광고를 고르고, 첫 화면은 거래가 가장 많은 시군구 기준으로 고릅니다.
- **지역 풍경 사진:** `pipeline.media`가 한국관광공사 관광사진 API에서 시군구마다 한 장씩 받습니다. 공공데이터포털에서 '한국관광공사_관광사진 정보' 활용신청이 따로 필요하고, 이용 조건(출처 표시)을 확인해 화면 문구를 맞춰 주세요.
- **단지 전경 사진:** 공개적으로 쓸 수 있는 출처가 없어 관리자 화면 → 사진 관리에서 올립니다. 직접 촬영했거나 허락받은 사진만 올리고, 포털·앱의 단지 사진은 쓰지 마세요.
- **중개사 얼굴 사진:** 광고 등록 때 본인 동의를 받은 사진만 올립니다.

## 6. 테스트

```bash
pip install -r requirements.txt
python -m tests.test_collect          # 공공데이터포털 응답 해석
node tests/test_geo.js                # 위치 규칙 (첫 화면 단지, 가까운 광고)
bash supabase/test/run.sh             # 회원·광고·사진 권한 (로컬 Postgres 16)
python -m pipeline.build && python -m pipeline.site
cd site && python -m http.server 8765 # 다른 창에서: node tests/e2e_demo.js shots  (Playwright 필요)
python3 tests/make_geo_fixture.py && (cd site_geo && python -m http.server 8766)   # 다른 창에서: node tests/e2e_geo.js
```

직접 받은 실거래 파일로 시작하려면 아래처럼 넣습니다.
```bash
python -m pipeline.import_files sale 매매.xlsx
python -m pipeline.import_files rent 전월세.xlsx
```

## 7. Claude Code로 이어서 만들기

VS Code에서 Claude Code 확장을 열고 플랜 모드로 진행하세요. 저장소 규칙은 `CLAUDE.md`에, 다음 작업 목록과 붙여 넣을 요청 문구는 `docs/BACKLOG.md`에 있습니다.

## 출시 전 확인할 것
- 이용약관과 개인정보처리방침 전문 (지금은 요약 문구만 있음)
- 카카오 로컬 API 결과를 저장해서 보여주는 조건
- 광고 심의 기준과 단가표
- 회원 탈퇴 기능 (아직 없음)
- 공공데이터포털 실제 응답 필드: 첫 실행 로그로 확인
