/* CUT & CLAIM 本体(画面・操作・描画・ひとりで練習)。sim.js(計算)と i18n.js のあとに読む。オンラインは net.js。
   画面: home(ホーム)→ solo(ひとりで練習の設定)→ play(対戦)→ end(結果)
   - 計算は sim.js の CC.step だけ。1秒に30コマ。ランダムは試合ごとの種(seed)。
   - ひとりで練習は、自分がプレイヤー0、CPU が 1〜7。 */

const $ = id => document.getElementById(id);
const app = $('app');
const LS = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FOOT = () => `<p class="dim foot"><a href="${sitePath('/')}">${T("Muddy's Games トップ")}</a>・<a href="${sitePath('/privacy.html')}">${T('プライバシーポリシー')}</a></p>`;

/* 8人の色(プレイヤー番号の順): 赤・青・緑・黄・紫・オレンジ・水色・ピンク */
const COLORS = ['#ff3b5c', '#3b8cff', '#34e07a', '#ffd23b', '#b45cff', '#ff8a2b', '#3be8ff', '#ff5cc8'];
const LV_NAME = { easy: 'よわい', normal: 'ふつう', hard: 'つよい' };
const ARROW = ['▲', '▶', '▼', '◀'];

let G = null;          // 試合の状態(sim.js)
let ME = 0;            // 自分のプレイヤー番号(観戦は -1)
let NAMES = [];        // プレイヤーの名前
let online = false;    // オンライン対戦中か
let raf = 0, lastT = 0, acc = 0, intro = 0;
let soloN = Math.min(7, Math.max(1, +(LS.get('cc-cpus') || 3)));
let soloLv = CC.CPU[LS.get('cc-lv')] ? LS.get('cc-lv') : 'normal';
let toasts = [];
const toast = msg => toasts.push({ msg, t: 2 });

/* ---------- 戻るボタンの確認(backguard.js) ---------- */
function guard(level, fn) { if (window.BackGuard) BackGuard.set(level, fn); }

/* ---------- 画面: ホーム ---------- */
function home() {
  stopLoop(); guard('home');
  app.innerHTML = `
  <h1 class="title">CUT &amp; CLAIM</h1>
  <div class="dim">${T('線で切って、陣地を取れ！')}</div>
  ${langSwitchHtml()}
  <div class="card left">
    <div class="lbl">${T('遊び方')}</div>
    <div>① ${T('△は、線の上を自動で進む')}</div>
    <div>② ${T('線の上で、空いている側の矢印を押すと、枠の中へ進んでいく。中でも矢印で向きを変える')}</div>
    <div>③ ${T('中では、人の陣地の中にも線を引ける。外の枠か自分の陣地に戻ってきたら、囲んだうちダイヤンがいないほうが自分の陣地になる(人の陣地もふくむ。どちらにもいなければ小さいほう)')}</div>
    <div>④ ${T('中を進んでいる線を、人にさわられたらやられる(自分の線にぶつかっても)。空いている所ではダイヤンにさわられてもやられる。5秒で復活')}</div>
    <div>⑤ ${T('線の上はアスタンが走っている。さわるとやられる。中へ入ると、線をたどって追いかけてくる')}</div>
    <div>⑥ ${T('囲まれた所の線の上にいた人も、やられる')}</div>
    <div>⑦ ${T('A を押しているあいだ、ダッシュ(2倍の速さ)。ゲージは線の上でたまる')}</div>
    <div>⑧ ${T('陣地が目標をこえるか、3分たって陣地がいちばん広い人の勝ち。目標は 2〜3人で50%、4〜5人で35%、6〜8人で30%')}</div>
  </div>
  <button id="solo" class="wide">${T('ひとりで練習(CPU対戦)')}</button>
  ${window.NO_ONLINE ? `<button class="wide sub" disabled>${T('オンライン対戦は muddys-games.com で遊べます')}</button>` : `<button id="online" class="wide">${T('オンライン対戦(8人まで)')}</button>`}
  <div class="dim small">${T('試作版です。遊びながら調整します')}</div>
  ${FOOT()}`;
  langSwitchInit(() => { });
  $('solo').onclick = solo;
  if ($('online')) $('online').onclick = () => netHome();
}

/* ---------- 画面: ひとりで練習の設定 ---------- */
function solo() {
  stopLoop(); guard('home');
  const nb = [1, 2, 3, 4, 5, 6, 7].map(n => `<button class="sub mini ${n === soloN ? 'on' : ''}" data-n="${n}">${n}</button>`).join('');
  const lb = Object.keys(LV_NAME).map(l => `<button class="sub mini ${l === soloLv ? 'on' : ''}" data-lv="${l}">${T(LV_NAME[l])}</button>`).join('');
  app.innerHTML = `
  <h1>${T('ひとりで練習(CPU対戦)')}</h1>
  <div class="card"><div class="lbl">${T('CPUの数')}</div><div class="seg">${nb}</div>
  <div class="lbl">${T('CPUの強さ')}</div><div class="seg">${lb}</div></div>
  <button id="go" class="wide">${T('スタート')}</button>
  <button id="back" class="sub">${T('もどる')}</button>`;
  app.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { soloN = +b.dataset.n; LS.set('cc-cpus', soloN); solo(); });
  app.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { soloLv = b.dataset.lv; LS.set('cc-lv', soloLv); solo(); });
  $('go').onclick = startSolo;
  $('back').onclick = home;
}
function startSolo() {
  const slots = [{ cpu: null }].concat(Array.from({ length: soloN }, () => ({ cpu: soloLv })));
  const names = [T('あなた')].concat(slots.slice(1).map((s, i) => 'CPU ' + (i + 1)));
  play({ seed: (Date.now() & 0x7fffffff) | 1, slots, names, me: 0 });
}

/* ---------- 画面: 対戦 ---------- */
/* opt: { seed, slots, names, me, online } */
function play(opt) {
  stopLoop();
  G = CC.newGame(opt.seed, opt.slots, opt.limit);
  ME = opt.me; NAMES = opt.names; online = !!opt.online;
  intro = 2.2; acc = 0; held = false; toasts = []; FX.length = 0; SPK.length = 0; terrVer = -1;
  guard('game', online ? netLeaveToEntry : () => solo());
  app.innerHTML = `
  <div class="hud"><span id="ht">3:00</span><span id="hp" class="me"></span><button id="quit" class="sub mini">✕</button></div>
  <div id="rank" class="rank"></div>
  <div class="board"><canvas id="cv"></canvas><div id="toasts"></div><div id="intro" class="intro"></div></div>
  <div class="pad ${ME < 0 ? 'spec' : ''}">
    <div class="arrows">${[0, 1, 2, 3].map(d => `<button class="ar ar${d}" data-d="${d}">${ARROW[d]}</button>`).join('')}</div>
    <button id="abtn" class="abtn">A</button>
  </div>`;
  cv = $('cv'); cx = cv.getContext('2d');
  resize();
  app.querySelectorAll('[data-d]').forEach(b => b.onpointerdown = e => { e.preventDefault(); act('d', +b.dataset.d); press(b); });
  // A: 押しているあいだダッシュ
  const ab = $('abtn');
  ab.onpointerdown = e => { e.preventDefault(); try { ab.setPointerCapture(e.pointerId); } catch (_) { } hold(true); press(ab); };
  ab.onpointerup = ab.onpointercancel = ab.onlostpointercapture = () => hold(false);
  $('quit').onclick = () => {
    if ($('quit').classList.contains('sure')) { if (online) netLeaveToEntry(); else solo(); }
    else { $('quit').classList.add('sure'); $('quit').textContent = T('本当にやめる？'); setTimeout(() => { const q = $('quit'); if (q) { q.classList.remove('sure'); q.textContent = '✕'; } }, 2500); }
  };
  lastT = performance.now(); raf = requestAnimationFrame(loop);
}
let held = false;
function hold(on) { if (held === on) return; held = on; $('abtn') && $('abtn').classList.toggle('on', on); act('a', on ? 1 : 0); }
function press(b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); try { navigator.vibrate && navigator.vibrate(8); } catch (e) { } }
/* 操作: ひとりならすぐ、オンラインは net.js で送る */
function act(a, d) {
  if (!G || G.over || ME < 0 || (intro > 0 && a !== 'a')) return;
  if (online) netSend(a, d); else CC.command(G, ME, a, d);
}
const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
window.addEventListener('keydown', e => {
  if (!G || !$('cv')) return;
  if (e.key in KEYS) { act('d', KEYS[e.key]); e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'Enter' || e.key === 'z') { if (!e.repeat) hold(true); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (!G || !$('cv')) return;
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'z') { hold(false); e.preventDefault(); }
});

let cv = null, cx = null, BW = 360, BH = 480, CS = 6, PX = 8, DPR = 1;   // PX = フィールドのまわりのすき間(はしのキャラが切れないように)
const PADM = 2.4;   // すき間の大きさ(マス)
function resize() {
  if (!cv) return;
  const r = app.getBoundingClientRect();
  // 横はばいっぱい。たてが入りきらなければ、たてに合わせて小さくする
  const TW = Math.floor(Math.max(210, Math.min(r.width || 360, 460, (window.innerHeight - 300) * (CC.W + PADM * 2) / (CC.H + PADM * 2))));
  CS = TW / (CC.W + PADM * 2); BW = CS * CC.W; BH = CS * CC.H; PX = CS * PADM;
  const TH = Math.round(BH + PX * 2);
  DPR = window.devicePixelRatio || 1;
  cv.width = Math.round(TW * DPR); cv.height = Math.round(TH * DPR);
  cv.style.width = TW + 'px'; cv.style.height = TH + 'px';
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  terrVer = -1;
}
window.addEventListener('resize', () => { if (G && cv && document.body.contains(cv)) resize(); });

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (intro > 0) { intro -= dt; }
  else if (!G.over) {
    if (online) netStep(dt);
    else { acc = Math.min(acc + dt, 0.3); while (acc >= CC.TICK && !G.over) { CC.step(G); events(); acc -= CC.TICK; } }
  }
  toasts.forEach(t => t.t -= dt); toasts = toasts.filter(t => t.t > 0);
  draw(dt); hud();
  if (online) netHud();
  if (G.over) { raf = 0; setTimeout(end, 1200); return; }
  raf = requestAnimationFrame(loop);
}
/* 1コマごとの出来事(やられた・囲んだ)を、演出とお知らせにする */
function events() {
  for (const e of G.events) {
    if (e.t === 'die') {
      boom(e.x, e.y, COLORS[e.p]);
      if (e.p === ME) toast(e.by >= 0 ? T('{name} にやられた', { name: esc(NAMES[e.by]) }) : e.by === -2 ? T('ダイヤンにやられた') : e.by === -3 ? T('アスタンにやられた') : T('やられた'));
      else if (e.by === ME) toast(T('{name} をたおした！', { name: esc(NAMES[e.p]) }));
    }
    if (e.t === 'claim') { const P = G.players[e.p]; flash.push({ p: e.p, t: 0.5, x: P.x, y: P.y, n: G.area[e.p] }); }
  }
}

/* ---------- 描画(ネオン風) ---------- */
const FX = [], flash = [];
const ETR = { g: null, l: [] };   // ダイヤンの通ったあと(画面だけ)
const SPK = [];   // アスタンの火花(画面だけ)
function boom(x, y, col) { for (let k = 0; k < 14; k++) { const a = Math.random() * 7, s = 4 + Math.random() * 10; FX.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.6, col }); } }
let terrVer = -1, fillC = null, edgeC = null;
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
/* 陣地の絵を、変わったときだけ作り直す。
   中のぬり = 1マス 1点の小さい絵。ふちの線 = 画面と同じ細かさの絵に、マスの真ん中を通る細い光の線(スタイリッシュに) */
function buildTerritory() {
  const MW = CC.W, MH = CC.H;
  if (!fillC) { fillC = document.createElement('canvas'); edgeC = document.createElement('canvas'); fillC.width = MW; fillC.height = MH; }
  const ew = Math.round(BW * DPR), eh = Math.round(BH * DPR);
  if (edgeC.width !== ew || edgeC.height !== eh) { edgeC.width = ew; edgeC.height = eh; }
  const f = fillC.getContext('2d'), e = edgeC.getContext('2d');
  const fi = f.createImageData(MW, MH);
  const rgb = COLORS.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  for (let i = 0; i < MW * MH; i++) {
    const o = G.own[i], k = i * 4;
    if (o > 0) {
      const c = rgb[o - 1];
      fi.data[k] = c[0] * 0.28 + 7; fi.data[k + 1] = c[1] * 0.28 + 10; fi.data[k + 2] = c[2] * 0.28 + 22; fi.data[k + 3] = 255;
    } else if (o === -1) {
      fi.data[k] = 20; fi.data[k + 1] = 30; fi.data[k + 2] = 52; fi.data[k + 3] = 255;
    }
  }
  f.putImageData(fi, 0, 0);
  // ふちの線: 持ち主ごとに、となりの線のマスと真ん中どうしをつなぐ
  const paths = {};
  const at = i => paths[G.own[i]] || (paths[G.own[i]] = new Path2D());
  const cxy = i => [((i % MW) + 0.5) * CS, (((i / MW) | 0) + 0.5) * CS];
  for (let i = 0; i < MW * MH; i++) {
    if (!G.line[i]) continue;
    const o = G.own[i], x = i % MW, y = (i / MW) | 0, [ax, ay] = cxy(i);
    let n = 0;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= MW || yy >= MH) continue;
      const j = yy * MW + xx; if (!G.line[j] || G.own[j] !== o) continue;
      n++; if (dx < 0 || dy < 0) continue;   // 同じ線を2回描かない
      // 空いている所に面している線だけ描く(はば2マスの陣地が、はしごのように見えないように)
      const fr0 = (px, py) => px >= 0 && py >= 0 && px < MW && py < MH && G.own[py * MW + px] === 0;
      const face = dx ? fr0(x, y - 1) || fr0(xx, y - 1) || fr0(x, y + 1) || fr0(xx, y + 1) : fr0(x - 1, y) || fr0(x - 1, yy) || fr0(x + 1, y) || fr0(x + 1, yy);
      if (!face) continue;
      const [bx, by] = cxy(j), p = at(i); p.moveTo(ax, ay); p.lineTo(bx, by);
    }
    if (!n) { const p = at(i); p.moveTo(ax - CS * 0.3, ay); p.lineTo(ax + CS * 0.3, ay); }   // ひとつだけの点
  }
  e.setTransform(1, 0, 0, 1, 0, 0); e.clearRect(0, 0, ew, eh); e.setTransform(DPR, 0, 0, DPR, 0, 0);
  e.lineCap = 'round'; e.lineJoin = 'round';
  for (const k in paths) {
    const col = +k === -1 ? '#96d7ff' : COLORS[+k - 1];
    e.strokeStyle = col; e.shadowColor = col;
    e.globalAlpha = 0.55; e.shadowBlur = CS * 1.6; e.lineWidth = Math.max(1.5, CS * 0.42); e.stroke(paths[k]);   // 光
    e.globalAlpha = 1; e.shadowBlur = CS * 0.5; e.lineWidth = Math.max(1, CS * 0.26); e.stroke(paths[k]);        // 芯
  }
  e.shadowBlur = 0;
  terrVer = G.ver;
}
function draw(dt) {
  if (!cx) return;
  const MW = CC.W;
  if (terrVer !== G.ver) buildTerritory();
  // なめらかに見せる: 1コマの中の、いまの時間(画面だけ。計算には関係ない)
  const fr = Math.max(0, Math.min(1, acc / CC.TICK)), vt = G.tick + fr;
  const ppos = P => {   // △の見た目の位置(前のマスから今のマスへ、すーっと)
    if (Math.abs(P.x - P.px) + Math.abs(P.y - P.py) !== 1) return [P.x, P.y];
    const f = Math.max(0, Math.min(1, (vt - P.mt) / P.ms));
    return [P.px + (P.x - P.px) * f, P.py + (P.y - P.py) * f];
  };
  cx.imageSmoothingEnabled = false;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  cx.translate(PX, PX);   // フィールドのまわりにすき間
  cx.fillStyle = '#080d1c'; cx.fillRect(0, 0, BW, BH);
  // まだだれのものでもない場所の点
  cx.fillStyle = 'rgba(120,160,255,.10)';
  for (let y = 5; y < CC.H; y += 5) for (let x = 5; x < MW; x += 5) cx.fillRect((x + 0.5) * CS - 1, (y + 0.5) * CS - 1, 2, 2);
  cx.drawImage(fillC, 0, 0, BW, BH);
  // 囲んだ瞬間に光る
  for (const f of flash) {
    f.t -= dt;
    cx.globalAlpha = Math.max(0, f.t) * 0.9;
    cx.fillStyle = COLORS[f.p]; cx.font = `bold ${Math.round(CS * 3.2)}px sans-serif`; cx.textAlign = 'center';
    cx.fillText(Math.round(f.n / CC.INNER * 100) + '%', (f.x + 0.5) * CS, (f.y - 1.5) * CS - (0.5 - f.t) * 30);
    cx.globalAlpha = 1;
  }
  for (let k = flash.length - 1; k >= 0; k--) if (flash[k].t <= 0) flash.splice(k, 1);
  // 線(ふち)を光らせる
  cx.imageSmoothingEnabled = true; cx.drawImage(edgeC, 0, 0, BW, BH);
  // 中を進んでいる線
  cx.lineCap = 'round'; cx.lineJoin = 'round';
  for (const P of G.players) {
    if (P.mode !== 'draw' || !P.trail.length) continue;
    const pts = [P.start].concat(P.trail);
    cx.strokeStyle = COLORS[P.i]; cx.lineWidth = Math.max(1.5, CS * 0.45);
    cx.shadowColor = COLORS[P.i]; cx.shadowBlur = 10;
    cx.beginPath();
    const hd = ppos(P);
    pts.forEach((i, k) => {
      let x = i % MW, y = i / MW | 0;
      if (k === pts.length - 1) [x, y] = hd;   // 先は、△といっしょにすーっと
      x = (x + 0.5) * CS; y = (y + 0.5) * CS;
      if (k) cx.lineTo(x, y); else cx.moveTo(x, y);
    });
    cx.stroke(); cx.shadowBlur = 0;
  }
  // △
  for (const P of G.players) {
    if (P.mode === 'dead') continue;
    const [vx, vy] = ppos(P), x = (vx + 0.5) * CS, y = (vy + 0.5) * CS, s = CS * (P.i === ME ? 2.3 : 1.9), a = P.dir * Math.PI / 2;
    cx.save(); cx.translate(x, y); cx.rotate(a);
    // 中は塗らずに、線だけの△(自分は太く、内側に白い線)
    cx.beginPath(); cx.moveTo(0, -s); cx.lineTo(s * 0.8, s * 0.7); cx.lineTo(-s * 0.8, s * 0.7); cx.closePath();
    cx.strokeStyle = COLORS[P.i]; cx.shadowColor = COLORS[P.i]; cx.shadowBlur = P.i === ME ? 16 : 10;
    cx.lineWidth = P.i === ME ? 3.2 : 2.2; cx.stroke(); cx.shadowBlur = 0;
    if (P.i === ME) { cx.lineWidth = 1.2; cx.strokeStyle = '#fff'; cx.stroke(); }
    if (P.dash) {   // ダッシュ中: うしろに短い光のすじ
      cx.strokeStyle = hexA(COLORS[P.i], 0.7); cx.lineWidth = 1.5; cx.shadowColor = COLORS[P.i]; cx.shadowBlur = 6;
      cx.beginPath();
      for (const o of [-0.45, 0, 0.45]) { cx.moveTo(o * s, s * 1.0); cx.lineTo(o * s, s * (o ? 1.8 : 2.2)); }
      cx.stroke(); cx.shadowBlur = 0;
    }
    cx.restore();
  }
  // 中の敵「ダイヤン」: 白い細長い◇(中を塗る)。くるくるゆっくり回りながら進む。通ったあとがうっすら光る
  if (ETR.g !== G) { ETR.g = G; ETR.l = []; }
  for (const [k, E] of G.enemies.entries()) {
    const ex = (E.px + (E.x - E.px) * fr) / CC.U * CS, ey = (E.py + (E.y - E.py) * fr) / CC.U * CS, L = CS * CC.E_LEN, Wd = CS * CC.E_WID;
    const tr = ETR.l[k] || (ETR.l[k] = []);
    const lt = tr[tr.length - 1];
    if (!lt || lt[0] !== E.x || lt[1] !== E.y) { tr.push([E.x, E.y]); if (tr.length > 45) tr.shift(); }
    cx.save();
    {
      cx.lineCap = 'butt'; cx.lineWidth = Math.max(1, CS * 0.3); cx.shadowColor = '#bcd4ff'; cx.shadowBlur = 6;
      for (let j = 1; j < tr.length; j++) {
        cx.strokeStyle = `rgba(190,215,255,${(j / tr.length) * 0.3})`;
        cx.beginPath(); cx.moveTo(tr[j - 1][0] / CC.U * CS, tr[j - 1][1] / CC.U * CS); cx.lineTo(tr[j][0] / CC.U * CS, tr[j][1] / CC.U * CS); cx.stroke();
      }
    }
    const rot = Math.PI * 2 * (vt / CC.SPIN + E.k * 24 / 64) + Math.PI / 2;   // 向きは計算(sim.js)と同じ
    // 回ったあとの残像: うしろ側の長い面のかげを、細い線で何本か。はなれるほどうすく
    const GN = 10, GS = 0.9 / GN;
    cx.lineCap = 'round'; cx.lineWidth = 1; cx.shadowColor = '#cfe0ff'; cx.shadowBlur = 4;
    for (let j = 1; j <= GN; j++) {
      const r = rot - j * GS, c = Math.cos(r), sn = Math.sin(r), P = (x, y) => [ex + x * c - y * sn, ey + x * sn + y * c];
      cx.strokeStyle = `rgba(215,228,255,${0.6 * (1 - (j - 1) / GN)})`;
      const a1 = P(0, -L), a2 = P(-Wd, 0), b1 = P(Wd, 0), b2 = P(0, L);
      cx.beginPath(); cx.moveTo(a1[0], a1[1]); cx.lineTo(a2[0], a2[1]); cx.moveTo(b1[0], b1[1]); cx.lineTo(b2[0], b2[1]); cx.stroke();
    }
    cx.translate(ex, ey); cx.rotate(rot);
    cx.beginPath(); cx.moveTo(0, -L); cx.lineTo(Wd, 0); cx.lineTo(0, L); cx.lineTo(-Wd, 0); cx.closePath();
    cx.fillStyle = '#f4f6ff'; cx.shadowColor = '#ffffff'; cx.shadowBlur = 8; cx.fill();
    cx.restore();
  }
  // アスタン(線の上を走る敵): 白+ライムの「＊」がくるくる回る。ライム色の火花をちらす
  for (const S of G.sparx) {
    const f = Math.abs(S.x - S.px) + Math.abs(S.y - S.py) === 1 ? Math.max(0, Math.min(1, (vt - S.mt) / S.ms)) : 1;
    const x = (S.px + (S.x - S.px) * f + 0.5) * CS, y = (S.py + (S.y - S.py) * f + 0.5) * CS;
    for (let n = 0; n < 2; n++) { const a = Math.random() * 6.28, v = CS * (8 + Math.random() * 14); SPK.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.25 + Math.random() * 0.3, t0: 0.55 }); }
    const L = CS * 2.1, star = (l, w) => { cx.lineWidth = w; cx.beginPath(); for (let j = 0; j < 4; j++) { const a = j * Math.PI / 4; cx.moveTo(-Math.cos(a) * l, -Math.sin(a) * l); cx.lineTo(Math.cos(a) * l, Math.sin(a) * l); } cx.stroke(); };
    cx.save(); cx.translate(x, y); cx.rotate(vt / 40 + S.k); cx.lineCap = 'round';
    cx.strokeStyle = '#b8ff2e'; cx.shadowColor = '#b8ff2e'; cx.shadowBlur = 10; star(L, Math.max(1.6, CS * 0.42));
    cx.strokeStyle = '#ffffff'; cx.shadowBlur = 4; star(L * 0.55, Math.max(1.6, CS * 0.44));
    cx.restore();
  }
  for (const f of SPK) {
    f.t -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += CS * 14 * dt;
    const al = Math.max(0, f.t / f.t0);
    cx.fillStyle = al > 0.6 ? `rgba(245,255,220,${al})` : `rgba(184,255,46,${Math.min(1, al * 1.6)})`; cx.shadowColor = '#b8ff2e'; cx.shadowBlur = 6;
    const z = Math.max(2, CS * 0.45) * (0.5 + al * 0.5); cx.fillRect(f.x - z / 2, f.y - z / 2, z, z); cx.shadowBlur = 0;
  }
  for (let k = SPK.length - 1; k >= 0; k--) if (SPK[k].t <= 0) SPK.splice(k, 1);
  // やられたときの火花
  for (const f of FX) {
    f.t -= dt; f.x += f.vx * dt; f.y += f.vy * dt;
    cx.globalAlpha = Math.max(0, f.t / 0.6); cx.fillStyle = f.col;
    cx.fillRect(f.x * CS - 2, f.y * CS - 2, 4, 4);
  }
  cx.globalAlpha = 1;
  for (let k = FX.length - 1; k >= 0; k--) if (FX[k].t <= 0) FX.splice(k, 1);
  // 最初のカウント
  const it = $('intro');
  if (it) { it.hidden = intro <= 0; if (intro > 0) it.textContent = intro > 1.4 ? '3' : intro > 0.7 ? '2' : '1'; }
}
function hud() {
  if (!$('ht')) return;
  const left = Math.max(0, Math.ceil((G.limit - G.tick) / 30));
  $('ht').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  const pc = k => (G.area[k] / CC.INNER * 100).toFixed(1) + '%';
  if (ME >= 0) {
    const P = G.players[ME], ab = $('abtn');
    if (ab) { ab.style.setProperty('--g', (P.g / CC.GAUGE_MAX * 100).toFixed(1) + '%'); ab.classList.toggle('tired', !!P.tired); }
    $('hp').innerHTML = `<i style="background:${COLORS[ME]}"></i>${pc(ME)}` + (P.mode === 'dead' ? ` <b>${T('復活まで {n}', { n: Math.max(1, Math.ceil((CC.RESPAWN - (G.tick - P.deadAt)) / 30)) })}</b>` : '');
  }
  const order = G.players.map(P => P.i).sort((a, b) => G.area[b] - G.area[a] || a - b);
  $('rank').innerHTML = order.map(k => `<span class="${k === ME ? 'me' : ''}"><i style="background:${COLORS[k]}"></i>${esc(NAMES[k] || '')} ${pc(k)}</span>`).join('');
  $('toasts').innerHTML = toasts.slice(-2).map(t => `<div class="toast">${t.msg}</div>`).join('');
}

/* ---------- 画面: 結果 ---------- */
function end() {
  if (!G || !G.over || !$('cv')) return;
  const o = G.over, win = o.win, me = ME;
  const ttl = win.length > 1 ? T('引き分け') : win[0] === me ? T('🏆 勝利！') : T('{name} の勝ち！', { name: esc(NAMES[win[0]]) });
  const why = o.reason === 'rate' ? T('陣地が{p}%をこえた', { p: Math.round(G.winRate * 100) }) : o.reason === 'time' ? T('時間切れ。陣地がいちばん広い人の勝ち') : T('ぜんぶ取られた');
  const order = G.players.map(P => P.i).sort((a, b) => G.area[b] - G.area[a] || a - b);
  const rows = order.map((k, r) => `<tr class="${k === me ? 'me' : ''}"><td>${r + 1}</td><td class="nm"><i style="background:${COLORS[k]}"></i>${esc(NAMES[k])}</td><td>${(G.area[k] / CC.INNER * 100).toFixed(1)}%</td><td>${G.players[k].kills}</td><td>${G.players[k].deaths}</td></tr>`).join('');
  stopLoop();
  guard(online ? 'room' : 'home', online ? netLeaveToEntry : null);
  app.innerHTML = `
  <h1 class="title">${ttl}</h1>
  <div class="dim">${why}</div>
  <div class="card"><table class="res"><tr><th>${T('順位')}</th><th></th><th>${T('陣地')}</th><th>${T('たおした')}</th><th>${T('やられた回数')}</th></tr>${rows}</table></div>
  ${online ? netEndButtons() : `<button id="again" class="wide">${T('もう一回')}</button>
  <button id="chg" class="wide sub">${T('設定を変える')}</button>
  <button id="hm" class="sub">${T('ホームへ')}</button>`}`;
  if (online) netEndInit();
  else { $('again').onclick = startSolo; $('chg').onclick = solo; $('hm').onclick = home; }
}

/* テスト用(ブラウザのコンソールから: __cc.G など) */
window.__cc = { get G() { return G }, get ME() { return ME }, play, home, solo, startSolo, act };
