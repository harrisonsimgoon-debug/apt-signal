"""예측 모델, 워크포워드 백테스트, 지표."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import balanced_accuracy_score, accuracy_score

from .features import FEATURES, UP, FLAT, DOWN, BAND, to_class

HORIZON = 6
CLS_NAME = {UP: "오를 신호", FLAT: "보합", DOWN: "내릴 신호"}


# ---------- 모델들 ----------
def rule_score(f: pd.DataFrame) -> pd.Series:
    """소비자 화면 시안의 규칙 점수(현재 버전). 비교 기준용."""
    pct = lambda x: (np.exp(x) - 1) * 100
    vol = pct(f.reg_vol_chg3).clip(-200, 200)
    mom = pct(f.cx_mom3.fillna(f.reg_mom3))
    gap = pct(f.peak_gap)
    pts = (vol / 40 * 12).clip(-12, 12).fillna(0)
    pts += (mom * 4).clip(-12, 12).fillna(0)
    pts += np.select([gap >= 0, gap > -15, gap > -30], [-5, 2, 3], 0)
    if f.jeonse.notna().any():
        pts += ((f.jeonse * 100 - 60) / 2).clip(-8, 8).fillna(0)
    pts += (pct(f.reg_mom3) * 3 + pct(f.reg_vol_chg3) / 10).clip(-8, 8).fillna(0)
    return (50 + pts).clip(5, 95)


def rule_class(score: pd.Series) -> pd.Series:
    return pd.Series(np.where(score >= 66, UP, np.where(score >= 42, FLAT, DOWN)), index=score.index)


def momentum_class(f: pd.DataFrame) -> pd.Series:
    m = f.cx_mom6.fillna(f.reg_mom3 * 2)
    return to_class(m.fillna(0))


def make_ml():
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.05, max_leaf_nodes=24,
                                          min_samples_leaf=80, l2_regularization=1.0, random_state=0)


def probs_to_score(p: np.ndarray) -> np.ndarray:
    # p 열 순서: DOWN, FLAT, UP
    return 50 + 50 * (p[:, 2] - p[:, 0])


# ---------- 데이터셋 ----------
def build_dataset(panel, t_from: int, t_to: int, log=print) -> pd.DataFrame:
    rows = []
    for t in range(t_from, t_to + 1):
        f = panel.features(t)
        f = f[f.cx_vol6 > 0]                 # 최근 6개월 거래가 있는 단지만 판단
        y = panel.label(t).reindex(f.index)
        f["y"] = y
        f["cx"] = f.index
        rows.append(f)
        if (t - t_from) % 12 == 0:
            log(f"  지표 계산 {t // 12}-{t % 12 + 1:02d}: 단지 {len(f):,}곳, 라벨 {y.notna().sum():,}곳")
    return pd.concat(rows, ignore_index=True)


# ---------- 백테스트 ----------
def walk_forward(ds: pd.DataFrame, test_from: int, retrain_every: int = 3, log=print) -> pd.DataFrame:
    """test_from 이후 매달: 그 시점에 결과가 확정된 과거 표본(t' <= t-6)으로만 학습해 예측."""
    lab = ds.dropna(subset=["y"]).copy()
    lab["cls"] = to_class(lab.y)
    out, model, trained_at = [], None, None
    for t in sorted(ds.t.unique()):
        if t < test_from:
            continue
        if model is None or t - trained_at >= retrain_every:
            tr = lab[lab.t <= t - HORIZON]
            model = make_ml().fit(tr[FEATURES], tr.cls)
            trained_at = t
            log(f"  학습 {t // 12}-{t % 12 + 1:02d}: 표본 {len(tr):,}건")
        cur = ds[ds.t == t].copy()
        p = model.predict_proba(cur[FEATURES])
        p = pd.DataFrame(p, columns=model.classes_, index=cur.index).reindex(columns=[DOWN, FLAT, UP], fill_value=0).values
        cur["p_down"], cur["p_flat"], cur["p_up"] = p[:, 0], p[:, 1], p[:, 2]
        cur["ml_score"] = probs_to_score(p)
        cur["ml_cls"] = p.argmax(1)
        cur["rule_score"] = rule_score(cur)
        cur["rule_cls"] = rule_class(cur.rule_score)
        cur["mom_cls"] = momentum_class(cur)
        out.append(cur)
    return pd.concat(out, ignore_index=True)


def evaluate(pred: pd.DataFrame) -> dict:
    ev = pred.dropna(subset=["y"]).copy()
    ev["cls"] = to_class(ev.y)
    res = {"n": int(len(ev)), "months": int(ev.t.nunique()),
           "base_rate": {CLS_NAME[k]: float((ev.cls == k).mean()) for k in (UP, FLAT, DOWN)}}
    majority = int(ev.cls.mode()[0])
    models = {"AI 모델": "ml_cls", "현재 규칙 점수": "rule_cls", "단순 모멘텀": "mom_cls"}
    out = {}
    for name, col in models.items():
        c = ev[col]
        up, dn = ev[c == UP], ev[c == DOWN]
        out[name] = {
            "accuracy": float(accuracy_score(ev.cls, c)),
            "balanced_accuracy": float(balanced_accuracy_score(ev.cls, c)),
            "up_calls": int(len(up)),
            "up_hit": float((up.cls == UP).mean()) if len(up) else None,       # 오를 신호 → 실제 +2% 초과
            "up_rose": float((up.y > 0).mean()) if len(up) else None,         # 오를 신호 → 실제로 조금이라도 오름
            "up_mean_ret": float(np.expm1(up.y).mean()) if len(up) else None,
            "down_calls": int(len(dn)),
            "down_hit": float((dn.cls == DOWN).mean()) if len(dn) else None,
            "down_mean_ret": float(np.expm1(dn.y).mean()) if len(dn) else None,
        }
    out["항상 다수 클래스"] = {"accuracy": float((ev.cls == majority).mean()),
                          "balanced_accuracy": 1 / 3}
    res["models"] = out
    # 순위 능력: 같은 달 안에서 점수가 높은 단지가 더 올랐나 (시장 전체 방향과 무관)
    for name, col in (("AI 모델", "ml_score"), ("현재 규칙 점수", "rule_score")):
        ics, spreads = [], []
        for t, g in ev.groupby("t"):
            if len(g) < 50:
                continue
            ics.append(spearmanr(g[col], g.y).statistic)
            q = pd.qcut(g[col].rank(method="first"), 5, labels=False)
            spreads.append(np.expm1(g.y[q == 4]).mean() - np.expm1(g.y[q == 0]).mean())
        ics = np.array(ics)
        res["models"][name]["rank_ic"] = float(np.nanmean(ics))
        res["models"][name]["rank_ic_t"] = float(np.nanmean(ics) / (np.nanstd(ics) / np.sqrt(len(ics)))) if len(ics) > 2 else None
        res["models"][name]["q5_minus_q1"] = float(np.nanmean(spreads))
    # 확률 보정: AI가 '오를 확률 x%'라 했을 때 실제 비율
    ev["bucket"] = pd.cut(ev.p_up, [0, .2, .35, .5, .65, 1], include_lowest=True)
    cal = ev.groupby("bucket", observed=True).agg(pred=("p_up", "mean"), real=("cls", lambda c: (c == UP).mean()), n=("cls", "size"))
    res["calibration"] = [{"bucket": str(b), "pred": float(r.pred), "real": float(r.real), "n": int(r.n)} for b, r in cal.iterrows()]
    # 연도별
    ev["year"] = ev.t // 12
    res["by_year"] = []
    for yv, g in ev.groupby("year"):
        up = g[g.ml_cls == UP]
        res["by_year"].append({"year": int(yv), "n": int(len(g)), "market_up_share": float((g.cls == UP).mean()),
                               "ml_bal_acc": float(balanced_accuracy_score(g.cls, g.ml_cls)),
                               "ml_up_hit": float((up.cls == UP).mean()) if len(up) else None})
    return res
