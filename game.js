// ============================================================
// Wetterleuchten — prototype core
// 戦闘ではなく「観測」。倒すのではなく、不透明度を下げて記録する。
// ============================================================

const G = {
  data: null,
  screen: 'title',
  knownWords: [],     // 永続的な知識(localStorage)。観測員チームの候補にもなる
  party: [],           // 今、傍にいる観測員チーム(プレイヤー自身を含む)
  seesaw: 0,           // 0=完全な明晰さ, 100=完全な残響
  afterEffect: false,  // 直前の気絶による軽い後遺症フラグ
  obs: null,           // 現在進行中の観測の状態
  playerName: null,    // オープニングで組み立てた名前。未設定ならオープニングへ
  opening: null,       // オープニング進行中の一時状態
  clockActionCount: 0,  // ゲーム内時計を進めるための行動カウンタ(永続)
  instrumentState: {},  // {weathervane: 'broken'|'repaired', ...} 永続
  parts: 0,              // 観測器具の修理に使う素材の所持数(永続)
  gardenUnlocked: false, // Raunenの依頼を受けたかどうか(永続)
  titleTab: 'scene'      // 拠点画面のタブ状態(景色/器具)。永続化しない
};

// プレイヤー自身。まだ何も知らない状態でも、無冠詞の存在として観測ができる。
// 弱点も無く、得意な相性も無い(typeChartにunbenanntの特例はplural以外定義していないため中立)。
function PLAYER_SELF() {
  return {
    word: G.playerName || '私',
    meaning: 'まだ多くを知らない、観測する者自身',
    artikel: '',
    attr: 'unbenannt',
    tier: 0,
    isPlayer: true
  };
}

// ------------------------------------------------------------
// 観測員の個別ステータス
// 仲間になった瞬間に一度だけ生成され、以後はその個体固有の値として育っていく。
// (同じ言葉が複数現れることはないので、これは「その言葉、その一体」の記録になる)
// ------------------------------------------------------------
function generateInitialStats() {
  const rand = (base, spread) => base + Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  const maxHp = rand(22, 4);
  return {
    level: 1,
    exp: 0,
    resolution: rand(100, 12),  // 個体差。基準100に対して±12のばらつき
    resistance: rand(100, 12),
    maxHp,
    hp: maxHp
  };
}

function expRequiredForLevel(level) {
  return level * 12;
}

// この観測員に経験値を与える。プレイヤー自身(無冠詞)は対象外。
function gainExp(observerWord, amount) {
  const entry = G.knownWords.find(k => k.word === observerWord);
  if (!entry || !entry.stats) return;
  const stats = entry.stats;
  stats.exp += amount;
  let leveledUp = false;
  while (stats.exp >= expRequiredForLevel(stats.level)) {
    stats.exp -= expRequiredForLevel(stats.level);
    stats.level++;
    stats.resolution += 3;
    stats.resistance += 3;
    stats.maxHp += 2;
    stats.hp = stats.maxHp; // レベルアップで全快
    leveledUp = true;
  }
  persistSave();
  return leveledUp;
}

// ------------------------------------------------------------
// 初期化
// ------------------------------------------------------------
async function init() {
  const res = await fetch('data.json');
  G.data = await res.json();
  loadSave();
  if (!G.playerName) {
    startOpening();
  } else {
    render();
  }
}

function loadSave() {
  try {
    const saved = JSON.parse(localStorage.getItem('wetterleuchten_save') || '{}');
    G.knownWords = saved.knownWords || [];
    G.playerName = saved.playerName || null;
    G.clockActionCount = saved.clockActionCount || 0;
    G.instrumentState = saved.instrumentState || initialInstrumentState();
    G.parts = saved.parts != null ? saved.parts : 0;
    G.gardenUnlocked = saved.gardenUnlocked || false;

    // 個体ステータス導入前のセーブデータには stats が無いので、ここで補う
    let migrated = false;
    G.knownWords.forEach(w => {
      if (!w.stats) {
        w.stats = generateInitialStats();
        migrated = true;
      }
    });
    if (migrated) persistSave();
  } catch (e) {
    console.warn('save load failed', e);
  }
}

function initialInstrumentState() {
  const state = {};
  G.data.instruments.list.forEach(inst => { state[inst.id] = 'broken'; });
  return state;
}

function persistSave() {
  localStorage.setItem('wetterleuchten_save', JSON.stringify({
    knownWords: G.knownWords,
    playerName: G.playerName,
    clockActionCount: G.clockActionCount,
    instrumentState: G.instrumentState,
    parts: G.parts,
    gardenUnlocked: G.gardenUnlocked
  }));
}

// ------------------------------------------------------------
// ゲーム内時計: リアルタイムには連動せず、行動するたびに進む
// ------------------------------------------------------------
function advanceClock() {
  G.clockActionCount++;
  persistSave();
}

function currentPhase() {
  const phases = G.data.gameClock.phases;
  const perPhase = G.data.gameClock.actionsPerPhase;
  const idx = Math.floor(G.clockActionCount / perPhase) % phases.length;
  return phases[idx];
}

// ------------------------------------------------------------
// オープニング: 目覚め → 自分自身を観測する → 名前の断片を組み立てる
// ------------------------------------------------------------
function startOpening() {
  G.opening = { stage: 'wake' };
  G.screen = 'opening';
  render();
}

function openingObserveSelf() {
  // 周辺の気配から3〜4語をランダムに選び、断片プールを作る。
  // 重要な対象(Wetterleuchten)や稀少な対象は、最初の名前には混ぜない。
  const basics = G.data.subjects.filter(s => !s.important && !s.rare);
  const shuffled = [...basics].sort(() => Math.random() - 0.5);
  const sourceWords = shuffled.slice(0, 3 + Math.round(Math.random())); // 3〜4語

  // 同じ綴りの断片が複数語から出ても区別できるよう、一意なIDを振る
  let uid = 0;
  const pool = sourceWords
    .flatMap(s => s.nameFragments.map(text => ({ id: `f${uid++}`, text })))
    .sort(() => Math.random() - 0.5);

  G.opening = {
    stage: 'fragments',
    pool,
    sourceWords,    // 後で「実はこの単語の一部だった」と明かす時のために保持しておく
    chosen: []        // 選んだ断片のidの配列
  };
  G.screen = 'opening';
  render();
}

function toggleFragment(fragmentId) {
  const o = G.opening;
  const idx = o.chosen.indexOf(fragmentId);
  if (idx >= 0) {
    o.chosen.splice(idx, 1);
  } else if (o.chosen.length < 4) {
    o.chosen.push(fragmentId);
  }
  render();
}

function confirmName() {
  const o = G.opening;
  if (o.chosen.length < 2) {
    alert('断片を2つ以上選んでください');
    return;
  }
  const text = o.chosen
    .map(id => o.pool.find(f => f.id === id).text)
    .join('');
  G.playerName = text;
  persistSave();
  G.opening = null;
  G.screen = 'title';
  render();
}

// ------------------------------------------------------------
// 観測員チームの編成
// 本来は季節・天候による「気まぐれ」で誰が傍にいるかが変わる予定だが、
// その出現条件はまだ実装していないため、今は定着済み全員が傍にいる簡易状態とする。
// ------------------------------------------------------------
function assembleParty() {
  G.party = [PLAYER_SELF(), ...G.knownWords];
}

// ------------------------------------------------------------
// 本を開く: 拠点(現実)から、言葉の世界(本の中)へ入る入口
// ------------------------------------------------------------
function openBook() {
  advanceClock();
  G.screen = 'book';
  render();
}

// ------------------------------------------------------------
// Wortzimmer(言葉の部屋): 観測員になった言葉たちの記録を見る場所
// ------------------------------------------------------------
function openWortzimmer() {
  G.screen = 'wortzimmer';
  render();
}

// 観測員に話しかける。まだ伝えていない用件(庭の依頼など)があれば、ここで渡す。
function talkToWord(word) {
  const entry = G.knownWords.find(k => k.word === word);
  if (!entry) return;

  G.talkReturnTo = 'wortzimmer'; // Wortzimmerから話しかけた場合、戻り先もWortzimmer

  if (entry.unlocksGarden && !G.gardenUnlocked) {
    G.gardenUnlocked = true;
    persistSave();
    G.lastTalkSubject = entry;
    G.lastTalkLine = entry.gardenLine;
    G.screen = 'wortzimmerTalk';
    render();
    return;
  }

  G.lastTalkSubject = entry;
  G.lastTalkLine = null; // 特に新しい話は無い
  G.screen = 'wortzimmerTalk';
  render();
}

// ------------------------------------------------------------
// 観測対象を選んで遭遇する(プロトタイプ用の簡易入口)
// ------------------------------------------------------------
function encounterRandomSubject() {
  assembleParty();
  // 一度仲間になった言葉とは、もう本の中で出会えない(その存在は唯一のものだから)
  const pool = G.data.subjects.filter(s =>
    !s.important && !G.knownWords.find(k => k.word === s.word)
  );

  if (pool.length === 0) {
    alert('もう、新しい気配は見当たらないようだ。');
    return;
  }

  const rates = G.data.rareSpawnRates;
  let subject;
  const pluralCandidates = pool.filter(s => s.attr === 'plural');
  const normals = pool.filter(s => s.attr !== 'plural');

  if (pluralCandidates.length > 0 && Math.random() < rates.plural) {
    subject = pluralCandidates[Math.floor(Math.random() * pluralCandidates.length)];
  } else if (normals.length > 0) {
    subject = normals[Math.floor(Math.random() * normals.length)];
  } else {
    subject = pluralCandidates[Math.floor(Math.random() * pluralCandidates.length)];
  }
  startObservation(subject, false);
}

function encounterImportantSubject() {
  assembleParty();
  const subject = G.data.subjects.find(s => s.important);
  if (G.knownWords.find(k => k.word === subject.word)) {
    alert('Wetterleuchtenは、もうあなたの傍にいる。');
    return;
  }
  startObservation(subject, true);
}

// ------------------------------------------------------------
// 観測開始
// ------------------------------------------------------------
function startObservation(subject, isImportant) {
  G.obs = {
    subject: { ...subject },
    fog: 100,            // 不透明度。0になれば観測完了
    isImportant,
    turn: 0,
    fragments: [],        // この観測で得た断片(全滅すると失われうる)
    over: false,
    fainted: false,
    observer: null,        // 今、観測している観測員(party内の一人)
    tempObserverIndex: null  // 重要観測で「先に選んだ観測員」を保持する一時状態
  };
  G.screen = 'observe';
  render();
}

// ------------------------------------------------------------
// 通常観測: 誰に観測してもらうかを選ぶだけ→自動進行
// ------------------------------------------------------------
function selectObserverLight(observerIndex) {
  G.obs.observer = G.party[observerIndex];
  runLightObservationAuto();
}

function runLightObservationAuto() {
  const o = G.obs;
  const interval = setInterval(() => {
    if (o.over) { clearInterval(interval); render(); return; }
    o.turn++;

    const mult = getMultiplier(o.observer.attr, o.subject.attr);
    const resistance = o.subject.fogResistance != null ? o.subject.fogResistance : 1;
    const fogDrop = Math.round(14 * mult * resistance);
    o.fog = Math.max(0, o.fog - fogDrop);
    addFragmentLog(mult);

    shiftSeesaw(3); // 通常観測の負荷は軽め

    if (o.fog <= 0) {
      finishObservation();
      o.over = true;
      clearInterval(interval);
      render();
      return;
    }
    if (checkSeesawOverflow()) {
      o.over = true;
      clearInterval(interval);
      render();
      return;
    }
    render();
  }, 650);
}

// ------------------------------------------------------------
// 重要観測: 視点+手法を毎ターン選ぶ
// ------------------------------------------------------------
function commandObserve(observerIndex, methodId) {
  const o = G.obs;
  if (o.over) return;
  const observer = G.party[observerIndex];
  const method = G.data.methods.list.find(m => m.id === methodId);

  const mult = getMultiplier(observer.attr, o.subject.attr);
  const resistance = o.subject.fogResistance != null ? o.subject.fogResistance : 1;
  const fogDrop = Math.round(10 * method.fogPower * mult * resistance);
  o.fog = Math.max(0, o.fog - fogDrop);
  o.observer = observer;
  addFragmentLog(mult, method);

  shiftSeesaw(method.seesawShift);

  if (o.fog <= 0) {
    finishObservation();
    render();
    return;
  }
  if (checkSeesawOverflow()) {
    render();
    return;
  }
  render();
}

// 塗りつぶし背景の上に置く文字色を、背景色の輝度から自動で決める。
// 個別の色をハードコードで判定すると、後で配色を変えるたびに崩れるため。
function readableTextColor(hexColor) {
  const c = hexColor.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#2a2a2a' : '#ffffff';
}

// ------------------------------------------------------------
// 解像度(相性)計算
// ------------------------------------------------------------
function getMultiplier(viewerAttr, subjectAttr) {
  const chart = G.data.typeChart;
  if (chart[viewerAttr] && chart[viewerAttr][subjectAttr] != null) {
    return chart[viewerAttr][subjectAttr];
  }
  return 1.0;
}

function addFragmentLog(mult, method) {
  const o = G.obs;
  const clarity = mult > 1 ? 'よく見える' : mult < 1 ? 'ぼんやりとしか見えない' : 'いつも通りに見える';
  const observerName = o.observer.isPlayer ? '私' : o.observer.word;
  const methodLabel = method ? `${method.name}で` : '';
  o.fragments.push(`${observerName}が${methodLabel}観測——${clarity}。不透明度 ${o.fog}%`);
}

// ------------------------------------------------------------
// シーソー(明晰さ ⇄ 残響)
// ------------------------------------------------------------
function shiftSeesaw(amount) {
  const penalty = G.afterEffect ? G.data.seesaw.afterEffectRecoveryPenalty : 1;
  G.seesaw = Math.min(G.data.seesaw.max, G.seesaw + amount * penalty);
}

function recoverSeesaw(amount) {
  G.seesaw = Math.max(0, G.seesaw - amount);
}

function checkSeesawOverflow() {
  if (G.seesaw >= G.data.seesaw.max) {
    triggerOverflow();
    return true;
  }
  return false;
}

// シーソーが完全に振れた: UI侵食 → 光 → 気絶 → 送還
function triggerOverflow() {
  const o = G.obs;
  o.over = true;
  o.fainted = true;
  G.screen = 'overflow';
  render();
}

function confirmFaintedReturn() {
  const o = G.obs;
  // モノは失うが、ランダムに一つだけ握りしめている
  let kept = null;
  if (o.fragments.length > 0) {
    kept = o.subject; // 簡易プロトタイプでは「対象そのものの断片」を1つ握っている扱いにする
  }
  // 知識(永続)は、これまでに十分観測できていた場合のみ別途定着処理(今回は省略しシンプルに)
  G.afterEffect = true;
  G.lastKept = kept;
  G.lastGotPart = false; // 気絶時は部品どころではないので拾えない
  G.obs = null;
  G.screen = 'result_faint';
  render();
}

// ------------------------------------------------------------
// 観測完了(不透明度0)
// 既に観測員になっている対象ならそのまま結果へ。
// 初めて出会う対象なら、意味の4択クイズを経てから定着するかどうかが決まる。
// ------------------------------------------------------------
function finishObservation() {
  const o = G.obs;
  const w = o.subject;

  // 観測に付き合ってくれた観測員(プレイヤー自身は除く)は、経験を積む
  if (o.observer && !o.observer.isPlayer) {
    G.lastLeveledUp = gainExp(o.observer.word, 5);
  } else {
    G.lastLeveledUp = false;
  }

  // 観測の合間に、素材(部品)を拾うことがある
  let gotPart = false;
  if (Math.random() < 0.35) {
    G.parts++;
    gotPart = true;
    persistSave();
  }
  G.lastGotPart = gotPart;

  // ここに来るのは本来ありえない(入口のencounterRandomSubject/encounterImportantSubjectが
  // 既知の対象を候補から除外・拒否しているため)。それでも何らかの理由で既知の対象に
  // たどり着いてしまった場合の保険として残している。
  if (G.knownWords.find(k => k.word === w.word)) {
    G.lastFinished = w;
    G.screen = 'result_finish';
    return;
  }

  offerMeaningQuiz(w);
}

function offerMeaningQuiz(subject) {
  const others = G.data.subjects.filter(s => s.word !== subject.word);
  const shuffledOthers = [...others].sort(() => Math.random() - 0.5).slice(0, 3);
  const optionSubjects = [subject, ...shuffledOthers].sort(() => Math.random() - 0.5);
  G.quiz = { subject, optionSubjects };
  G.screen = 'quiz';
}

function answerMeaningQuiz(idx) {
  const chosen = G.quiz.optionSubjects[idx];
  const subject = G.quiz.subject;
  const correct = chosen.word === subject.word;

  let gardenJustUnlocked = false;
  if (correct) {
    if (!G.knownWords.find(k => k.word === subject.word)) {
      G.knownWords.push({ ...subject, stats: generateInitialStats() });
    }
    if (subject.unlocksGarden && !G.gardenUnlocked) {
      G.gardenUnlocked = true;
      gardenJustUnlocked = true;
    }
    persistSave();
  }
  G.lastQuizResult = correct;
  G.lastQuizSubject = subject;
  G.lastGardenUnlocked = gardenJustUnlocked;
  G.screen = 'quizResult';
  render();
}

// 拠点(タイトル画面)に戻る。その直前に、まだ伝えていない用件を持つ観測員がいれば、
// ここで自動的に話しかけてくる(Wortzimmerを自分から訪れる、という発見任せにしない)。
function returnToTitleOrAutoTalk() {
  const messenger = G.knownWords.find(k => k.unlocksGarden && !G.gardenUnlocked);
  if (messenger) {
    G.gardenUnlocked = true;
    persistSave();
    G.talkReturnTo = 'title'; // 自動会話の場合、戻り先は拠点
    G.lastTalkSubject = messenger;
    G.lastTalkLine = messenger.gardenLine;
    G.screen = 'wortzimmerTalk';
    return;
  }
  G.screen = 'title';
}

function backToTitleAfterResult() {
  advanceClock();
  G.afterEffect = false; // 1回休んだことで後遺症は解消(簡易処理)
  G.obs = null;
  returnToTitleOrAutoTalk();
  render();
}

function continueAfterFinish() {
  advanceClock();
  G.obs = null;
  returnToTitleOrAutoTalk();
  render();
}

// ------------------------------------------------------------
// 拠点(観測所)の描画
// ------------------------------------------------------------

// フェーズごとの地面の色味だけを淡く変化させる。観測所の他の要素は固定。
// フェーズごとの色温度オーバーレイ。画像自体は変えず、薄い色を重ねて表情を変える。
// フェーズごとの地面の色味だけを淡く変化させる。観測所の他の要素は固定。
const PHASE_GROUND = {
  '夜明け': ['#f2e9e4', '#dcd3da'],
  '昼':     ['#eef3ee', '#d8d6dc'],
  '夕暮れ': ['#f0e0d2', '#d9c4bf'],
  '夜':     ['#dcdce2', '#bcb9c4']
};

function renderObservatorySvg(phase) {
  const [groundTop, groundBottom] = PHASE_GROUND[phase] || PHASE_GROUND['昼'];

  return `
    <svg class="fb-observatory-svg" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${groundTop}" />
          <stop offset="100%" stop-color="${groundBottom}" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="200" fill="url(#groundGrad)" />

      <g transform="translate(70,12)">
        <rect x="0" y="0" width="90" height="130" fill="#cfc9bd" opacity="0.55" />
        <rect x="4" y="4" width="82" height="122" fill="none" stroke="#ada58f" stroke-width="1.4" opacity="0.6" />
        <rect x="18" y="14" width="54" height="40" fill="#e8e4da" opacity="0.5" />
        <line x1="45" y1="14" x2="45" y2="54" stroke="#ada58f" stroke-width="1.2" opacity="0.5" />
        <line x1="18" y1="34" x2="72" y2="34" stroke="#ada58f" stroke-width="1.2" opacity="0.5" />

        <path d="M8,4 C4,30 14,46 6,72 C0,90 12,108 4,128" stroke="#9bb083" stroke-width="2.2" fill="none" opacity="0.6" />
        <ellipse cx="6" cy="20" rx="3.5" ry="2" fill="#9bb083" opacity="0.6" transform="rotate(20 6 20)" />
        <ellipse cx="11" cy="48" rx="3" ry="1.8" fill="#a3b88a" opacity="0.55" transform="rotate(-15 11 48)" />
        <ellipse cx="3" cy="66" rx="3.2" ry="1.9" fill="#9bb083" opacity="0.6" transform="rotate(30 3 66)" />
        <ellipse cx="10" cy="92" rx="3" ry="1.8" fill="#a3b88a" opacity="0.55" transform="rotate(-10 10 92)" />
        <ellipse cx="5" cy="115" rx="3.2" ry="1.9" fill="#9bb083" opacity="0.6" transform="rotate(15 5 115)" />

        <rect x="74" y="76" width="3" height="10" rx="1" fill="#b79a7a" opacity="0.85" />
      </g>

      <g opacity="0.9">
        <rect x="70" y="150" width="60" height="10" rx="1" fill="#d6d1c6" />
        <rect x="55" y="160" width="90" height="12" rx="1" fill="#cfcac0" />
        <rect x="40" y="172" width="120" height="14" rx="1" fill="#c7c2b8" />
      </g>

      <g transform="translate(95,158) rotate(-2)">
        <rect x="0" y="0" width="56" height="20" rx="1.5" fill="#e8e2cf" stroke="#a8916e" stroke-width="1" />
        <line x1="0" y1="4" x2="56" y2="4" stroke="#cfc6a8" stroke-width="0.6" />
        <line x1="0" y1="7" x2="56" y2="7" stroke="#cfc6a8" stroke-width="0.6" />
        <line x1="0" y1="10" x2="56" y2="10" stroke="#cfc6a8" stroke-width="0.6" />
        <line x1="0" y1="13" x2="56" y2="13" stroke="#cfc6a8" stroke-width="0.6" />
        <line x1="0" y1="16" x2="56" y2="16" stroke="#cfc6a8" stroke-width="0.6" />
        <rect x="0" y="0" width="3" height="20" fill="#cdbb98" />
      </g>

      <g opacity="0.75">
        <path d="M230,200 C228,180 240,170 236,150 C233,138 244,128 240,112" stroke="#8fa873" stroke-width="2" fill="none" />
        <path d="M252,200 C255,178 244,164 250,144 C253,132 242,122 248,108" stroke="#9bb083" stroke-width="1.8" fill="none" />
        <path d="M272,200 C270,184 280,172 276,156 C273,146 282,136 278,124" stroke="#86a06a" stroke-width="1.8" fill="none" />

        <ellipse cx="237" cy="160" rx="6" ry="3" fill="#9bb083" transform="rotate(-25 237 160)" />
        <ellipse cx="240" cy="135" rx="5.5" ry="3" fill="#a3b88a" transform="rotate(15 240 135)" />
        <ellipse cx="248" cy="118" rx="5" ry="2.8" fill="#8fa873" transform="rotate(-20 248 118)" />
        <ellipse cx="251" cy="170" rx="5.5" ry="3" fill="#86a06a" transform="rotate(20 251 170)" />
        <ellipse cx="249" cy="150" rx="5" ry="2.8" fill="#9bb083" transform="rotate(-10 249 150)" />
        <ellipse cx="277" cy="148" rx="5.5" ry="3" fill="#a3b88a" transform="rotate(25 277 148)" />
        <ellipse cx="274" cy="128" rx="5" ry="2.8" fill="#8fa873" transform="rotate(-15 274 128)" />
        <ellipse cx="280" cy="180" rx="5.5" ry="3" fill="#9bb083" transform="rotate(10 280 180)" />

        <ellipse cx="260" cy="192" rx="9" ry="4" fill="#9bb083" opacity="0.5" />
        <ellipse cx="290" cy="195" rx="7" ry="3.5" fill="#86a06a" opacity="0.5" />
        <ellipse cx="220" cy="195" rx="6" ry="3" fill="#a3b88a" opacity="0.5" />
      </g>
    </svg>`;
}

function renderEnvironmentDetails(phase) {
  const details = G.data.environmentDetails.list;
  // 行動回数を簡易シードにして、毎回少しだけ違う表情に見せる(完全ランダムだとチラつくため)
  const seed = G.clockActionCount;
  const lines = {
    fungus:   ['壁の隙間に、小さな菌が並んでいる。', '苔むした石の上に、新しい菌糸が伸びている。'],
    creature: ['どこかで、何かが動いた気配がする。', '虫の羽音が、遠くでかすかに響いている。'],
    relic:    ['錆びた工具が、土に半分埋もれている。', '誰かの字で、何か書かれた紙片が落ちている。'],
    clouds:   ['雲が、ゆっくり形を変えていく。', '雲の切れ間から、薄い光が差している。'],
    skycolor: [`${phase}の光が、あたりをそめている。`, '空の色が、いつもと少し違う気がする。']
  };
  const picked = details.map((d, i) => {
    const variants = lines[d.id] || [d.label];
    const text = variants[(seed + i) % variants.length];
    return `<p class="fb-envline">${text}</p>`;
  }).join('');
  return `<div class="fb-environment">${picked}</div>`;
}

function renderInstrumentPanel() {
  const instruments = G.data.instruments.list;
  const rows = instruments.map(inst => {
    const state = G.instrumentState[inst.id];
    if (state === 'repaired') {
      return `<p class="fb-instrument-row fb-repaired">${inst.name}：直っている</p>`;
    }
    const canRepair = G.parts >= inst.partsCost;
    return `
      <p class="fb-instrument-row">
        ${inst.name}：壊れている（部品 ${inst.partsCost}個必要）
        <button ${canRepair ? '' : 'disabled'} onclick="repairInstrument('${inst.id}')">直す</button>
      </p>`;
  }).join('');
  return `<div class="fb-instruments">${rows}</div>`;
}

function repairInstrument(id) {
  const inst = G.data.instruments.list.find(i => i.id === id);
  if (G.parts < inst.partsCost) return;
  G.parts -= inst.partsCost;
  G.instrumentState[id] = 'repaired';
  persistSave();
  render();
}

// ------------------------------------------------------------
// 描画
// ------------------------------------------------------------
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (G.screen === 'opening') {
    renderOpening(app);
    return;
  }

  if (G.screen === 'title') {
    const phase = currentPhase();
    const tab = G.titleTab || 'scene';
    app.innerHTML = `
      <div class="fb-title">
        <h1>${G.data.meta.title}</h1>
        <p class="fb-sub">${G.data.meta.subtitle}</p>
        ${G.playerName ? `<p class="fb-playername">${G.playerName}</p>` : ''}

        ${renderObservatorySvg(phase)}
        <p class="fb-phase-label">今は${phase}</p>

        <div class="fb-tabbar">
          <button class="fb-tab ${tab === 'scene' ? 'fb-tab-active' : ''}" onclick="G.titleTab='scene'; render();">景色</button>
          <button class="fb-tab ${tab === 'instruments' ? 'fb-tab-active' : ''}" onclick="G.titleTab='instruments'; render();">器具</button>
        </div>
        <div class="fb-tabpanel">
          ${tab === 'scene' ? renderEnvironmentDetails(phase) : renderInstrumentPanel()}
        </div>

        <div class="fb-actions">
          <button class="fb-openbook-btn" onclick="openBook()">扉の前に落ちている本を開く</button>
          <button class="fb-openbook-btn" onclick="openWortzimmer()">言葉の部屋へ</button>
        </div>

        <p class="fb-known">記憶している言葉: ${G.knownWords.length}語　／　部品: ${G.parts}</p>
        ${G.afterEffect ? '<p class="fb-aftereffect">まだ光の名残がある。明晰さの回復が少し遅い。</p>' : ''}
        <button class="fb-reset" onclick="resetSave()">記憶をすべて消す（検証用）</button>
      </div>`;
    return;
  }

  if (G.screen === 'book') {
    app.innerHTML = `
      <div class="fb-book">
        <p class="fb-book-title">Meteorologische Beobachtungen</p>
        <p class="fb-opening-text">表紙を開くと、文字よりも先に、何かの気配が立ちのぼってくる。</p>
        <button onclick="encounterRandomSubject()">気配の方へ、目を向ける</button>
        <button onclick="encounterImportantSubject()">遠くで、何かが光っている方へ</button>
        <button class="fb-reset" onclick="G.screen='title'; render();">本を閉じる</button>
      </div>`;
    return;
  }

  if (G.screen === 'wortzimmer') {
    const attrs = G.data.attributes;
    app.innerHTML = `
      <div class="fb-wortzimmer">
        <h2 class="fb-wortzimmer-title">Wortzimmer</h2>
        <p class="fb-wortzimmer-sub">言葉の部屋</p>
        ${G.knownWords.length === 0 ? '<p class="fb-wortzimmer-empty">まだ、誰もここにいない。</p>' : ''}
        <div class="fb-wortzimmer-list">
          ${G.knownWords.map(w => `
            <button class="fb-wordcard" style="border-color:${attrs[w.attr].color}" onclick="talkToWord('${w.word}')">
              <span class="fb-wordcard-head">
                <strong>${w.word}</strong>
                <span class="fb-attrtag" style="background:${attrs[w.attr].color}; color:${readableTextColor(attrs[w.attr].color)};">${attrs[w.attr].label}</span>
              </span>
              <span class="fb-wordcard-meaning">${w.meaning}</span>
              <span class="fb-wordcard-stats">
                Lv.${w.stats.level}　解像度 ${w.stats.resolution}　耐性 ${w.stats.resistance}　HP ${w.stats.hp}/${w.stats.maxHp}
              </span>
            </button>
          `).join('')}
        </div>
        <button class="fb-reset" onclick="G.screen='title'; render();">部屋を出る</button>
      </div>`;
    return;
  }

  if (G.screen === 'wortzimmerTalk') {
    const w = G.lastTalkSubject;
    const returnLabel = G.talkReturnTo === 'wortzimmer' ? '部屋に戻る' : '拠点へ戻る';
    const returnAction = G.talkReturnTo === 'wortzimmer' ? 'openWortzimmer()' : "G.screen='title'; render();";
    app.innerHTML = `
      <div class="fb-wortzimmer-talk">
        <p class="fb-talk-name">${w.word}</p>
        <p class="fb-talk-line">${G.lastTalkLine || '今は、特に話すことは無いようだ。'}</p>
        <button onclick="${returnAction}">${returnLabel}</button>
      </div>`;
    return;
  }

  if (G.screen === 'observe') {
    renderObserve(app);
    return;
  }

  if (G.screen === 'overflow') {
    renderOverflow(app);
    return;
  }

  if (G.screen === 'result_faint') {
    app.innerHTML = `
      <div class="fb-result">
        <p>光に当てられ、何も持たずに戻ってきた——いや、一つだけ。</p>
        ${G.lastKept ? `<p class="fb-kept">${G.lastKept.word}（${G.lastKept.meaning}）だけを、握りしめていた。</p>` : '<p class="fb-kept">何も握っていなかった。</p>'}
        <button onclick="backToTitleAfterResult()">拠点へ戻る</button>
      </div>`;
    return;
  }

  if (G.screen === 'result_finish') {
    app.innerHTML = `
      <div class="fb-result">
        <p>${G.lastFinished.word}（${G.lastFinished.meaning}）を、また見届けた。</p>
        ${G.lastGotPart ? '<p class="fb-gotpart">足元に、小さな部品が落ちていた。</p>' : ''}
        ${G.lastLeveledUp ? '<p class="fb-levelup">経験が積み重なり、力が増した。</p>' : ''}
        <button onclick="continueAfterFinish()">拠点へ戻る</button>
      </div>`;
    return;
  }

  if (G.screen === 'quiz') {
    app.innerHTML = `
      <div class="fb-quiz">
        <p class="fb-quiz-prompt">${G.quiz.subject.word} は、何を意味しているのだろう？</p>
        <div class="fb-quiz-options">
          ${G.quiz.optionSubjects.map((s, i) => `<button onclick="answerMeaningQuiz(${i})">${s.meaning}</button>`).join('')}
        </div>
      </div>`;
    return;
  }

  if (G.screen === 'quizResult') {
    const s = G.lastQuizSubject;
    app.innerHTML = `
      <div class="fb-quizresult">
        <p>${G.lastQuizResult
          ? `${s.word}は、あなたと行動することを選んだようだ。`
          : 'まだ、お互いに見えていない部分が多いらしい。'}</p>
        ${G.lastQuizResult ? `<p class="fb-meaning">${s.word} — ${s.meaning}</p>` : ''}
        ${G.lastGotPart ? '<p class="fb-gotpart">足元に、小さな部品が落ちていた。</p>' : ''}
        ${G.lastGardenUnlocked ? `<p class="fb-gardenline">${s.gardenLine}</p>` : ''}
        <button onclick="continueAfterFinish()">拠点へ戻る</button>
      </div>`;
    return;
  }
}

function renderOpening(app) {
  const o = G.opening;

  if (o.stage === 'wake') {
    app.innerHTML = `
      <div class="fb-opening">
        <p class="fb-opening-text">観測所の近くで、目が覚める。</p>
        <p class="fb-opening-text">記憶は、ほとんど無い。</p>
        <p class="fb-opening-text">手の中に、壊れた方位磁針が一つ。針は定まらず、ただ静かに回り続けている。</p>
        <button onclick="openingObserveSelf()">磁針を、自分自身に向けてみる</button>
      </div>`;
    return;
  }

  if (o.stage === 'fragments') {
    app.innerHTML = `
      <div class="fb-opening">
        <p class="fb-opening-text">いくつかの音の断片が、ぼんやりと浮かび上がる。</p>
        <p class="fb-opening-hint">2〜4個選んで、つなげてください。</p>
        <div class="fb-fragment-pool">
          ${o.pool.map(f => `
            <button class="fb-fragment-btn ${o.chosen.includes(f.id) ? 'fb-selected' : ''}" onclick="toggleFragment('${f.id}')">${f.text}</button>
          `).join('')}
        </div>
        <p class="fb-fragment-preview">${o.chosen.map(id => o.pool.find(f => f.id === id).text).join('') || '……'}</p>
        <button onclick="confirmName()">この名前にする</button>
      </div>`;
    return;
  }
}

function renderObserve(app) {
  const o = G.obs;
  const attrs = G.data.attributes;
  const seesawPct = G.seesaw;
  const corrupted = seesawPct >= G.data.seesaw.uiCorruptionStart;

  let controls = '';
  if (!o.over) {
    if (!o.isImportant) {
      controls = `
        <div class="fb-observers">
          <p>${corruptText('どの観測員に見てもらうか', corrupted)}</p>
          ${G.party.map((p, i) => `
            <button class="fb-observer-btn" style="border-color:${attrs[p.attr].color}; background:${attrs[p.attr].color}1a;" onclick="selectObserverLight(${i})">
              ${p.isPlayer ? '私' : p.word}
              <span class="fb-observer-attr" style="color:${attrs[p.attr].color}">${attrs[p.attr].label}</span>
            </button>
          `).join('')}
        </div>`;
    } else {
      controls = `
        <div class="fb-important">
          <p>${corruptText('観測員と手法を選ぶ', corrupted)}</p>
          <div class="fb-observers">
            ${G.party.map((p, i) => `
              <button class="fb-observer-btn ${o.tempObserverIndex === i ? 'fb-selected' : ''}" style="border-color:${attrs[p.attr].color}; background:${attrs[p.attr].color}1a;" onclick="G.obs.tempObserverIndex=${i}; render();">
                ${p.isPlayer ? '私' : p.word}
                <span class="fb-observer-attr" style="color:${attrs[p.attr].color}">${attrs[p.attr].label}</span>
              </button>
            `).join('')}
          </div>
          <div class="fb-methods">
            ${G.data.methods.list.map(m => `
              <button onclick="if(G.obs.tempObserverIndex!=null){commandObserve(G.obs.tempObserverIndex,'${m.id}');}else{alert('先に観測員を選んでください');}">${corruptText(m.name, corrupted)}<br><small>${m.desc}</small></button>
            `).join('')}
          </div>
        </div>`;
    }
  }

  app.innerHTML = `
    <div class="fb-observe ${corrupted ? 'fb-corrupted' : ''}">
      <div class="fb-subject" style="border-color:${attrs[o.subject.attr].color}">
        <span class="fb-attrtag" style="background:${attrs[o.subject.attr].color}; color:${readableTextColor(attrs[o.subject.attr].color)};">${attrs[o.subject.attr].label}</span>
        <strong>${o.subject.word}</strong>
        <div class="fb-fogbar"><div class="fb-fogfill" style="width:${o.fog}%"></div></div>
        <p class="fb-foglabel">不透明度 ${o.fog}%</p>
      </div>

      <div class="fb-seesaw">
        <span class="fb-seesaw-label-left">明晰さ</span>
        <div class="fb-seesawbar">
          <div class="fb-seesawfill" style="width:${seesawPct}%"></div>
        </div>
        <span class="fb-seesaw-label-right">残響</span>
      </div>

      ${controls}

      <div class="fb-log">${o.fragments.slice(-4).map(f => `<p>${f}</p>`).join('')}</div>
    </div>`;
}

// シーソーが侵食域に入ると、ボタン等のテキストにドイツ語を薄く混ぜる(簡易演出)
const CORRUPT_MAP = {
  'どの観測員に見てもらうか': 'wer sieht',
  '観測員と手法を選ぶ': 'wer und wie',
  'Blick（一瞥）': 'der Blick',
  'Lauschen（耳を澄ます）': 'das Lauschen',
  'Abwarten（待つ）': 'das Abwarten'
};
function corruptText(text, corrupted) {
  if (!corrupted) return text;
  const alt = CORRUPT_MAP[text];
  if (!alt) return text;
  return `<span class="fb-corrupt-pair"><span class="fb-corrupt-jp">${text}</span><span class="fb-corrupt-de">${alt}</span></span>`;
}

function renderOverflow(app) {
  app.innerHTML = `
    <div class="fb-overflow">
      <div class="fb-flash"></div>
      <p class="fb-overflow-text">見てはいけないものを、見すぎた。</p>
      <button onclick="confirmFaintedReturn()">目を覚ます</button>
    </div>`;
}

// ------------------------------------------------------------
// 検証用リセット
// ------------------------------------------------------------
function resetSave() {
  if (!confirm('記憶している言葉も、あなたの名前も、すべて消えます。よろしいですか？')) return;
  localStorage.removeItem('wetterleuchten_save');
  G.knownWords = [];
  G.seesaw = 0;
  G.afterEffect = false;
  G.playerName = null;
  startOpening();
}

window.addEventListener('DOMContentLoaded', init);
