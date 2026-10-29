// 서비스 설정. Supabase 주소와 공개 키(anon key)를 넣으면 실제 회원·광고 서버를 쓰고,
// 비워 두면 브라우저 안에서만 돌아가는 데모 모드로 동작한다.
// anon key 는 공개되어도 되는 키다(권한은 supabase/schema.sql 의 RLS 가 지킨다). service_role 키는 절대 넣지 말 것.
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // 로그인 버튼에 보일 방법. Supabase → Authentication → Providers 에서 켠 것만 남긴다.
  providers: ["kakao", "google", "email"],
  serviceName: "우리집 AI시세",
  supportEmail: "ad@example.com",
  // 지역 부동산 뉴스 파일 위치 (news.yml 이 news 브랜치에 2시간마다 올린다). 비우면 뉴스 칸을 숨긴다.
  newsBase: "https://raw.githubusercontent.com/harrisonsimgoon-debug/apt-signal/news/",
};
