// CPU だけで何試合も動かして、止まらない・おかしな状態にならないかを確かめる
// 使い方: node tests/sim-test.js [試合数]
const CC = require('../sim.js');
const games = +(process.argv[2] || 60);
let ends = { rate: 0, time: 0, full: 0 }, dashT = 0, entries = 0, bySparx = 0, steal = 0, enclosedWalk = 0, stuck = 0, bad = 0, totalKills = 0, claims = 0, lens = [], byEnemy = 0;
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 7), lv = ['easy', 'normal', 'hard'][g % 3];
  const slots = Array.from({ length: n }, () => ({ cpu: lv }));
  const human = g % 2 === 0;   // 半分の試合は、1人目をでたらめに押す「人」にする(矢印で中へ入る・ダッシュ)
  if (human) slots[0] = { cpu: null };
  const rnd = CC.makeRng(77 + g);
  const G = CC.newGame(1000 + g, slots);
  const last = G.players.map(P => P.x + ',' + P.y); let still = G.players.map(() => 0);
  while (!G.over) {
    if (human) {
      if (rnd() < 0.03) CC.command(G, 0, 'd', Math.floor(rnd() * 4));
      if (rnd() < 0.02) CC.command(G, 0, 'a', rnd() < 0.6 ? 1 : 0);
    }
    const before = G.players[0].mode, areaB = G.area.slice(), modeB = G.players.map(P => P.mode);
    CC.step(G);
    // 人の陣地が減った(取られた)・線の上でやられた
    G.area.forEach((v, k) => { if (v < areaB[k]) steal++; });
    for (const e of G.events) if (e.t === 'die' && e.by >= 0 && modeB[e.p] === 'line') enclosedWalk++;
    if (human && before === 'line' && G.players[0].mode === 'draw') entries++;
    dashT += G.players.filter(P => P.dash).length;
    for (const e of G.events) { if (e.t === 'claim') claims++; if (e.t === 'die' && e.by === -2) byEnemy++; if (e.t === 'die' && e.by === -3) bySparx++; }
    // 敵はいつも空きマスの中にいるはず
    // アスタンは、追いかけていないときは線の上にいるはず
    for (const S of G.sparx) if (S.chase < 0 && !G.line[CC.idx(S.x, S.y)] && !G.over) { bad++; if (bad < 5) console.log('アスタンが線の外', g, G.tick, S); }
    for (const E of G.enemies) if (G.own[CC.idx(E.x / CC.U | 0, E.y / CC.U | 0)] !== 0 && !G.over) { bad++; if (bad < 5) console.log('敵が空きの外', g, G.tick); }
    if (G.tick % CC.STEP === 0 && !G.over) G.players.forEach((P, k) => {
      const s = P.x + ',' + P.y;
      if (P.mode !== 'dead' && s === last[k]) { still[k]++; if (still[k] === 40) { stuck++; console.log('止まった?', g, k, P.mode, s); } } else still[k] = 0;
      last[k] = s;
      // 線の上の人は線の上にいるはず、中の人の頭は自分の線
      const i = CC.idx(P.x, P.y);
      if (P.mode === 'line' && !G.line[i]) { bad++; if (bad < 5) console.log('線の外', g, k, s); }
      if (P.mode === 'draw' && G.trail[i] !== P.i + 1) { bad++; if (bad < 5) console.log('頭が線にない', g, k, s); }
    });
  }
  ends[G.over.reason]++; lens.push(G.tick / 30);
  totalKills += G.players.reduce((s, P) => s + P.kills, 0);
  // 同じ種なら同じ結果
  if (g < 6) {
    const H = CC.newGame(1000 + g, slots), r2 = CC.makeRng(77 + g);
    while (!H.over) {
      if (human) { if (r2() < 0.03) CC.command(H, 0, 'd', Math.floor(r2() * 4)); if (r2() < 0.02) CC.command(H, 0, 'a', r2() < 0.6 ? 1 : 0); }
      CC.step(H);
    }
    if (CC.sig(H) !== CC.sig(G)) { bad++; console.log('同じにならない', g); }
  }
}
lens.sort((a, b) => a - b);
console.log({ games, ends, bySparx, steal, enclosedWalk, humanEntries: entries, dashSec: (dashT / 30).toFixed(0), stuck, bad, totalKills, byEnemy, claims, medianSec: lens[lens.length >> 1].toFixed(0), minSec: lens[0].toFixed(0) });
process.exit(stuck || bad ? 1 : 0);
