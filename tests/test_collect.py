"""공공데이터포털 응답 해석 테스트. 실제 응답 형식이 바뀌면 여기서 먼저 깨진다.

실행: python -m tests.test_collect
"""
import pandas as pd
from pipeline.collect import _items, normalize, QuotaExceeded

SALE = """<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items><item><aptNm>그랜드센트럴</aptNm><aptSeq>29110-123</aptSeq><buildYear>2020</buildYear><cdealDay> </cdealDay><cdealType> </cdealType>
<dealAmount>    45,000</dealAmount><dealDay>7</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><dealingGbn>중개거래</dealingGbn>
<excluUseAr>76.03</excluUseAr><floor>12</floor><jibun>1</jibun><sggCd>29110</sggCd><umdNm>계림동</umdNm></item>
<item><aptNm>신천</aptNm><buildYear>1987</buildYear><cdealDay>26.09.20</cdealDay><cdealType>O</cdealType><dealAmount>4,500</dealAmount><dealDay>3</dealDay>
<dealMonth>9</dealMonth><dealYear>2026</dealYear><dealingGbn>직거래</dealingGbn><excluUseAr>54</excluUseAr><floor>7</floor><jibun>585-3</jibun><sggCd>29155</sggCd><umdNm>백운동</umdNm></item>
</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>"""

RENT = """<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items><item><aptNm>부영6</aptNm><buildYear>1998</buildYear>
<contractType>신규</contractType><dealDay>26</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><deposit>4,554</deposit><excluUseAr>49.92</excluUseAr>
<floor>7</floor><jibun>405-3</jibun><monthlyRent>0</monthlyRent><sggCd>46790</sggCd><umdNm>화순읍 신기리</umdNm></item></items><totalCount>1</totalCount></body></response>"""

QUOTA = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode><resultCode>22</resultCode><resultMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</resultMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"

reg = pd.Series({"code": "29110", "sido": "전남광주통합특별시", "sgg": "동구"})
items, total = _items(SALE)
assert total == 2 and len(items) == 2
d = normalize("sale", items, reg)
assert d.price.tolist() == [45000, 4500], d.price
assert d.cancelled.tolist() == [False, True], d.cancelled
assert d.direct.tolist() == [False, True]
assert d.ymd.tolist() == ["2026-09-07", "2026-09-03"]
r = normalize("rent", _items(RENT)[0], reg)
assert r.deposit.iloc[0] == 4554 and r.monthly.iloc[0] == 0
try:
    _items(QUOTA); raise AssertionError("한도 초과를 잡지 못함")
except QuotaExceeded:
    pass
print("응답 해석 테스트 통과")
