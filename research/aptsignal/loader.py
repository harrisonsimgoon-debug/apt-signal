"""실거래 원천 파일을 하나의 표준 표로 읽는다.

지원 형식
- 국토교통부 실거래가 공개시스템(rt.molit.go.kr) 다운로드 CSV / XLSX (매매, 전월세)
- 공공데이터포털 아파트 매매 실거래가 상세 API 응답 XML (collect_api.py 가 저장한 파일)

표준 매매 컬럼: sido, sgg, umd, jibun, apt, area, ymd(datetime), price(만원), floor, built, cancelled(bool), direct(bool)
표준 전월세 컬럼: sido, sgg, umd, jibun, apt, area, ymd, deposit(만원), monthly(만원)
"""
from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

HEADER_KEYS = ("시군구", "단지명")


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _find_header_row(rows: list[list[str]]) -> int:
    for i, r in enumerate(rows[:60]):
        cells = [str(c).strip() for c in r]
        if all(any(k == c or c.startswith(k) for c in cells) for k in HEADER_KEYS):
            return i
    raise ValueError("시군구/단지명 헤더를 찾지 못했습니다. 실거래가 공개시스템에서 받은 원본 파일인지 확인해 주세요.")


def _raw_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, header=None, dtype=str)
        rows = df.fillna("").values.tolist()
    else:
        text = _read_text(path)
        df = pd.read_csv(io.StringIO(text), header=None, dtype=str, keep_default_na=False,
                         on_bad_lines="skip", engine="python")
        rows = df.values.tolist()
    h = _find_header_row(rows)
    cols = [str(c).strip() for c in rows[h]]
    body = pd.DataFrame(rows[h + 1:], columns=cols)
    return body.loc[:, [c for c in body.columns if c]]


def _col(df: pd.DataFrame, *names: str) -> pd.Series | None:
    for n in names:
        for c in df.columns:
            if c == n or c.startswith(n):
                return df[c]
    return None


def _num(s: pd.Series | None) -> pd.Series:
    if s is None:
        return pd.Series(dtype=float)
    return pd.to_numeric(s.astype(str).str.replace(",", "").str.strip().replace({"": None, "-": None}), errors="coerce")


def split_region(full: str) -> tuple[str, str, str]:
    """'경기도 성남시 분당구 정자동' -> ('경기도', '성남시 분당구', '정자동'); 리 단위는 읍면과 함께 umd 로 둔다."""
    tok = str(full).split()
    if len(tok) < 2:
        return (tok[0] if tok else "", "", "")
    sido = tok[0]
    if len(tok) >= 4 and tok[-1].endswith("리") and tok[-2].endswith(("읍", "면")):
        return sido, " ".join(tok[1:-2]), " ".join(tok[-2:])
    if len(tok) == 2:  # 세종특별자치시 반곡동
        return sido, sido, tok[1]
    return sido, " ".join(tok[1:-1]), tok[-1]


def _common(df: pd.DataFrame) -> pd.DataFrame:
    region = _col(df, "시군구").astype(str).map(split_region)
    out = pd.DataFrame({
        "sido": region.map(lambda r: r[0]),
        "sgg": region.map(lambda r: r[1]),
        "umd": region.map(lambda r: r[2]),
        "jibun": _col(df, "번지").astype(str).str.strip() if _col(df, "번지") is not None else "",
        "apt": _col(df, "단지명").astype(str).str.strip(),
        "area": _num(_col(df, "전용면적")),
    })
    ym = _col(df, "계약년월").astype(str).str.strip()
    day = _col(df, "계약일").astype(str).str.extract(r"(\d+)")[0].fillna("1")
    out["ymd"] = pd.to_datetime(ym.str[:4] + "-" + ym.str[4:6] + "-" + day.str.zfill(2), errors="coerce")
    return out


def read_sale_file(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() == ".xml":
        return read_sale_api_xml(path)
    df = _raw_table(path)
    out = _common(df)
    out["price"] = _num(_col(df, "거래금액"))
    out["floor"] = _num(_col(df, "층"))
    out["built"] = _num(_col(df, "건축년도"))
    cancel = _col(df, "해제사유발생일")
    out["cancelled"] = cancel.astype(str).str.strip().replace({"-": ""}).ne("") if cancel is not None else False
    kind = _col(df, "거래유형")
    out["direct"] = kind.astype(str).str.contains("직거래") if kind is not None else False
    return out.dropna(subset=["ymd", "price", "area"])


def read_rent_file(path: str | Path) -> pd.DataFrame:
    df = _raw_table(Path(path))
    out = _common(df)
    out["deposit"] = _num(_col(df, "보증금"))
    out["monthly"] = _num(_col(df, "월세"))
    return out.dropna(subset=["ymd", "deposit", "area"])


def read_sale_api_xml(path: str | Path) -> pd.DataFrame:
    """collect_api.py 가 저장한 응답 XML(여러 개를 이어 붙인 파일 허용)."""
    text = Path(path).read_text(encoding="utf-8")
    recs = []
    for chunk in re.findall(r"<item>.*?</item>", text, flags=re.S):
        el = ET.fromstring(chunk)
        g = lambda k: (el.findtext(k) or "").strip()
        recs.append({
            "sido": "", "sgg": g("sggCd"), "umd": g("umdNm"), "jibun": g("jibun"), "apt": g("aptNm"),
            "area": g("excluUseAr"), "y": g("dealYear"), "m": g("dealMonth"), "d": g("dealDay"),
            "price": g("dealAmount"), "floor": g("floor"), "built": g("buildYear"),
            "cancelled": g("cdealType") not in ("", "-"), "direct": "직거래" in g("dealingGbn"),
        })
    df = pd.DataFrame(recs)
    if df.empty:
        return df
    for c in ("area", "price", "floor", "built"):
        df[c] = _num(df[c])
    df["ymd"] = pd.to_datetime(df.y + "-" + df.m.str.zfill(2) + "-" + df.d.str.zfill(2), errors="coerce")
    return df.drop(columns=["y", "m", "d"]).dropna(subset=["ymd", "price", "area"])


def read_many(paths, reader) -> pd.DataFrame:
    frames = [reader(p) for p in paths]
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    # 기간을 나눠 받은 파일이 겹치면 같은 거래가 두 번 들어온다
    return df.drop_duplicates().reset_index(drop=True)
