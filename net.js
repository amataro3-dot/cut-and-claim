/* CUT & CLAIM オンライン対戦(8人まで。CPU も入れられる)。game.js のあとに読む。最後にホーム画面を出す。
   Firebase は BANNER RAID・Labyrinth と同じプロジェクト(labyrinth-game-bc5aa)。場所は cc-rooms/{部屋コード}。

   部屋のデータ:
   meta        { state: 'lobby' | 'play', round, cpus(CPU の数), lv(CPU の強さ), created }
   players/{uid}    { name, joined }   … 回線が切れたら消える
   game/{round}     { seed, slots: ['uid', ..., 'cpu'], names: [...] }   … ホストが「はじめる」で書く
   cmds/{round}/{push}  操作 { p: プレイヤー番号, t: コマ, a: 'd' 矢印 / 'a' A ボタン / 'x' 回線が切れた, d: 向き, n: 通し番号 }
   fr/{round}/{p}       「このコマまでは、もう新しい操作を出さない」という約束
   drop/{round}/{p}     回線が切れた人が CPU にかわるコマ(ホストが1回だけ書く)
   hash/{round}/{p}/{コマ}  ずれていないかの確かめ

   同じ盤面にするしくみ(BANNER RAID と同じ):
   - 盤面の計算(sim.js)は全員が同じものを同じコマ数だけ進める。ランダムは試合ごとの同じ種(seed)。CPU も同じ計算の中で動く。
   - 操作は、押したコマ + DELAY のコマで、みんな同時に実行する。
   - 人はそれぞれ fr を書く。全員の fr のいちばん小さいコマより先へは進まない(待つ)。
   - 回線が切れた人は、ホストが「fr の次のコマから CPU にかわる」(a: 'x')を出す。そのコマからは、その人を待たない。
   - 150コマごとに、盤面の短い文字(CC.sig)を hash に書いてくらべる。 */

const DELAY = 8;         // 操作は 8コマ(約0.27秒)あとに実行する
const FR_EVERY = 3;      // fr は 3コマごとに書く
const HASH_EVERY = 150;  // 5秒ごとに、ずれていないか確かめる

const NET = { db: null, uid: null, code: null, ref: null, got: {}, meta: null, players: {},
  round: 0, slots: [], me: -1, cmds: {}, fr: {}, drops: {}, dropping: {}, sentFr: -1, seq: 0, hashes: {}, wait: 0, desync: false, leaving: false, starting: false };
let myName = LS.get('cc-name') || '';
let netScreen = '';

/* ---------- つなぐ(はじめて「オンライン対戦」を押したときだけ) ---------- */
function netInit() {
  if (NET.db) return Promise.resolve(true);
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') return Promise.resolve(false);
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    /* App Check: このサイトから来たアクセスだと証明する(失敗してもゲームは続ける) */
    try { firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider('6LfFffwtAAAAAKMoDAtqJDlgLK720RWBuBENti2t'), true); } catch (e) { console.warn('App Check', e); }
    NET.db = firebase.database();
  } catch (e) { console.warn(e); return Promise.resolve(false); }
  return new Promise(res => {
    let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
    try { firebase.auth().signInAnonymously().then(c => { NET.uid = c.user.uid; fin(true); }).catch(e => { console.warn(e); fin(false); }); } catch (e) { fin(false); }
    setTimeout(() => fin(!!NET.uid), 8000);
  });
}

/* ---------- 画面: 部屋に入る ---------- */
function netHome(err) {
  stopLoop(); netScreen = 'home'; guard('home');
  app.innerHTML = `
  <h1 class="title">CUT &amp; CLAIM</h1>
  <div class="dim">${T('オンライン対戦(8人まで)')}</div>
  <div class="card">
    <input id="nm" maxlength="8" placeholder="${T('なまえ')}" value="${esc(myName)}">
    <button id="mk" class="wide">${T('部屋を作る')}</button>
    <hr>
    <input id="cd" inputmode="numeric" maxlength="4" placeholder="${T('部屋コード(4けた)')}" value="${esc(LS.get('cc-room') || '')}">
    <button id="jn" class="wide sub">${T('入室する')}</button>
    <div class="err" id="er">${err ? esc(err) : ''}</div>
  </div>
  <button id="back" class="sub">${T('もどる')}</button>`;
  $('mk').onclick = () => netEnter(null);
  $('jn').onclick = () => netEnter($('cd').value.trim());
  $('back').onclick = home;
}

async function netEnter(code) {
  const nm = $('nm').value.trim();
  if (!nm) { $('er').textContent = T('なまえを入れてね'); return; }
  if (code !== null && !/^\d{4}$/.test(code)) { $('er').textContent = T('部屋コードは4けたの数字だよ'); return; }
  myName = nm; LS.set('cc-name', nm);
  $('er').textContent = T('接続中…');
  if (!(await netInit()) || !NET.uid) { $('er').textContent = T('つながりませんでした。もう一度ためしてね'); return; }
  try {
    const rooms = NET.db.ref('cc-rooms');
    if (code === null) {
      for (let i = 0; i < 20; i++) { code = String(1000 + Math.floor(Math.random() * 9000)); if (!(await rooms.child(code).get()).exists()) break; }
      await rooms.child(code + '/meta').set({ state: 'lobby', round: 0, cpus: 0, lv: 'normal', created: firebase.database.ServerValue.TIMESTAMP });
    } else {
      const meta = (await rooms.child(code + '/meta').get()).val();
      if (!meta) { $('er').textContent = T('部屋がありません'); return; }
      const ps = (await rooms.child(code + '/players').get()).val() || {};
      if (!ps[NET.uid] && Object.keys(ps).length >= CC.MAX_PLAYERS) { $('er').textContent = T('満員です'); return; }
    }
    NET.code = code; NET.ref = rooms.child(code);
    const me = NET.ref.child('players/' + NET.uid);
    const old = (await me.get()).val();
    await me.set({ name: myName, joined: old && old.joined || firebase.database.ServerValue.TIMESTAMP });
    me.onDisconnect().remove();
    LS.set('cc-room', code);
    netListen();
  } catch (e) { console.warn(e); $('er').textContent = T('つながりませんでした。もう一度ためしてね'); }
}

/* 部屋を見はる(meta と players の最初の値が届いてから画面を決める) */
const NET_PARTS = ['meta', 'players'];
function netListen() {
  NET.leaving = false; NET.got = {};
  for (const c of NET_PARTS) NET.ref.child(c).on('value', s => { NET[c] = s.val() || (c === 'meta' ? null : {}); NET.got[c] = 1; netRoute(); });
}
function netUnlisten() {
  if (!NET.ref) return;
  for (const c of NET_PARTS) NET.ref.child(c).off();
  netBattleOff();
}

/* ---------- 部屋の人 ---------- */
const netOrder = () => Object.entries(NET.players).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0) || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
const netIsHost = () => netOrder()[0] === NET.uid;

function netRoute() {
  if (NET.leaving || !NET.ref || NET_PARTS.some(c => !NET.got[c])) return;
  const m = NET.meta;
  if (!m) { netCleanup(); return netHome(T('部屋が閉じました')); }
  if (!NET.players[NET.uid]) { netCleanup(); return netHome(T('部屋から外れました')); }
  if (m.state === 'lobby') { if (netScreen === 'play' || netScreen === 'end') { stopLoop(); netBattleOff(); } return netLobby(); }
  // 試合中
  if ((netScreen === 'play' || netScreen === 'end') && NET.round === m.round) return;
  if (!NET.starting) netJoinRound(m.round);
}
async function netJoinRound(round) {
  NET.starting = true;
  try {
    const g = (await NET.ref.child('game/' + round).get()).val();
    if (!g || !NET.meta || NET.meta.state !== 'play' || NET.meta.round !== round) return;
    const slots = g.slots || [], me = slots.indexOf(NET.uid);
    if (me < 0) { netWaitScreen(); return; }
    netStart(round, g, me);
  } catch (e) { console.warn(e); }
  finally { NET.starting = false; }
}
function netWaitScreen() {
  if (netScreen === 'wait') return;
  stopLoop(); netScreen = 'wait'; guard('room', netLeaveToEntry);
  app.innerHTML = `<h1 class="title">CUT &amp; CLAIM</h1><div class="card">${T('試合中です。終わるまで待ってね')}</div><button id="lv" class="sub">${T('部屋を出る')}</button>`;
  $('lv').onclick = netLeaveToEntry;
}

/* ---------- 画面: 待ちあい ---------- */
function netLobby() {
  const order = netOrder(), host = netIsHost(), m = NET.meta;
  const cpus = Math.max(0, Math.min(m.cpus || 0, CC.MAX_PLAYERS - order.length)), lv = CC.CPU[m.lv] ? m.lv : 'normal';
  const key = 'lobby:' + JSON.stringify([order.map(id => [id, NET.players[id].name]), cpus, lv, host]);
  if (netScreen === key) return;
  stopLoop(); netScreen = key; guard('room', netLeaveToEntry);
  const list = order.map((id, k) => `<div class="pl"><i style="background:${COLORS[k]}"></i>${esc(NET.players[id].name)}${k === 0 ? ` <span class="tag">${T('ホスト')}</span>` : ''}${id === NET.uid ? ' ★' : ''}</div>`)
    .concat(Array.from({ length: cpus }, (_, j) => `<div class="pl cpu"><i style="background:${COLORS[order.length + j]}"></i>CPU ${j + 1} <span class="dim small">${T(LV_NAME[lv])}</span></div>`)).join('');
  const total = order.length + cpus;
  const lvb = Object.keys(LV_NAME).map(l => `<button class="sub mini ${l === lv ? 'on' : ''}" data-lv="${l}" ${host ? '' : 'disabled'}>${T(LV_NAME[l])}</button>`).join('');
  app.innerHTML = `
  <h1>${T('待ちあい')}</h1>
  <div class="card"><div class="dim">${T('部屋コード')}</div><div class="code">${esc(NET.code)}</div></div>
  <div class="card left plist">${list}</div>
  ${host ? `<div class="card"><div class="seg"><button id="cm" class="sub mini" ${cpus ? '' : 'disabled'}>${T('CPUをへらす')}</button><button id="cp" class="sub mini" ${total < CC.MAX_PLAYERS ? '' : 'disabled'}>${T('CPUを足す')}</button></div>
    <div class="lbl">${T('CPUの強さ')}</div><div class="seg">${lvb}</div></div>
    <button id="st" class="wide" ${total >= 2 ? '' : 'disabled'}>${T('はじめる')}</button>${total >= 2 ? '' : `<div class="dim small">${T('2人以上(CPUをふくむ)で遊べます')}</div>`}`
    : `<div class="dim">${T('ホストがはじめるのを待っています')}</div>`}
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
  if (host) {
    $('cm').onclick = () => NET.ref.child('meta/cpus').set(Math.max(0, cpus - 1));
    $('cp').onclick = () => NET.ref.child('meta/cpus').set(Math.min(CC.MAX_PLAYERS - order.length, cpus + 1));
    app.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => NET.ref.child('meta/lv').set(b.dataset.lv));
    $('st').onclick = netHostStart;
  }
  $('lv').onclick = netLeaveToEntry;
}
/* ホストが「はじめる」: 人(入った順)のあとに CPU を並べて、試合を書く */
async function netHostStart() {
  if (!netIsHost()) return;
  const order = netOrder().slice(0, CC.MAX_PLAYERS), m = NET.meta;
  const cpus = Math.max(0, Math.min(m.cpus || 0, CC.MAX_PLAYERS - order.length));
  if (order.length + cpus < 2) return;
  const round = (m.round || 0) + 1, lv = CC.CPU[m.lv] ? m.lv : 'normal';
  const slots = order.concat(Array.from({ length: cpus }, () => 'cpu'));
  const names = order.map(id => NET.players[id].name).concat(Array.from({ length: cpus }, (_, j) => 'CPU ' + (j + 1)));
  const seed = (Math.floor(Math.random() * 0x7fffffff)) | 1;
  const limit = window.__ccLimit || null;   // テストのときだけ、試合を短くする
  await NET.ref.update({ ['game/' + round]: { seed, slots, names, lv, limit }, cmds: null, fr: null, drop: null, hash: null, 'meta/state': 'play', 'meta/round': round });
}

/* ---------- 対戦 ---------- */
function netStart(round, g, me) {
  netBattleOff();
  const slots = g.slots;
  Object.assign(NET, { round, slots, me, cmds: {}, fr: {}, drops: {}, dropping: {}, sentFr: -1, seq: 0, hashes: {}, wait: 0, desync: false, toldDesync: false });
  slots.forEach((s, i) => { NET.fr[i] = DELAY - 1; });
  netScreen = 'play';
  const lv = CC.CPU[g.lv] ? g.lv : 'normal';
  play({ seed: g.seed, slots: slots.map(s => ({ cpu: s === 'cpu' ? lv : null })), names: g.names || slots.map((s, i) => 'P' + (i + 1)), me, online: true, limit: g.limit || 0 });
  NET.ref.child('cmds/' + round).on('child_added', s => netGotCmd(s.val()));
  NET.ref.child('fr/' + round).on('value', s => { const v = s.val() || {}; for (const k in v) if (typeof v[k] === 'number') NET.fr[k] = Math.max(NET.fr[k] || 0, v[k]); });
  slots.forEach((s, i) => { if (i !== me && s !== 'cpu') NET.ref.child('hash/' + round + '/' + i).on('child_added', h => netCheckHash(+h.key, h.val())); });
}
function netBattleOff() {
  if (!NET.ref || !NET.round) return;
  const r = NET.round;
  NET.ref.child('cmds/' + r).off(); NET.ref.child('fr/' + r).off();
  (NET.slots || []).forEach((s, i) => NET.ref.child('hash/' + r + '/' + i).off());
}

/* 自分の操作を送る(自分の表にもすぐ入れる) */
function netSend(a, d) {
  if (!G || G.over || NET.me < 0) return;
  const c = { p: NET.me, t: G.tick + DELAY, a, d: d | 0, n: NET.seq++ };
  netAddCmd(c);
  NET.ref.child('cmds/' + NET.round).push(c);
}
function netAddCmd(c) { (NET.cmds[c.t] = NET.cmds[c.t] || []).push(c); }
function netGotCmd(c) {
  if (!c || c.p === NET.me) return;   // 自分のは、もう入れてある
  if (c.a === 'x') NET.drops[c.p] = Math.min(NET.drops[c.p] ?? Infinity, c.t);
  if (G && c.t <= G.tick) { NET.desync = true; console.warn('おそすぎる操作', c, G.tick); }
  netAddCmd(c);
}
/* そのコマの操作を実行する(プレイヤー番号・通し番号の順。みんな同じ順) */
function netApply(tick) {
  const list = NET.cmds[tick]; if (!list) return;
  list.sort((a, b) => a.p - b.p || a.n - b.n);
  for (const c of list) {
    CC.command(G, c.p, c.a, c.d);
    if (c.a === 'x') toast(esc(NAMES[c.p] || '') + ': ' + T('回線が切れたので、CPUにかわりました'));
  }
  delete NET.cmds[tick];
}
/* そのコマに進んでよいか: 人(自分と、CPU にかわった人をのぞく)全員の約束が、そのコマまで届いているか */
function netCanRun(t) {
  for (let q = 0; q < NET.slots.length; q++) {
    if (q === NET.me || NET.slots[q] === 'cpu') continue;
    if (NET.drops[q] !== undefined && t >= NET.drops[q]) continue;
    if ((NET.fr[q] ?? DELAY - 1) < t) return false;
  }
  return true;
}
/* 1フレームぶん進める */
function netStep(dt) {
  acc = Math.min(acc + dt, 0.3);
  let moved = 0;
  while (acc >= CC.TICK && !G.over && moved < 300) {
    const next = G.tick + 1;
    if (!netCanRun(next)) break;
    netApply(next); CC.step(G); events(); acc -= CC.TICK; moved++;
    if (G.tick % HASH_EVERY === 0) netHash();
  }
  NET.wait = moved ? 0 : NET.wait + dt;
  if (NET.me >= 0) {
    const myFr = G.tick + DELAY - 1;
    if (myFr - NET.sentFr >= FR_EVERY || (G.over && myFr > NET.sentFr)) { NET.sentFr = myFr; NET.ref.child('fr/' + NET.round + '/' + NET.me).set(myFr); }
  }
  if (netIsHost()) netCheckGone();
}
/* ホスト: 部屋からいなくなった人を、約束(fr)の次のコマから CPU にかえる */
function netCheckGone() {
  NET.slots.forEach((id, q) => {
    if (q === NET.me || id === 'cpu' || NET.players[id] || NET.drops[q] !== undefined || NET.dropping[q]) return;
    NET.dropping[q] = true;
    const r = NET.round;
    NET.ref.child('fr/' + r + '/' + q).get().then(s => {
      const t = (typeof s.val() === 'number' ? s.val() : DELAY - 1) + 1;
      return NET.ref.child('drop/' + r + '/' + q).transaction(v => (v === null ? t : undefined)).then(res => {
        if (res.committed) NET.ref.child('cmds/' + r).push({ p: q, t, a: 'x', d: 0, n: 0 });
      });
    }).catch(e => { console.warn(e); NET.dropping[q] = false; });
  });
}
function netHud() {
  const w = $('netwait');
  const waiting = NET.wait > 1;
  if (waiting && !w) $('toasts').insertAdjacentHTML('afterend', `<div id="netwait" class="netwait">${T('みんなを待っています…')}</div>`);
  if (!waiting && w) w.remove();
  if (NET.desync && !NET.toldDesync) { NET.toldDesync = true; toast(T('画面にずれが出ました')); }
}
/* ずれていないかの確かめ */
function netHash() {
  const h = CC.sig(G); NET.hashes[G.tick] = h;
  if (NET.me >= 0) NET.ref.child('hash/' + NET.round + '/' + NET.me + '/' + G.tick).set(h);
  for (const k of Object.keys(NET.hashes)) if (k.startsWith('o' + G.tick + ':')) { netCheckHash(G.tick, NET.hashes[k]); delete NET.hashes[k]; }
}
function netCheckHash(tick, h) {
  if (NET.hashes[tick] === undefined) { NET.hashes['o' + tick + ':' + Math.random()] = h; return; }
  NET.checked = (NET.checked || 0) + 1;
  if (NET.hashes[tick] !== h) { NET.desync = true; console.warn('ずれ', tick, NET.hashes[tick], h); }
}

/* ---------- 結果 ---------- */
function netEndButtons() {
  return netIsHost() ? `<button id="lobby" class="wide">${T('待ちあいへ(みんな)')}</button>` : `<div class="dim">${T('ホストが待ちあいにもどすのを待っています')}</div>`;
}
function netEndInit() {
  netScreen = 'end';
  if (NET.me >= 0) NET.ref.child('fr/' + NET.round + '/' + NET.me).set(G.tick + DELAY + 999999);   // 終わったので、もう操作は出さない
  app.insertAdjacentHTML('beforeend', `<button id="lv" class="sub">${T('部屋を出る')}</button>`);
  if ($('lobby')) $('lobby').onclick = () => NET.ref.update({ 'meta/state': 'lobby', cmds: null, fr: null, drop: null, hash: null, game: null });
  $('lv').onclick = netLeaveToEntry;
}

/* ---------- 部屋を出る ---------- */
async function netLeave() {
  if (!NET.ref) return;
  NET.leaving = true;
  stopLoop();
  const ref = NET.ref, last = Object.keys(NET.players).filter(id => id !== NET.uid).length === 0;
  netUnlisten();
  try {
    ref.child('players/' + NET.uid).onDisconnect().cancel();
    if (last) await ref.remove(); else await ref.child('players/' + NET.uid).remove();
  } catch (e) { console.warn(e); }
  netCleanup();
}
function netCleanup() {
  netUnlisten();
  Object.assign(NET, { ref: null, code: null, meta: null, players: {}, got: {}, round: 0, slots: [], me: -1 });
  netScreen = ''; online = false;
  LS.set('cc-room', '');
}
/* 部屋から出て、部屋に入る画面へ(戻るボタン・✕・「部屋を出る」) */
async function netLeaveToEntry() { await netLeave(); netHome(); }

home();
