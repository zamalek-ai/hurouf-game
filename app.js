/* ===========================================================
   حروف 🎯 — منطق اللعبة الرئيسي (app.js)
   -----------------------------------------------------------
   - إدارة الشاشات والتنقل
   - حالة اللاعب المحلي والغرفة
   - منطق اللعب: إدخال الإجابات، المؤقت، COMPLETED
   - احتساب النقاط تلقائيًا
   - عرض النتائج والترتيب
   - الأصوات والمؤثرات
   =========================================================== */

(function () {
  'use strict';

  /* ===========================================================
     1) الإعدادات والثوابت
     =========================================================== */

  // الخانات الافتراضية
  const DEFAULT_CATEGORIES = [
    { id: 'girl',  name: 'بنت',   emoji: '👧' },
    { id: 'boy',   name: 'ولد',   emoji: '👦' },
    { id: 'animal',name: 'حيوان', emoji: '🐾' },
    { id: 'object',name: 'جماد',  emoji: '🧱' },
    { id: 'country',name: 'بلد',  emoji: '🌍' },
    { id: 'food',  name: 'أكل',   emoji: '🍎' },
    { id: 'plant', name: 'نبات',  emoji: '🌿' },
    { id: 'job',   name: 'مهنة',  emoji: '💼' }
  ];

  // الحروف العربية المتاحة (تجنّب الحروف النادرة جدًا)
  const ARABIC_LETTERS = ['أ','ب','ت','ج','ح','خ','د','ر','س','ش','ص','ع','ف','ق','ك','ل','م','ن','ه','و','ي'];

  // أنظمة النقاط
  const SCORING_MODES = {
    standard: { unique: 10, duplicate: 5, wrong: 0 },
    strict:   { unique: 15, duplicate: 0, wrong: 0 },
    lenient:  { unique: 10, duplicate: 7, wrong: 3 }
  };

  // ثوانٍ إضافية بعد أول COMPLETED
  const COUNTDOWN_AFTER_COMPLETE = 10;

  /* ===========================================================
     2) الحالة العامة
     =========================================================== */
  const state = {
    playerId: null,
    playerName: '',
    roomCode: null,
    isHost: false,
    room: null,
    players: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c, enabled: true })),
    selectedRounds: 5,        // 0 = مفتوح
    selectedDuration: 60,
    scoringMode: 'standard',
    answers: {},              // { categoryId: 'value' }
    completed: false,         // هل ضغط هذا اللاعب COMPLETED؟
    timer: null,
    timeLeft: 0,
    currentRound: 0,
    soundEnabled: true,
    audioCtx: null
  };

  /* ===========================================================
     3) أدوات DOM مساعدة
     =========================================================== */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#' + id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  /* ===========================================================
     4) الأصوات (Web Audio API — بدون ملفات خارجية)
     =========================================================== */
  function ensureAudio() {
    if (state.audioCtx) return state.audioCtx;
    try {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { state.audioCtx = null; }
    return state.audioCtx;
  }

  function playTone(freq, duration = 0.15, type = 'sine', volume = 0.2) {
    if (!state.soundEnabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  // نغمات مناسبة لكل حدث
  const sounds = {
    click:      () => playTone(800, 0.05, 'square', 0.08),
    roundStart: () => { playTone(523, 0.12); setTimeout(() => playTone(659, 0.12), 130); setTimeout(() => playTone(784, 0.18), 260); },
    letterShow: () => { playTone(440, 0.1); setTimeout(() => playTone(660, 0.15), 100); },
    tickWarn:   () => playTone(880, 0.08, 'sawtooth', 0.1),
    completed:  () => { playTone(880, 0.1); setTimeout(() => playTone(1100, 0.15), 110); },
    win:        () => { [523,659,784,1046].forEach((f,i) => setTimeout(() => playTone(f, 0.18), i*120)); },
    finalWin:   () => { [523,659,784,1046,1318].forEach((f,i) => setTimeout(() => playTone(f, 0.22, 'triangle', 0.18), i*140)); }
  };

  /* ===========================================================
     5) تطبيع النصوص العربية (لمقارنة عادلة للإجابات)
     =========================================================== */
  function normalizeArabic(text) {
    if (!text) return '';
    return text.toString().trim()
      .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
      .replace(/[إأآا]/g, 'ا')              // توحيد الألف
      .replace(/ى/g, 'ي')                   // ألف مقصورة → ياء
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')                   // تاء مربوطة → هاء
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // التحقق أن الإجابة تبدأ بالحرف المطلوب
  function isValidLetterMatch(answer, letter) {
    const a = normalizeArabic(answer);
    const l = normalizeArabic(letter);
    if (!a || a.length < 2) return false;       // تقبل على الأقل حرفين
    if (a === l) return false;                   // الإجابة = الحرف فقط غير مقبولة
    return a.startsWith(l);
  }

  /* ===========================================================
     6) توليد حرف عشوائي
     =========================================================== */
  function pickLetter(exclude = []) {
    const pool = ARABIC_LETTERS.filter(l => !exclude.includes(l));
    return pool[Math.floor(Math.random() * pool.length)] || ARABIC_LETTERS[0];
  }

  /* ===========================================================
     7) تهيئة شاشة الإنشاء (اختيار الخانات)
     =========================================================== */
  function initCategoriesSelector() {
    const container = $('#categories-selector');
    container.innerHTML = '';
    state.categories.forEach((cat, idx) => {
      const chip = document.createElement('button');
      chip.className = 'cat-chip' + (cat.enabled ? ' active' : '');
      chip.dataset.idx = idx;
      chip.innerHTML = `
        <span class="cat-emoji">${cat.emoji}</span>
        <span class="cat-name">${cat.name}</span>
        <span class="cat-check">${cat.enabled ? '✓' : ''}</span>
      `;
      chip.addEventListener('click', () => {
        if (!state.isHost && state.room) return; // غير مسموح بعد البدء
        cat.enabled = !cat.enabled;
        chip.classList.toggle('active', cat.enabled);
        chip.querySelector('.cat-check').textContent = cat.enabled ? '✓' : '';
        sounds.click();
      });
      container.appendChild(chip);
    });
  }

  /* ===========================================================
     8) ربط أزرار Segmented (عدد الجولات، المدة)
     =========================================================== */
  function initSegmented() {
    $$('.segmented').forEach(seg => {
      const name = seg.dataset.name;
      seg.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const val = parseInt(btn.dataset.value, 10);
          if (name === 'rounds') state.selectedRounds = val;
          else if (name === 'duration') state.selectedDuration = val;
          sounds.click();
        });
      });
    });
    $('#scoring-mode').addEventListener('change', e => {
      state.scoringMode = e.target.value;
    });
  }

  /* ===========================================================
     9) ربط أزرار الإجراءات العامة (data-action)
     =========================================================== */
  function bindActions() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      sounds.click();
      switch (action) {
        case 'go-create':     showScreen('screen-create'); break;
        case 'go-join':       showScreen('screen-join'); break;
        case 'open-howto':    $('#modal-howto').classList.remove('hidden'); break;
        case 'close-howto':   $('#modal-howto').classList.add('hidden'); break;
        case 'back-home':     goHome(); break;
        case 'back-home-final': resetLocalState(); showScreen('screen-home'); break;
        case 'create-room':   handleCreateRoom(); break;
        case 'join-room':    handleJoinRoom(); break;
        case 'copy-code':     copyRoomCode(); break;
        case 'share-code':   shareRoomCode(); break;
        case 'leave-room':   handleLeaveRoom(); break;
        case 'next-round':   handleNextRound(); break;
        case 'play-again':   handlePlayAgain(); break;
      }
    });

    // زر كتم/تشغيل الصوت
    $('#sound-toggle-home').addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      $('.sound-on').classList.toggle('hidden', !state.soundEnabled);
      $('.sound-off').classList.toggle('hidden', state.soundEnabled);
      if (state.soundEnabled) sounds.click();
    });

    // زر COMPLETED
    $('#btn-completed').addEventListener('click', handleCompleted);

    // Enter على شاشة الدخول
    $('#join-code').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  }

  /* ===========================================================
     10) إنشاء غرفة
     =========================================================== */
  async function handleCreateRoom() {
    const name = $('#create-name').value.trim();
    if (!name) { toast('اكتب اسمك أولاً', 'error'); return; }

    const enabledCats = state.categories.filter(c => c.enabled);
    if (enabledCats.length < 3) { toast('اختر 3 خانات على الأقل', 'error'); return; }

    state.playerName = name;
    state.isHost = true;

    const settings = {
      totalRounds: state.selectedRounds,
      roundDuration: state.selectedDuration,
      categories: enabledCats,
      scoringMode: state.scoringMode
    };

    try {
      const { roomCode, playerId } = await HuroufSync.createRoom({ hostName: name, settings });
      state.roomCode = roomCode;
      state.playerId = playerId;
      state.categories = enabledCats;
      enterRoomScreen();
    } catch (e) {
      toast(e.message || 'فشل إنشاء الغرفة', 'error');
    }
  }

  /* ===========================================================
     11) الانضمام لغرفة
     =========================================================== */
  async function handleJoinRoom() {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!name) { toast('اكتب اسمك', 'error'); return; }
    if (code.length < 6) { toast('كود الغرفة يجب أن يكون 6 أحرف', 'error'); return; }

    state.playerName = name;
    state.isHost = false;

    try {
      const { room, playerId } = await HuroufSync.joinRoom({ roomCode: code, playerName: name });
      state.roomCode = code;
      state.playerId = playerId;
      state.room = room;
      state.categories = room.categories || state.categories;
      state.selectedRounds = room.total_rounds || 5;
      state.selectedDuration = room.round_duration || 60;
      state.scoringMode = room.scoring_mode || 'standard';
      enterRoomScreen();
    } catch (e) {
      $('#join-error').textContent = e.message || 'تعذر الانضمام';
      $('#join-error').classList.remove('hidden');
    }
  }

  /* ===========================================================
     12) شاشة الغرفة
     =========================================================== */
  function enterRoomScreen() {
    showScreen('screen-room');
    $('#room-code').textContent = state.roomCode || '------';
    $('#room-rounds-display').textContent = state.selectedRounds === 0 ? '∞' : state.selectedRounds;
    $('#room-duration-display').textContent = state.selectedDuration;
    renderPlayersList();
    updateStartButton();

    // ربط زر البدء
    $('#btn-start-game').onclick = handleStartGame;
  }

  function renderPlayersList() {
    const list = $('#players-list');
    const players = state.players;
    $('#players-list-count').textContent = players.length;
    $('#room-players-count').textContent = players.length;
    list.innerHTML = '';
    if (!players.length) {
      list.innerHTML = '<li class="hint">لا يوجد لاعبون بعد...</li>';
      return;
    }
    const colors = ['7c4dff','ff4d8d','00e0c6','fbbf24','34d399','f87171','60a5fa','f472b6'];
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-row' + (p.isHost ? ' is-host' : '');
      const initial = (p.name || '?').trim().charAt(0).toUpperCase();
      const color = '#' + colors[i % colors.length];
      const isMe = p.id === state.playerId;
      const status = p.ready ? '🟢 جاهز' : '⏳ غير جاهز';
      li.innerHTML = `
        <div class="player-avatar" style="background:${color}">${initial}</div>
        <div class="player-name">${escapeHtml(p.name)}${isMe ? ' (أنت)' : ''}</div>
        ${p.isHost ? '<span class="player-host-badge">صاحب الغرفة</span>' : ''}
        <span class="player-status ${p.ready ? 'ready' : ''}">${status}</span>
      `;
      list.appendChild(li);
    });
  }

  function updateStartButton() {
    const btn = $('#btn-start-game');
    const waiting = $('#room-waiting');
    if (state.isHost) {
      btn.classList.remove('hidden');
      waiting.classList.add('hidden');
      const otherPlayers = state.players.filter(p => p.id !== state.playerId);
      btn.disabled = otherPlayers.length === 0;
      btn.textContent = otherPlayers.length === 0 ? 'في انتظار لاعبين آخرين...' : '🎮 ابدأ اللعبة';
    } else {
      btn.classList.add('hidden');
      waiting.classList.remove('hidden');
      waiting.textContent = 'في انتظار أن يبدأ صاحب الغرفة اللعبة...';
    }
  }

  /* ===========================================================
     13) بدء اللعبة
     =========================================================== */
  async function handleStartGame() {
    if (!state.isHost) return;
    const enabledCats = state.categories.filter(c => c.enabled);
    if (enabledCats.length < 3) { toast('اختر 3 خانات على الأقل', 'error'); return; }
    state.categories = enabledCats;
    await startNewRound(1);
  }

  async function startNewRound(roundNumber) {
    const usedLetters = (state.usedLetters || []);
    const letter = pickLetter(usedLetters);
    state.usedLetters = [...usedLetters, letter];
    state.currentRound = roundNumber;
    state.answers = {};
    state.completed = false;

    try {
      await HuroufSync.startRound({ letter, roundNumber });
    } catch (e) {
      console.error(e);
      toast('فشل بدء الجولة', 'error');
    }
  }

  /* ===========================================================
     14) شاشة اللعب
     =========================================================== */
  function enterPlayScreen(roundNumber, letter, room) {
    $('#current-round').textContent = roundNumber;
    $('#total-rounds').textContent = (state.selectedRounds === 0 ? '∞' : state.selectedRounds);
    $('#current-letter').textContent = letter;
    $('#hint-letter').textContent = letter;
    $('#timer-text').textContent = state.selectedDuration;

    // أعد بناء حقول الإجابات
    const grid = $('#answers-grid');
    grid.innerHTML = '';
    state.categories.forEach(cat => {
      const cell = document.createElement('div');
      cell.className = 'answer-cell';
      cell.dataset.cat = cat.id;
      cell.innerHTML = `
        <div class="cat-icon">${cat.emoji}</div>
        <input type="text"
               data-cat="${cat.id}"
               placeholder="${cat.name}..."
               autocomplete="off"
               ${state.completed ? 'disabled' : ''} />
      `;
      const input = cell.querySelector('input');
      input.value = state.answers[cat.id] || '';
      input.addEventListener('input', e => {
        state.answers[cat.id] = e.target.value;
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          // انتقل للحقل التالي
          const inputs = $$('#answers-grid input');
          const idx = inputs.indexOf(input);
          if (idx >= 0 && idx + 1 < inputs.length) inputs[idx + 1].focus();
        }
      });
      grid.appendChild(cell);
    });

    // زر COMPLETED
    const btnDone = $('#btn-completed');
    btnDone.disabled = false;
    btnDone.classList.remove('hidden');
    $('#completed-notice').classList.remove('show');
    $('#completed-notice').classList.add('hidden');

    showScreen('screen-play');

    // أعد تشغيل حركة ظهور الحرف
    const letterEl = $('#current-letter');
    letterEl.classList.remove('show');
    void letterEl.offsetWidth; // إعادة التدفق
    letterEl.classList.add('show');
    sounds.letterShow();

    // ابدأ المؤقت
    startTimer(state.selectedDuration);
  }

  /* ===========================================================
     15) المؤقت
     =========================================================== */
  function startTimer(duration) {
    stopTimer();
    state.timeLeft = duration;
    updateTimerUI();
    state.timer = setInterval(() => {
      state.timeLeft--;
      updateTimerUI();
      if (state.timeLeft <= 5 && state.timeLeft > 0) sounds.tickWarn();
      if (state.timeLeft <= 0) {
        stopTimer();
        onTimeUp();
      }
    }, 1000);
  }

  function startCountdown(seconds) {
    // عداد تنازلي بعد أول COMPLETED
    stopTimer();
    state.timeLeft = seconds;
    updateTimerUI();
    state.timer = setInterval(() => {
      state.timeLeft--;
      updateTimerUI();
      if (state.timeLeft <= 5 && state.timeLeft > 0) sounds.tickWarn();
      if (state.timeLeft <= 0) {
        stopTimer();
        onTimeUp();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function updateTimerUI() {
    const txt = $('#timer-text');
    const circle = $('#timer-circle');
    const wrap = circle.parentElement.parentElement;
    txt.textContent = state.timeLeft;
    const ratio = state.timeLeft / state.selectedDuration;
    const circumference = 283; // 2π × 45
    circle.style.strokeDashoffset = circumference * (1 - Math.max(0, ratio));
    wrap.classList.remove('warning', 'danger');
    if (state.timeLeft <= 5) wrap.classList.add('danger');
    else if (state.timeLeft <= 15) wrap.classList.add('warning');
  }

  /* ===========================================================
     16) ضغط COMPLETED
     =========================================================== */
  async function handleCompleted() {
    if (state.completed) return;
    state.completed = true;

    // عطّل حقول الإدخال
    $$('#answers-grid input').forEach(i => i.disabled = true);
    $('#btn-completed').disabled = true;

    sounds.completed();

    // أرسل الإجابات وأعلن الانتهاء
    try {
      await HuroufSync.submitAnswers(state.answers, true);
      await HuroufSync.announceCompletion();
    } catch (e) {
      console.error(e);
      toast('فشل إرسال الإجابات', 'error');
    }

    // ابدأ عدًا تنازليًا قصيرًا (10 ثوانٍ) ثم أنهِ الجولة تلقائيًا
    // هذا يضمن أن الجولة تنتهي حتى لو كان هذا هو اللاعب الوحيد
    startCountdown(COUNTDOWN_AFTER_COMPLETE);
  }

  function onTimeUp() {
    // انتهى الوقت — أرسل ما لدينا وأغلق الجولة
    if (!state.completed) {
      state.completed = true;
      $$('#answers-grid input').forEach(i => i.disabled = true);
      $('#btn-completed').disabled = true;
      HuroufSync.submitAnswers(state.answers, false).catch(console.error);
    }
    // الـ host سيلخص النتائج
    maybeFinalizeRound();
  }

  /* ===========================================================
     17) إنهاء الجولة واحتساب النقاط (يديره الـ host)
     =========================================================== */
  async function maybeFinalizeRound() {
    if (!state.isHost) return;
    if (state.room && state.room.roundFinalized) return;

    // انتظر قليلًا للتأكد من استلام كل الإجابات (1.5 ثانية)
    setTimeout(async () => {
      try {
        const answers = await HuroufSync.getRoundAnswers(state.currentRound);
        const scores = computeScores(answers);
        await HuroufSync.finalizeRound(scores);
      } catch (e) {
        console.error('finalizeRound error:', e);
      }
    }, 1500);
  }

  function computeScores(answersList) {
    const mode = SCORING_MODES[state.scoringMode] || SCORING_MODES.standard;
    const letter = state.room?.currentLetter || '';
    const enabledCats = state.categories.map(c => c.id);

    // اجمع كل القيم لكل خانة لاكتشاف التكرار
    const valuesByCat = {}; // { cat: [{ playerId, value }] }
    enabledCats.forEach(cat => valuesByCat[cat] = []);
    answersList.forEach(a => {
      enabledCats.forEach(cat => {
        const v = a.answers?.[cat];
        if (v) valuesByCat[cat].push({ playerId: a.playerId, playerName: a.playerName, value: v });
      });
    });

    // احسب نقاط كل لاعب
    return answersList.map(ans => {
      const perCat = {};
      let roundScore = 0;
      enabledCats.forEach(cat => {
        const v = ans.answers?.[cat] || '';
        const norm = normalizeArabic(v);
        let points = 0;
        if (!norm) {
          points = 0; // خانة فارغة
        } else if (!isValidLetterMatch(v, letter)) {
          points = mode.wrong; // لا تبدأ بالحرف
        } else {
          // هل هي مكررة؟
          const allVals = valuesByCat[cat].map(x => normalizeArabic(x.value));
          const isDup = allVals.filter(x => x === norm).length > 1;
          points = isDup ? mode.duplicate : mode.unique;
        }
        perCat[cat] = points;
        roundScore += points;
      });
      return { playerId: ans.playerId, playerName: ans.playerName, scores: perCat, roundScore };
    });
  }

  /* ===========================================================
     18) شاشة النتائج
     =========================================================== */
  async function enterResultsScreen(round, scores, players) {
    $('#results-round').textContent = round;

    // رتّب اللاعبين حسب نقاط الجولة
    const sorted = [...scores].sort((a, b) => b.roundScore - a.roundScore);
    const winner = sorted[0];

    // بانر بطل الجولة
    const banner = $('#round-winner-banner');
    if (winner && winner.roundScore > 0) {
      banner.classList.remove('hidden');
      $('#round-winner-name').textContent = winner.playerName;
      if (winner.playerId === state.playerId) sounds.win();
    } else {
      banner.classList.add('hidden');
    }

    // الجدول
    const table = $('#results-table');
    table.innerHTML = '';
    sorted.forEach((s, idx) => {
      const card = document.createElement('div');
      card.className = 'result-card' + (idx === 0 && s.roundScore > 0 ? ' winner' : '');
      const player = players.find(p => p.id === s.playerId);
      const totalScore = player ? (player.totalScore || 0) : 0;

      let rowsHTML = '';
      state.categories.forEach(cat => {
        const ans = scores.find(x => x.playerId === s.playerId)?.answers?.[cat.id] || '';
        const pts = s.scores?.[cat.id] ?? 0;
        const ptsClass = pts >= (SCORING_MODES[state.scoringMode].unique) ? 'unique' :
                         pts > 0 ? 'dup' : 'zero';
        rowsHTML += `
          <div class="result-answer-row">
            <span class="ans-emoji">${cat.emoji}</span>
            <span class="ans-text ${ans ? '' : 'empty'}">${ans ? escapeHtml(ans) : '—'}</span>
            <span class="ans-points ${ptsClass}">${pts}</span>
          </div>
        `;
      });

      const rankEmoji = ['🥇','🥈','🥉'][idx] || (idx + 1);
      card.innerHTML = `
        <div class="result-card-header">
          <div class="rank">${rankEmoji}</div>
          <div class="player-name">${escapeHtml(s.playerName)}${s.playerId === state.playerId ? ' (أنت)' : ''}</div>
          <div class="player-score">
            +${s.roundScore}
            <div class="small">المجموع ${totalScore}</div>
          </div>
        </div>
        <div class="result-answers">${rowsHTML}</div>
      `;
      table.appendChild(card);
    });

    // زر الجولة التالية
    const nextBtn = $$('[data-action="next-round"]')[0];
    if (state.isHost) {
      nextBtn.disabled = false;
      nextBtn.classList.remove('hidden');
      const isLastRound = state.selectedRounds !== 0 && state.currentRound >= state.selectedRounds;
      nextBtn.querySelector('span').textContent = isLastRound ? '🏆 إنهاء اللعبة' : 'الجولة التالية ←';
    } else {
      nextBtn.disabled = true;
      nextBtn.querySelector('span').textContent = 'في انتظار الـ host...';
    }

    showScreen('screen-results');
  }

  async function handleNextRound() {
    if (!state.isHost) return;
    const isLastRound = state.selectedRounds !== 0 && state.currentRound >= state.selectedRounds;
    if (isLastRound) {
      await HuroufSync.endGame();
    } else {
      await startNewRound(state.currentRound + 1);
    }
  }

  /* ===========================================================
     19) شاشة النهاية
     =========================================================== */
  function enterFinalScreen(players) {
    const sorted = [...players].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    // منصة التتويج (أعلى 3)
    const podium = $('#final-podium');
    podium.innerHTML = '';
    const top3 = sorted.slice(0, 3);
    const podiumClasses = ['gold', 'silver', 'bronze'];
    const podiumRanks = ['🥇','🥈','🥉'];
    // ترتيب العرض: silver | gold | bronze
    const order = [1, 0, 2].filter(i => top3[i]);
    order.forEach(i => {
      const p = top3[i];
      const spot = document.createElement('div');
      spot.className = 'podium-spot ' + podiumClasses[i];
      const initial = (p.name || '?').charAt(0).toUpperCase();
      spot.innerHTML = `
        <div class="podium-rank">${podiumRanks[i]}</div>
        <div class="player-avatar" style="background:#fff;color:#333">${initial}</div>
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-score">${p.totalScore || 0}</div>
      `;
      podium.appendChild(spot);
    });

    // الجدول الكامل
    const table = $('#final-table');
    table.innerHTML = '';
    sorted.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'result-card' + (idx === 0 ? ' winner' : '');
      const rankEmoji = ['🥇','🥈','🥉'][idx] || (idx + 1);
      card.innerHTML = `
        <div class="result-card-header">
          <div class="rank">${rankEmoji}</div>
          <div class="player-name">${escapeHtml(p.name)}${p.id === state.playerId ? ' (أنت)' : ''}</div>
          <div class="player-score">${p.totalScore || 0}</div>
        </div>
      `;
      table.appendChild(card);
    });

    showScreen('screen-final');

    // confetti + صوت
    launchConfetti();
    if (sorted[0] && sorted[0].id === state.playerId) {
      sounds.finalWin();
    } else {
      sounds.win();
    }
  }

  function launchConfetti() {
    const colors = ['#7c4dff','#ff4d8d','#00e0c6','#fbbf24','#34d399','#f87171'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDuration = (2 + Math.random() * 2) + 's';
      c.style.animationDelay = (Math.random() * 0.6) + 's';
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  /* ===========================================================
     20) إعادة اللعب
     =========================================================== */
  async function handlePlayAgain() {
    if (!state.isHost) {
      toast('في انتظار الـ host لإعادة اللعب...', 'info');
      return;
    }
    state.usedLetters = [];
    state.currentRound = 0;
    await HuroufSync.resetGame();
    // سيتم الانتقال للغرفة تلقائيًا عبر حدث room-updated
  }

  /* ===========================================================
     21) مغادرة الغرفة والعودة للرئيسية
     =========================================================== */
  async function handleLeaveRoom() {
    try { await HuroufSync.leaveRoom(); } catch {}
    resetLocalState();
    showScreen('screen-home');
  }

  function goHome() {
    // زر العودة من شاشة الإنشاء/الدخول
    showScreen('screen-home');
  }

  function resetLocalState() {
    state.playerId = null;
    state.roomCode = null;
    state.isHost = false;
    state.room = null;
    state.players = [];
    state.answers = {};
    state.completed = false;
    state.currentRound = 0;
    state.usedLetters = [];
    stopTimer();
  }

  /* ===========================================================
     22) نسخ ومشاركة كود الغرفة
     =========================================================== */
  async function copyRoomCode() {
    if (!state.roomCode) return;
    try {
      await navigator.clipboard.writeText(state.roomCode);
      const toastEl = $('#copy-toast');
      toastEl.classList.add('show');
      setTimeout(() => toastEl.classList.remove('show'), 1500);
    } catch {
      toast('تعذر النسخ', 'error');
    }
  }

  async function shareRoomCode() {
    if (!state.roomCode) return;
    const url = location.origin + location.pathname + '?room=' + state.roomCode;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'حروف 🎯', text: 'انضم إلى غرفتي في حروف!', url });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast('تم نسخ رابط الدعوة', 'success');
      } catch {
        toast('الكود: ' + state.roomCode, 'info');
      }
    }
  }

  /* ===========================================================
     23) ربط أحداث المزامنة القادمة من HuroufSync
     =========================================================== */
  function bindSyncEvents() {
    HuroufSync.on('room-updated', (room) => {
      state.room = room;
      // تحديث الإعدادات إذا لم تكن قد ضُبطت
      if (room.categories) state.categories = room.categories;
      if (room.total_rounds !== undefined) state.selectedRounds = room.total_rounds;
      if (room.round_duration !== undefined) state.selectedDuration = room.round_duration;
      if (room.scoring_mode) state.scoringMode = room.scoring_mode;

      // تحديث شاشة الغرفة
      if (room.status === 'lobby') {
        $('#room-rounds-display').textContent = (room.total_rounds === 0 ? '∞' : room.total_rounds);
        $('#room-duration-display').textContent = room.round_duration;
        renderPlayersList();
        updateStartButton();

        // إذا كنا في شاشة النهاية أو النتائج، أعدنا اللعب → انتقل لشاشة الغرفة
        const currentScreen = document.querySelector('section.screen.active')?.id;
        if (currentScreen === 'screen-final' || currentScreen === 'screen-results') {
          // أعد ضبط الحالة المحلية
          state.completed = false;
          state.answers = {};
          state.currentRound = 0;
          stopTimer();
          enterRoomScreen();
        }
      }
    });

    HuroufSync.on('players-updated', (players) => {
      state.players = players;
      renderPlayersList();
      updateStartButton();
    });

    HuroufSync.on('round-started', ({ round, letter, room }) => {
      if (room) state.room = room;
      state.currentRound = round;
      enterPlayScreen(round, letter, room);
      sounds.roundStart();
    });

    HuroufSync.on('answers-updated', ({ completedBy, completedName }) => {
      if (completedBy && completedBy !== state.playerId && !state.completed) {
        // لاعب آخر أنهى — ابدأ العد التنازلي
        const notice = $('#completed-notice');
        notice.classList.remove('hidden');
        $('#completed-text').textContent = `🔥 ${completedName} أنهى أولًا!`;
        setTimeout(() => notice.classList.add('show'), 10);
        startCountdown(COUNTDOWN_AFTER_COMPLETE);

        // عطّل الإدخال بعد انتهاء العد
        // (سيتم تعطيله في onTimeUp)
      }
    });

    HuroufSync.on('round-finalized', ({ scores, players }) => {
      stopTimer();
      if (scores) enterResultsScreen(state.currentRound, scores, players || state.players);
    });

    HuroufSync.on('game-ended', () => {
      // اعرض الشاشة النهائية
      HuroufSync.getRoomState().then(({ players }) => {
        enterFinalScreen(players);
      });
    });

    HuroufSync.on('player-joined', ({ name }) => {
      toast(`🎉 ${name} انضم للغرفة`, 'success');
    });

    HuroufSync.on('player-left', ({ name }) => {
      if (name) toast(`👋 ${name} غادر الغرفة`, 'info');
    });
  }

  /* ===========================================================
     24) فحص ?room=CODE في الرابط للدخول المباشر
     =========================================================== */
  function checkRoomInURL() {
    const params = new URLSearchParams(location.search);
    const code = params.get('room');
    if (code) {
      showScreen('screen-join');
      $('#join-code').value = code.toUpperCase();
      $('#join-name').focus();
      history.replaceState({}, '', location.pathname);
    }
  }

  /* ===========================================================
     25) أدوات HTML escape
     =========================================================== */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ===========================================================
     26) الإقلاع
     =========================================================== */
  async function boot() {
    initCategoriesSelector();
    initSegmented();
    bindActions();
    bindSyncEvents();

    try { await HuroufSync.init(); }
    catch (e) { console.warn('Sync init error:', e); }

    // أوقف شاشة التحميل
    setTimeout(() => {
      $('#loader').classList.remove('active');
      $('#app').classList.remove('hidden');
      checkRoomInURL();
    }, 600);

    // تعامل مع الضغط على Back button في المتصفح
    window.addEventListener('popstate', () => {
      if (state.roomCode) {
        if (confirm('هل تريد مغادرة الغرفة؟')) handleLeaveRoom();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
