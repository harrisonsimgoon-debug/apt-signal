// 회원·광고 저장소 연결. 같은 함수 모음을 두 가지로 구현한다.
//  - LiveBackend: Supabase (config.js 에 주소와 키가 있을 때)
//  - DemoBackend: 이 브라우저의 저장공간만 쓰는 체험용 (서버 없음, 다른 사람과 공유되지 않음)
// 화면 코드는 window.getBackend() 로 받은 객체만 쓴다.
(() => {
const CFG = window.APP_CONFIG || {};
// 데모 데이터 구조가 바뀌면 키 숫자를 올려 예전 체험 데이터를 버린다
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

// ---------- 공통 ----------
const isLive = a => a.active && new Date(a.starts_at) <= new Date() && (!a.ends_at || new Date(a.ends_at) > new Date());
// 지역 타깃·거리·광고 종류를 함께 따지는 순서 규칙은 geo.js (window.Geo.rankAds) 하나에서 관리한다
const rankAds = (list, ctx) => window.Geo.rankAds(list, ctx || {});
// 자리별 광고 종류 규칙 (supabase/schema.sql 의 ads_slot_category 와 같다)
function slotRule(a) {
  if (a.slot === "agent_box" && (a.category !== "agent" || !a.agent_name || !a.agent_reg_no || !a.phone)) throw new Error("매물 문의 자리는 공인중개사 광고만 가능하고, 중개사 이름·등록번호·전화번호가 필요해요");
  if (a.slot === "side_box" && a.category !== "sales") throw new Error("오른쪽 박스는 분양·대행사 광고 전용이에요");
  if (a.phone && !/^[0-9-]{8,15}$/.test(a.phone)) throw new Error("전화번호는 숫자와 - 만 써 주세요");
}
function brnValid(brn) {
  const d = String(brn || "").replace(/\D/g, "");
  if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += +d[i] * w[i];
  s += Math.floor(+d[8] * 5 / 10);
  return (10 - (s % 10)) % 10 === +d[9];
}

// ---------- 데모 ----------
class DemoBackend {
  constructor() {
    this.mode = "demo";
    this.key = "zs_demo_v3";
    this.mem = null;
    this.subs = [];
    this.db = this._load();
  }
  _load() {
    let raw = null;
    try { raw = localStorage.getItem(this.key); } catch (e) {}
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    return this._seed();
  }
  _save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.db)); } catch (e) { /* 저장 불가: 이번 화면에서만 유지 */ }
  }
  _seed() {
    const now = Date.now(), day = 864e5, iso = t => new Date(t).toISOString();
    const u = (id, email, provider, created) => ({ id, email, provider, created_at: iso(created) });
    const users = [
      u("demo-admin", "admin@example.com", "email", now - 40 * day),
      u("demo-p1", "minji@example.com", "kakao", now - 12 * day),
      u("demo-p2", "junho@example.com", "google", now - 3 * day),
      u("demo-b1", "hanbit@example.com", "kakao", now - 2 * day),
      u("demo-b2", "saesol@example.com", "email", now - 1 * day),
      u("demo-b3", "dawon@example.com", "kakao", now - 20 * day),
    ];
    const prof = (id, kind, nickname, extra = {}) => ({ id, kind, role: "user", nickname, phone: "", interest_region: "", age14_confirmed: true, marketing_opt_in: false, ...extra });
    const profiles = {
      "demo-admin": prof("demo-admin", "personal", "운영자", { role: "admin" }),
      "demo-p1": prof("demo-p1", "personal", "민지", { interest_region: "전남광주" }),
      "demo-p2": prof("demo-p2", null, "준호"),
      "demo-b1": prof("demo-b1", "business", "한빛중개", { phone: "010-1234-5678" }),
      "demo-b2": prof("demo-b2", "business", "새솔분양", { phone: "010-2345-6789" }),
      "demo-b3": prof("demo-b3", "business", "다원중개", { phone: "010-3456-7890" }),
    };
    const biz = (user_id, biz_type, company, ceo, brn, agent_reg_no, status, created) => ({
      user_id, biz_type, company, ceo, brn, agent_reg_no, office_address: "광주 동구 (예시 주소)", office_phone: "062-000-0000",
      status, reject_reason: null, created_at: iso(created) });
    const business = {
      "demo-b1": biz("demo-b1", "agent", "한빛공인중개사사무소 (예시)", "박대표", "1234567891", "29110-2024-00012", "pending", now - 2 * day),
      "demo-b2": biz("demo-b2", "sales_agency", "새솔분양대행 (예시)", "이대표", "2148765433", "", "pending", now - 1 * day),
      "demo-b3": biz("demo-b3", "agent", "다원공인중개사사무소 (예시)", "최대표", "3051827461", "29140-2023-00087", "approved", now - 20 * day),
    };
    const ad = (id, slot, title, body, cta, advertiser_name, extra = {}) => ({
      id, slot, title, body, cta, advertiser_name, image_url: "", link_url: "https://example.com/",
      advertiser_id: null, target_sido: null, target_sgg: null, starts_at: iso(now - 5 * day), ends_at: iso(now + 25 * day),
      weight: 1, active: true, created_at: iso(now - 5 * day), ...extra });
    const G = "전남광주통합특별시";
    const ads = [
      ad(1, "top_banner", "새솔 더파크 2차 견본주택 오픈", "광주 광산구 · 전용 84㎡ 중심 1,240세대 (광고 예시)", "관심고객 등록", "새솔분양대행 (예시)", { theme: "teal", category: "sales" }),
      ad(2, "top_banner", "이 자리에 메인 배너를 걸 수 있어요", "관리자 화면에서 이미지·기간·지역을 정해 바로 게재 (광고 예시)", "광고 문의", "우리집 AI시세", { theme: "ink" }),
      // 오른쪽 박스: 분양·대행사 전용
      ad(3, "side_box", "새솔 더파크 2차 · 1,240세대 분양", "광산구 수완지구 · 계약금 5% · 견본주택 운영 중 (광고 예시)", "관심고객 등록", "새솔분양대행 (예시)", { category: "sales", target_sido: G, loc_sgg: "광산구", loc_umd: "수완동", loc_label: "광산구 수완동 현장", radius_km: 10, theme: "teal", phone: "1600-0000" }),
      ad(4, "side_box", "순천 해룡 리버뷰 · 잔여 세대", "해룡면 신대지구 · 전용 59·84㎡ (광고 예시)", "분양 상담", "가람분양대행 (예시)", { category: "sales", target_sido: G, loc_sgg: "순천시", loc_umd: "해룡면 신대리", loc_label: "순천시 신대지구 현장", radius_km: 10, theme: "sand" }),
      ad(6, "side_box", "다음 달 시작하는 예약 광고", "예약 상태 확인용 (광고 예시)", "보기", "새솔분양대행 (예시)", { category: "sales", starts_at: iso(now + 10 * day), ends_at: iso(now + 40 * day) }),
      ad(5, "region_box", "우리 동네 중개사무소를 알리세요", "지역을 골라 그 동네를 보는 사람에게만 노출 (광고 예시)", "기업회원 가입", "우리집 AI시세", { theme: "teal", link_url: "" }),
      // 단지 랭킹 중간: 분양
      ad(7, "list_native", "새솔 더파크 2차 · 분양 중", "광산구 신축 · 계약금 5% (광고 예시)", "자세히", "새솔분양대행 (예시)", { category: "sales", target_sido: G, loc_sgg: "광산구", loc_umd: "수완동", loc_label: "광산구 수완동" }),
    ];
    // 동네 공인중개사: 매물 문의 박스 + 랭킹 중간 (가까운 단지를 볼 때 먼저 나온다)
    const AG = [["순천시", "조례동", "김조은"], ["서구", "화정동", "이화정"], ["광양시", "중동", "박중동"], ["무안군", "삼향읍 남악리", "최남악"], ["서구", "금호동", "정금호"],
      ["목포시", "상동", "한상동"], ["순천시", "해룡면 신대리", "오신대"], ["북구", "신용동", "윤신용"], ["북구", "운암동", "장운암"], ["나주시", "빛가람동", "임빛가"],
      ["광산구", "수완동", "강수완"], ["남구", "봉선동", "조봉선"], ["동구", "계림동", "서계림"]];
    AG.forEach(([sgg, umd, name], i) => {
      const dong = umd.split(" ").pop(), office = `${dong.replace(/(동|리)$/, "")}공인중개사사무소 (예시)`;
      const common = { category: "agent", target_sido: G, loc_sgg: sgg, loc_umd: umd, loc_label: `${sgg} ${umd}`, radius_km: 3,
        agent_name: name, agent_reg_no: `00000-2026-${String(100 + i).padStart(5, "0")}`, phone: `000-0000-${String(1000 + i)}`, link_url: "https://example.com/" };
      ads.push(ad(20 + i, "agent_box", `${dong} 아파트 매물 상담`, `${dong} 단지 매매·전세 매물을 안내해 드려요 (광고 예시)`, "", office, common));
      if (i % 3 === 0) ads.push(ad(60 + i, "list_native", `${dong} 급매·전세 매물 안내`, `${name} 공인중개사 · ${office}`, "", office, common));
    });
    const events = [];
    for (const a of ads.filter(isLive)) for (let d = 0; d < 7; d++) {
      const imp = 120 + ((a.id * 37 + d * 11) % 90), clk = Math.round(imp * (0.008 + (a.id % 4) * 0.004));
      const call = a.slot === "agent_box" ? Math.round(clk * 0.6) : 0;
      events.push({ ad_id: a.id, day: iso(now - d * day).slice(0, 10), imp, click: clk, call, web: clk - call });
    }
    return { users, profiles, business, ads, events, nextAd: 100, session: null };
  }
  reset() { try { localStorage.removeItem(this.key); } catch (e) {} this.db = this._seed(); this._emit(); }
  _emit() { const s = this._session(); this.subs.forEach(f => f(s)); }
  _session() {
    const id = this.db.session; if (!id) return null;
    const user = this.db.users.find(u => u.id === id); if (!user) return null;
    return { user, profile: this.db.profiles[id], business: this.db.business[id] || null };
  }
  async session() { return this._session(); }
  onAuth(cb) { this.subs.push(cb); }
  async signIn(provider) {
    const id = "demo-u" + Date.now().toString(36);
    const names = { kakao: "카카오", google: "구글" };
    this.db.users.push({ id, email: `${provider}-${id.slice(-4)}@example.com`, provider, created_at: new Date().toISOString() });
    this.db.profiles[id] = { id, kind: null, role: "user", nickname: `${names[provider] || ""}사용자${id.slice(-3)}`, phone: "", interest_region: "", age14_confirmed: false, marketing_opt_in: false };
    this.db.session = id; this._save(); this._emit();
    return { redirected: false };
  }
  async signInEmail(email) {
    let u = this.db.users.find(x => x.email === email);
    if (!u) {
      const id = "demo-u" + Date.now().toString(36);
      u = { id, email, provider: "email", created_at: new Date().toISOString() };
      this.db.users.push(u);
      this.db.profiles[id] = { id, kind: null, role: "user", nickname: email.split("@")[0].slice(0, 30), phone: "", interest_region: "", age14_confirmed: false, marketing_opt_in: false };
    }
    this.db.session = u.id; this._save(); this._emit();
    return { sent: false, signedIn: true };
  }
  async signInDemoAdmin() { this.db.session = "demo-admin"; this._save(); this._emit(); }
  async signOut() { this.db.session = null; this._save(); this._emit(); }
  async saveOnboarding(f) {
    const id = this.db.session, p = this.db.profiles[id];
    if (p.kind && f.kind !== p.kind) throw new Error("회원 유형은 고객센터를 통해 바꿀 수 있어요");
    Object.assign(p, { kind: f.kind, nickname: f.nickname, phone: f.phone, interest_region: f.interest_region || "",
      age14_confirmed: true, terms_agreed_at: new Date().toISOString(), privacy_agreed_at: new Date().toISOString(), marketing_opt_in: !!f.marketing });
    if (f.kind === "business") {
      const b = f.business;
      if (!brnValid(b.brn)) throw new Error("사업자등록번호를 다시 확인해 주세요");
      this.db.business[id] = { ...(this.db.business[id] || {}), user_id: id, ...b, brn: b.brn.replace(/\D/g, ""), status: "pending", reject_reason: null, created_at: (this.db.business[id] || {}).created_at || new Date().toISOString() };
    }
    this._save(); this._emit();
  }
  async slots() { return SLOTS; }
  async ads(slot, ctx = {}) { return rankAds(this.db.ads.filter(a => a.slot === slot), ctx); }
  async photos() { return (this.db.photos || []).filter(p => p.active); }
  async adminPhotos() { this._admin(); return [...(this.db.photos || [])].sort((a, b) => b.id - a.id); }
  async savePhoto(ph) {
    this._admin();
    if (!/^(https:\/\/|data:image\/)/.test(ph.url)) throw new Error("사진 주소는 https:// 로 시작해야 해요");
    if (!ph.credit || !ph.license) throw new Error("출처와 이용 조건을 적어 주세요");
    this.db.photos = (this.db.photos || []).map(x => x.kind === ph.kind && x.ref === ph.ref ? { ...x, active: false } : x);
    this.db.photos.push({ ...ph, id: (this.db.nextPhoto = (this.db.nextPhoto || 1) + 1), active: true, created_at: new Date().toISOString() });
    this._save();
  }
  async deletePhoto(id) { this._admin(); this.db.photos = (this.db.photos || []).filter(p => p.id !== id); this._save(); }
  async logEvent(adId, kind) {
    const day = new Date().toISOString().slice(0, 10);
    let e = this.db.events.find(x => x.ad_id === adId && x.day === day);
    if (!e) { e = { ad_id: adId, day, imp: 0, click: 0, call: 0, web: 0 }; this.db.events.push(e); }
    if (kind === "imp") e.imp++; else { e.click++; if (kind === "call" || kind === "web") e[kind] = (e[kind] || 0) + 1; }
    this._save();
  }
  // ----- 관리자 -----
  _admin() { const s = this._session(); if (!s || s.profile.role !== "admin") throw new Error("관리자만 쓸 수 있어요"); }
  async overview(days = 7) {
    this._admin();
    const P = Object.values(this.db.profiles), B = Object.values(this.db.business), since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const ev = this.db.events.filter(e => e.day >= since);
    return { members: P.length, personal: P.filter(p => p.kind === "personal").length, business: P.filter(p => p.kind === "business").length,
      onboarding: P.filter(p => !p.kind).length, pending: B.filter(b => b.status === "pending").length,
      new_7d: this.db.users.filter(u => u.created_at >= new Date(Date.now() - 7 * 864e5).toISOString()).length,
      live_ads: this.db.ads.filter(isLive).length, imp: ev.reduce((s, e) => s + e.imp, 0), click: ev.reduce((s, e) => s + e.click, 0) };
  }
  async members(filter = "all", search = "") {
    this._admin();
    const q = search.trim().toLowerCase();
    return this.db.users.map(u => {
      const p = this.db.profiles[u.id] || {}, b = this.db.business[u.id] || {};
      return { id: u.id, email: u.email, provider: u.provider, created_at: u.created_at, kind: p.kind, role: p.role, nickname: p.nickname, phone: p.phone,
        biz_type: b.biz_type, company: b.company, ceo: b.ceo, brn: b.brn, agent_reg_no: b.agent_reg_no, office_address: b.office_address, office_phone: b.office_phone,
        status: b.status, reject_reason: b.reject_reason };
    }).filter(m => (filter === "all" || (filter === "pending" ? m.status === "pending" : m.kind === filter))
      && (!q || [m.email, m.nickname, m.company].some(v => (v || "").toLowerCase().includes(q))))
      .sort((a, b) => (b.status === "pending") - (a.status === "pending") || b.created_at.localeCompare(a.created_at));
  }
  async reviewBusiness(userId, status, reason = "") {
    this._admin();
    const b = this.db.business[userId]; if (!b) throw new Error("기업 정보가 없어요");
    Object.assign(b, { status, reject_reason: status === "rejected" ? reason : null, reviewed_at: new Date().toISOString() });
    this._save();
  }
  async setRole(userId, role) {
    this._admin();
    if (userId === this.db.session && role !== "admin") throw new Error("자기 자신의 관리자 권한은 해제할 수 없어요");
    this.db.profiles[userId].role = role; this._save();
  }
  async listAds() { this._admin(); return [...this.db.ads].sort((a, b) => b.id - a.id); }
  async saveAd(a) {
    this._admin();
    if (a.link_url && !/^https:\/\//.test(a.link_url)) throw new Error("링크는 https:// 로 시작해야 해요");
    slotRule(a);
    if (a.id) { const i = this.db.ads.findIndex(x => x.id === a.id); this.db.ads[i] = { ...this.db.ads[i], ...a }; }
    else this.db.ads.push({ ...a, id: this.db.nextAd++, created_at: new Date().toISOString() });
    this._save();
  }
  async deleteAd(id) { this._admin(); this.db.ads = this.db.ads.filter(a => a.id !== id); this.db.events = this.db.events.filter(e => e.ad_id !== id); this._save(); }
  async uploadImage(file) {
    this._admin();
    if (file.size > 1024 * 1024) throw new Error("데모에서는 1MB 이하 이미지만 올릴 수 있어요");
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("이미지를 읽지 못했어요")); r.readAsDataURL(file); });
  }
  async adStats(days = 30) {
    this._admin();
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), m = {};
    for (const e of this.db.events.filter(e => e.day >= since)) { const x = m[e.ad_id] = m[e.ad_id] || { ad_id: e.ad_id, imp: 0, click: 0, call: 0, web: 0 }; x.imp += e.imp; x.click += e.click; x.call += e.call || 0; x.web += e.web || 0; }
    return Object.values(m);
  }
}

// ---------- Supabase ----------
class LiveBackend {
  constructor(client) { this.mode = "live"; this.c = client; }
  _err(r) { if (r.error) throw new Error(r.error.message || "요청을 처리하지 못했어요"); return r.data; }
  async session() {
    const { data } = await this.c.auth.getSession();
    const user = data.session?.user; if (!user) return null;
    const profile = this._err(await this.c.from("profiles").select("*").eq("id", user.id).maybeSingle());
    const business = this._err(await this.c.from("business_profiles").select("*").eq("user_id", user.id).maybeSingle());
    return { user: { id: user.id, email: user.email, provider: user.app_metadata?.provider }, profile, business };
  }
  onAuth(cb) { this.c.auth.onAuthStateChange(async () => cb(await this.session())); }
  async signIn(provider) {
    const back = location.href.split("#")[0];
    this._err(await this.c.auth.signInWithOAuth({ provider, options: { redirectTo: back } }));
    return { redirected: true };
  }
  async signInEmail(email) {
    this._err(await this.c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0] } }));
    return { sent: true };
  }
  async signOut() { await this.c.auth.signOut(); }
  async saveOnboarding(f) {
    const { data } = await this.c.auth.getUser(); const id = data.user.id, now = new Date().toISOString();
    this._err(await this.c.from("profiles").update({ kind: f.kind, nickname: f.nickname, phone: f.phone || null, interest_region: f.interest_region || null,
      age14_confirmed: true, terms_agreed_at: now, privacy_agreed_at: now, marketing_opt_in: !!f.marketing }).eq("id", id));
    if (f.kind === "business") {
      if (!brnValid(f.business.brn)) throw new Error("사업자등록번호를 다시 확인해 주세요");
      this._err(await this.c.from("business_profiles").upsert({ user_id: id, ...f.business, brn: f.business.brn.replace(/\D/g, "") }));
    }
  }
  async slots() { return this._err(await this.c.from("ad_slots").select("*").order("sort")); }
  async ads(slot, ctx = {}) {
    const list = this._err(await this.c.from("ads").select("id,slot,title,body,cta,image_url,link_url,advertiser_name,target_sido,target_sgg,starts_at,ends_at,weight,active,theme,category,lat,lng,loc_label,loc_sgg,loc_umd,radius_km,agent_name,agent_photo_url,agent_reg_no,phone").eq("slot", slot));
    return rankAds(list, ctx);
  }
  async logEvent(adId, kind) { await this.c.rpc("log_ad_event", { p_ad_id: adId, p_kind: kind }); }
  async photos() { return this._err(await this.c.from("photos").select("kind,ref,url,credit,license,source_url").eq("active", true)); }
  async adminPhotos() { return this._err(await this.c.from("photos").select("*").order("id", { ascending: false })); }
  async savePhoto(ph) {
    // 같은 지역·단지에 쓰던 사진은 내리고 새 사진을 올린다 (사용 중 사진은 하나만)
    this._err(await this.c.from("photos").update({ active: false }).eq("kind", ph.kind).eq("ref", ph.ref).eq("active", true));
    const { data } = await this.c.auth.getUser();
    this._err(await this.c.from("photos").insert({ kind: ph.kind, ref: ph.ref, url: ph.url, credit: ph.credit, license: ph.license, source_url: ph.source_url || null, created_by: data.user.id }));
  }
  async deletePhoto(id) { this._err(await this.c.from("photos").delete().eq("id", id)); }
  async overview(days = 7) { return this._err(await this.c.rpc("admin_overview", { p_days: days })); }
  async members(filter = "all", search = "") { return this._err(await this.c.rpc("admin_members", { p_filter: filter, p_search: search })); }
  async reviewBusiness(userId, status, reason = "") {
    this._err(await this.c.from("business_profiles").update({ status, reject_reason: status === "rejected" ? reason : null }).eq("user_id", userId));
  }
  async setRole(userId, role) {
    const { data } = await this.c.auth.getUser();
    if (userId === data.user.id && role !== "admin") throw new Error("자기 자신의 관리자 권한은 해제할 수 없어요");
    this._err(await this.c.from("profiles").update({ role }).eq("id", userId));
  }
  async listAds() { return this._err(await this.c.from("ads").select("*").order("id", { ascending: false })); }
  async saveAd(a) {
    slotRule(a);
    const row = { ...a }; delete row.id; delete row.created_at; delete row.updated_at; delete row._km; delete row._near;
    if (a.id) this._err(await this.c.from("ads").update(row).eq("id", a.id));
    else this._err(await this.c.from("ads").insert(row));
  }
  async deleteAd(id) { this._err(await this.c.from("ads").delete().eq("id", id)); }
  async uploadImage(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error("5MB 이하 이미지만 올릴 수 있어요");
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    this._err(await this.c.storage.from("ads").upload(path, file, { cacheControl: "31536000", contentType: file.type }));
    return this.c.storage.from("ads").getPublicUrl(path).data.publicUrl;
  }
  async adStats(days = 30) { return this._err(await this.c.rpc("admin_ad_stats", { p_days: days })); }
}

const SLOTS = [
  { key: "top_banner", name: "최상단 메인 배너", description: "모든 화면 맨 위. 여러 개를 등록하면 6초마다 순서대로 바뀜", size_hint: "PC 1440×120 · 휴대폰 750×200" },
  { key: "agent_box", name: "매물 문의 (공인중개사 전용)", description: "단지 결론 카드 바로 아래. 보고 있는 단지에서 가까운 중개사 순. 얼굴·사무소·등록번호·전화·홈페이지", size_hint: "얼굴 사진 400×400" },
  { key: "side_box", name: "분양 홍보 박스 (분양·대행사 전용)", description: "PC 오른쪽 칸 생활 인프라 아래, 휴대폰은 근거 카드 아래", size_hint: "600×400" },
  { key: "list_native", name: "단지 랭킹 중간", description: "지역 단지 목록 4번째 줄. 그 시군구의 중개사·분양 광고", size_hint: "텍스트 + 작은 이미지 160×160" },
  { key: "region_box", name: "지역 지도 아래 박스", description: "지역 지도 카드 아래 빈 공간", size_hint: "600×300" },
];

let promise = null;
window.getBackend = () => promise || (promise = (async () => {
  if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
    if (!window.supabase) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = SUPABASE_JS; s.onload = res; s.onerror = () => rej(new Error("로그인 모듈을 불러오지 못했어요")); document.head.appendChild(s); });
    return new LiveBackend(window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey));
  }
  return new DemoBackend();
})());
window.AppUtil = { brnValid, isLive };
})();
