"""호가 적정성: 이 가격에 사도 되나."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .clean import BANDS, BAND_LABELS


def ask_check(sales: pd.DataFrame, idx: pd.DataFrame, cx_key: str, area: float, ask_price: float,
              asof_m: int, lookback: int = 12) -> dict:
    """ask_price(만원) 를 같은 단지·면적대 최근 실거래(지역 지수로 지금 시점에 맞춰 보정)와 비교."""
    band = int(pd.cut([area], BANDS, labels=False)[0])
    t = sales[(sales.cx_key == cx_key) & (sales.band == band) & ~sales.outlier]
    sgg = t.sgg.iloc[0] if len(t) else None
    recent = t[(t.m > asof_m - lookback) & (t.m <= asof_m)].copy()
    widened = False
    if len(recent) < 3:  # 거래가 적으면 2년까지 넓힌다
        recent, widened = t[(t.m > asof_m - 24) & (t.m <= asof_m)].copy(), True
    out = {"band": BAND_LABELS[band], "n": int(len(recent)), "widened": widened}
    if recent.empty:
        out["say"] = "최근 2년 동안 같은 평형 거래가 없어 비교할 수 없어요."
        return out
    gi = idx[idx.sgg == sgg].set_index("m").idx
    now = gi.get(asof_m, gi.iloc[-1])
    recent["adj_unit"] = recent.unit * np.exp(now - recent.m.map(gi).fillna(now))
    adj = recent.adj_unit * area
    med = float(adj.median())
    pos = ask_price / med - 1
    pct_below = float((adj < ask_price).mean())
    peak_unit = t.unit.max()
    peak_price = float(peak_unit * area)
    peak_row = t.loc[t.unit.idxmax()]
    out.update({
        "fair_median": med, "fair_low": float(adj.quantile(.25)), "fair_high": float(adj.quantile(.75)),
        "ask_vs_fair": pos, "share_cheaper_trades": pct_below,
        "peak_price": peak_price, "peak_month": f"{peak_row.ymd:%Y.%m}", "ask_vs_peak": ask_price / peak_price - 1,
    })
    eok = lambda v: f"{v / 10000:.1f}억"
    if abs(pos) < 0.02:
        head = f"최근 실거래 시세({eok(med)})와 비슷한 가격이에요."
    elif pos > 0:
        head = f"최근 실거래 시세({eok(med)})보다 {pos * 100:.0f}% 비싸요."
    else:
        head = f"최근 실거래 시세({eok(med)})보다 {-pos * 100:.0f}% 싸요."
    period = "2년" if widened else "1년"
    out["say"] = head
    out["detail"] = (f"최근 {period} 같은 평형 거래 {len(recent)}건 중 {pct_below * 100:.0f}%가 이 가격보다 낮게 거래됐어요. "
                     f"(시세 변동을 반영해 지금 기준으로 환산) 역대 최고가는 {eok(peak_price)}({out['peak_month']})예요.")
    out["confidence"] = "높음" if len(recent) >= 8 else "보통" if len(recent) >= 3 else "낮음"
    return out
