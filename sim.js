/* CUT & CLAIM のゲームの計算(画面なし)。
   - 同じ種(seed)・同じ操作なら、どのスマホでも同じ結果になる(オンラインで全員が同じ計算をするため)。
   - 画面(game.js)とオンライン(net.js)は、ここの newGame / step / command を使う。
   - Node でも読める(テスト用)。

   マス目:
   own[i]   -1 = 外の枠、0 = まだだれのものでもない、1〜8 = 陣地(プレイヤー番号 + 1)
   trail[i] 0 = なし、1〜8 = 中を進んでいる人の線(プレイヤー番号 + 1)
   line[i]  1 = 線(歩ける)。枠か陣地のうち、まわり8マスに「だれのものでもない」マスがあるところ */
(function (root) {
  'use strict';
  const W = 60, H = 80;            // マス目の大きさ(横・たて。外の枠をふくむ)
  const TICK = 1 / 30;             // 1コマの時間(1秒に30コマ)
  const STEP = 6;                  // ふつうは6コマで1マス進む(1秒に5マス)。ダッシュ中は2倍(3コマで1マス)
  const GAUGE_MAX = 180;           // ダッシュのゲージ。ダッシュ中は1コマで2へる(満タンで3秒)、線の上では1コマで1たまる(6秒で満タン)
  const GAUGE_RESUME = 60;         // 使いきったら、ここまでたまるまで使えない(ガタガタ動かないように)
  const RESPAWN = 150;             // やられてから復活まで(5秒)
  const TIME_LIMIT = 180 * 30;     // 3分
  const winRate = n => (n <= 3 ? 0.5 : n <= 5 ? 0.35 : 0.3);   // 陣地がこれをこえたら勝ち(2〜3人 50%、4〜5人 35%、6〜8人 30%)
  const GO_WAIT = 3;               // 線の上で矢印を押してから、その向きに中へ入れる場所を待つ歩数
  const MAX_PLAYERS = 8;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];   // 向き: 0 上、1 右、2 下、3 左
  const back = d => (d + 2) & 3;
  const INNER = (W - 2) * (H - 2);
  /* 中の敵(本家の「クイックス」)。位置は 1マス = 64 の整数(どのスマホでも同じ計算になるように、小数や三角関数を使わない) */
  const U = 64;                    // 1マスの細かさ
  /* 敵「ダイヤン」は細長い◇。くるくる回る(SPIN コマで1周)。◇の形(少し大きめ)にかかった線を引いていた人がやられる */
  const SPIN = 144;                // 1周のコマ(約4.8秒)
  const E_LEN = 5.1, E_WID = 0.5;  // 見た目の長さ(中心からはしまで)・はば(中心から横のかどまで)。マス
  const HIT_L = Math.round((E_LEN + 0.6) * 64), HIT_W = Math.round((E_WID + 0.6) * 64);   // やられる形(線のマスの大きさのぶん、少し大きめ)
  /* 64方向の cos×64(小数や三角関数のずれが出ないように、数を書いておく)。sin は 16 ずらして使う */
  const COS64 = [64, 64, 63, 61, 59, 56, 53, 49, 45, 41, 36, 30, 24, 19, 12, 6, 0, -6, -12, -19, -24, -30, -36, -41, -45, -49, -53, -56, -59, -61, -63, -64, -64, -64, -63, -61, -59, -56, -53, -49, -45, -41, -36, -30, -24, -19, -12, -6, 0, 6, 12, 19, 24, 30, 36, 41, 45, 49, 53, 56, 59, 61, 63, 64];
  const ENEMY_TURN = [20, 70];     // 向きを変えるまでのコマ
  const ENEMY_VEL = [[9, 0], [8, 3], [6, 6], [3, 8], [0, 9], [-3, 8], [-6, 6], [-8, 3], [-9, 0], [-8, -3], [-6, -6], [-3, -8], [0, -9], [3, -8], [6, -6], [8, -3]];   // 1コマで約0.135マス(1秒に約4マス)
  const enemyCount = n => (n >= 5 ? 2 : 1);   // 5人以上なら2体
  /* 線の上を走る敵「アスタン」(本家の「スパークス」)。acc に毎コマ足して、SPX_STEP をこえたら1マス進む */
  const sparxCount = n => (n <= 3 ? 1 : n === 4 ? 2 : 3);
  const SPX_STEP = 60, SPX_V = 10, SPX_CHASE = 13;   // 線の上は△と同じ速さ(6コマで1マス)、人の線を追いかけるときは1.3倍

  /* CPU の強さ: a = 中へ進む深さ、b = 横の長さ、cool = 次に入るまでのコマ、
     danger = 敵の頭がこの距離に来たら帰る、attack = 敵の線がこの距離ならねらう、dash = 帰るときにダッシュする */
  const CPU = {
    easy:   { a: [3, 7],  b: [3, 8],  cool: [60, 150], danger: 0, attack: 0, dash: 0 },
    normal: { a: [5, 13], b: [5, 13], cool: [30, 90],  danger: 6, attack: 3, dash: 1 },
    hard:   { a: [7, 18], b: [6, 17], cool: [12, 45],  danger: 9, attack: 7, dash: 1 },
  };

  function makeRng(seed) {   // mulberry32(同じ種なら、どのスマホでも同じ並び)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 新しい試合。slots = [{ cpu: null | 'easy' | 'normal' | 'hard' }, ...](2〜8人)。limit はテスト用(試合の長さのコマ数) */
  function newGame(seed, slots, limit) {
    const G = {
      w: W, h: H, tick: 0, limit: limit || TIME_LIMIT, winRate: winRate(slots.length), rng: makeRng(seed), over: null, ver: 0,
      own: new Int8Array(W * H), trail: new Int8Array(W * H), line: new Uint8Array(W * H),
      dist: new Int16Array(W * H), area: [], players: [], events: [], enemies: [], sparx: [],
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) G.own[y * W + x] = -1;
    // 外の枠を時計回りに1周する道。全員が同じ間隔で並ぶ
    const ring = [];
    for (let x = 0; x < W - 1; x++) ring.push([x, 0]);
    for (let y = 0; y < H - 1; y++) ring.push([W - 1, y]);
    for (let x = W - 1; x > 0; x--) ring.push([x, H - 1]);
    for (let y = H - 1; y > 0; y--) ring.push([0, y]);
    const n = slots.length;
    slots.forEach((s, i) => {
      const k = Math.floor((i + 0.5) * ring.length / n), [x, y] = ring[k], [nx, ny] = ring[(k + 1) % ring.length];
      const dir = nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0;
      G.players.push({ i, x, y, dir, want: -1, mode: 'line', go: 0, goD: 0, trail: [], px: x, py: y, mt: 0, ms: STEP, acc: 0, g: GAUGE_MAX, hold: false, tired: false, dash: false, start: -1, deadAt: 0, cpu: s.cpu || null,
        ai: { cool: 30 + Math.floor(G.rng() * 60), plan: null, leg: 0, left: 0, home: false }, kills: 0, deaths: 0, best: 0 });
      G.area.push(0);
    });
    for (let k = 0, m = enemyCount(slots.length); k < m; k++) {
      const v = ENEMY_VEL[Math.floor(G.rng() * 16)];
      const ex = ((W >> 1) + (m > 1 ? (k ? 8 : -8) : 0)) * U + (U >> 1), ey = (H >> 1) * U + (U >> 1);
      G.enemies.push({ x: ex, y: ey, px: ex, py: ey, vx: v[0], vy: v[1], turn: 30, k });
    }
    // アスタン: 外の枠の上、となりの人と人のまん中に置く(時計回りと反時計回りを交互に)
    for (let k = 0, m = sparxCount(n); k < m; k++) {
      const j = Math.floor(k * n / m), r = Math.floor(j * ring.length / n) % ring.length, [x, y] = ring[r];
      const [nx, ny] = ring[(r + (k % 2 ? ring.length - 1 : 1)) % ring.length];
      G.sparx.push({ k, x, y, px: x, py: y, d: nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0, acc: 0, mt: 0, ms: STEP, chase: -1, j: -1 });
    }
    refresh(G);
    return G;
  }

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  /* 線と、線までの近さを数え直す(囲んだあと・始まるとき) */
  function refresh(G) {
    const { own, line, dist } = G;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      let l = 0;
      if (own[i] !== 0) {
        for (let dy = -1; dy <= 1 && !l; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (inside(xx, yy) && own[idx(xx, yy)] === 0) { l = 1; break; }
        }
      }
      line[i] = l;
    }
    // 線までの近さ(CPU が帰るときに使う)
    dist.fill(9999);
    const q = [];
    for (let i = 0; i < W * H; i++) if (line[i]) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inside(xx, yy)) continue;
        const j = idx(xx, yy);
        if (own[j] === 0 && dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
      }
    }
    G.area = G.players.map(() => 0);
    for (let i = 0; i < W * H; i++) if (own[i] > 0) G.area[own[i] - 1]++;
    G.players.forEach((P, k) => { P.best = Math.max(P.best, G.area[k]); });
    G.ver++;
  }

  /* 操作。a: 'd' = 矢印(d = 向き)、'a' = A ボタン(d = 1 押した、0 はなした)、'x' = 回線が切れたので CPU にかわる */
  function command(G, p, a, d) {
    const P = G.players[p]; if (!P) return;
    if (a === 'd') { P.want = d & 3; if (P.mode === 'line') { P.go = GO_WAIT; P.goD = d & 3; } }   // 線の上で空いている側を押すと、中へ入る
    else if (a === 'a') { if (!P.cpu) P.hold = !!d; }
    else if (a === 'x') { if (!P.cpu) { P.cpu = 'normal'; P.dropped = true; } }
  }

  /* 線の上で、次に進む向き */
  function lineDir(G, P) {
    const ok = d => { const x = P.x + DX[d], y = P.y + DY[d]; return inside(x, y) && G.line[idx(x, y)]; };
    if (P.want >= 0 && ok(P.want)) return P.want;
    if (ok(P.dir)) return P.dir;
    const r = (P.dir + 1) & 3, l = (P.dir + 3) & 3;
    if (ok(r) && ok(l)) return P.want === l ? l : r;
    if (ok(r)) return r;
    if (ok(l)) return l;
    if (ok(back(P.dir))) return back(P.dir);
    return -1;
  }
  /* CPU が中へ入る向き(だれのものでもないマスへ) */
  function goDir(G, P) {
    const free = d => { const x = P.x + DX[d], y = P.y + DY[d]; return inside(x, y) && G.own[idx(x, y)] === 0; };
    const order = [P.want, P.dir, (P.dir + 1) & 3, (P.dir + 3) & 3, back(P.dir)];
    for (const d of order) if (d >= 0 && free(d)) return d;
    return -1;
  }

  /* by: やった人(いなければ null)。enemy: true = ダイヤン、'sparx' = アスタン */
  function kill(G, P, by, enemy) {
    if (P.mode === 'dead') return;
    for (const i of P.trail) if (G.trail[i] === P.i + 1) G.trail[i] = 0;
    P.trail = []; P.mode = 'dead'; P.deadAt = G.tick; P.deaths++; P.go = 0; P.want = -1; P.dash = false; if (P.cpu) P.hold = false;
    P.ai.plan = null; P.ai.home = false;
    if (by && by !== P) by.kills++;
    G.events.push({ t: 'die', p: P.i, by: by ? by.i : enemy === 'sparx' ? -3 : enemy ? -2 : -1, x: P.x, y: P.y });
  }

  /* 囲み終わり(外の枠か自分の陣地に着いた): 線を陣地にする。
     線にふれている「空いている所 + 人の陣地」のかたまりのうち、ダイヤンがいない所を全部もらう(人の陣地もふくむ)。
     どれにもダイヤンがいなければ、いちばん大きいかたまり以外(小さいほう)をもらう */
  function claim(G, P) {
    const { own, trail } = G, me = P.i + 1, line0 = P.trail.slice();
    const got0 = new Uint8Array(W * H);   // このときに自分のものになったマス
    for (const i of P.trail) { if (own[i] !== me) got0[i] = 1; own[i] = me; if (trail[i] === me) trail[i] = 0; }
    P.trail = [];
    const open = j => own[j] !== -1 && own[j] !== me;   // 取れる所(空き・人の陣地)
    // 線のまわりの、取れる所を、つながりごとに分ける
    const comp = new Int32Array(W * H).fill(-1), sizes = [];
    const seeds = [];
    for (const i of line0) { const x = i % W, y = (i / W) | 0; for (let d = 0; d < 4; d++) { const xx = x + DX[d], yy = y + DY[d]; if (inside(xx, yy)) seeds.push(idx(xx, yy)); } }
    for (const s0 of seeds) {
      if (!open(s0) || comp[s0] >= 0) continue;
      const c = sizes.length, q = [s0]; comp[s0] = c;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const xx = x + DX[d], yy = y + DY[d];
          if (!inside(xx, yy)) continue;
          const j = idx(xx, yy);
          if (open(j) && comp[j] < 0) { comp[j] = c; q.push(j); }
        }
      }
      sizes.push(q.length);
    }
    const keep = new Set();
    for (const E of G.enemies) { const c = comp[idx(E.x / U | 0, E.y / U | 0)]; if (c >= 0) keep.add(c); }
    if (!keep.size && sizes.length) { let big = 0; sizes.forEach((v, c) => { if (v > sizes[big]) big = c; }); keep.add(big); }
    let got = 0;
    for (let i = 0; i < W * H; i++) if (comp[i] >= 0 && !keep.has(comp[i])) { own[i] = me; got0[i] = 1; got++; }
    // 囲まれた中で線を引いていた人はやられる
    for (const Q of G.players) if (Q !== P && Q.mode === 'draw' && Q.trail.some(i => got0[i])) kill(G, Q, P);
    refresh(G);
    for (const E of G.enemies) if (own[idx(E.x / U | 0, E.y / U | 0)] !== 0) enemyHome(G, E);   // 念のため
    // 囲まれて、足もとが線でなくなった人はやられる(自分は、いちばん近い線へ)
    for (const Q of G.players) if (Q.mode === 'line' && !G.line[idx(Q.x, Q.y)]) { if (Q === P) snap(G, Q); else kill(G, Q, P); }
    for (const S of G.sparx) if (S.chase < 0 && !G.line[idx(S.x, S.y)]) sparxHome(G, S);
    G.events.push({ t: 'claim', p: P.i, n: got + line0.length });
  }
  /* いちばん近い線へ移す(陣地の中を通って探す) */
  function snap(G, P) {
    const seen = new Uint8Array(W * H), s = idx(P.x, P.y), q = [s]; seen[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (G.line[i]) { P.x = i % W; P.y = (i / W) | 0; const d = lineDir(G, P); if (d >= 0) P.dir = d; return; }
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inside(xx, yy)) continue;
        const j = idx(xx, yy);
        if (!seen[j] && G.own[j] !== 0) { seen[j] = 1; q.push(j); }
      }
    }
  }
  /* 復活の場所: 自分の陣地のふち(なければ外の枠)のうち、ほかの人とアスタンからいちばん遠い所 */
  function respawn(G, P) {
    const me = P.i + 1, mine = [], frame = [];
    for (let i = 0; i < W * H; i++) if (G.line[i]) { if (G.own[i] === me) mine.push(i); else if (G.own[i] === -1) frame.push(i); }
    let cand = mine.length ? mine : frame;
    if (!cand.length) for (let i = 0; i < W * H; i++) if (G.line[i]) cand.push(i);
    if (!cand.length) return;
    const others = G.players.filter(Q => Q !== P && Q.mode !== 'dead');
    let best = cand[0], bv = -1;
    for (const i of cand) {
      const x = i % W, y = (i / W) | 0;
      let v = 9999;
      for (const Q of others) v = Math.min(v, Math.abs(Q.x - x) + Math.abs(Q.y - y));
      for (const S of G.sparx) v = Math.min(v, Math.abs(S.x - x) + Math.abs(S.y - y) - 4);
      if (v > bv) { bv = v; best = i; }
    }
    P.x = P.px = best % W; P.y = P.py = (best / W) | 0; P.mode = 'line'; P.want = -1; P.go = 0;
    P.g = GAUGE_MAX; P.tired = false; P.acc = 0;
    P.ai.cool = 20 + Math.floor(G.rng() * 40);
    const d = lineDir(G, P); if (d >= 0) P.dir = d;
    G.events.push({ t: 'spawn', p: P.i });
  }

  /* ---------- 中の敵 ---------- */
  const freeAt = (G, ux, uy) => { const x = ux / U | 0, y = uy / U | 0; return inside(x, y) && G.own[idx(x, y)] === 0; };
  function enemyStep(G, E) {
    if (--E.turn <= 0) {
      const v = ENEMY_VEL[Math.floor(G.rng() * 16)];
      E.vx = v[0]; E.vy = v[1]; E.turn = rint(G, ENEMY_TURN);
    }
    // 壁(枠・陣地)ではね返る
    let nx = E.x + E.vx, ny = E.y + E.vy;
    if (!freeAt(G, nx, E.y)) { E.vx = -E.vx; nx = E.x; }
    if (!freeAt(G, E.x, ny)) { E.vy = -E.vy; ny = E.y; }
    if (!freeAt(G, nx, ny)) { nx = E.x; ny = E.y; }
    E.x = nx; E.y = ny;
    // ◇の形にかかった線を引いていた人はやられる
    const a = enemyAngle(G, E), c = COS64[a], sn = COS64[(a + 48) & 63];
    const cx = E.x / U | 0, cy = E.y / U | 0, R = Math.ceil(E_LEN) + 1;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!inside(x, y)) continue;
      const t = G.trail[idx(x, y)]; if (!t || G.own[idx(x, y)] !== 0) continue;   // 人の陣地の中の線には、ダイヤンはさわれない
      const dx = x * U + (U >> 1) - E.x, dy = y * U + (U >> 1) - E.y;
      const al = Math.abs(dx * c + dy * sn) >> 6, pe = Math.abs(dy * c - dx * sn) >> 6;   // ◇の長いほうの向き・横の向きのきょり
      if (al * HIT_W + pe * HIT_L > HIT_L * HIT_W) continue;
      const P = G.players[t - 1]; if (P.mode === 'draw') kill(G, P, null, true);
    }
  }
  /* ダイヤンの向き(0〜63)。時間で決まる(どのスマホでも同じ) */
  const enemyAngle = (G, E) => ((G.tick * 64 / SPIN | 0) + E.k * 24) & 63;
  /* 敵のいるマスが空きでなくなったとき(念のため)、いちばん近い空きへ */
  function enemyHome(G, E) {
    const cx = E.x / U | 0, cy = E.y / U | 0;
    let best = -1, bv = 1e9;
    for (let i = 0; i < W * H; i++) if (G.own[i] === 0) { const v = Math.abs(i % W - cx) + Math.abs((i / W | 0) - cy); if (v < bv) { bv = v; best = i; } }
    if (best >= 0) { E.x = (best % W) * U + (U >> 1); E.y = (best / W | 0) * U + (U >> 1); }
  }
  const enemyNear = (G, x, y, r) => G.enemies.some(E => Math.abs((E.x / U | 0) - x) + Math.abs((E.y / U | 0) - y) <= r);

  /* ---------- CPU ---------- */
  const rint = (G, [a, b]) => a + Math.floor(G.rng() * (b - a + 1));
  function cpuThink(G, P) {
    const L = CPU[P.cpu] || CPU.normal, A = P.ai;
    P.hold = !!(L.dash && P.mode === 'draw' && A.home);   // 帰るときにダッシュ
    if (P.mode === 'line') {
      // アスタンが近い: 中へにげるか、ひき返す
      const sp = G.sparx.find(S => S.chase < 0 && Math.abs(S.x - P.x) + Math.abs(S.y - P.y) <= 5);
      if (sp) {
        const d = goDir(G, P);
        if (d >= 0 && !enemyNear(G, P.x, P.y, 7)) { A.cool = 0; } else { P.want = back(P.dir); return; }
      }
      if (A.cool > 0) { A.cool--; return; }
      if (enemyNear(G, P.x, P.y, 12)) return;   // 敵が近いときは入らない
      const d = goDir(G, P);
      if (d < 0) return;
      // 中へ a マス、横へ b マス、そのあとは線へ帰る(コの字)
      const side = G.rng() < 0.5 ? (d + 1) & 3 : (d + 3) & 3;
      A.plan = [[d, rint(G, L.a)], [side, rint(G, L.b)]]; A.leg = 0; A.left = A.plan[0][1]; A.home = false;
      P.want = d; P.go = GO_WAIT; P.goD = d;
      A.cool = rint(G, L.cool);
      return;
    }
    if (P.mode !== 'draw') return;
    if (G.sparx.some(S => S.chase === P.i)) { A.home = true; if (L.dash) P.hold = true; }   // アスタンに追いかけられている → 急いで帰る
    // 敵の頭が近い・線が長い → 帰る
    if (L.danger && !A.home) {
      for (const Q of G.players) if (Q !== P && Q.mode === 'draw' && Math.abs(Q.x - P.x) + Math.abs(Q.y - P.y) <= L.danger) { A.home = true; break; }
      if (enemyNear(G, P.x, P.y, L.danger + 6)) A.home = true;
      if (P.trail.length > 70) A.home = true;
    }
    // 敵の線が近ければねらう
    if (L.attack) {
      for (let d = 0; d < 4; d++) {
        if (d === back(P.dir)) continue;
        for (let k = 1; k <= L.attack; k++) {
          const x = P.x + DX[d] * k, y = P.y + DY[d] * k;
          if (!inside(x, y)) break;
          const t = G.trail[idx(x, y)];
          if (G.own[idx(x, y)] !== 0 || t === P.i + 1) break;
          if (t) { P.want = d; return; }
        }
      }
    }
    if (!A.home && A.plan && A.leg < A.plan.length) {
      if (A.left <= 0) { A.leg++; if (A.leg < A.plan.length) A.left = A.plan[A.leg][1]; }
      if (A.leg < A.plan.length) { P.want = A.plan[A.leg][0]; A.left--; if (safe(G, P, P.want)) return; }
    }
    A.home = true; if (L.dash) P.hold = true;
    // 帰る(外の枠か自分の陣地へ): 自分の線にぶつからない向きのうち、いちばん近い向き
    const hd = homeDist(G, P);
    let bd = -1, bv = 1e9;
    for (let d = 0; d < 4; d++) {
      if (d === back(P.dir)) continue;
      const x = P.x + DX[d], y = P.y + DY[d];
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (G.trail[i] === P.i + 1) continue;
      const v = hd[i] + (d === P.dir ? -0.1 : 0);
      if (v < bv) { bv = v; bd = d; }
    }
    if (bd >= 0) P.want = bd;
  }
  /* 帰り道の近さ: 外の枠か自分の陣地(= 0)まで、空き・人の陣地を通って何マスか(自分の線は通れない) */
  function homeDist(G, P) {
    const me = P.i + 1, dist = new Int16Array(W * H).fill(9999), q = [];
    for (let i = 0; i < W * H; i++) if (G.own[i] === -1 || G.own[i] === me) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inside(xx, yy)) continue;
        const j = idx(xx, yy);
        if (dist[j] > dist[i] + 1 && G.own[j] !== -1 && G.own[j] !== me && G.trail[j] !== me) { dist[j] = dist[i] + 1; q.push(j); }
      }
    }
    return dist;
  }
  /* その向きに進んでも、すぐ自分の線にぶつからないか */
  function safe(G, P, d) {
    if (d === back(P.dir)) return false;
    const x = P.x + DX[d], y = P.y + DY[d];
    return inside(x, y) && G.trail[idx(x, y)] !== P.i + 1;
  }

  /* ---------- アスタン(線の上を走る敵) ---------- */
  function sparxStep(G) {
    for (const S of G.sparx) {
      S.acc += S.chase >= 0 ? SPX_CHASE : SPX_V;
      if (S.acc < SPX_STEP) continue;
      S.acc -= SPX_STEP; S.px = S.x; S.py = S.y; S.mt = G.tick; S.ms = SPX_STEP / (S.chase >= 0 ? SPX_CHASE : SPX_V);
      if (S.chase >= 0) {   // 人の線をたどって追いかける。頭に追いついたら、その人はやられる
        const Q = G.players[S.chase];
        if (Q.mode !== 'draw') { sparxHome(G, S); continue; }
        S.j++;
        if (S.j >= Q.trail.length - 1) { S.x = Q.x; S.y = Q.y; kill(G, Q, null, 'sparx'); sparxHome(G, S); continue; }
        const i = Q.trail[S.j]; S.x = i % W; S.y = (i / W) | 0;
        continue;
      }
      // 線の上を走る。分かれ道はランダム(真うしろには、行き止まりのときだけ)
      const ok = d => { const x = S.x + DX[d], y = S.y + DY[d]; return inside(x, y) && G.line[idx(x, y)]; };
      const opts = [S.d, (S.d + 1) & 3, (S.d + 3) & 3].filter(ok);
      const d = opts.length ? opts[opts.length > 1 ? Math.floor(G.rng() * opts.length) : 0] : ok(back(S.d)) ? back(S.d) : -1;
      if (d < 0) continue;
      S.d = d; S.x += DX[d]; S.y += DY[d];
      // 人の線(か、線の始まり)に来たら、追いかけはじめる
      const i = idx(S.x, S.y), t = G.trail[i];
      if (t && G.players[t - 1].mode === 'draw') { S.chase = t - 1; S.j = G.players[t - 1].trail.indexOf(i); }
      else for (const Q of G.players) if (Q.mode === 'draw' && Q.start === i) { S.chase = Q.i; S.j = -1; break; }
    }
    // 線の上の人にさわったら(同じマス・すれちがい)、その人はやられる。中を進んでいる人の頭にさわっても
    for (const S of G.sparx) {
      if (S.chase >= 0) continue;
      for (const P of G.players) {
        if (P.mode === 'dead') continue;
        const same = P.x === S.x && P.y === S.y;
        const swap = P.mode === 'line' && P.mt === G.tick && S.mt === G.tick && P.px === S.x && P.py === S.y && S.px === P.x && S.py === P.y;
        if (same || swap) kill(G, P, null, 'sparx');
      }
    }
  }
  /* 追いかけ終わり・足もとが線でなくなったとき: いちばん近い線へもどる */
  function sparxHome(G, S) {
    S.chase = -1; S.j = -1;
    const seen = new Uint8Array(W * H), s0 = idx(S.x, S.y), q = [s0]; seen[s0] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (G.line[i]) { S.x = S.px = i % W; S.y = S.py = (i / W) | 0; break; }
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) { const xx = x + DX[d], yy = y + DY[d]; if (inside(xx, yy) && !seen[idx(xx, yy)]) { seen[idx(xx, yy)] = 1; q.push(idx(xx, yy)); } }
    }
    for (let d = 0; d < 4; d++) { const x = S.x + DX[d], y = S.y + DY[d]; if (inside(x, y) && G.line[idx(x, y)]) { S.d = d; break; } }
  }

  /* 1コマ進める */
  function step(G) {
    if (G.over) return;
    G.tick++;
    G.events = [];
    // 復活
    for (const P of G.players) if (P.mode === 'dead' && G.tick - P.deadAt >= RESPAWN) respawn(G, P);
    for (const E of G.enemies) { E.px = E.x; E.py = E.y; enemyStep(G, E); }
    // ダッシュとゲージ
    for (const P of G.players) {
      if (P.mode === 'dead') continue;
      P.dash = P.hold && !P.tired && P.g > 0;
      if (P.dash) { P.g = Math.max(0, P.g - 2); if (!P.g) P.tired = true; }
      else if (P.mode === 'line') { P.g = Math.min(GAUGE_MAX, P.g + 1); if (P.tired && P.g >= GAUGE_RESUME) P.tired = false; }
      P.acc += P.dash ? 2 : 1;
    }
    move(G);
    sparxStep(G);
    // 勝ち負け
    const free = INNER - G.area.reduce((s, v) => s + v, 0);
    const top = Math.max(...G.area);
    if (top / INNER > G.winRate) G.over = { reason: 'rate', win: G.area.map((v, k) => v === top ? k : -1).filter(k => k >= 0) };
    else if (G.tick >= G.limit || free <= 0) G.over = { reason: G.tick >= G.limit ? 'time' : 'full', win: G.area.map((v, k) => v === top ? k : -1).filter(k => k >= 0) };
  }

  /* このコマで1マス進む人(ふつうは6コマごと、ダッシュ中は3コマごと)を動かす */
  function move(G) {
    const { own, trail, line } = G;
    const movers = G.players.filter(P => P.mode !== 'dead' && P.acc >= STEP);
    if (!movers.length) return;
    for (const P of movers) { P.acc -= STEP; P.px = P.x; P.py = P.y; P.mt = G.tick; P.ms = P.dash ? STEP >> 1 : STEP; }
    for (const P of movers) if (P.cpu) cpuThink(G, P);
    // 1) 行き先を決める
    const plan = [], cutBy = new Map();
    const end = (P, i) => own[i] === -1 || own[i] === P.i + 1;   // 外の枠か自分の陣地に着いたら、囲み終わり
    for (const P of movers) {
      if (P.mode === 'line') {
        if (P.go > 0) {
          const d = P.goD, fx = P.x + DX[d], fy = P.y + DY[d];
          if (inside(fx, fy) && own[idx(fx, fy)] === 0) { P.dir = d; P.mode = 'draw'; P.go = 0; P.start = idx(P.x, P.y); plan.push({ P, x: P.x + DX[d], y: P.y + DY[d] }); continue; }
          P.go--;
        }
        const d = lineDir(G, P);
        if (d >= 0) {
          P.dir = d; P.x += DX[d]; P.y += DY[d];
          // 人の陣地のふちを通っている人の線をふんだら、その人がやられる
          const t = trail[idx(P.x, P.y)];
          if (t && t !== P.i + 1 && G.players[t - 1].mode === 'draw') cutBy.set(G.players[t - 1], P);
        }
        continue;
      }
      // 中を進んでいる: 真うしろには曲がれない
      if (P.want >= 0 && P.want !== back(P.dir)) P.dir = P.want;
      plan.push({ P, x: P.x + DX[P.dir], y: P.y + DY[P.dir] });
    }
    // 2) ぶつかりを調べる(みんな同時に)
    const dead = new Set(), count = new Map();
    for (const m of plan) { m.i = idx(m.x, m.y); if (inside(m.x, m.y) && !end(m.P, m.i)) count.set(m.i, (count.get(m.i) || 0) + 1); }
    for (const m of plan) {
      const { P, i } = m;
      if (!inside(m.x, m.y)) { dead.add(P); continue; }
      if (end(P, i)) continue;                                 // 外の枠か自分の陣地に着いた(囲み終わり)
      if (trail[i] === P.i + 1) { dead.add(P); continue; }     // 自分の線にぶつかった
      if (count.get(i) > 1) { dead.add(P); continue; }         // 2人が同じマスへ(正面衝突)
      if (trail[i]) { const Q = G.players[trail[i] - 1]; if (Q.mode === 'draw') cutBy.set(Q, P); }   // 人の線を横切った → その人がやられる
    }
    for (const [Q, P] of cutBy) kill(G, Q, P);
    for (const P of dead) kill(G, P, null);
    // 3) 動かす
    const claims = [];
    for (const m of plan) {
      const { P, i } = m;
      if (P.mode !== 'draw') continue;
      P.x = m.x; P.y = m.y;
      if (end(P, i)) { claims.push(P); continue; }
      trail[i] = P.i + 1; P.trail.push(i);
    }
    for (const P of claims) if (P.mode === 'draw') {
      claim(G, P);
      P.mode = 'line'; P.want = -1;
      if (!G.line[idx(P.x, P.y)]) snap(G, P);   // 囲んだせいで、着いた所が線でなくなったとき
      const d = lineDir(G, P); if (d >= 0) P.dir = d;
    }
  }

  /* ずれていないかを確かめる短い文字 */
  function sig(G) {
    let h = 0;
    for (let i = 0; i < W * H; i++) h = (Math.imul(h, 31) + G.own[i] * 7 + G.trail[i]) | 0;
    return [G.tick, h >>> 0, G.players.map(P => P.x + '.' + P.y + P.mode[0] + P.g).join('/'), G.enemies.map(E => E.x + '.' + E.y).join('/'), G.sparx.map(S => S.x + '.' + S.y + '.' + S.chase).join('/')].join(',');
  }

  const API = { W, H, U, TICK, STEP, SPX_STEP, SPIN, E_LEN, E_WID, GAUGE_MAX, RESPAWN, TIME_LIMIT, winRate, INNER, MAX_PLAYERS, CPU, DX, DY, makeRng, newGame, step, command, sig, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CC = API;
})(typeof window !== 'undefined' ? window : this);
