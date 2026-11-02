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
    <div>② ${T('A を押すと、枠の中へ進んでいく。矢印で向きを変える')}</div>
    <div>③ ${T('線に戻ってこられたら、囲んだうち敵がいないほうが自分の陣地になる(どちらにもいなければ小さいほう)')}</div>
    <div>④ ${T('中を進んでいる線を、人や敵にさわられたら、やられる(自分の線にぶつかっても)。5秒で復活')}</div>
    <div>⑤ ${T('線の上にいるときは安全')}</div>
    <div>⑥ ${T('陣地が50%をこえるか、3分たって陣地がいちばん広い人の勝ち')}</div>
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
  intro = 2.2; acc = 0; toasts = []; FX.length = 0; terrVer = -1;
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
  $('abtn').onpointerdown = e => { e.preventDefault(); act('a', 0); press($('abtn')); };
  $('quit').onclick = () => {
    if ($('quit').classList.contains('sure')) { if (online) netLeaveToEntry(); else solo(); }
    else { $('quit').classList.add('sure'); $('quit').textContent = T('本当にやめる？'); setTimeout(() => { const q = $('quit'); if (q) { q.classList.remove('sure'); q.textContent = '✕'; } }, 2500); }
  };
  lastT = performance.now(); raf = requestAnimationFrame(loop);
}
function press(b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); try { navigator.vibrate && navigator.vibrate(8); } catch (e) { } }
/* 操作: ひとりならすぐ、オンラインは net.js で送る */
function act(a, d) {
  if (!G || G.over || ME < 0 || intro > 0) return;
  if (online) netSend(a, d); else CC.command(G, ME, a, d);
}
const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
window.addEventListener('keydown', e => {
  if (!G || !$('cv')) return;
  if (e.key in KEYS) { act('d', KEYS[e.key]); e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'Enter' || e.key === 'z') { act('a', 0); e.preventDefault(); }
});

let cv = null, cx = null, W = 360, CS = 6;
function resize() {
  if (!cv) return;
  const r = app.getBoundingClientRect();
  W = Math.floor(Math.min(r.width || 360, 460, window.innerHeight - 290));
  W = Math.max(240, W);
  CS = W / CC.N;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr);
  cv.style.width = W + 'px'; cv.style.height = W + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      if (e.p === ME) toast(e.by >= 0 ? T('{name} にやられた', { name: esc(NAMES[e.by]) }) : e.by === -2 ? T('敵にやられた') : T('やられた'));
      else if (e.by === ME) toast(T('{name} をたおした！', { name: esc(NAMES[e.p]) }));
    }
    if (e.t === 'claim') { const P = G.players[e.p]; flash.push({ p: e.p, t: 0.5, x: P.x, y: P.y, n: G.area[e.p] }); }
  }
}

/* ---------- 描画(ネオン風) ---------- */
const FX = [], flash = [];
function boom(x, y, col) { for (let k = 0; k < 14; k++) { const a = Math.random() * 7, s = 4 + Math.random() * 10; FX.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.6, col }); } }
let terrVer = -1, fillC = null, edgeC = null;
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
/* 陣地の絵(1マス = 1点の小さい絵)を、変わったときだけ作り直す */
function buildTerritory() {
  const N = CC.N;
  if (!fillC) { fillC = document.createElement('canvas'); edgeC = document.createElement('canvas'); fillC.width = fillC.height = edgeC.width = edgeC.height = N; }
  const f = fillC.getContext('2d'), e = edgeC.getContext('2d');
  const fi = f.createImageData(N, N), ei = e.createImageData(N, N);
  const rgb = COLORS.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  for (let i = 0; i < N * N; i++) {
    const o = G.own[i], k = i * 4;
    if (o > 0) {
      const c = rgb[o - 1];
      fi.data[k] = c[0] * 0.28 + 7; fi.data[k + 1] = c[1] * 0.28 + 10; fi.data[k + 2] = c[2] * 0.28 + 22; fi.data[k + 3] = 255;
      if (G.line[i]) { ei.data[k] = c[0]; ei.data[k + 1] = c[1]; ei.data[k + 2] = c[2]; ei.data[k + 3] = 255; }
    } else if (o === -1) {
      fi.data[k] = 20; fi.data[k + 1] = 30; fi.data[k + 2] = 52; fi.data[k + 3] = 255;
      if (G.line[i]) { ei.data[k] = 150; ei.data[k + 1] = 215; ei.data[k + 2] = 255; ei.data[k + 3] = 200; }
    }
  }
  f.putImageData(fi, 0, 0); e.putImageData(ei, 0, 0);
  terrVer = G.ver;
}
function draw(dt) {
  if (!cx) return;
  const N = CC.N;
  if (terrVer !== G.ver) buildTerritory();
  cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#080d1c'; cx.fillRect(0, 0, W, W);
  // まだだれのものでもない場所の点
  cx.fillStyle = 'rgba(120,160,255,.10)';
  for (let y = 5; y < N; y += 5) for (let x = 5; x < N; x += 5) cx.fillRect((x + 0.5) * CS - 1, (y + 0.5) * CS - 1, 2, 2);
  cx.drawImage(fillC, 0, 0, W, W);
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
  cx.drawImage(edgeC, 0, 0, W, W);
  cx.save(); cx.globalCompositeOperation = 'lighter'; cx.filter = `blur(${Math.max(2, CS * 0.7)}px)`; cx.globalAlpha = 0.9;
  cx.imageSmoothingEnabled = true; cx.drawImage(edgeC, 0, 0, W, W); cx.restore();
  // 中を進んでいる線
  cx.lineCap = 'round'; cx.lineJoin = 'round';
  for (const P of G.players) {
    if (P.mode !== 'draw' || !P.trail.length) continue;
    const pts = [P.start].concat(P.trail);
    cx.strokeStyle = COLORS[P.i]; cx.lineWidth = Math.max(2, CS * 0.75);
    cx.shadowColor = COLORS[P.i]; cx.shadowBlur = 10;
    cx.beginPath();
    pts.forEach((i, k) => { const x = (i % N + 0.5) * CS, y = ((i / N | 0) + 0.5) * CS; if (k) cx.lineTo(x, y); else cx.moveTo(x, y); });
    cx.stroke(); cx.shadowBlur = 0;
  }
  // △
  for (const P of G.players) {
    if (P.mode === 'dead') continue;
    const x = (P.x + 0.5) * CS, y = (P.y + 0.5) * CS, s = CS * (P.i === ME ? 2.3 : 1.9), a = P.dir * Math.PI / 2;
    cx.save(); cx.translate(x, y); cx.rotate(a);
    // 中は塗らずに、線だけの△(自分は太く、内側に白い線)
    cx.beginPath(); cx.moveTo(0, -s); cx.lineTo(s * 0.8, s * 0.7); cx.lineTo(-s * 0.8, s * 0.7); cx.closePath();
    cx.strokeStyle = COLORS[P.i]; cx.shadowColor = COLORS[P.i]; cx.shadowBlur = P.i === ME ? 16 : 10;
    cx.lineWidth = P.i === ME ? 3.2 : 2.2; cx.stroke(); cx.shadowBlur = 0;
    if (P.i === ME) { cx.lineWidth = 1.2; cx.strokeStyle = '#fff'; cx.stroke(); }
    cx.restore();
  }
  // 中の敵(本家の「クイックス」): 回りながらのびちぢみする光る線のたば
  const tm = performance.now() / 1000;
  for (const [k, E] of G.enemies.entries()) {
    const ex = E.x / CC.U * CS, ey = E.y / CC.U * CS;
    cx.save(); cx.globalCompositeOperation = 'lighter'; cx.lineCap = 'round';
    for (let j = 0; j < 6; j++) {
      const a = tm * (1.7 + j * 0.23) + j * 1.05 + k * 2, len = CS * (1.6 + 1.1 * Math.sin(tm * 2.3 + j * 1.7));
      const ox = Math.cos(tm * 1.3 + j * 2.1) * CS * 0.8, oy = Math.sin(tm * 1.1 + j * 1.3) * CS * 0.8;
      cx.strokeStyle = j % 2 ? '#ff4dff' : '#fff27a'; cx.shadowColor = cx.strokeStyle; cx.shadowBlur = 10; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(ex + ox - Math.cos(a) * len, ey + oy - Math.sin(a) * len); cx.lineTo(ex + ox + Math.cos(a) * len, ey + oy + Math.sin(a) * len); cx.stroke();
    }
    cx.restore();
  }
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
    const P = G.players[ME];
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
  const why = o.reason === 'rate' ? T('陣地が50%をこえた') : o.reason === 'time' ? T('時間切れ。陣地がいちばん広い人の勝ち') : T('ぜんぶ取られた');
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
