"""読み直したときの自動入り直しのテスト(にせ Firebase で、スマホ3台 + CPU 1体)。
使い方: python3 tests/rejoin_test.py [リポジトリのフォルダ]
- 待ちあいで読み直す → 自動で同じ部屋の待ちあいに戻る
- 試合中に読み直す → 自動で部屋に戻り、「試合中です」の待ちの画面。その試合は CPU がかわりに続け、ほかの人は止まらない・ずれない
- 試合が終わって待ちあいへ → 読み直した人も待ちあいにいる
- 「部屋を出る」で出たあと読み直す → 自動では戻らない。部屋コードは入力欄に残っている"""
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

def reload(ph, name):
    """ページを読み直す(切れたときの片づけ onDisconnect をしてから)。同じスマホなので uid と localStorage は同じ"""
    ctx, pg, uid = ph.all[name]
    with fakefb.lock:
        for path, v in fakefb.ondis.pop(uid, {}).items(): fakefb.set_at(path, v)
    pg.reload(); pg.wait_for_timeout(300)
    return pg

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

    # 待ちあいで C が読み直す
    pages["C"] = reload(ph, "C")
    pages["C"].wait_for_selector(".code", timeout=8000)
    pages["A"].wait_for_timeout(800)
    check("待ちあいで読み直し → 自動で戻った", pages["C"].inner_text(".code") == code and pages["A"].locator(".plist .pl").count() == 3)

    pages["A"].evaluate("window.__ccLimit = 30 * 40")
    pages["A"].click("#cp"); pages["A"].wait_for_timeout(600)
    pages["A"].click("#st")
    for n, pg in pages.items(): pg.wait_for_selector("#cv", timeout=8000)
    t0 = time.time()
    while time.time() - t0 < 6:
        for n, pg in pages.items():
            if random.random() < 0.5: pg.evaluate(f"__cc.act('d', {random.randrange(4)})")
        pages["A"].wait_for_timeout(250)
    cme = pages["C"].evaluate("NET.me")

    # 試合中に C が読み直す
    pages["C"] = reload(ph, "C")
    pages["C"].wait_for_selector("text=試合中です", timeout=8000)
    check("試合中に読み直し → 待ちの画面", True)
    del_c = pages.pop("C")
    pages["A"].wait_for_timeout(2500)
    t1 = {n: pg.evaluate("__cc.G.tick") for n, pg in pages.items()}
    pages["A"].wait_for_timeout(3000)
    t2 = {n: pg.evaluate("__cc.G.tick") for n, pg in pages.items()}
    check("ほかの人は止まらない", all(t2[n] - t1[n] > 60 for n in pages), f"{t1} -> {t2}")
    drops = {n: pg.evaluate(f"NET.drops[{cme}]") for n, pg in pages.items()}
    check("C は CPU にかわった", all(isinstance(v, int) for v in drops.values()), str(drops))
    for n, pg in pages.items(): pg.wait_for_selector("table.res", timeout=60000)
    st = {n: pg.evaluate("({d: NET.desync, c: NET.checked || 0})") for n, pg in pages.items()}
    check("ずれがない", not any(s["d"] for s in st.values()), str(st))
    pages["A"].click("#lobby")
    for n, pg in pages.items(): pg.wait_for_selector(".plist", timeout=8000)
    del_c.wait_for_selector(".plist", timeout=8000)
    pages["C"] = del_c
    check("試合のあと、C も待ちあいにいる", pages["A"].locator(".plist .pl").count() == 4, "A, B, C と CPU 1")

    # C が「部屋を出る」→ 読み直す
    pages["C"].click("#lv"); pages["C"].wait_for_selector("#mk", timeout=8000)
    pages["C"] = reload(ph, "C")
    pages["C"].wait_for_timeout(1500)
    check("自分で出たあとは、自動で戻らない", pages["C"].locator(".code").count() == 0)
    pages["C"].click("#online")
    check("部屋コードは入力欄に残る", pages["C"].input_value("#cd") == code)
    check("ページのエラーなし", not ph.errors, str(ph.errors[:3]))
    b.close()
print("ALL OK" if ok else "SOME NG")
sys.exit(0 if ok else 1)
