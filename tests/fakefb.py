"""にせ Firebase(テスト用。compat 版の firebase.* をまねる)。データは Python の中の tree に置く。
online_test.py で使う。本物の Firebase にはつながない。GRAB & RUN の tests/fakefb.py と同じ考え方。"""
import json, threading, time, functools, http.server, socketserver, itertools

tree = {}
ondis = {}          # uid -> {path: value}  切れたときに書きこむもの
clock = itertools.count(int(time.time() * 1000))
pushn = itertools.count(1)

def parts(path): return [p for p in path.split("/") if p]
def get_at(path):
    node = tree
    for k in parts(path):
        if not isinstance(node, dict) or k not in node: return None
        node = node[k]
    return node
def resolve(v):
    if isinstance(v, list): v = {str(i): x for i, x in enumerate(v)}
    if isinstance(v, dict):
        if v == {".sv": "timestamp"}: return next(clock)
        out = {k: resolve(x) for k, x in v.items() if x is not None}
        out = {k: x for k, x in out.items() if x is not None}
        return out or None
    return v
def set_at(path, value):
    global tree
    value = resolve(value)
    ps = parts(path)
    if not ps: tree = value or {}; return
    chain = [tree]
    node = tree
    for k in ps[:-1]:
        if not isinstance(node.get(k), dict): node[k] = {}
        node = node[k]; chain.append(node)
    if value is None: node.pop(ps[-1], None)
    else: node[ps[-1]] = value
    for i in range(len(ps) - 1, 0, -1):   # 空になった親を片づける
        if chain[i] == {}: chain[i - 1].pop(ps[i - 1], None)
def as_list(v):
    """{'0':..,'1':..} は本物の Firebase と同じく配列にして返す"""
    if isinstance(v, dict):
        v = {k: as_list(x) for k, x in v.items()}
        if v and all(k.isdigit() for k in v):
            n = max(int(k) for k in v) + 1
            if len(v) * 2 > n: return [v.get(str(i)) for i in range(n)]
    return v

lock = threading.Lock()
def handler_for(uid):
    def h(o):
        with lock:
            op = o["op"]
            if op == "uid": return uid
            if op == "get": return as_list(get_at(o["path"]))
            if op == "set": set_at(o["path"], o.get("value")); return None
            if op == "update":
                for k, v in o["value"].items(): set_at(o["path"].rstrip("/") + "/" + k, v)
                return None
            if op == "push":
                key = "k%09d" % next(pushn)
                set_at(o["path"].rstrip("/") + "/" + key, o.get("value")); return key
            if op == "cas":   # 前に読んだ値のままなら書く(トランザクション用)
                if json.dumps(as_list(get_at(o["path"])), sort_keys=True) != json.dumps(o.get("expect"), sort_keys=True): return False
                set_at(o["path"], o.get("value")); return True
            if op == "odset": ondis.setdefault(uid, {})[o["path"]] = o.get("value"); return None
            if op == "odcancel": ondis.get(uid, {}).pop(o["path"], None); return None
            raise ValueError(op)
    return h

FAKE_JS = r"""
(function(){
const call = o => window.__db(o);
const snap = (v, key) => ({ key, exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : v) });
function Ref(path){
  this.path = path.replace(/\/+$/,''); this.key = this.path.split('/').pop(); this._subs = [];
}
Ref.prototype.child = function(p){ return new Ref(this.path + '/' + p); };
Ref.prototype.get = async function(){ return snap(await call({op:'get', path:this.path}), this.key); };
Ref.prototype.set = async function(v){ await call({op:'set', path:this.path, value:v}); };
Ref.prototype.update = async function(v){ await call({op:'update', path:this.path, value:v}); };
Ref.prototype.remove = async function(){ await call({op:'set', path:this.path, value:null}); };
Ref.prototype.push = function(v){ const p = call({op:'push', path:this.path, value:v}); const r = new Ref(this.path + '/pending'); r.then = (a,b)=>p.then(a,b); return r; };
Ref.prototype.transaction = async function(fn){
  for (let i = 0; i < 25; i++) {
    let cur = await call({op:'get', path:this.path}); if (cur === undefined) cur = null;
    const next = fn(cur);
    if (next === undefined) return { committed:false, snapshot: snap(cur) };
    if (await call({op:'cas', path:this.path, expect:cur, value:next})) return { committed:true, snapshot: snap(next) };
  }
  throw new Error('transaction failed');
};
Ref.prototype.onDisconnect = function(){ const path = this.path; return {
  set: async v => call({op:'odset', path, value:v}), remove: async () => call({op:'odset', path, value:null}),
  cancel: async () => call({op:'odcancel', path}) }; };
Ref.prototype.on = function(ev, cb){
  const sub = { stop:false }; this._subs.push(sub); (Ref._all[this.path] = Ref._all[this.path] || []).push(sub);
  let last = '__init'; const seen = new Set();
  const tick = async () => {
    if (sub.stop) return;
    const v = await call({op:'get', path:this.path});
    if (ev === 'value') { const j = JSON.stringify(v ?? null); if (j !== last) { last = j; cb(snap(v ?? null, this.key)); } }
    else if (ev === 'child_added' && v && typeof v === 'object') {
      for (const k of Object.keys(v).sort()) if (!seen.has(k)) { seen.add(k); cb(snap(v[k], k)); }
    }
    if (!sub.stop) setTimeout(tick, 40);
  };
  tick();
};
Ref.prototype.off = function(){ for (const s of (Ref._all[this.path] || [])) s.stop = true; Ref._all[this.path] = []; };
Ref._all = {};
const db = { ref: p => new Ref(p) };
window.firebase = {
  apps: [], initializeApp(){ this.apps.push({}); return {}; },
  appCheck(){ return { activate(){} }; },
  auth(){ return { signInAnonymously: async () => ({ user: { uid: await call({op:'uid'}) } }) }; },
  database: Object.assign(() => db, { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }),
};
window.firebase.appCheck.ReCaptchaEnterpriseProvider = function(){};
})();
"""

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve(root):
    """ページを配るサーバーを動かして、index.html の URL を返す"""
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/index.html"

class Phones:
    """スマホ数台ぶんの画面を作る"""
    def __init__(self, browser, url):
        self.browser, self.url, self.all, self.errors = browser, url, {}, []
    def open(self, name, w=390, h=844):
        ctx = self.browser.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True, locale="ja-JP")
        def fake(route):
            u = route.request.url
            route.fulfill(content_type="text/javascript", body=FAKE_JS if "firebase-app-compat" in u else "")
        ctx.route("https://www.gstatic.com/firebasejs/**", fake)
        uid = "uid_" + name
        ctx.expose_function("__db", handler_for(uid))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: self.errors.append(f"{name}: {e}"))
        pg.goto(self.url); pg.wait_for_timeout(300)
        self.all[name] = (ctx, pg, uid)
        return pg
    def disconnect(self, name):
        """スマホを閉じた(電波が切れた)ことにする"""
        ctx, pg, uid = self.all.pop(name)
        ctx.close()
        with lock:
            for path, v in ondis.pop(uid, {}).items(): set_at(path, v)
