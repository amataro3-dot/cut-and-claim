/* 言語(日本語・English・한국어)。game.js より先に読む。ほかのゲーム(BANNER RAID など)と同じ決まり。
   - 画面の文字は T('日本語の文')。下の辞書 I18N に [英語, 韓国語] を書く。辞書にない文は日本語のまま出る。
   - {n} などは T('{n}けた',{n:3}) のように置きかえる(HTMLもそのまま入る)。
   - 名前のあとの「さん」は SAN(名前)(英語はなし、韓国語は「님」)。
   - Firebase には数字・名前・uid だけが入る(文は入らない)ので、同じ部屋でも人それぞれの言語で出る。
   - 言語は URL の ?lang=ja/en/ko → localStorage の muddys-lang(全ゲーム共通)→ スマホの言語設定 の順で決める。 */

const LANGS = ['ja', 'en', 'ko'];
const LANG_NAMES = { ja: '日本語', en: 'English', ko: '한국어' };
const LANG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) { localStorage.setItem('muddys-lang', q); return q; }
  } catch (e) { }
  try { const s = localStorage.getItem('muddys-lang'); if (LANGS.includes(s)) return s; } catch (e) { }
  const n = String(navigator.language || '').toLowerCase();
  return n.startsWith('ko') ? 'ko' : n.startsWith('ja') ? 'ja' : 'en';
})();
document.documentElement.lang = LANG;

function T(ja, vars) {
  const e = I18N[ja];
  let s = LANG === 'ja' || !e ? ja : (e[LANG === 'en' ? 0 : 1] ?? ja);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
const SAN = n => n + (LANG === 'ja' ? 'さん' : LANG === 'ko' ? '님' : '');
/* サイトへのリンク(英語・韓国語は /en/ /ko/ のページ) */
const sitePath = p => (LANG !== 'ja' ? '/' + LANG + p : p);

/* ホームの「日本語 / English / 한국어」。押したら、なまえを覚えてから読みこみ直す */
const langSwitchHtml = () => `<div class="seg lang">${LANGS.map(l => `<button class="sub ${l === LANG ? 'on' : ''}" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('')}</div>`;
function langSwitchInit(saveName) {
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
    const l = b.dataset.lang; if (l === LANG) return;
    try { saveName(); localStorage.setItem('muddys-lang', l); } catch (e) { }
    const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.toString();
  });
}
const I18N = {
  // --- ホーム ---
  "Muddy's Games トップ": ["Muddy's Games home", "Muddy's Games 홈"],
  'プライバシーポリシー': ['Privacy policy', '개인정보 처리방침'],
  '線で切って、陣地を取れ！': ['Cut the field. Claim your land!', '선을 그어 땅을 차지하라!'],
  '遊び方': ['How to play', '게임 방법'],
  '△は、線の上を自動で進む': ['Your △ runs along the lines by itself', '△는 선 위를 자동으로 달려요'],
  '線の上で、空いている側の矢印を押すと、枠の中へ進んでいく。中でも矢印で向きを変える': ['On a line, press the arrow toward open space to cut inside. Steer with the arrows', '선 위에서 빈 쪽 화살표를 누르면 안으로 들어가요. 안에서도 화살표로 방향을 바꿔요'],
  '中では、人の陣地の中にも線を引ける。外の枠か自分の陣地に戻ってきたら、囲んだうちダイヤンがいないほうが自分の陣地になる(人の陣地もふくむ。どちらにもいなければ小さいほう)': ['Inside, you can draw through other players\' land too. Get back to the outer frame or your own land, and the side without Diayan becomes yours (other players\' land included; if neither has it, the smaller side)', '안에서는 다른 사람의 땅 안에도 선을 그을 수 있어요. 바깥 테두리나 내 땅으로 돌아오면, 나뉜 곳 중 다이얀이 없는 쪽이 내 땅이 돼요(다른 사람의 땅도 포함. 둘 다 없으면 작은 쪽)'],
  '中を進んでいる線を、人にさわられたらやられる(自分の線にぶつかっても)。空いている所ではダイヤンにさわられてもやられる。5秒で復活': ['If a player touches your line while you are inside, you are out (your own line too). In open space, Diayan can get you too. Back in 5 seconds', '안에서 긋는 선을 사람이 건드리면 아웃(내 선에 부딪혀도). 빈 곳에서는 다이얀에게 닿아도 아웃. 5초 뒤 부활'],
  '線の上はアスタンが走っている。さわるとやられる。中へ入ると、線をたどって追いかけてくる': ['Astan runs along the lines. Touch it and you are out. When you go inside, it chases you along your line', '선 위에는 아스탄이 달려요. 닿으면 아웃. 안으로 들어가면 선을 따라 쫓아와요'],
  '囲まれた所の線の上にいた人も、やられる': ['Players on lines inside an area that gets claimed are out too', '둘러싸인 곳의 선 위에 있던 사람도 아웃'],
  'ダイヤンにやられた': ['Diayan got you', '다이얀에게 당했어요'],
  'アスタンにやられた': ['Astan got you', '아스탄에게 당했어요'],
  '陣地が目標をこえるか、3分たって陣地がいちばん広い人の勝ち。目標は 2〜3人で50%、4〜5人で35%、6〜8人で30%': ['Win by owning more than the goal, or the most land after 3 minutes. Goal: 50% for 2–3 players, 35% for 4–5, 30% for 6–8', '땅이 목표를 넘거나, 3분 뒤 땅이 가장 넓은 사람이 승리. 목표는 2~3명 50%, 4~5명 35%, 6~8명 30%'],
  'A を押しているあいだ、ダッシュ(2倍の速さ)。ゲージは線の上でたまる': ['Hold A to dash (2× speed). The gauge refills while on a line', 'A를 누르는 동안 대시(2배 속도). 게이지는 선 위에서 차요'],
  'ひとりで練習(CPU対戦)': ['Practice (vs CPU)', '혼자 연습 (CPU 대전)'],
  'オンライン対戦(8人まで)': ['Online battle (up to 8)', '온라인 대전 (최대 8명)'],
  'オンライン対戦は muddys-games.com で遊べます': ['Online battles are on muddys-games.com', '온라인 대전은 muddys-games.com에서 할 수 있어요'],
  '試作版です。遊びながら調整します': ['Prototype. We will tune it as we play.', '시제품 버전이에요. 플레이하면서 조정해요'],
  // --- ひとりで練習 ---
  'CPUの数': ['Number of CPUs', 'CPU 수'],
  'CPUの強さ': ['CPU level', 'CPU 강도'],
  'よわい': ['Easy', '약함'],
  'ふつう': ['Normal', '보통'],
  'つよい': ['Hard', '강함'],
  'スタート': ['Start', '시작'],
  'もどる': ['Back', '뒤로'],
  // --- 対戦 ---
  'あなた': ['You', '나'],
  '復活まで {n}': ['Back in {n}', '부활까지 {n}'],
  '{name} にやられた': ['{name} cut your line', '{name}에게 당했어요'],
  '自分の線にぶつかった': ['You hit your own line', '내 선에 부딪혔어요'],
  'やられた': ['You are out', '당했어요'],
  '{name} をたおした！': ['You cut {name}!', '{name}을(를) 쓰러뜨렸어요!'],
  'みんなを待っています…': ['Waiting for others…', '다른 사람을 기다리는 중…'],
  '画面にずれが出ました': ['Screens got out of sync', '화면이 어긋났어요'],
  '本当にやめる？': ['Really quit?', '정말 그만둘까요?'],
  // --- 結果 ---
  '{name} の勝ち！': ['{name} wins!', '{name} 승리!'],
  '🏆 勝利！': ['🏆 You win!', '🏆 승리!'],
  '引き分け': ['Draw', '무승부'],
  '陣地が{p}%をこえた': ['Over {p}% of the land', '땅이 {p}%를 넘었어요'],
  '時間切れ。陣地がいちばん広い人の勝ち': ['Time up. The most land wins', '시간 종료. 땅이 가장 넓은 사람이 승리'],
  'ぜんぶ取られた': ['All the land is taken', '땅이 모두 차지됐어요'],
  '順位': ['Rank', '순위'],
  '陣地': ['Land', '땅'],
  'たおした': ['Cuts', '쓰러뜨림'],
  'やられた回数': ['Outs', '당한 횟수'],
  'もう一回': ['Play again', '한 번 더'],
  '設定を変える': ['Change settings', '설정 바꾸기'],
  'ホームへ': ['Home', '홈으로'],
  // --- オンライン ---
  'なまえ': ['Name', '이름'],
  '部屋を作る': ['Create a room', '방 만들기'],
  '部屋コード(4けた)': ['Room code (4 digits)', '방 코드 (4자리)'],
  '入室する': ['Join', '입장하기'],
  'なまえを入れてね': ['Enter your name', '이름을 입력해 주세요'],
  '部屋コードは4けたの数字だよ': ['The room code is 4 digits', '방 코드는 4자리 숫자예요'],
  '接続中…': ['Connecting…', '연결 중…'],
  'つながりませんでした。もう一度ためしてね': ['Could not connect. Please try again.', '연결하지 못했어요. 다시 시도해 주세요'],
  '部屋がありません': ['No such room', '방이 없어요'],
  '満員です': ['The room is full', '방이 꽉 찼어요'],
  '部屋が閉じました': ['The room was closed', '방이 닫혔어요'],
  '部屋から外れました': ['You left the room', '방에서 나갔어요'],
  '部屋コード': ['Room code', '방 코드'],
  '待ちあい': ['Lobby', '대기실'],
  'ホスト': ['Host', '호스트'],
  'CPUを足す': ['Add CPU', 'CPU 추가'],
  'CPUをへらす': ['Remove CPU', 'CPU 빼기'],
  'はじめる': ['Start', '시작하기'],
  'ホストがはじめるのを待っています': ['Waiting for the host to start', '호스트가 시작하기를 기다리는 중'],
  '2人以上(CPUをふくむ)で遊べます': ['Needs 2 or more (CPUs count)', '2명 이상(CPU 포함)이면 할 수 있어요'],
  '部屋を出る': ['Leave the room', '방에서 나가기'],
  '試合中です。終わるまで待ってね': ['A match is on. Please wait until it ends.', '경기 중이에요. 끝날 때까지 기다려 주세요'],
  '待ちあいへ(みんな)': ['Back to lobby (everyone)', '대기실로 (모두)'],
  'ホストが待ちあいにもどすのを待っています': ['Waiting for the host to go back to the lobby', '호스트가 대기실로 돌아가기를 기다리는 중'],
  '回線が切れたので、CPUにかわりました': ['Disconnected, so a CPU took over', '연결이 끊겨서 CPU가 대신해요'],
  'CPU': ['CPU', 'CPU'],
};
