/* ===========================================================
   حروف 🎯 — منطق اللعبة الرئيسي (app.js)
   -----------------------------------------------------------
   - إدارة الشاشات والتنقل
   - حالة اللاعب المحلي والغرفة
   - منطق اللعب: إدخال الإجابات، المؤقت، COMPLETED
   - احتساب النقاط تلقائيًا
   - عرض النتائج والترتيب
   - تكامل مع AudioFX و EffectsFX
   - معالجة أخطاء شاملة
   - منع الضغط المتكرر على الأزرار
   =========================================================== */

(function () {
  'use strict';

  /* ===========================================================
     1) الإعدادات والثوابت
     =========================================================== */

  // الخانات الافتراضية (مع SVG icons بدلًا من Emojis)
  const DEFAULT_CATEGORIES = [
    { id: 'girl',    name: 'بنت',   icon: 'girl' },
    { id: 'boy',     name: 'ولد',   icon: 'boy' },
    { id: 'animal',  name: 'حيوان', icon: 'animal' },
    { id: 'object',  name: 'جماد',  icon: 'object' },
    { id: 'country', name: 'بلد',   icon: 'country' },
    { id: 'food',    name: 'أكل',   icon: 'food' },
    { id: 'plant',   name: 'نبات',  icon: 'plant' },
    { id: 'job',     name: 'مهنة',  icon: 'job' }
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

  // ===== SVG Icons (Inline) =====
  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    girl: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="3"/><path d="M12 10c-3 0-6 1-6 3v4h2v6h8v-6h2v-4c0-2-3-3-6-3z"/></svg>',
    boy: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="3"/><path d="M12 10c-3 0-6 1-6 3v4h2v6h8v-6h2v-4c0-2-3-3-6-3z"/></svg>',
    animal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l3 3h6l3-3 1 5-2 1v9H7v-9l-2-1z"/></svg>',
    object: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    country: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 2 6 5 6 9c0 3 2 5 4 7l-1 6h6l-1-6c2-2 4-4 4-7 0-4-2-7-6-7z"/></svg>',
    plant: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L8 8h3v4h2V8h3z M11 12h2v10h-2z"/></svg>',
    job: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18l-2-9-4 4-4-7-4 7-4-4z"/></svg>'
  };

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
    usedLetters: [],
    // منع الضغط المتكرر
    busy: {
      creating: false,
      joining: false,
      starting: false,
      completing: false,
      finalizing: false,
      nextRound: false,
      reset: false
    }
  };

  /* ===========================================================
     3) أدوات DOM مساعدة
     =========================================================== */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const target = $('#' + id);
    if (!target) return;
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // زن详细信息 للمساعدة في تشخيص الأخطاء
    console.info('[Screen] →', id);
  }

  function toast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container');
    if (!container) { console.warn('Toast:', message); return; }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  /** يعطّل زرًا مؤقتًا لمنع الضغط المتكرر */
  function guardAction(actionName, fn) {
    return async function (...args) {
      if (state.busy[actionName]) {
        console.info(`[Guard] ${actionName} busy, ignored`);
        return;
      }
      state.busy[actionName] = true;
      try {
        await fn.apply(this, args);
      } catch (e) {
        console.error(`[Guard] ${actionName} error:`, e);
        toast(e.message || 'حدث خطأ غير متوقع', 'error');
        AudioFX.play('error');
        EffectsFX.flashError();
      } finally {
        state.busy[actionName] = false;
      }
    };
  }

  /* ===========================================================
     4) تطبيع النصوص العربية
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

  function isValidLetterMatch(answer, letter) {
    const a = normalizeArabic(answer);
    const l = normalizeArabic(letter);
    if (!a || a.length < 2) return false;
    if (a === l) return false;
    return a.startsWith(l);
  }

  /* ===========================================================
     5) توليد حرف عشوائي
     =========================================================== */
  function pickLetter(exclude = []) {
    const pool = ARABIC_LETTERS.filter(l => !exclude.includes(l));
    if (pool.length === 0) {
      // إذا استخدمنا كل الحروف، أعد البدء
      return ARABIC_LETTERS[Math.floor(Math.random() * ARABIC_LETTERS.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* ===========================================================
     6) تهيئة شاشة الإنشاء (اختيار الخانات)
     =========================================================== */
  function initCategoriesSelector() {
    const container = $('#categories-selector');
    if (!container) return;
    container.innerHTML = '';
    state.categories.forEach((cat, idx) => {
      const chip = document.createElement('button');
      chip.className = 'cat-chip' + (cat.enabled ? ' active' : '');
      chip.dataset.idx = idx;
      chip.innerHTML = `
        <span class="cat-icon-svg">${ICONS[cat.icon] || ICONS.object}</span>
        <span class="cat-name">${cat.name}</span>
        <span class="cat-check">${cat.enabled ? ICONS.check : ''}</span>
      `;
      chip.addEventListener('click', () => {
        if (!state.isHost && state.room) return;
        cat.enabled = !cat.enabled;
        chip.classList.toggle('active', cat.enabled);
        chip.querySelector('.cat-check').innerHTML = cat.enabled ? ICONS.check : '';
        AudioFX.play('click');
        EffectsFX.trigger('click');
      });
      container.appendChild(chip);
    });
  }

  /* ===========================================================
     7) ربط أزرار Segmented
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
          AudioFX.play('click');
          EffectsFX.trigger('click');
        });
      });
    });
    const sm = $('#scoring-mode');
    if (sm) sm.addEventListener('change', e => {
      state.scoringMode = e.target.value;
      AudioFX.play('click');
    });
  }

  /* ===========================================================
     8) ربط أزرار الإجراءات العامة
     =========================================================== */
  function bindActions() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.disabled) return;
      const action = btn.dataset.action;
      // لا تشغّل صوتًا على كل زر (بعض الأزرار لها أصواتها الخاصة)
      AudioFX.unlock();
      switch (action) {
        case 'go-create':       AudioFX.play('click'); showScreen('screen-create'); break;
        case 'go-join':         AudioFX.play('click'); showScreen('screen-join'); break;
        case 'open-howto':      AudioFX.play('click'); $('#modal-howto').classList.remove('hidden'); break;
        case 'close-howto':     AudioFX.play('click'); $('#modal-howto').classList.add('hidden'); break;
        case 'back-home':       goHome(); break;
        case 'back-home-final': resetLocalState(); showScreen('screen-home'); break;
        case 'create-room':      handleCreateRoom(); break;
        case 'join-room':        handleJoinRoom(); break;
        case 'copy-code':        copyRoomCode(); break;
        case 'share-code':       shareRoomCode(); break;
        case 'leave-room':       handleLeaveRoom(); break;
        case 'next-round':       handleNextRound(); break;
        case 'play-again':       handlePlayAgain(); break;
      }
    });

    // زر كتم/تشغيل الصوت
    const soundToggle = $('#sound-toggle');
    if (soundToggle) {
      soundToggle.addEventListener('click', () => {
        const newVal = !AudioFX.isEnabled();
        AudioFX.setEnabled(newVal);
        updateSoundIcon();
        if (newVal) {
          AudioFX.play('click');
          toast('تم تفعيل الصوت', 'success', 1500);
        } else {
          toast('تم كتم الصوت', 'info', 1500);
        }
      });
    }

    // زر الاهتزاز
    const vibToggle = $('#vibration-toggle');
    if (vibToggle) {
      vibToggle.addEventListener('click', () => {
        const newVal = !EffectsFX.isVibrationEnabled();
        EffectsFX.setVibrationEnabled(newVal);
        updateVibrationIcon();
        if (newVal) {
          EffectsFX.trigger('click');
          toast('تم تفعيل الاهتزاز', 'success', 1500);
        } else {
          toast('تم إيقاف الاهتزاز', 'info', 1500);
        }
      });
    }

    // زر COMPLETED
    const completeBtn = $('#btn-completed');
    if (completeBtn) {
      completeBtn.addEventListener('click', () => handleCompleted());
    }

    // Enter على شاشة الدخول
    const joinCode = $('#join-code');
    if (joinCode) {
      joinCode.addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
    }

    // Enter يُرسل النموذج
    const joinName = $('#join-name');
    if (joinName && joinCode) {
      [joinName, joinCode].forEach(input => {
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') handleJoinRoom();
        });
      });
    }
    const createName = $('#create-name');
    if (createName) {
      createName.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleCreateRoom();
      });
    }
  }

  function updateSoundIcon() {
    const on = $('#sound-on'); const off = $('#sound-off');
    if (on && off) {
      on.classList.toggle('hidden', !AudioFX.isEnabled());
      off.classList.toggle('hidden', AudioFX.isEnabled());
    }
  }

  function updateVibrationIcon() {
    const on = $('#vibration-on'); const off = $('#vibration-off');
    if (on && off) {
      on.classList.toggle('hidden', !EffectsFX.isVibrationEnabled());
      off.classList.toggle('hidden', EffectsFX.isVibrationEnabled());
    }
  }

  /* ===========================================================
     9) إنشاء غرفة
     =========================================================== */
  const handleCreateRoom = guardAction('creating', async function () {
    const name = $('#create-name').value.trim();
    if (!name) { toast('اكتب اسمك أولاً', 'error'); AudioFX.play('error'); return; }

    const enabledCats = state.categories.filter(c => c.enabled);
    if (enabledCats.length < 3) { toast('اختر 3 خانات على الأقل', 'error'); AudioFX.play('error'); return; }

    state.playerName = name;
    state.isHost = true;

    const settings = {
      totalRounds: state.selectedRounds,
      roundDuration: state.selectedDuration,
      categories: enabledCats,
      scoringMode: state.scoringMode
    };

    toast('جارٍ إنشاء الغرفة...', 'info', 2000);
    const { roomCode, playerId } = await HuroufSync.createRoom({ hostName: name, settings });
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.categories = enabledCats;
    enterRoomScreen();
    toast('تم إنشاء الغرفة بنجاح!', 'success', 2000);
  });

  /* ===========================================================
     10) الانضمام لغرفة
     =========================================================== */
  const handleJoinRoom = guardAction('joining', async function () {
    const name = $('#join-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!name) { toast('اكتب اسمك', 'error'); AudioFX.play('error'); return; }
    if (code.length < 6) { toast('كود الغرفة يجب أن يكون 6 أحرف', 'error'); AudioFX.play('error'); return; }

    state.playerName = name;
    state.isHost = false;

    toast('جارٍ الانضمام...', 'info', 2000);
    const { room, playerId } = await HuroufSync.joinRoom({ roomCode: code, playerName: name });
    state.roomCode = code;
    state.playerId = playerId;
    state.room = room;
    // اقرأ الإعدادات من الغرفة (مع توحيد أسماء الحقول)
    state.categories = room.categories || state.categories;
    state.selectedRounds = room.total_rounds !== undefined ? room.total_rounds : (room.totalRounds || 5);
    state.selectedDuration = room.round_duration !== undefined ? room.round_duration : (room.roundDuration || 60);
    state.scoringMode = room.scoring_mode || room.scoringMode || 'standard';
    enterRoomScreen();
    toast('تم الانضمام بنجاح!', 'success', 2000);
  });

  /* ===========================================================
     11) شاشة الغرفة
     =========================================================== */
  function enterRoomScreen() {
    showScreen('screen-room');
    $('#room-code').textContent = state.roomCode || '------';
    $('#room-rounds-display').textContent = state.selectedRounds === 0 ? '∞' : state.selectedRounds;
    $('#room-duration-display').textContent = state.selectedDuration;
    renderPlayersList();
    updateStartButton();

    // ربط زر البدء
    const btnStart = $('#btn-start-game');
    if (btnStart) btnStart.onclick = handleStartGame;
  }

  function renderPlayersList() {
    const list = $('#players-list');
    const players = state.players || [];
    $('#players-list-count').textContent = players.length;
    $('#room-players-count').textContent = players.length;
    list.innerHTML = '';
    if (!players.length) {
      list.innerHTML = '<li class="hint">لا يوجد لاعبون بعد...</li>';
      return;
    }
    const colors = ['C8A45D','123C35','0B2924','E6CC91','34d399','f87171','60a5fa','f472b6'];
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-row' + (p.isHost ? ' is-host' : '');
      const initial = (p.name || '?').trim().charAt(0).toUpperCase();
      const color = '#' + colors[i % colors.length];
      const isMe = p.id === state.playerId;
      const statusClass = p.ready ? 'ready' : '';
      const statusText = p.ready ? 'جاهز' : 'في الانتظار';
      const score = p.totalScore || 0;
      li.innerHTML = `
        <div class="player-avatar" style="background:${color}">${initial}</div>
        <div class="player-info">
          <div class="player-name">${escapeHtml(p.name)}${isMe ? ' <span class="me-badge">(أنت)</span>' : ''}</div>
          <div class="player-meta">
            ${p.isHost ? '<span class="host-badge">صاحب الغرفة</span>' : ''}
            <span class="player-status ${statusClass}">${statusText}</span>
          </div>
        </div>
        <div class="player-score-badge">${score}</div>
      `;
      list.appendChild(li);
    });
  }

  function updateStartButton() {
    const btn = $('#btn-start-game');
    const waiting = $('#room-waiting');
    if (!btn || !waiting) return;
    if (state.isHost) {
      btn.classList.remove('hidden');
      waiting.classList.add('hidden');
      // السماح باللعب حتى لو كان الـ host وحده
      btn.disabled = false;
      const label = btn.querySelector('.btn-label');
      if (label) label.textContent = 'ابدأ اللعبة';
    } else {
      btn.classList.add('hidden');
      waiting.classList.remove('hidden');
      waiting.textContent = 'في انتظار أن يبدأ صاحب الغرفة اللعبة...';
    }
  }

  /* ===========================================================
     12) بدء اللعبة
     =========================================================== */
  const handleStartGame = guardAction('starting', async function () {
    if (!state.isHost) return;
    const enabledCats = state.categories.filter(c => c.enabled);
    if (enabledCats.length < 3) {
      toast('اختر 3 خانات على الأقل', 'error');
      AudioFX.play('error');
      return;
    }
    state.categories = enabledCats;
    await startNewRound(1);
  });

  async function startNewRound(roundNumber) {
    const usedLetters = state.usedLetters || [];
    const letter = pickLetter(usedLetters);
    state.usedLetters = [...usedLetters, letter];
    state.currentRound = roundNumber;
    state.answers = {};
    state.completed = false;

    await HuroufSync.startRound({ letter, roundNumber });
    // الحدث 'round-started' يُطلق محليًا داخل sync.startRound
    // (في الوضع المحلي والـ Supabase معًا)
    // فيضمن انتقال الواجهة فورًا.
  }

  /* ===========================================================
     13) شاشة اللعب
     =========================================================== */
  function enterPlayScreen(roundNumber, letter, room) {
    if (room) state.room = room;
    const elRound = $('#current-round');
    const elTotal = $('#total-rounds');
    const elLetter = $('#current-letter');
    const elHint = $('#hint-letter');
    const elTimer = $('#timer-text');
    if (elRound) elRound.textContent = roundNumber;
    if (elTotal) elTotal.textContent = (state.selectedRounds === 0 ? '∞' : state.selectedRounds);
    if (elLetter) elLetter.textContent = letter;
    if (elHint) elHint.textContent = letter;
    if (elTimer) elTimer.textContent = state.selectedDuration;

    // أعد بناء حقول الإجابات
    const grid = $('#answers-grid');
    grid.innerHTML = '';
    state.categories.forEach(cat => {
      const cell = document.createElement('div');
      cell.className = 'answer-cell';
      cell.dataset.cat = cat.id;
      cell.innerHTML = `
        <div class="cat-icon-svg">${ICONS[cat.icon] || ICONS.object}</div>
        <div class="answer-field">
          <label class="answer-label">${cat.name}</label>
          <input type="text"
                 data-cat="${cat.id}"
                 placeholder="..."
                 autocomplete="off"
                 ${state.completed ? 'disabled' : ''} />
        </div>
      `;
      const input = cell.querySelector('input');
      input.value = state.answers[cat.id] || '';
      input.addEventListener('input', e => {
        state.answers[cat.id] = e.target.value;
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
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
    const notice = $('#completed-notice');
    notice.classList.remove('show');
    notice.classList.add('hidden');

    showScreen('screen-play');

    // أعد تشغيل حركة ظهور الحرف
    const letterEl = $('#current-letter');
    letterEl.classList.remove('show');
    void letterEl.offsetWidth; // إعادة التدفق
    letterEl.classList.add('show');

    AudioFX.play('letter');
    EffectsFX.trigger('letter');

    // ابدأ المؤقت
    startTimer(state.selectedDuration);
  }

  /* ===========================================================
     14) المؤقت
     =========================================================== */
  function startTimer(duration) {
    stopTimer();
    state.timeLeft = duration;
    updateTimerUI();
    state.timer = setInterval(() => {
      state.timeLeft--;
      updateTimerUI();
      // تشغيل أصوات العد التنازلي
      if (state.timeLeft === 3) { AudioFX.play('countdown', 3); EffectsFX.trigger('countdown'); }
      else if (state.timeLeft === 2) { AudioFX.play('countdown', 2); EffectsFX.trigger('countdown'); }
      else if (state.timeLeft === 1) { AudioFX.play('countdown', 1); EffectsFX.trigger('countdown'); }
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
      if (state.timeLeft === 3) { AudioFX.play('countdown', 3); EffectsFX.trigger('countdown'); }
      else if (state.timeLeft === 2) { AudioFX.play('countdown', 2); EffectsFX.trigger('countdown'); }
      else if (state.timeLeft === 1) { AudioFX.play('countdown', 1); EffectsFX.trigger('countdown'); }
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
    if (!txt || !circle) return;
    const wrap = circle.closest('.timer-circle');
    txt.textContent = state.timeLeft;
    const ratio = state.timeLeft / state.selectedDuration;
    const circumference = 283; // 2π × 45
    circle.style.strokeDashoffset = circumference * (1 - Math.max(0, ratio));
    wrap.classList.remove('warning', 'danger');
    if (state.timeLeft <= 5) wrap.classList.add('danger');
    else if (state.timeLeft <= 15) wrap.classList.add('warning');
  }

  /* ===========================================================
     15) ضغط COMPLETED
     =========================================================== */
  const handleCompleted = guardAction('completing', async function () {
    if (state.completed) return;
    state.completed = true;

    // عطّل حقول الإدخال
    $$('#answers-grid input').forEach(i => i.disabled = true);
    $('#btn-completed').disabled = true;

    AudioFX.play('completed');
    EffectsFX.trigger('completed');

    // أرسل الإجابات وأعلن الانتهاء
    await HuroufSync.submitAnswers(state.answers, true);
    await HuroufSync.announceCompletion();

    // ابدأ عدًا تنازليًا قصيرًا (10 ثوانٍ) ثم أنهِ الجولة تلقائيًا
    // هذا يضمن أن الجولة تنتهي حتى لو كان هذا هو اللاعب الوحيد
    startCountdown(COUNTDOWN_AFTER_COMPLETE);
  });

  function onTimeUp() {
    // انتهى الوقت — أرسل ما لدينا وأغلق الجولة
    if (!state.completed) {
      state.completed = true;
      $$('#answers-grid input').forEach(i => i.disabled = true);
      const btn = $('#btn-completed');
      if (btn) btn.disabled = true;
      AudioFX.play('timeout');
      EffectsFX.trigger('timeout');
      HuroufSync.submitAnswers(state.answers, false).catch(e => {
        console.warn('submitAnswers onTimeUp failed:', e);
      });
    }
    // الـ host سيلخص النتائج
    maybeFinalizeRound();
  }

  /* ===========================================================
     16) إنهاء الجولة واحتساب النقاط (يديره الـ host)
     =========================================================== */
  const maybeFinalizeRound = guardAction('finalizing', async function () {
    if (!state.isHost) return;
    if (state.room && state.room.roundFinalized) return;
    if (state.room && state.room.round_finalized) return; // snake_case

    // انتظر قليلًا للتأكد من استلام كل الإجابات
    await new Promise(resolve => setTimeout(resolve, 1500));

    const answers = await HuroufSync.getRoundAnswers(state.currentRound);
    const scores = computeScores(answers);
    await HuroufSync.finalizeRound(scores);
  });

  function computeScores(answersList) {
    const mode = SCORING_MODES[state.scoringMode] || SCORING_MODES.standard;
    const letter = (state.room && (state.room.currentLetter || state.room.current_letter)) || '';
    const enabledCats = state.categories.map(c => c.id);

    // اجمع كل القيم لكل خانة لاكتشاف التكرار
    const valuesByCat = {};
    enabledCats.forEach(cat => valuesByCat[cat] = []);
    answersList.forEach(a => {
      enabledCats.forEach(cat => {
        const v = a.answers && (a.answers[cat] !== undefined ? a.answers[cat] : (a.answers && a.answers[cat]));
        if (v) valuesByCat[cat].push({ playerId: a.playerId, playerName: a.player_name || a.playerName, value: v });
      });
    });

    return answersList.map(ans => {
      const perCat = {};
      let roundScore = 0;
      enabledCats.forEach(cat => {
        const v = (ans.answers && ans.answers[cat]) || '';
        const norm = normalizeArabic(v);
        let points = 0;
        if (!norm) {
          points = 0;
        } else if (!isValidLetterMatch(v, letter)) {
          points = mode.wrong;
        } else {
          const allVals = valuesByCat[cat].map(x => normalizeArabic(x.value));
          const isDup = allVals.filter(x => x === norm).length > 1;
          points = isDup ? mode.duplicate : mode.unique;
        }
        perCat[cat] = points;
        roundScore += points;
      });
      return {
        playerId: ans.playerId,
        playerName: ans.player_name || ans.playerName || 'لاعب',
        scores: perCat,
        roundScore
      };
    });
  }

  /* ===========================================================
     17) شاشة النتائج
     =========================================================== */
  async function enterResultsScreen(round, scores, players) {
    $('#results-round').textContent = round;

    const sorted = [...scores].sort((a, b) => b.roundScore - a.roundScore);
    const winner = sorted[0];

    const banner = $('#round-winner-banner');
    if (winner && winner.roundScore > 0) {
      banner.classList.remove('hidden');
      $('#round-winner-name').textContent = winner.playerName;
      AudioFX.play('win');
      EffectsFX.trigger('win');
      EffectsFX.confetti({ count: 30 });
    } else {
      banner.classList.add('hidden');
    }

    // الجدول
    const table = $('#results-table');
    table.innerHTML = '';
    sorted.forEach((s, idx) => {
      const card = document.createElement('div');
      card.className = 'result-card' + (idx === 0 && s.roundScore > 0 ? ' winner' : '');
      const player = (players || state.players).find(p => p.id === s.playerId);
      const totalScore = player ? (player.totalScore || player.total_score || 0) : 0;

      let rowsHTML = '';
      state.categories.forEach(cat => {
        // ابحث عن إجابة اللاعب في scores
        const playerScore = scores.find(x => x.playerId === s.playerId);
        const ans = playerScore && playerScore.answers ? playerScore.answers[cat.id] : '';
        const pts = s.scores && s.scores[cat.id] !== undefined ? s.scores[cat.id] : 0;
        const uniquePoints = (SCORING_MODES[state.scoringMode] || SCORING_MODES.standard).unique;
        const ptsClass = pts >= uniquePoints ? 'unique' :
                         pts > 0 ? 'dup' : 'zero';
        rowsHTML += `
          <div class="result-answer-row">
            <span class="ans-cat-icon">${ICONS[cat.icon] || ICONS.object}</span>
            <span class="ans-text ${ans ? '' : 'empty'}">${ans ? escapeHtml(ans) : '—'}</span>
            <span class="ans-points ${ptsClass}">${pts}</span>
          </div>
        `;
      });

      const rankEmoji = ['1st','2nd','3rd'][idx] || (idx + 1);
      card.innerHTML = `
        <div class="result-card-header">
          <div class="rank">${rankEmoji}</div>
          <div class="result-player-name">${escapeHtml(s.playerName)}${s.playerId === state.playerId ? ' <span class="me-badge">(أنت)</span>' : ''}</div>
          <div class="result-player-score">
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
      const label = nextBtn.querySelector('.btn-label');
      if (label) label.textContent = isLastRound ? 'إنهاء اللعبة' : 'الجولة التالية';
    } else {
      nextBtn.disabled = true;
      const label = nextBtn.querySelector('.btn-label');
      if (label) label.textContent = 'في انتظار الـ host...';
    }

    AudioFX.play('results');
    showScreen('screen-results');
  }

  const handleNextRound = guardAction('nextRound', async function () {
    if (!state.isHost) return;
    const isLastRound = state.selectedRounds !== 0 && state.currentRound >= state.selectedRounds;
    if (isLastRound) {
      await HuroufSync.endGame();
    } else {
      AudioFX.play('round');
      await startNewRound(state.currentRound + 1);
    }
  });

  /* ===========================================================
     18) شاشة النهاية
     =========================================================== */
  function enterFinalScreen(players) {
    const sorted = [...(players || state.players)].sort((a, b) => {
      const aScore = a.totalScore || a.total_score || 0;
      const bScore = b.totalScore || b.total_score || 0;
      return bScore - aScore;
    });

    // منصة التتويج (أعلى 3)
    const podium = $('#final-podium');
    podium.innerHTML = '';
    const top3 = sorted.slice(0, 3);
    const podiumClasses = ['gold', 'silver', 'bronze'];
    // ترتيب العرض: silver | gold | bronze
    const order = [1, 0, 2].filter(i => top3[i]);
    order.forEach(i => {
      const p = top3[i];
      const spot = document.createElement('div');
      spot.className = 'podium-spot ' + podiumClasses[i];
      const initial = (p.name || '?').charAt(0).toUpperCase();
      const score = p.totalScore || p.total_score || 0;
      spot.innerHTML = `
        <div class="podium-rank">${i === 0 ? ICONS.crown : (i + 1)}</div>
        <div class="player-avatar gold-avatar">${initial}</div>
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-score">${score}</div>
      `;
      podium.appendChild(spot);
    });

    // الجدول الكامل
    const table = $('#final-table');
    table.innerHTML = '';
    sorted.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'result-card' + (idx === 0 ? ' winner' : '');
      const rankLabel = idx + 1;
      const score = p.totalScore || p.total_score || 0;
      card.innerHTML = `
        <div class="result-card-header">
          <div class="rank">${rankLabel}</div>
          <div class="result-player-name">${escapeHtml(p.name)}${p.id === state.playerId ? ' <span class="me-badge">(أنت)</span>' : ''}</div>
          <div class="result-player-score">${score}</div>
        </div>
      `;
      table.appendChild(card);
    });

    showScreen('screen-final');

    // confetti + صوت
    EffectsFX.confetti({ count: 120, duration: 5500 });
    EffectsFX.flashGold();
    const winner = sorted[0];
    if (winner && winner.id === state.playerId) {
      AudioFX.play('finalWin');
      EffectsFX.trigger('finalWin');
    } else {
      AudioFX.play('win');
      EffectsFX.trigger('win');
    }
  }

  /* ===========================================================
     19) إعادة اللعب
     =========================================================== */
  const handlePlayAgain = guardAction('reset', async function () {
    if (!state.isHost) {
      toast('في انتظار الـ host لإعادة اللعب...', 'info');
      return;
    }
    state.usedLetters = [];
    state.currentRound = 0;
    state.answers = {};
    state.completed = false;
    await HuroufSync.resetGame();
    // سيتم الانتقال للغرفة تلقائيًا عبر حدث room-updated
  });

  /* ===========================================================
     20) مغادرة الغرفة والعودة للرئيسية
     =========================================================== */
  async function handleLeaveRoom() {
    try { await HuroufSync.leaveRoom(); } catch {}
    resetLocalState();
    showScreen('screen-home');
    toast('غادرت الغرفة', 'info', 1500);
  }

  function goHome() {
    AudioFX.play('click');
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
     21) نسخ ومشاركة كود الغرفة
     =========================================================== */
  async function copyRoomCode() {
    if (!state.roomCode) return;
    try {
      await navigator.clipboard.writeText(state.roomCode);
      const toastEl = $('#copy-toast');
      if (toastEl) {
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), 1500);
      }
      AudioFX.play('click');
    } catch {
      toast('تعذر النسخ', 'error');
      AudioFX.play('error');
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
    AudioFX.play('click');
  }

  /* ===========================================================
     22) ربط أحداث المزامنة القادمة من HuroufSync
     =========================================================== */
  function bindSyncEvents() {
    HuroufSync.on('room-updated', (room) => {
      state.room = room;
      // تحديث الإعدادات من بيانات الغرفة (توحيد camelCase و snake_case)
      if (room.categories) state.categories = room.categories;
      if (room.total_rounds !== undefined) state.selectedRounds = room.total_rounds;
      else if (room.totalRounds !== undefined) state.selectedRounds = room.totalRounds;
      if (room.round_duration !== undefined) state.selectedDuration = room.round_duration;
      else if (room.roundDuration !== undefined) state.selectedDuration = room.roundDuration;
      if (room.scoring_mode) state.scoringMode = room.scoring_mode;
      else if (room.scoringMode) state.scoringMode = room.scoringMode;

      // تحديث شاشة الغرفة
      if (room.status === 'lobby') {
        const rDisplay = $('#room-rounds-display');
        const dDisplay = $('#room-duration-display');
        if (rDisplay) rDisplay.textContent = (room.total_rounds === 0 ? '∞' : room.total_rounds);
        if (dDisplay) dDisplay.textContent = room.round_duration;
        renderPlayersList();
        updateStartButton();

        // إذا كنا في شاشة النهاية أو النتائج، أعدنا اللعب → انتقل لشاشة الغرفة
        const currentScreen = document.querySelector('section.screen.active')?.id;
        if (currentScreen === 'screen-final' || currentScreen === 'screen-results') {
          state.completed = false;
          state.answers = {};
          state.currentRound = 0;
          stopTimer();
          enterRoomScreen();
        }
      }
    });

    HuroufSync.on('players-updated', (players) => {
      // توحيد أسماء الحقول
      state.players = (players || []).map(p => ({
        ...p,
        totalScore: p.totalScore !== undefined ? p.totalScore : (p.total_score || 0),
        isHost: p.isHost !== undefined ? p.isHost : p.is_host
      }));
      renderPlayersList();
      updateStartButton();
    });

    HuroufSync.on('round-started', ({ round, letter, room }) => {
      if (room) state.room = room;
      state.currentRound = round;
      state.completed = false;
      state.answers = {};
      enterPlayScreen(round, letter, room);
      // الصوت يُشغّل داخل enterPlayScreen لتجنب التكرار
    });

    HuroufSync.on('answers-updated', ({ completedBy, completedName, playerId }) => {
      // completedBy: لاعب آخر أنهى — اعرض الإشعار وابدأ العد التنازلي
      if (completedBy && completedBy !== state.playerId && !state.completed) {
        const notice = $('#completed-notice');
        if (notice) {
          notice.classList.remove('hidden');
          $('#completed-text').textContent = `${completedName || 'لاعب'} أنهى أولًا!`;
          setTimeout(() => notice.classList.add('show'), 10);
        }
        AudioFX.play('completed');
        startCountdown(COUNTDOWN_AFTER_COMPLETE);
      }
    });

    HuroufSync.on('round-finalized', ({ scores, players }) => {
      stopTimer();
      if (scores && scores.length) {
        enterResultsScreen(state.currentRound, scores, players || state.players);
      } else {
        toast('تعذر عرض النتائج', 'error');
      }
    });

    HuroufSync.on('game-ended', ({ players }) => {
      // اعرض الشاشة النهائية
      if (players && players.length) {
        enterFinalScreen(players);
      } else {
        HuroufSync.getRoomState().then(({ players }) => {
          enterFinalScreen(players);
        }).catch(e => {
          console.error('getRoomState error:', e);
          enterFinalScreen(state.players);
        });
      }
    });

    HuroufSync.on('player-joined', ({ name }) => {
      if (name) toast(`${name} انضم للغرفة`, 'success', 2000);
    });

    HuroufSync.on('player-left', ({ name }) => {
      if (name) toast(`${name} غادر الغرفة`, 'info', 2000);
    });
  }

  /* ===========================================================
     23) فحص ?room=CODE في الرابط للدخول المباشر
     =========================================================== */
  function checkRoomInURL() {
    const params = new URLSearchParams(location.search);
    const code = params.get('room');
    if (code) {
      showScreen('screen-join');
      $('#join-code').value = code.toUpperCase();
      setTimeout(() => $('#join-name').focus(), 300);
      history.replaceState({}, '', location.pathname);
    }
  }

  /* ===========================================================
     24) أدوات HTML escape
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
     25) الإقلاع
     =========================================================== */
  async function boot() {
    console.info('[Boot] حروف 🎯 starting...');

    initCategoriesSelector();
    initSegmented();
    bindActions();
    bindSyncEvents();

    // اعرض حالة الأيقونات الأولية
    updateSoundIcon();
    updateVibrationIcon();

    try {
      await HuroufSync.init();
    } catch (e) {
      console.warn('[Boot] Sync init error:', e);
      toast('تحذير: تعذر الاتصال بـ Supabase. جارٍ العمل في الوضع المحلي.', 'error', 4000);
    }

    // أوقف شاشة التحميل
    setTimeout(() => {
      const loader = $('#loader');
      const app = $('#app');
      if (loader) loader.classList.remove('active');
      if (app) app.classList.remove('hidden');
      checkRoomInURL();
    }, 600);

    // تعامل مع الضغط على Back button في المتصفح
    window.addEventListener('popstate', () => {
      if (state.roomCode) {
        if (confirm('هل تريد مغادرة الغرفة؟')) handleLeaveRoom();
      }
    });

    console.info('[Boot] حروف 🎯 ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
