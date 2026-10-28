"""현재 시점 예측(v2 점수) + 호가 판단용 데이터 + 지역 요약을 화면용 JSON으로 내보낸다."""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from .clean import region_index, BAND_LABELS, month_label
from .factor_test import run, m_of
from .score_v2 import composite, to_score, level, W


def pct(x):
    return float(np.expm1(x) * 100)


def main(asof="2026-10", out="data/predictions.json"):
    sales = pd.read_pickle("data/sales.pkl"); rents = pd.read_pickle("data/rents.pkl")
    t = m_of(asof); L = t - 1
    M1, M2 = (L - 5, L - 3), (L - 2, L)
    _, f = run(sales, rents, M1, M2, M2, M2)
    c1 = sales[(sales.m >= M1[0]) & (sales.m <= M1[1]) & ~sales.outlier].groupby("cx").size()
    c2 = sales[(sales.m >= M2[0]) & (sales.m <= M2[1]) & ~sales.outlier].groupby("cx").size()
    f["n1"] = c1.reindex(f.index, fill_value=0); f["n2"] = c2.reindex(f.index, fill_value=0)
    f = f[(f.n1 + f.n2) > 0].copy()
    comp = composite(f)
    f["score"] = to_score(comp); f["lv"] = level(f.score)
    zc = {}
    for k, w in W.items():
        x = f[k].clip(f[k].quantile(.02), f[k].quantile(.98)); zc[k] = ((x - x.mean()) / x.std()) * w

    s = sales[~sales.outlier]
    idx = region_index(sales)
    gi = idx.set_index(["sgg", "m"]).idx
    info = s.groupby("cx").agg(apt=("apt", "first"), sgg=("sgg", "first"), umd=("umd", "first"), built=("built", "median"))
    mb = s.groupby(["cx", "band"]).size().reset_index(name="n").sort_values("n").drop_duplicates("cx", keep="last").set_index("cx").band
    months = list(range(L - 10, L + 1))
    by_cx = {k: g for k, g in s.groupby("cx")}
    jq = (f.jeonse.quantile(.3) * 100, f.jeonse.quantile(.7) * 100); jmed = f.jeonse.median() * 100
    reg = {}
    for sgg, g in f.groupby(info.sgg.reindex(f.index)):
        rm = g.reg_mom.dropna()
        reg[sgg] = float(rm.iloc[0]) if len(rm) else np.nan

    cxs = []
    for cx, r in f.iterrows():
        sgg = info.sgg[cx]; b = int(mb[cx])
        tt = by_cx[cx]; tb = tt[tt.band == b]
        area = float(tb.area.median())
        ser = tb.groupby("m").price.median().reindex(months)
        rec = tb[tb.m > L - 12]
        now_i = gi.get((sgg, L), np.nan)
        adj = rec.price * np.exp(now_i - pd.Series([gi.get((sgg, m), now_i) for m in rec.m], index=rec.index)) if not np.isnan(now_i) else rec.price
        reasons = []
        if pd.notna(r.reg_mom):
            v = pct(r.reg_mom)
            reasons.append({"k": "reg_mom", "dir": "up" if v > 1 else "down" if v < -1 else "flat", "text":
                (f"{sgg} 아파트 실거래가가 최근 3개월 {v:.1f}% 올랐어요." if v > 1 else
                 f"{sgg} 아파트 실거래가가 최근 3개월 {-v:.1f}% 내렸어요." if v < -1 else
                 f"{sgg} 아파트 실거래가는 최근 3개월 거의 그대로예요.") +
                " 지역 흐름이 강한 곳의 단지가 이후에도 더 오르는 경향이 있었어요.", "src": "국토교통부 실거래 · 같은 단지 같은 평형 비교"})
        if pd.notna(r.jeonse):
            v = r.jeonse * 100
            reasons.append({"k": "jeonse", "dir": "up" if v >= jq[1] else "down" if v < jq[0] else "flat", "text":
                (f"전세가가 매매가의 {v:.0f}%로 광주·전남에서 높은 편이에요(중간 {jmed:.0f}%). 실제 살려는 수요가 가격을 받쳐주고 있어요." if v >= jq[1] else
                 f"전세가가 매매가의 {v:.0f}%로 광주·전남에서 낮은 편이에요(중간 {jmed:.0f}%). 전세가율이 낮은 단지는 이후 상승폭이 작은 편이었어요." if v < jq[0] else
                 f"전세가가 매매가의 {v:.0f}%로 광주·전남 중간 수준이에요(중간 {jmed:.0f}%)."), "src": "국토교통부 전월세 실거래"})
        else:
            reasons.append({"k": "jeonse", "dir": "flat", "text": "최근 전세 거래가 없어 전세가율은 판단에서 뺐어요.", "src": "국토교통부 전월세 실거래"})
        a, bb = r.n2 / 3, r.n1 / 3
        reasons.append({"k": "cx_vol_chg", "dir": "up" if a > bb * 1.3 and r.n2 >= 2 else "down" if a < bb * 0.7 else "flat", "text":
            (f"최근 3개월 이 단지 거래가 {int(r.n2)}건으로 그 전 3개월({int(r.n1)}건)보다 늘었어요." if a > bb * 1.3 and r.n2 >= 2 else
             f"최근 3개월 이 단지 거래가 {int(r.n2)}건으로 그 전 3개월({int(r.n1)}건)보다 줄었어요." if a < bb * 0.7 else
             f"최근 3개월 이 단지 거래는 {int(r.n2)}건으로 그 전과 비슷해요."), "src": "국토교통부 실거래 신고 건수"})
        reasons.sort(key=lambda o: -abs(float(zc[o["k"]].get(cx, 0) or 0)))
        n6 = int(r.n1 + r.n2)
        cxs.append({
            "id": int(cx), "name": info.apt[cx], "sgg": sgg, "umd": info.umd[cx],
            "built": None if pd.isna(info.built[cx]) else int(info.built[cx]),
            "score": int(r.score), "lv": r.lv, "n6": n6,
            "conf": "높음" if n6 >= 8 else "보통" if n6 >= 3 else "낮음",
            "reasons": reasons, "band": BAND_LABELS[b], "area": round(area, 1),
            "series": [None if pd.isna(v) else int(v) for v in ser.values],
            "adj": [int(v) for v in adj.values[-30:]], "peak": int(tb.price.max()),
            "peak_m": f"{tb.loc[tb.price.idxmax()].ymd:%Y.%m}",
        })
    regions = []
    for sgg, g in f.groupby(info.sgg.reindex(f.index)):
        v = reg.get(sgg, np.nan)
        regions.append({"sgg": sgg, "trades": int(g.n2.sum()), "complexes": int(len(g)),
                        "mom": None if pd.isna(v) else round(pct(v), 2),
                        "lv": "flat" if pd.isna(v) else ("up" if pct(v) > 1 else "down" if pct(v) < -1 else "flat"),
                        "jeonse": None if g.jeonse.isna().all() else round(float(g.jeonse.median() * 100))})
    check = json.load(open("data/v2_check.json"))
    meta = {"asof": asof, "data_to": month_label(L), "months": [month_label(m) for m in months],
            "sido": "전남광주통합특별시", "n_complexes": len(cxs),
            "check": {"up_hit": float(np.mean([check[k]["up +2%초과"] for k in "ABC"])),
                      "base": float(np.mean([check[k]["전체 +2%초과"] for k in "ABC"])),
                      "up_med": float(np.mean([check[k]["up 중위"] for k in "ABC"])),
                      "down_med": float(np.mean([check[k]["down 중위"] for k in "ABC"])),
                      "n": int(np.mean([check[k]["단지"] for k in "ABC"]))}}
    json.dump({"meta": meta, "regions": regions, "cx": cxs}, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
    lv = pd.Series([c["lv"] for c in cxs]).value_counts().to_dict()
    print(f"단지 {len(cxs)}곳 {lv}, 지역 {len(regions)}곳 → {out}")


if __name__ == "__main__":
    main(*sys.argv[1:])
