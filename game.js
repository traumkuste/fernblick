// ============================================================
// Fernblick — prototype core
// 戦闘ではなく「観測」。倒すのではなく、不透明度を下げて記録する。
// ============================================================

const G = {
  data: null,
  screen: 'title',
  knownWords: [],     // 永続的な知識(localStorage)
  seesaw: 0,           // 0=完全な明晰さ, 100=完全な残響
  afterEffect: false,  // 直前の気絶による軽い後遺症フラグ
  obs: null            // 現在進行中の観測の状態
};

// ------------------------------------------------------------
// 初期化
// ------------------------------------------------------------
async function init() {
  const res = await fetch('data.json');
  G.data = await res.json();
  loadSave();
  render();
}

function loadSave() {
  try {
    const saved = JSON.parse(localStorage.getItem('fernblick_save') || '{}');
    G.knownWords = saved.knownWords || [];
  } catch (e) {
    console.warn('save load failed', e);
  }
}

function persistSave() {
  localStorage.setItem('fernblick_save', JSON.stringify({
    knownWords: G.knownWords
  }));
}

// ------------------------------------------------------------
// 観測対象を選んで遭遇する(プロトタイプ用の簡易入口)
// ------------------------------------------------------------
function encounterRandomSubject() {
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
    selectedViewpoint: null
  };
  G.screen = 'observe';
  render();
}

// ------------------------------------------------------------
// 通常観測: 視点を選ぶだけ→自動進行
// ------------------------------------------------------------
function pickViewpointLight(attr) {
  G.obs.selectedViewpoint = attr;
  runLightObservationAuto();
}

function runLightObservationAuto() {
  const o = G.obs;
  const interval = setInterval(() => {
    if (o.over) { clearInterval(interval); render(); return; }
    o.turn++;

    const mult = getMultiplier(o.selectedViewpoint, o.subject.attr);
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
function commandObserve(attr, methodId) {
  const o = G.obs;
  if (o.over) return;
  const method = G.data.methods.list.find(m => m.id === methodId);

  const mult = getMultiplier(attr, o.subject.attr);
  const resistance = o.subject.fogResistance != null ? o.subject.fogResistance : 1;
  const fogDrop = Math.round(10 * method.fogPower * mult * resistance);
  o.fog = Math.max(0, o.fog - fogDrop);
  o.selectedViewpoint = attr;
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
  const label = method ? `${method.name}で` : '';
  o.fragments.push(`${label}${clarity}。不透明度 ${o.fog}%`);
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

  if (correct) {
    if (!G.knownWords.find(k => k.word === subject.word)) {
      G.knownWords.push({ ...subject });
      persistSave();
    }
  }
  G.lastQuizResult = correct;
  G.lastQuizSubject = subject;
  G.screen = 'quizResult';
  render();
}

function backToTitleAfterResult() {
  G.afterEffect = false; // 1回休んだことで後遺症は解消(簡易処理)
  G.obs = null;
  G.screen = 'title';
  render();
}

function continueAfterFinish() {
  G.obs = null;
  G.screen = 'title';
  render();
}

// ------------------------------------------------------------
// 描画
// ------------------------------------------------------------
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (G.screen === 'title') {
    app.innerHTML = `
      <div class="fb-title">
        <h1>Fernblick</h1>
        <p class="fb-sub">遠い眺め</p>
        <button onclick="encounterRandomSubject()">観測に出る</button>
        <button onclick="encounterImportantSubject()">重要な観測へ（Wetterleuchten）</button>
        <p class="fb-known">記憶している言葉: ${G.knownWords.length}語</p>
        ${G.afterEffect ? '<p class="fb-aftereffect">まだ光の名残がある。明晰さの回復が少し遅い。</p>' : ''}
        <button class="fb-reset" onclick="resetSave()">記憶をすべて消す（検証用）</button>
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
        <button onclick="continueAfterFinish()">拠点へ戻る</button>
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
        <div class="fb-viewpoints">
          <p>${corruptText('どの視点で見るか', corrupted)}</p>
          ${Object.entries(attrs).map(([k, v]) => `
            <button class="fb-viewpoint-btn" style="border-color:${v.color}; background:${v.color}1a;" onclick="pickViewpointLight('${k}')">${corruptText(v.label, corrupted)}</button>
          `).join('')}
        </div>`;
    } else {
      controls = `
        <div class="fb-important">
          <p>${corruptText('視点と手法を選ぶ', corrupted)}</p>
          <div class="fb-viewpoints">
            ${Object.entries(attrs).map(([k, v]) => `
              <button class="fb-viewpoint-btn ${o.tempViewpoint === k ? 'fb-selected' : ''}" style="border-color:${v.color}; background:${v.color}1a;" onclick="G.obs.tempViewpoint='${k}'; render();">${v.label}</button>
            `).join('')}
          </div>
          <div class="fb-methods">
            ${G.data.methods.list.map(m => `
              <button onclick="if(G.obs.tempViewpoint){commandObserve(G.obs.tempViewpoint,'${m.id}');}else{alert('先に視点を選んでください');}">${corruptText(m.name, corrupted)}<br><small>${m.desc}</small></button>
            `).join('')}
          </div>
        </div>`;
    }
  }

  app.innerHTML = `
    <div class="fb-observe ${corrupted ? 'fb-corrupted' : ''}">
      <div class="fb-subject" style="border-color:${attrs[o.subject.attr].color}">
        <span class="fb-attrtag" style="background:${attrs[o.subject.attr].color}">${attrs[o.subject.attr].label}</span>
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
  'どの視点で見るか': 'welche Sicht',
  'der（衝動）': 'der',
  'die（流れ）': 'die',
  'das（静止）': 'das',
  'Plural（群れ）': 'Plural',
  '無冠詞（名）': '——',
  '視点と手法を選ぶ': 'Sicht und Methode',
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
  if (!confirm('記憶している言葉が、すべて消えます。よろしいですか？')) return;
  localStorage.removeItem('fernblick_save');
  G.knownWords = [];
  G.seesaw = 0;
  G.afterEffect = false;
  G.screen = 'title';
  render();
}

window.addEventListener('DOMContentLoaded', init);
