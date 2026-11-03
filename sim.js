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
  const N = 60;                    // マス目の大きさ(外の枠をふくむ)
  const TICK = 1 / 30;             // 1コマの時間(1秒に30コマ)
  const MOVE_EVERY = 6;            // 6コマで1マス進む(1秒に5マス)
  const RESPAWN = 150;             // やられてから復活まで(5秒)
  const TIME_LIMIT = 180 * 30;     // 3分
  const winRate = n => (n <= 3 ? 0.5 : n <= 5 ? 0.35 : 0.25);   // 陣地がこれをこえたら勝ち(人数で変わる)
  const GO_WAIT = 8;               // A を押してから、中に入れる場所を待つ歩数
  const MAX_PLAYERS = 8;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];   // 向き: 0 上、1 右、2 下、3 左
  const back = d => (d + 2) & 3;
  const INNER = (N - 2) * (N - 2);
  /* 中の敵(本家の「クイックス」)。位置は 1マス = 64 の整数(どのスマホでも同じ計算になるように、小数や三角関数を使わない) */
  const U = 64;                    // 1マスの細かさ
  const ENEMY_R2 = 5;              // 敵のまわりのこの範囲(マスの距離の2乗)の線にさわったら、やられる
  const ENEMY_TURN = [20, 70];     // 向きを変えるまでのコマ
  const ENEMY_VEL = [[9, 0], [8, 3], [6, 6], [3, 8], [0, 9], [-3, 8], [-6, 6], [-8, 3], [-9, 0], [-8, -3], [-6, -6], [-3, -8], [0, -9], [3, -8], [6, -6], [8, -3]];   // 1コマで約0.135マス(1秒に約4マス)
  const enemyCount = n => (n >= 5 ? 2 : 1);   // 5人以上なら2体

  /* CPU の強さ: a = 中へ進む深さ、b = 横の長さ、cool = 次に入るまでのコマ、
     danger = 敵の頭がこの距離に来たら帰る、attack = 敵の線がこの距離ならねらう */
  const CPU = {
    easy:   { a: [3, 7],  b: [3, 8],  cool: [60, 150], danger: 0, attack: 0 },
    normal: { a: [5, 13], b: [5, 13], cool: [30, 90],  danger: 6, attack: 3 },
    hard:   { a: [7, 18], b: [6, 17], cool: [12, 45],  danger: 9, attack: 7 },
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
      n: N, tick: 0, limit: limit || TIME_LIMIT, winRate: winRate(slots.length), rng: makeRng(seed), over: null, ver: 0,
      own: new Int8Array(N * N), trail: new Int8Array(N * N), line: new Uint8Array(N * N),
      dist: new Int16Array(N * N), area: [], players: [], events: [], enemies: [],
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x === 0 || y === 0 || x === N - 1 || y === N - 1) G.own[y * N + x] = -1;
    // 外の枠を時計回りに1周する道。全員が同じ間隔で並ぶ
    const ring = [];
    for (let x = 0; x < N - 1; x++) ring.push([x, 0]);
    for (let y = 0; y < N - 1; y++) ring.push([N - 1, y]);
    for (let x = N - 1; x > 0; x--) ring.push([x, N - 1]);
    for (let y = N - 1; y > 0; y--) ring.push([0, y]);
    const n = slots.length;
    slots.forEach((s, i) => {
      const k = Math.floor((i + 0.5) * ring.length / n), [x, y] = ring[k], [nx, ny] = ring[(k + 1) % ring.length];
      const dir = nx > x ? 1 : nx < x ? 3 : ny > y ? 2 : 0;
      G.players.push({ i, x, y, dir, want: -1, mode: 'line', go: 0, trail: [], start: -1, deadAt: 0, cpu: s.cpu || null,
        ai: { cool: 30 + Math.floor(G.rng() * 60), plan: null, leg: 0, left: 0, home: false }, kills: 0, deaths: 0, best: 0 });
      G.area.push(0);
    });
    for (let k = 0, m = enemyCount(slots.length); k < m; k++) {
      const v = ENEMY_VEL[Math.floor(G.rng() * 16)];
      G.enemies.push({ x: ((N >> 1) + (m > 1 ? (k ? 8 : -8) : 0)) * U + (U >> 1), y: (N >> 1) * U + (U >> 1), vx: v[0], vy: v[1], turn: 30 });
    }
    refresh(G);
    return G;
  }

  const idx = (x, y) => y * N + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  /* 線と、線までの近さを数え直す(囲んだあと・始まるとき) */
  function refresh(G) {
    const { own, line, dist } = G;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
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
    for (let i = 0; i < N * N; i++) if (line[i]) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inside(xx, yy)) continue;
        const j = idx(xx, yy);
        if (own[j] === 0 && dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
      }
    }
    G.area = G.players.map(() => 0);
    for (let i = 0; i < N * N; i++) if (own[i] > 0) G.area[own[i] - 1]++;
    G.players.forEach((P, k) => { P.best = Math.max(P.best, G.area[k]); });
    G.ver++;
  }

  /* 操作。a: 'd' = 矢印(d = 向き)、'a' = A ボタン、'x' = 回線が切れたので CPU にかわる */
  function command(G, p, a, d) {
    const P = G.players[p]; if (!P) return;
    if (a === 'd') P.want = d & 3;
    else if (a === 'a') { if (P.mode === 'line') P.go = GO_WAIT; }
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
  /* A を押したとき、中へ入る向き(だれのものでもないマスへ) */
  function goDir(G, P) {
    const free = d => { const x = P.x + DX[d], y = P.y + DY[d]; return inside(x, y) && G.own[idx(x, y)] === 0; };
    const order = [P.want, P.dir, (P.dir + 1) & 3, (P.dir + 3) & 3, back(P.dir)];
    for (const d of order) if (d >= 0 && free(d)) return d;
    return -1;
  }

  function kill(G, P, by, enemy) {
    if (P.mode === 'dead') return;
    for (const i of P.trail) if (G.trail[i] === P.i + 1) G.trail[i] = 0;
    P.trail = []; P.mode = 'dead'; P.deadAt = G.tick; P.deaths++; P.go = 0; P.want = -1;
    P.ai.plan = null; P.ai.home = false;
    if (by && by !== P) by.kills++;
    G.events.push({ t: 'die', p: P.i, by: by ? by.i : enemy ? -2 : -1, x: P.x, y: P.y });
  }

  /* 囲み終わり: 線を陣地にして、分かれたうちの小さいほう(いちばん大きい所以外)をもらう */
  function claim(G, P) {
    const { own, trail } = G, me = P.i + 1;
    for (const i of P.trail) { own[i] = me; if (trail[i] === me) trail[i] = 0; }
    P.trail = [];
    // だれのものでもない場所を、つながりごとに分ける
    const comp = new Int32Array(N * N).fill(-1), sizes = [];
    for (let s = 0; s < N * N; s++) {
      if (own[s] !== 0 || comp[s] >= 0) continue;
      const c = sizes.length, q = [s]; comp[s] = c;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % N, y = (i / N) | 0;
        for (let d = 0; d < 4; d++) {
          const xx = x + DX[d], yy = y + DY[d];
          if (!inside(xx, yy)) continue;
          const j = idx(xx, yy);
          if (own[j] === 0 && comp[j] < 0) { comp[j] = c; q.push(j); }
        }
      }
      sizes.push(q.length);
    }
    // 敵がいる所は残す(敵がいないほうが陣地)。どこにも敵がいなければ、いちばん大きい所を残す(小さいほうが陣地)
    const keep = new Set();
    for (const E of G.enemies) { const c = comp[idx(E.x / U | 0, E.y / U | 0)]; if (c >= 0) keep.add(c); }
    if (!keep.size && sizes.length) { let big = 0; sizes.forEach((v, c) => { if (v > sizes[big]) big = c; }); keep.add(big); }
    let got = 0;
    for (let i = 0; i < N * N; i++) if (comp[i] >= 0 && !keep.has(comp[i])) { own[i] = me; got++; }
    // 囲まれた中で線を引いていた人はやられる
    for (const Q of G.players) if (Q !== P && Q.mode === 'draw' && Q.trail.some(i => own[i] !== 0)) kill(G, Q, P);
    refresh(G);
    for (const E of G.enemies) if (own[idx(E.x / U | 0, E.y / U | 0)] !== 0) enemyHome(G, E);   // 念のため
    // 線でなくなった所にいる人は、いちばん近い線へ
    for (const Q of G.players) if (Q.mode === 'line' && !G.line[idx(Q.x, Q.y)]) snap(G, Q);
    G.events.push({ t: 'claim', p: P.i, n: got + 0 });
  }
  /* いちばん近い線へ移す(陣地の中を通って探す) */
  function snap(G, P) {
    const seen = new Uint8Array(N * N), s = idx(P.x, P.y), q = [s]; seen[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (G.line[i]) { P.x = i % N; P.y = (i / N) | 0; const d = lineDir(G, P); if (d >= 0) P.dir = d; return; }
      const x = i % N, y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d], yy = y + DY[d];
        if (!inside(xx, yy)) continue;
        const j = idx(xx, yy);
        if (!seen[j] && G.own[j] !== 0) { seen[j] = 1; q.push(j); }
      }
    }
  }
  /* 復活の場所: 自分の陣地のふち(なければ外の枠)のうち、ほかの人からいちばん遠い所 */
  function respawn(G, P) {
    const me = P.i + 1, mine = [], frame = [];
    for (let i = 0; i < N * N; i++) if (G.line[i]) { if (G.own[i] === me) mine.push(i); else if (G.own[i] === -1) frame.push(i); }
    let cand = mine.length ? mine : frame;
    if (!cand.length) for (let i = 0; i < N * N; i++) if (G.line[i]) cand.push(i);
    if (!cand.length) return;
    const others = G.players.filter(Q => Q !== P && Q.mode !== 'dead');
    let best = cand[0], bv = -1;
    for (const i of cand) {
      const x = i % N, y = (i / N) | 0;
      let v = 9999;
      for (const Q of others) v = Math.min(v, Math.abs(Q.x - x) + Math.abs(Q.y - y));
      if (v > bv) { bv = v; best = i; }
    }
    P.x = best % N; P.y = (best / N) | 0; P.mode = 'line'; P.want = -1; P.go = 0;
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
    // まわりの線にさわったら、その線を引いていた人はやられる
    const cx = E.x / U | 0, cy = E.y / U | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > ENEMY_R2 || !inside(cx + dx, cy + dy)) continue;
      const t = G.trail[idx(cx + dx, cy + dy)];
      if (t) { const P = G.players[t - 1]; if (P.mode === 'draw') kill(G, P, null, true); }
    }
  }
  /* 敵のいるマスが空きでなくなったとき(念のため)、いちばん近い空きへ */
  function enemyHome(G, E) {
    const cx = E.x / U | 0, cy = E.y / U | 0;
    let best = -1, bv = 1e9;
    for (let i = 0; i < N * N; i++) if (G.own[i] === 0) { const v = Math.abs(i % N - cx) + Math.abs((i / N | 0) - cy); if (v < bv) { bv = v; best = i; } }
    if (best >= 0) { E.x = (best % N) * U + (U >> 1); E.y = (best / N | 0) * U + (U >> 1); }
  }
  const enemyNear = (G, x, y, r) => G.enemies.some(E => Math.abs((E.x / U | 0) - x) + Math.abs((E.y / U | 0) - y) <= r);

  /* ---------- CPU ---------- */
  const rint = (G, [a, b]) => a + Math.floor(G.rng() * (b - a + 1));
  function cpuThink(G, P) {
    const L = CPU[P.cpu] || CPU.normal, A = P.ai;
    if (P.mode === 'line') {
      if (A.cool > 0) { A.cool--; return; }
      if (enemyNear(G, P.x, P.y, 9)) return;   // 敵が近いときは入らない
      const d = goDir(G, P);
      if (d < 0) return;
      // 中へ a マス、横へ b マス、そのあとは線へ帰る(コの字)
      const side = G.rng() < 0.5 ? (d + 1) & 3 : (d + 3) & 3;
      A.plan = [[d, rint(G, L.a)], [side, rint(G, L.b)]]; A.leg = 0; A.left = A.plan[0][1]; A.home = false;
      P.want = d; P.go = GO_WAIT;
      A.cool = rint(G, L.cool);
      return;
    }
    if (P.mode !== 'draw') return;
    // 敵の頭が近い・線が長い → 帰る
    if (L.danger && !A.home) {
      for (const Q of G.players) if (Q !== P && Q.mode === 'draw' && Math.abs(Q.x - P.x) + Math.abs(Q.y - P.y) <= L.danger) { A.home = true; break; }
      if (enemyNear(G, P.x, P.y, L.danger + 2)) A.home = true;
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
    A.home = true;
    // 線へ帰る: 自分の線にぶつからない向きのうち、線にいちばん近い向き
    let bd = -1, bv = 1e9;
    for (let d = 0; d < 4; d++) {
      if (d === back(P.dir)) continue;
      const x = P.x + DX[d], y = P.y + DY[d];
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (G.trail[i] === P.i + 1) continue;
      const v = (G.line[i] ? -1 : G.dist[i]) + (d === P.dir ? -0.1 : 0);
      if (v < bv) { bv = v; bd = d; }
    }
    if (bd >= 0) P.want = bd;
  }
  /* その向きに進んでも、すぐ自分の線にぶつからないか */
  function safe(G, P, d) {
    if (d === back(P.dir)) return false;
    const x = P.x + DX[d], y = P.y + DY[d];
    return inside(x, y) && G.trail[idx(x, y)] !== P.i + 1;
  }

  /* 1コマ進める */
  function step(G) {
    if (G.over) return;
    G.tick++;
    G.events = [];
    // 復活
    for (const P of G.players) if (P.mode === 'dead' && G.tick - P.deadAt >= RESPAWN) respawn(G, P);
    for (const E of G.enemies) enemyStep(G, E);
    if (G.tick % MOVE_EVERY === 0) move(G);
    // 勝ち負け
    const free = INNER - G.area.reduce((s, v) => s + v, 0);
    const top = Math.max(...G.area);
    if (top / INNER > G.winRate) G.over = { reason: 'rate', win: G.area.map((v, k) => v === top ? k : -1).filter(k => k >= 0) };
    else if (G.tick >= G.limit || free <= 0) G.over = { reason: G.tick >= G.limit ? 'time' : 'full', win: G.area.map((v, k) => v === top ? k : -1).filter(k => k >= 0) };
  }

  function move(G) {
    const { own, trail, line } = G;
    for (const P of G.players) if (P.cpu && P.mode !== 'dead') cpuThink(G, P);
    // 1) みんなの行き先を決める
    const plan = [];
    for (const P of G.players) {
      if (P.mode === 'dead') continue;
      if (P.mode === 'line') {
        if (P.go > 0) {
          const d = goDir(G, P);
          if (d >= 0) { P.dir = d; P.mode = 'draw'; P.go = 0; P.start = idx(P.x, P.y); plan.push({ P, x: P.x + DX[d], y: P.y + DY[d] }); continue; }
          P.go--;
        }
        const d = lineDir(G, P);
        if (d >= 0) { P.dir = d; P.x += DX[d]; P.y += DY[d]; }
        continue;
      }
      // 中を進んでいる: 真うしろには曲がれない
      if (P.want >= 0 && P.want !== back(P.dir)) P.dir = P.want;
      plan.push({ P, x: P.x + DX[P.dir], y: P.y + DY[P.dir] });
    }
    // 2) ぶつかりを調べる(みんな同時に)
    const dead = new Set(), cutBy = new Map(), count = new Map();
    for (const m of plan) { m.i = idx(m.x, m.y); if (!line[m.i]) count.set(m.i, (count.get(m.i) || 0) + 1); }
    for (const m of plan) {
      const { P, i } = m;
      if (!inside(m.x, m.y) || own[i] < -1) { dead.add(P); continue; }
      if (line[i]) continue;                                   // 線に着いた(囲み終わり)
      if (own[i] !== 0) { dead.add(P); continue; }             // ここには来ないはず(念のため)
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
      if (line[i]) { claims.push(P); continue; }
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
    for (let i = 0; i < N * N; i++) h = (Math.imul(h, 31) + G.own[i] * 7 + G.trail[i]) | 0;
    return [G.tick, h >>> 0, G.players.map(P => P.x + '.' + P.y + P.mode[0]).join('/'), G.enemies.map(E => E.x + '.' + E.y).join('/')].join(',');
  }

  const API = { N, U, TICK, MOVE_EVERY, RESPAWN, TIME_LIMIT, winRate, INNER, MAX_PLAYERS, CPU, DX, DY, makeRng, newGame, step, command, sig, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CC = API;
})(typeof window !== 'undefined' ? window : this);
