/* ===========================================================
   حروف 🎯 — نظام إدارة الأصوات (AudioManager)
   -----------------------------------------------------------
   - يعتمد على Web Audio API لتوليد كل المؤثرات برمجيًا
     (لا حاجة لملفات mp3 خارجية).
   - يحترم إعداد المستخدم (localStorage: hurouf_sound = 'on'|'off').
   - لا يُشغّل الصوت إلا بعد أول تفاعل من المستخدم
     (سياسات Autoplay في المتصفحات الحديثة).
   - واجهة بسيطة:
       AudioFX.play('click');
       AudioFX.setEnabled(false);
       AudioFX.isEnabled();
   =========================================================== */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'hurouf_sound';

  // اقرأ الإعداد المحفوظ (افتراضي: مُفعّل)
  let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  let ctx = null;
  let unlocked = false; // هل فعّلنا AudioContext بعد تفاعل المستخدم؟

  /* ---- إنشاء/إرجاع سياق الصوت ---- */
  function getCtx() {
    if (ctx) return ctx;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) {
      console.warn('[AudioFX] لا يمكن إنشاء AudioContext:', e);
      ctx = null;
    }
    return ctx;
  }

  /* ---- فتح قفل الصوت بعد أول تفاعل ---- */
  function unlock() {
    if (unlocked) return;
    const c = getCtx();
    if (!c) return;
    // في Safari/Chrome، نحتاج لاستئناف السياق بعد إيماءة المستخدم
    if (c.state === 'suspended') {
      c.resume().catch(() => {});
    }
    unlocked = true;
  }

  /* ---- تشغيل نغمة واحدة ---- */
  function playTone(freq, duration = 0.15, type = 'sine', volume = 0.18, when = 0) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const t0 = c.currentTime + when;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) {
      console.warn('[AudioFX] tone error:', e);
    }
  }

  /* ---- تشغيل سلسلة نغمات (melody) ---- */
  function playSequence(notes, gap = 0.12) {
    if (!enabled) return;
    notes.forEach((n, i) => {
      const freq = Array.isArray(n) ? n[0] : n;
      const dur  = Array.isArray(n) ? (n[1] || 0.15) : 0.15;
      const vol  = Array.isArray(n) ? (n[2] || 0.18) : 0.18;
      const type = Array.isArray(n) ? (n[3] || 'sine') : 'sine';
      playTone(freq, dur, type, vol, i * gap);
    });
  }

  /* ---- تشغيل نغمة مع glide (تغيّر تدريجي في التردد) ---- */
  function playGlide(fromFreq, toFreq, duration = 0.3, type = 'sine', volume = 0.18) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(fromFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) {}
  }

  /* ---- تشغيل ضوضاء قصيرة (للأخطاء) ---- */
  function playNoise(duration = 0.2, volume = 0.1) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const bufferSize = c.sampleRate * duration;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
      }
      const source = c.createBufferSource();
      source.buffer = buffer;
      const gain = c.createGain();
      gain.gain.value = volume;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      source.connect(filter).connect(gain).connect(c.destination);
      source.start();
    } catch (e) {}
  }

  /* ===========================================================
     أصوات الأحداث المختلفة — كلها مولّدة برمجيًا
     =========================================================== */
  const SOUNDS = {
    // نقرات UI
    click:      () => playTone(660, 0.05, 'sine', 0.06),
    tap:        () => playTone(440, 0.04, 'sine', 0.05),

    // ظهور الحرف — نغمة صاعدة أنيقة
    letter:     () => playSequence([[440, 0.1, 0.18, 'sine'], [660, 0.1, 0.16, 'sine'], [880, 0.2, 0.14, 'sine']], 0.06),

    // عد تنازلي 3-2-1
    countdown:  (n) => {
      const freqs = { 3: 440, 2: 523, 1: 659 };
      playTone(freqs[n] || 440, 0.12, 'sine', 0.16);
    },

    // انتهاء الوقت — نغمة هابطة
    timeout:    () => playGlide(440, 110, 0.6, 'sawtooth', 0.18),

    // إرسال الإجابات
    submit:     () => playSequence([[523, 0.08, 0.14, 'sine'], [659, 0.08, 0.14, 'sine'], [784, 0.15, 0.14, 'sine']], 0.05),

    // انتقال للجولة التالية
    round:      () => playSequence([[523, 0.12, 0.16, 'triangle'], [659, 0.12, 0.16, 'triangle'], [784, 0.12, 0.16, 'triangle'], [1046, 0.2, 0.16, 'triangle']], 0.08),

    // ظهور النتائج
    results:    () => playSequence([[523, 0.1, 0.14, 'sine'], [659, 0.1, 0.14, 'sine'], [784, 0.18, 0.14, 'sine']], 0.07),

    // إضافة نقاط — نقرة لطيفة
    score:      () => playTone(1320, 0.08, 'sine', 0.12),

    // فوز بجولة
    win:        () => playSequence([[523, 0.12, 0.18, 'triangle'], [659, 0.12, 0.18, 'triangle'], [784, 0.12, 0.18, 'triangle'], [1046, 0.25, 0.18, 'triangle']], 0.1),

    // فوز بالمباراة (أطول وأكثر فخامة)
    finalWin:   () => playSequence([
      [523, 0.14, 0.2, 'triangle'], [659, 0.14, 0.2, 'triangle'],
      [784, 0.14, 0.2, 'triangle'], [1046, 0.14, 0.2, 'triangle'],
      [1318, 0.4, 0.22, 'triangle']
    ], 0.11),

    // خطأ — نغمة هابطة قصيرة + ضوضاء خفيفة
    error:      () => { playGlide(330, 165, 0.25, 'sawtooth', 0.12); setTimeout(() => playNoise(0.1, 0.05), 50); },

    // تنبيه عند اقتراب انتهاء الوقت (آخر 5 ثوانٍ)
    tick:       () => playTone(880, 0.06, 'sine', 0.1),

    // إشعار COMPLETED
    completed:  () => playSequence([[880, 0.08, 0.16, 'sine'], [1100, 0.12, 0.16, 'sine']], 0.05)
  };

  /* ===== الواجهة العامة ===== */
  const AudioFX = {
    /** شغّل صوتًا بالاسم */
    play(name, ...args) {
      try {
        const fn = SOUNDS[name];
        if (fn) fn(...args);
      } catch (e) {
        console.warn('[AudioFX] play error:', e);
      }
    },

    /** فعّل/عطّل الصوت وحفظ الإعداد */
    setEnabled(on) {
      enabled = !!on;
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      if (enabled) unlock();
    },

    /** هل الصوت مفعّل؟ */
    isEnabled() { return enabled; },

    /** فعّل قفل الصوت بعد تفاعل المستخدم — استدعها على أول click */
    unlock() { unlock(); },

    /** اختصار سريع لتمرير الحدث الصوتي حسب اسم */
    s(name, ...args) { this.play(name, ...args); }
  };

  global.AudioFX = AudioFX;

  // فعّل قفل الصوت على أول تفاعل من المستخدم (تلقائيًا)
  ['click', 'touchstart', 'keydown'].forEach(ev => {
    document.addEventListener(ev, function unlockOnce() {
      unlock();
      document.removeEventListener(ev, unlockOnce, true);
    }, { once: true, capture: true });
  });

  console.info('[AudioFX] ready, enabled =', enabled);
})(window);
