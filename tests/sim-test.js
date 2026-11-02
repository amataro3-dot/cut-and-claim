// CPU だけで何試合も動かして、止まらない・おかしな状態にならないかを確かめる
// 使い方: node tests/sim-test.js [試合数]
const CC = require('../sim.js');
const games = +(process.argv[2] || 60);
let ends = { rate: 0, time: 0, full: 0 }, stuck = 0, bad = 0, totalKills = 0, claims = 0, lens = [];
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 7), lv = ['easy', 'normal', 'hard'][g % 3];
  const slots = Array.from({ length: n }, () => ({ cpu: lv }));
  const G = CC.newGame(1000 + g, slots);
  const last = G.players.map(P => P.x + ',' + P.y); let still = G.players.map(() => 0);
  while (!G.over) {
    CC.step(G);
    for (const e of G.events) if (e.t === 'claim') claims++;
    if (G.tick % CC.MOVE_EVERY === 0 && !G.over) G.players.forEach((P, k) => {
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
    const H = CC.newGame(1000 + g, slots); while (!H.over) CC.step(H);
    if (CC.sig(H) !== CC.sig(G)) { bad++; console.log('同じにならない', g); }
  }
}
lens.sort((a, b) => a - b);
console.log({ games, ends, stuck, bad, totalKills, claims, medianSec: lens[lens.length >> 1].toFixed(0), minSec: lens[0].toFixed(0) });
process.exit(stuck || bad ? 1 : 0);
