"""1년 데이터 검증으로 고른 예비 점수(v2).

같은 시기의 다른 단지와 비교한 상대 점수다. 시장 전체가 오를지 내릴지는 맞히지 않는다.
가중치: 시군구 가격 흐름 0.5, 전세가율 0.3, 단지 거래량 변화 0.2 (단지 자체 가격 흐름은 제외: 기간마다 방향이 바뀜)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

W = {"reg_mom": 0.5, "jeonse": 0.3, "cx_vol_chg": 0.2}


def composite(f: pd.DataFrame) -> pd.Series:
    z = pd.DataFrame(index=f.index)
    for k in W:
        x = f[k].clip(f[k].quantile(.02), f[k].quantile(.98))
        z[k] = ((x - x.mean()) / x.std()).fillna(0)  # 값이 없으면 평균으로 둔다
    c = sum(z[k] * w for k, w in W.items())
    return c / c.std()


def to_score(c: pd.Series) -> pd.Series:
    return (50 + 15 * c).clip(5, 95).round()


def level(score: pd.Series) -> pd.Series:
    return pd.Series(np.where(score >= 60, "up", np.where(score >= 42, "flat", "down")), index=score.index)
