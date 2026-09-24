/* ===========================================================
   حروف 🎯 — نظام المؤثرات (EffectsFX)
   -----------------------------------------------------------
   - اهتزاز على الأجهزة التي تدعم Vibration API
   - قصاصات ورقية (confetti) عند الفوز
   - ومضات خفيفة عند الأحداث المهمة
   - يحترم إعداد المستخدم (localStorage: hurouf_vibration)
   =========================================================== */

(function (global) {
  'use strict';

  const VIB_KEY = 'hurouf_vibration';
  let vibrationEnabled = localStorage.getItem(VIB_KEY) !== 'off';

  /* ---- اهتزاز آمن ---- */
  function vibrate(pattern) {
    if (!vibrationEnabled) return;
    if (!global.navigator || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  /* ---- قصاصات ورقية (Confetti) ---- */
  function confetti(opts = {}) {
    const {
      count = 80,
      colors = ['#C8A45D', '#E6CC91', '#123C35', '#0B2924', '#F7F1E3'],
      duration = 4500
    } = opts;
    const root = document.body;
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'confetti-piece';
      c.style.cssText = `
        position: fixed;
        top: -20px;
        left: ${Math.random() * 100}vw;
        width: ${6 + Math.random() * 8}px;
        height: ${10 + Math.random() * 12}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        z-index: 9999;
        pointer-events: none;
        border-radius: ${Math.random() > 0.5 ? '2px' : '50%'};
        transform: rotate(${Math.random() * 360}deg);
        animation: confettiFall ${2 + Math.random() * 2}s linear forwards;
        animation-delay: ${Math.random() * 0.6}s;
      `;
      root.appendChild(c);
      setTimeout(() => c.remove(), duration);
    }
  }

  /* ---- ومضة خفيفة على عنصر ---- */
  function pulse(element, color = 'rgba(200,164,93,0.4)', duration = 600) {
    if (!element) return;
    const original = element.style.boxShadow;
    element.style.transition = `box-shadow ${duration/2}ms ease`;
    element.style.boxShadow = `0 0 30px ${color}, 0 0 60px ${color}`;
    setTimeout(() => {
      element.style.boxShadow = original;
    }, duration / 2);
  }

  /* ---- هزّ عنصرًا للتعبير عن خطأ ---- */
  function shake(element, duration = 400) {
    if (!element) return;
    element.classList.add('shake-effect');
    setTimeout(() => element.classList.remove('shake-effect'), duration);
  }

  /* ---- ومضة ذهبية خفيفة على الشاشة بأكملها ---- */
  function flashGold(duration = 300) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed; inset: 0;
      background: radial-gradient(circle, rgba(200,164,93,0.35), transparent 70%);
      pointer-events: none; z-index: 9998;
      opacity: 0;
      transition: opacity ${duration}ms ease;
    `;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), duration);
    }, duration);
  }

  /* ---- ومضة حمراء للأخطاء ---- */
  function flashError(duration = 300) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed; inset: 0;
      background: radial-gradient(circle, rgba(248,113,113,0.25), transparent 70%);
      pointer-events: none; z-index: 9998;
      opacity: 0;
      transition: opacity ${duration}ms ease;
    `;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), duration);
    }, duration);
  }

  /* ===========================================================
     أنماط الاهتزاز حسب الحدث
     =========================================================== */
  const VIBRATIONS = {
    click:      10,
    tap:        8,
    letter:     [20, 30, 40],
    countdown:  30,
    timeout:    [100, 50, 100, 50, 200],
    submit:     [15, 30, 15],
    completed:  [30, 40, 30],
    win:        [50, 50, 50, 100, 200],
    finalWin:   [80, 60, 80, 60, 80, 60, 250],
    error:      [80, 40, 80]
  };

  /* ===== الواجهة العامة ===== */
  const EffectsFX = {
    /** شغّل مؤثر بالاسم (يهتز + صوت) */
    trigger(name) {
      // اهتزاز
      vibrate(VIBRATIONS[name] || 10);
    },

    /** قصاصات ورقية */
    confetti(opts) { confetti(opts); },

    /** ومضة على عنصر */
    pulse(el, color, dur) { pulse(el, color, dur); },

    /** هزّ عنصر */
    shake(el, dur) { shake(el, dur); },

    /** ومضة ذهبية على الشاشة */
    flashGold(dur) { flashGold(dur); },

    /** ومضة حمراء على الشاشة */
    flashError(dur) { flashError(dur); },

    /** اهتزاز مباشر */
    vibrate(pattern) { vibrate(pattern); },

    /** فعّل/عطّل الاهتزاز */
    setVibrationEnabled(on) {
      vibrationEnabled = !!on;
      localStorage.setItem(VIB_KEY, vibrationEnabled ? 'on' : 'off');
    },

    /** هل الاهتزاز مفعّل؟ */
    isVibrationEnabled() { return vibrationEnabled; }
  };

  global.EffectsFX = EffectsFX;
  console.info('[EffectsFX] ready, vibration =', vibrationEnabled);
})(window);
