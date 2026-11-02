"""オンライン対戦のテスト(にせ Firebase で、スマホ3台 + CPU 2体)。
使い方: python3 tests/online_test.py [リポジトリのフォルダ]
- 部屋を作る・入る、ホストが CPU を足してはじめる
- 3台とも同じ盤面で進む(ずれの確かめ hash が合う)
- 1台が切れても、残りは止まらずに進む(切れた人は CPU にかわる)
- 試合が終わったら、結果が全員同じ。ホストが「待ちあいへ」で全員が待ちあいにもどる"""
import sys, random, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import fakefb

root = sys.argv[1] if len(sys.argv) > 1 else "."
url = fakefb.serve(root)
ok = True
def check(name, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(("OK " if cond else "NG ") + name + (f"  {extra}" if extra else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    ph = fakefb.Phones(b, url)
    pages = {n: ph.open(n) for n in ["A", "B", "C"]}
    for n, pg in pages.items():
        pg.click("#online"); pg.fill("#nm", "P" + n)
    pages["A"].click("#mk"); pages["A"].wait_for_selector(".code", timeout=8000)
    code = pages["A"].inner_text(".code")
    for n in ["B", "C"]:
        pages[n].fill("#cd", code); pages[n].click("#jn"); pages[n].wait_for_selector(".code", timeout=8000)
    pages["A"].wait_for_timeout(600)
    check("待ちあいに3人", pages["A"].locator(".plist .pl").count() == 3)
    pages["A"].evaluate("window.__ccLimit = 30 * 45")
    pages["A"].click("#cp"); pages["A"].wait_for_timeout(400); pages["A"].click("#cp"); pages["A"].wait_for_timeout(600)
    check("CPU 2体を足した", pages["B"].locator(".plist .pl").count() == 5)
    pages["A"].click("#st")
    for n, pg in pages.items(): pg.wait_for_selector("#cv", timeout=8000)
    check("全員が対戦の画面", True)
    # 12秒間、みんなでめちゃくちゃに押す
    t0 = time.time()
    while time.time() - t0 < 12:
        for n, pg in pages.items():
            if random.random() < 0.5: pg.evaluate(f"__cc.act('d', {random.randrange(4)})")
            if random.random() < 0.15: pg.evaluate("__cc.act('a', 0)")
        pages["A"].wait_for_timeout(250)
    st = {n: pg.evaluate("({t: __cc.G.tick, d: NET.desync, c: NET.checked || 0, me: NET.me})") for n, pg in pages.items()}
    check("3台とも進んでいる", all(s["t"] > 200 for s in st.values()), str(st))
    check("ずれがない", not any(s["d"] for s in st.values()) and all(s["c"] > 0 for s in st.values()), str(st))
    # C が切れる
    cme = st["C"]["me"]
    ph.disconnect("C"); del pages["C"]
    pages["A"].wait_for_timeout(3000)
    t1 = {n: pg.evaluate("__cc.G.tick") for n, pg in pages.items()}
    pages["A"].wait_for_timeout(4000)
    t2 = {n: pg.evaluate("__cc.G.tick") for n, pg in pages.items()}
    check("C が切れても進む", all(t2[n] - t1[n] > 60 for n in pages), f"{t1} -> {t2}")
    drops = {n: pg.evaluate(f"NET.drops[{cme}]") for n, pg in pages.items()}
    check("C は CPU にかわった", all(isinstance(v, int) for v in drops.values()) and pages["A"].evaluate(f"__cc.G.players[{cme}].cpu") == "normal", str(drops))
    # 終わるまで待つ
    for n, pg in pages.items(): pg.wait_for_selector("table.res", timeout=60000)
    res = {n: pg.inner_text("table.res") for n, pg in pages.items()}
    check("結果が同じ", res["A"] == res["B"], res["A"].replace("\n", " / ")[:120])
    st = {n: pg.evaluate("({d: NET.desync, c: NET.checked || 0})") for n, pg in pages.items()}
    check("最後までずれがない", not any(s["d"] for s in st.values()), str(st))
    pages["A"].click("#lobby")
    for n, pg in pages.items(): pg.wait_for_selector(".plist", timeout=8000)
    check("みんな待ちあいにもどった", pages["B"].locator(".plist .pl").count() == 4, "A, B と CPU 2")
    check("戻るボタン: 待ちあいは「ルームから出ますか？」", pages["B"].evaluate("BackGuard.level") == "room")
    # B が部屋を出る → A だけになる
    pages["B"].click("#lv"); pages["B"].wait_for_selector("#mk", timeout=8000)
    pages["A"].wait_for_timeout(800)
    check("B が出た", pages["A"].locator(".plist .pl").count() == 3)
    check("ページのエラーなし", not ph.errors, str(ph.errors[:3]))
    b.close()
print("ALL OK" if ok else "SOME NG")
sys.exit(0 if ok else 1)
