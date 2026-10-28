"""전체 파이프라인: 읽기 → 정제 → 지표 → 워크포워드 백테스트 → 현재 예측·호가 판단 데이터 내보내기.

사용: python -m aptsignal.run --sale 매매*.csv [--rent 전월세*.csv] --out 결과폴더 [--test-years 3]
"""
from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import loader
from .clean import clean_sales, clean_rents, region_index, month_label, BAND_LABELS
from .features import Panel, FEATURES, to_class, UP, DOWN, FLAT
from .model import build_dataset, walk_forward, evaluate, CLS_NAME, HORIZON


def last_complete_month(sales: pd.DataFrame) -> int:
    c = sales.groupby("m").size()
    ref = c.rolling(12, min_periods=3).median().shift(1)
    ok = c[c >= 0.6 * ref.fillna(0)]
    return int(ok.index.max())


def reasons(r: pd.Series) -> list[dict]:
    pct = lambda x: (np.exp(x) - 1) * 100
    out = []
    if pd.notna(r.reg_vol_yoy):
        v = pct(r.reg_vol_yoy)
        out.append({"w": abs(v) / 25, "dir": "up" if v > 15 else "down" if v < -15 else "flat",
                    "text": (f"{r.sgg} 아파트 거래가 1년 전보다 {v:.0f}% 늘었어요. 사려는 사람이 많아지고 있어요." if v > 15 else
                             f"{r.sgg} 아파트 거래가 1년 전보다 {-v:.0f}% 줄었어요. 매수세가 약해졌어요." if v < -15 else
                             f"{r.sgg} 아파트 거래량은 1년 전과 비슷해요."), "src": "국토교통부 실거래 신고 건수"})
    mom = r.cx_mom6 if pd.notna(r.cx_mom6) else r.reg_mom3
    if pd.notna(mom):
        v = pct(mom)
        who = "이 단지" if pd.notna(r.cx_mom6) else f"{r.sgg}"
        out.append({"w": abs(v) / 2, "dir": "up" if v > 2 else "down" if v < -2 else "flat",
                    "text": (f"최근 6개월 {who} 실거래가가 {v:.1f}% 올랐어요." if v > 2 else
                             f"최근 6개월 {who} 실거래가가 {-v:.1f}% 내렸어요." if v < -2 else
                             f"최근 6개월 {who} 실거래가는 거의 그대로예요."), "src": "같은 단지·같은 평형 실거래가 비교"})
    if pd.notna(r.peak_gap):
        v = pct(r.peak_gap)
        out.append({"w": 1.0 if v > -3 else abs(v) / 15, "dir": "flat" if v > -3 else "up",
                    "text": ("지금 가격이 이 단지 역대 최고가 수준이에요." if v > -3 else
                             f"이 단지 역대 최고가보다 {-v:.0f}% 낮은 가격에 거래되고 있어요."), "src": "실거래 최고가 이력"})
    if pd.notna(r.jeonse):
        v = r.jeonse * 100
        out.append({"w": abs(v - 60) / 10, "dir": "up" if v >= 65 else "down" if v < 50 else "flat",
                    "text": (f"전세가가 매매가의 {v:.0f}%예요. 실제 거주 수요가 가격을 받쳐줘요." if v >= 65 else
                             f"전세가가 매매가의 {v:.0f}%로 낮아요. 기대감이 가격에 많이 들어가 있어요." if v < 50 else
                             f"전세가율은 {v:.0f}%로 평균 수준이에요."), "src": "전월세 실거래"})
    if pd.notna(r.new_high_share) and r.new_high_share > 0.3:
        out.append({"w": 1.5, "dir": "up", "text": f"최근 3개월 거래 중 {r.new_high_share * 100:.0f}%가 신고가였어요.",
                    "src": "실거래 최고가 이력"})
    return sorted(out, key=lambda o: -o["w"])[:4]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sale", nargs="+", required=True)
    ap.add_argument("--rent", nargs="*", default=[])
    ap.add_argument("--out", default="out")
    ap.add_argument("--test-years", type=int, default=3)
    a = ap.parse_args(argv)
    expand = lambda ps: sorted({p for x in ps for p in glob.glob(x)})
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    raw = loader.read_many(expand(a.sale), loader.read_sale_file)
    sales = clean_sales(raw)
    rents = clean_rents(loader.read_many(expand(a.rent), loader.read_rent_file)) if a.rent else None
    lcm = last_complete_month(sales)
    sales = sales[sales.m <= lcm]
    print(f"매매 {len(raw):,}건 → 정제 후 {len(sales):,}건 (이상치 표시 {int(sales.outlier.sum()):,}건), "
          f"단지 {sales.cx.nunique():,}곳, 기간 {month_label(int(sales.m.min()))} ~ {month_label(lcm)}")

    panel = Panel(sales, rents)
    t_now = lcm + 1
    t_from = int(sales.m.min()) + 24
    test_from = max(t_now - HORIZON - 12 * a.test_years, t_from + 18)
    print(f"지표 계산 {month_label(t_from)} ~ {month_label(t_now)}, 검증 시작 {month_label(test_from)}")
    ds = build_dataset(panel, t_from, t_now)
    pred = walk_forward(ds, test_from)
    rep = evaluate(pred[pred.t < t_now])
    rep["period"] = {"data_from": month_label(int(sales.m.min())), "data_to": month_label(lcm),
                     "test_from": month_label(test_from), "test_to": month_label(t_now - HORIZON - 1),
                     "asof": month_label(t_now)}
    rep["counts"] = {"raw": int(len(raw)), "clean": int(len(sales)), "complexes": int(sales.cx.nunique())}
    (out / "backtest.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2))

    # ---------- 현재 예측 + 단지별 적중 이력 + 호가 판단용 데이터 ----------
    idx = region_index(sales)
    gi = idx.set_index(["sgg", "m"]).idx
    now = pred[pred.t == t_now].set_index("cx")
    hist = pred[(pred.t < t_now)].dropna(subset=["y"])
    info = panel.cx_info
    main_band = sales.groupby(["cx", "band"]).size().reset_index(name="n").sort_values("n").drop_duplicates("cx", keep="last").set_index("cx").band
    cxs = []
    for cx, r in now.iterrows():
        r = r.copy(); r["sgg"] = info.sgg[cx]
        b = int(main_band[cx])
        t = sales[(sales.cx == cx) & (sales.band == b) & ~sales.outlier]
        area_med = float(t.area.median())
        rec = t[t.m > lcm - 24]
        adj = (rec.unit * np.exp(gi.get((r.sgg, lcm), 0) - rec.set_index(["sgg", "m"]).index.map(gi).fillna(0).values)).tolist()
        series = t.groupby("m").unit.median().reindex(range(lcm - 23, lcm + 1))
        h = hist[hist.cx == cx].sort_values("t")
        cxs.append({
            "id": int(cx), "name": info.apt[cx], "sido": info.sido[cx], "sgg": info.sgg[cx], "umd": info.umd[cx],
            "built": None if pd.isna(info.built[cx]) else int(info.built[cx]),
            "score": round(float(r.ml_score)), "cls": CLS_NAME[int(r.ml_cls)],
            "p": {"up": round(float(r.p_up), 3), "flat": round(float(r.p_flat), 3), "down": round(float(r.p_down), 3)},
            "trades6": int(r.cx_vol6), "reasons": reasons(r),
            "band": BAND_LABELS[b], "area": round(area_med, 1),
            "series": [None if pd.isna(v) else round(v * area_med) for v in series.values],
            "recent_adj": [round(v) for v in adj[-40:]], "peak": round(float(t.unit.max() * area_med)),
            "peak_month": f"{t.loc[t.unit.idxmax()].ymd:%Y.%m}",
            "track": [{"t": month_label(int(x.t)), "call": CLS_NAME[int(x.ml_cls)], "ret": round(float(np.expm1(x.y)), 4)} for x in h.itertuples()][-8:],
        })
    meta = {"asof": month_label(t_now), "series_from": month_label(lcm - 23), "backtest": rep}
    (out / "predictions.json").write_text(json.dumps({"meta": meta, "complexes": cxs}, ensure_ascii=False))
    write_report(rep, out / "backtest.md")
    print(f"현재 예측 단지 {len(cxs):,}곳 → {out}/predictions.json, 백테스트 → {out}/backtest.md")
    return rep


def write_report(rep: dict, path: Path):
    f = lambda v: "-" if v is None else f"{v * 100:.1f}%"
    L = [f"# 백테스트 결과", "",
         f"- 데이터: {rep['period']['data_from']} ~ {rep['period']['data_to']}, 정제 거래 {rep['counts']['clean']:,}건, 단지 {rep['counts']['complexes']:,}곳",
         f"- 검증 기간(판단 시점): {rep['period']['test_from']} ~ {rep['period']['test_to']}, 표본 {rep['n']:,}건 ({rep['months']}개월)",
         f"- 실제 결과 분포: " + ", ".join(f"{k} {f(v)}" for k, v in rep["base_rate"].items()), "",
         "| 모델 | 정확도 | 균형 정확도 | 오를 신호 적중(+2% 초과) | 오를 신호 후 실제 상승 | 오를 신호 평균 수익 | 내릴 신호 적중 | 순위 IC | 상위20%−하위20% |",
         "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for name, m in rep["models"].items():
        L.append(f"| {name} | {f(m.get('accuracy'))} | {f(m.get('balanced_accuracy'))} | {f(m.get('up_hit'))} | {f(m.get('up_rose'))} | "
                 f"{f(m.get('up_mean_ret'))} | {f(m.get('down_hit'))} | {m.get('rank_ic', float('nan')):.3f} | {f(m.get('q5_minus_q1'))} |")
    L += ["", "## 확률 보정 (AI가 말한 오를 확률 vs 실제)", "", "| 구간 | 예측 평균 | 실제 | 표본 |", "| --- | --- | --- | --- |"]
    L += [f"| {c['bucket']} | {f(c['pred'])} | {f(c['real'])} | {c['n']:,} |" for c in rep["calibration"]]
    L += ["", "## 연도별", "", "| 연도 | 표본 | 실제 상승 비율 | AI 균형 정확도 | AI 오를 신호 적중 |", "| --- | --- | --- | --- | --- |"]
    L += [f"| {y['year']} | {y['n']:,} | {f(y['market_up_share'])} | {f(y['ml_bal_acc'])} | {f(y['ml_up_hit'])} |" for y in rep["by_year"]]
    path.write_text("\n".join(L))


if __name__ == "__main__":
    main()
