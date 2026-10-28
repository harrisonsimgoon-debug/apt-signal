"""web/ 템플릿 → site/ (GitHub Pages).

  site/index.html          지역 선택 허브 (regions.json 순서대로, 준비 중 지역도 표시)
  site/{slug}.html         지역 페이지. web/index.html 하나를 지역 이름만 바꿔 찍어낸다
  site/admin.html          관리자 (모든 지역 공통)
  site/data/{slug}/...     지역별 데이터 (pipeline.build 가 만든다)

새 지역 열기: regions.json 에서 status 를 live 로 바꾸고 sidos 를 채운 뒤 build → site 를 돌리면 끝.
"""
from __future__ import annotations

import html
import json
import shutil
from pathlib import Path

WEB, SITE = Path("web"), Path("site")
HEAD = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
"""


def regions():
    return json.loads(Path("regions.json").read_text(encoding="utf-8"))["regions"]


def wrap(body: str, split_at: str) -> str:
    i = body.index(split_at)
    return HEAD + body[:i] + "</head>\n<body>\n" + body[i:] + "\n</body>\n</html>\n"


def render_region(reg: dict, full: bool = True) -> str:
    t = (WEB / "index.html").read_text(encoding="utf-8")
    info = {"slug": reg["slug"], "label": reg["label"]}
    t = t.replace("{{REGION_JSON}}", json.dumps(info, ensure_ascii=False)).replace("{{REGION_LABEL}}", html.escape(reg["label"]))
    return wrap(t, '<aside class="adtop"') if full else t


def render_hub(full: bool = True) -> str:
    cards = []
    for r in regions():
        meta = None
        p = SITE / "data" / r["slug"] / "index.json"
        if r["status"] == "live" and p.exists():
            meta = json.loads(p.read_text(encoding="utf-8"))["meta"]
        lab = html.escape(r["label"])
        if meta:
            y, m = meta["data_to"].split("-")
            cards.append(f'<a class="hub-card live" href="{r["slug"]}.html"><b>{lab}</b>'
                         f'<span>단지 {meta["counts"]["complexes"]:,}곳 · {y}년 {int(m)}월 실거래까지</span><em>보러 가기</em></a>')
        else:
            cards.append(f'<div class="hub-card soon" aria-disabled="true"><b>{lab}</b><span>준비 중이에요</span></div>')
    body = f"""<title>우리집 AI시세</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="지역별 아파트 실거래 AI 시세 신호, 호가 판단, 브랜드 순위">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="account.css">
<style>
.hub{{max-width:960px;margin:0 auto;padding-block:32px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
.hub h1{{font-size:clamp(24px,3.4vw,34px);margin:0 0 6px;text-wrap:balance}}
.hub p.lead{{color:var(--sub);margin:0 0 24px;max-width:60ch}}
.hub-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}}
.hub-card{{display:flex;flex-direction:column;gap:4px;padding:18px;border-radius:16px;border:1px solid var(--line);background:var(--card);text-decoration:none;color:var(--ink);min-height:120px}}
.hub-card b{{font-size:20px}}
.hub-card span{{color:var(--sub);font-size:13px}}
.hub-card em{{margin-top:auto;font-style:normal;color:var(--region);font-weight:700;font-size:14px}}
.hub-card.live{{border-color:var(--region);box-shadow:inset 0 0 0 1px var(--region)}}
.hub-card.live:hover{{background:var(--soft)}}
.hub-card.soon{{opacity:.6}}
</style>

<aside class="adtop" id="ad-top" aria-label="광고" hidden></aside>
<header class="bar"><div class="bar-in">
  <a class="brand" href="index.html">우리집 <b>AI시세</b></a>
  <span style="flex:1"></span>
  <div class="account-slot" id="account-slot"></div>
</div></header>
<main class="hub">
  <h1>어느 지역 아파트를 볼까요?</h1>
  <p class="lead">국토교통부 실거래로 단지별 AI 시세 신호, 이 가격에 사도 되는지, 브랜드 순위를 보여드려요. 지역은 차례로 늘려가고 있어요.</p>
  <div class="hub-grid">{''.join(cards)}</div>
</main>
<footer class="foot"><p>점수는 같은 지역 다른 아파트와 비교한 상대 신호이며 가격을 보장하지 않아요.</p></footer>
<script src="config.js"></script>
<script src="geo.js"></script>
<script src="backend.js"></script>
<script src="account.js"></script>
<script src="ads.js"></script>
<script>window.Ads && window.Ads.fill("top_banner", document.getElementById("ad-top"), {{}});</script>
"""
    return wrap(body, '<aside class="adtop"') if full else body


def main():
    SITE.mkdir(exist_ok=True)
    for f in WEB.iterdir():
        if f.is_file() and f.name != "index.html":
            shutil.copy(f, SITE / f.name)
    shutil.copy("regions.json", SITE / "regions.json")
    live = [r for r in regions() if r["status"] == "live"]
    for r in live:
        (SITE / f"{r['slug']}.html").write_text(render_region(r), encoding="utf-8")
    (SITE / "index.html").write_text(render_hub(), encoding="utf-8")
    (SITE / ".nojekyll").write_text("")
    print(f"site/ 준비 완료: 지역 페이지 {', '.join(r['slug'] + '.html' for r in live)} + 허브 index.html + admin.html")


if __name__ == "__main__":
    main()
