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
  gardenUnlocked: false  // Raunenの依頼を受けたかどうか(永続)
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
// 観測対象を選んで遭遇する(プロトタイプ用の簡易入口)
// ------------------------------------------------------------
function encounterRandomSubject() {
  assembleParty();
  const pool = G.data.subjects.filter(s => !s.important);
  const rates = G.data.rareSpawnRates;
  let subject;
  if (Math.random() < rates.plural) {
    subject = pool.find(s => s.attr === 'plural');
  } else {
    const normals = pool.filter(s => s.attr !== 'plural');
    subject = normals[Math.floor(Math.random() * normals.length)];
  }
  startObservation(subject, false);
}

function encounterImportantSubject() {
  assembleParty();
  const subject = G.data.subjects.find(s => s.important);
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

  // 観測の合間に、素材(部品)を拾うことがある
  let gotPart = false;
  if (Math.random() < 0.35) {
    G.parts++;
    gotPart = true;
    persistSave();
  }
  G.lastGotPart = gotPart;

  if (G.knownWords.find(k => k.word === w.word)) {
    // 既に定着している対象でも、庭への誘いをまだ受け取っていなければここで渡す
    if (w.unlocksGarden && !G.gardenUnlocked) {
      G.gardenUnlocked = true;
      persistSave();
      G.lastQuizResult = true;
      G.lastQuizSubject = w;
      G.lastGardenUnlocked = true;
      G.screen = 'quizResult';
      return;
    }
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
      G.knownWords.push({ ...subject });
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

function backToTitleAfterResult() {
  advanceClock();
  G.afterEffect = false; // 1回休んだことで後遺症は解消(簡易処理)
  G.obs = null;
  G.screen = 'title';
  render();
}

function continueAfterFinish() {
  advanceClock();
  G.obs = null;
  G.screen = 'title';
  render();
}

// ------------------------------------------------------------
// 拠点(観測所)の描画
// ------------------------------------------------------------

// フェーズごとの地面の色味だけを淡く変化させる。観測所の他の要素は固定。
// フェーズごとの色温度オーバーレイ。画像自体は変えず、薄い色を重ねて表情を変える。
const PHASE_OVERLAY = {
  '夜明け': 'rgba(242, 220, 210, 0.18)',
  '昼':     'rgba(238, 243, 238, 0.08)',
  '夕暮れ': 'rgba(214, 150, 110, 0.22)',
  '夜':     'rgba(40, 38, 60, 0.38)'
};

function renderObservatoryImage(phase) {
  const overlay = PHASE_OVERLAY[phase] || PHASE_OVERLAY['昼'];
  return `
    <div class="fb-observatory-photo">
      <img src="assets/door-book.jpg" alt="扉の前に落ちている本" />
      <div class="fb-observatory-overlay" style="background:${overlay}"></div>
    </div>`;
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
    app.innerHTML = `
      <div class="fb-title">
        <h1>${G.data.meta.title}</h1>
        <p class="fb-sub">${G.data.meta.subtitle}</p>
        ${G.playerName ? `<p class="fb-playername">${G.playerName}</p>` : ''}

        ${renderObservatoryImage(phase)}
        <p class="fb-phase-label">今は${phase}</p>

        ${renderEnvironmentDetails(phase)}
        ${renderInstrumentPanel()}

        <button class="fb-openbook-btn" onclick="openBook()">扉の前に落ちている本を開く</button>
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
