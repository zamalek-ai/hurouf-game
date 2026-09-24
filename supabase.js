/* ===========================================================
   حروف 🎯 — طبقة المزامنة (Supabase + Local Fallback)
   -----------------------------------------------------------
   - إن وُجدت إعدادات Supabase في window.SUPABASE_CONFIG
     أو في localStorage، نستخدم Supabase Realtime.
   - وإلا، نعمل في "الوضع المحلي" عبر BroadcastChannel +
     localStorage (لتجربة اللعبة فورًا في عدة تبويبات).
   - نفس الواجهة (API) في الحالتين لتسهيل التبديل.
   -----------------------------------------------------------
   ملاحظة أمان: نستخدم ANON KEY فقط (Public) وليس Secret.
   مع تفعيل Row Level Security على جداول Supabase.
   =========================================================== */

(function (global) {
  'use strict';

  /* ====== الإعدادات ====== */
  // يمكن للمستخدم وضعها في ملف config.js منفصل:
  //   window.SUPABASE_CONFIG = { url: 'https://xxxx.supabase.co', anonKey: 'xxxx' };
  // أو إدخالها من شاشة الإعداد (تُخزن في localStorage).
  const SUPABASE_URL  = (global.SUPABASE_CONFIG && global.SUPABASE_CONFIG.url)      || localStorage.getItem('hurouf_sb_url')      || '';
  const SUPABASE_KEY  = (global.SUPABASE_CONFIG && global.SUPABASE_CONFIG.anonKey)  || localStorage.getItem('hurouf_sb_anon_key') || '';

  const HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY && global.supabase && global.supabase.createClient);

  /* ====== أدوات مساعدة ====== */
  function uid() {
    // معرّف فريد بدون الاعتماد على crypto.randomUUID (متوافق مع كل المتصفحات)
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function generateRoomCode() {
    // 6 أحرف/أرقام إنجليزية كبيرة، بدون أحرف ملتبسة (0/O, 1/I)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function emit(target, event, payload) {
    if (!target._listeners[event]) return;
    target._listeners[event].forEach(cb => {
      try { cb(payload); } catch (e) { console.error('[HuroufSync] listener error:', e); }
    });
  }

  /* ===========================================================
     طبقة الأحداث المشتركة
     =========================================================== */
  function makeEventEmitter() {
    return {
      _listeners: {},
      on(event, cb) {
        (this._listeners[event] = this._listeners[event] || []).push(cb);
        return () => {
          this._listeners[event] = (this._listeners[event] || []).filter(x => x !== cb);
        };
      },
      _emit(event, payload) { emit(this, event, payload); }
    };
  }

  /* ===========================================================
     الوضع المحلي (Local Mode)
     يستخدم BroadcastChannel + localStorage لمزامنة التبويبات
     في نفس المتصفح. مثالي للتجربة دون إعداد Supabase.
     =========================================================== */
  function createLocalSync() {
    const sync = makeEventEmitter();
    sync.mode = 'local';

    let currentRoomCode = null;
    let currentPlayerId = null;
    let bc = null;           // BroadcastChannel للغرفة الحالية
    let storageKey = '';
    let heartbeatTimer = null;

    /* ---- مفاتيح localStorage ---- */
    function roomKey()      { return `hurouf:room:${currentRoomCode}`; }
    function playersKey()   { return `hurouf:room:${currentRoomCode}:players`; }
    function answersKey(n)  { return `hurouf:room:${currentRoomCode}:round:${n}:answers`; }
    function scoresKey(n)   { return `hurouf:room:${currentRoomCode}:round:${n}:scores`; }

    /* ---- قراءة/كتابة آمنة ---- */
    function readJSON(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
      catch { return fallback; }
    }
    function writeJSON(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn(e); }
    }

    /* ---- تحميل الحالة الكاملة للغرفة ---- */
    function loadRoomState() {
      const room = readJSON(roomKey(), null);
      const players = readJSON(playersKey(), []);
      return { room, players };
    }

    /* ---- بث تحديث للتبويبات الأخرى ---- */
    function broadcast(message) {
      if (!bc) return;
      try { bc.postMessage(message); } catch (e) { console.warn(e); }
    }

    /* ---- معالجة رسائل BroadcastChannel ---- */
    function handleBCMessage(ev) {
      const msg = ev.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'room-updated':    sync._emit('room-updated', msg.room); break;
        case 'players-updated': sync._emit('players-updated', msg.players); break;
        case 'round-started':   sync._emit('round-started', msg); break;
        case 'answers-updated': sync._emit('answers-updated', msg); break;
        case 'round-finalized': sync._emit('round-finalized', msg); break;
        case 'game-ended':      sync._emit('game-ended', msg); break;
        case 'player-joined':   sync._emit('player-joined', msg); break;
        case 'player-left':     sync._emit('player-left', msg); break;
        case 'request-state': {
          // تبويب جديد دخل وطلب الحالة الحالية — نرسلها له
          const { room, players } = loadRoomState();
          broadcast({ type: 'state-snapshot', room, players, to: msg.from });
          break;
        }
        case 'state-snapshot': {
          if (msg.to !== currentPlayerId) return;
          if (msg.room) sync._emit('room-updated', msg.room);
          if (msg.players) sync._emit('players-updated', msg.players);
          break;
        }
      }
    }

    /* ---- مزامنة قائمة اللاعبين (لإزالة اللاعبين غير النشطين) ---- */
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!currentPlayerId) return;
        const players = readJSON(playersKey(), []);
        const idx = players.findIndex(p => p.id === currentPlayerId);
        if (idx >= 0) {
          players[idx].lastSeen = Date.now();
          writeJSON(playersKey(), players);
        }
      }, 4000);
    }
    function stopHeartbeat() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    /* ---- إزالة اللاعبين غير النشطين (>15s) ---- */
    function pruneStalePlayers() {
      const players = readJSON(playersKey(), []);
      const now = Date.now();
      const fresh = players.filter(p => !p.lastSeen || (now - p.lastSeen) < 15000);
      if (fresh.length !== players.length) {
        writeJSON(playersKey(), fresh);
        broadcast({ type: 'players-updated', players: fresh });
        sync._emit('players-updated', fresh);
      }
    }

    /* ===== API العامة ===== */

    sync.init = async function () {
      // لا شيء مطلوب في الوضع المحلي
      return Promise.resolve();
    };

    sync.createRoom = async function ({ hostName, settings }) {
      const code = generateRoomCode();
      const playerId = uid();
      currentRoomCode = code;
      currentPlayerId = playerId;
      storageKey = roomKey();

      const now = Date.now();
      const room = {
        code,
        status: 'lobby',          // lobby | playing | scoring | finished
        hostId: playerId,
        hostName,
        currentRound: 0,
        totalRounds: settings.totalRounds,
        roundDuration: settings.roundDuration,
        categories: settings.categories,
        scoringMode: settings.scoringMode,
        currentLetter: null,
        roundStartedAt: null,
        completedBy: null,
        completedAt: null,
        roundFinalized: false,
        createdAt: now
      };
      const players = [{
        id: playerId,
        name: hostName,
        isHost: true,
        ready: true,
        totalScore: 0,
        lastSeen: now,
        joinedAt: now
      }];

      writeJSON(roomKey(), room);
      writeJSON(playersKey(), players);

      // افتح قناة البث
      bc = new BroadcastChannel(`hurouf-room-${code}`);
      bc.onmessage = handleBCMessage;

      startHeartbeat();
      setInterval(pruneStalePlayers, 5000);

      sync._emit('room-updated', room);
      sync._emit('players-updated', players);

      return { roomCode: code, playerId };
    };

    sync.joinRoom = async function ({ roomCode, playerName }) {
      const code = roomCode.toUpperCase().trim();
      const room = readJSON(`hurouf:room:${code}`, null);
      if (!room) {
        throw new Error('كود الغرفة غير صحيح أو الغرفة غير موجودة');
      }
      if (room.status === 'finished') {
        throw new Error('انتهت اللعبة بالفعل');
      }
      // منع دخول لاعبين جدد بعد بدء الجولة الأولى (إلا إذا كانت الجولة لم تبدأ)
      if (room.status === 'playing' && room.currentRound > 0) {
        // نسمح بالدخول في وضع الانتظار فقط
        throw new Error('بدأت اللعبة بالفعل، لا يمكن الدخول الآن');
      }

      const playerId = uid();
      currentRoomCode = code;
      currentPlayerId = playerId;
      storageKey = `hurouf:room:${code}`;

      const now = Date.now();
      const players = readJSON(playersKey(), []);
      players.push({
        id: playerId,
        name: playerName,
        isHost: false,
        ready: false,
        totalScore: 0,
        lastSeen: now,
        joinedAt: now
      });
      writeJSON(playersKey(), players);

      bc = new BroadcastChannel(`hurouf-room-${code}`);
      bc.onmessage = handleBCMessage;

      startHeartbeat();
      setInterval(pruneStalePlayers, 5000);

      // أعلن عن نفسك للآخرين
      broadcast({ type: 'player-joined', playerId, name: playerName });
      broadcast({ type: 'players-updated', players });
      broadcast({ type: 'request-state', from: playerId });

      sync._emit('room-updated', room);
      sync._emit('players-updated', players);

      return { room, playerId };
    };

    sync.leaveRoom = async function () {
      if (!currentRoomCode || !currentPlayerId) return;
      const players = readJSON(playersKey(), []);
      const idx = players.findIndex(p => p.id === currentPlayerId);
      if (idx >= 0) {
        const left = players[idx];
        players.splice(idx, 1);
        writeJSON(playersKey(), players);
        broadcast({ type: 'player-left', playerId: currentPlayerId, name: left.name });
        broadcast({ type: 'players-updated', players });
      }
      stopHeartbeat();
      if (bc) { bc.close(); bc = null; }
      currentRoomCode = null;
      currentPlayerId = null;
    };

    sync.setPlayerReady = async function (ready) {
      if (!currentPlayerId) return;
      const players = readJSON(playersKey(), []);
      const idx = players.findIndex(p => p.id === currentPlayerId);
      if (idx >= 0) {
        players[idx].ready = ready;
        players[idx].lastSeen = Date.now();
        writeJSON(playersKey(), players);
        broadcast({ type: 'players-updated', players });
        sync._emit('players-updated', players);
      }
    };

    sync.updateRoom = async function (changes) {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      Object.assign(room, changes);
      writeJSON(roomKey(), room);
      broadcast({ type: 'room-updated', room });
      sync._emit('room-updated', room);
    };

    sync.startRound = async function ({ letter, roundNumber }) {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      room.status = 'playing';
      room.currentRound = roundNumber;
      room.currentLetter = letter;
      room.roundStartedAt = Date.now();
      room.completedBy = null;
      room.completedAt = null;
      room.roundFinalized = false;
      writeJSON(roomKey(), room);
      // امسح إجابات الجولة الجديدة
      writeJSON(answersKey(roundNumber), []);
      writeJSON(scoresKey(roundNumber), []);
      broadcast({ type: 'round-started', round: roundNumber, letter, room });
      sync._emit('round-started', { round: roundNumber, letter, room });
    };

    sync.submitAnswers = async function (answers, completed = true) {
      if (!currentPlayerId) return;
      const room = readJSON(roomKey(), null);
      if (!room) return;
      const players = readJSON(playersKey(), []);
      const me = players.find(p => p.id === currentPlayerId);
      const payload = {
        playerId: currentPlayerId,
        playerName: me ? me.name : 'لاعب',
        answers,
        completedAt: completed ? Date.now() : null
      };
      const list = readJSON(answersKey(room.currentRound), []);
      const idx = list.findIndex(a => a.playerId === currentPlayerId);
      if (idx >= 0) list[idx] = payload; else list.push(payload);
      writeJSON(answersKey(room.currentRound), list);
      broadcast({ type: 'answers-updated', round: room.currentRound, answers: list });
      sync._emit('answers-updated', { round: room.currentRound, answers: list });
    };

    sync.announceCompletion = async function () {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      room.completedBy = currentPlayerId;
      room.completedAt = Date.now();
      writeJSON(roomKey(), room);
      const players = readJSON(playersKey(), []);
      const me = players.find(p => p.id === currentPlayerId);
      broadcast({ type: 'answers-updated', round: room.currentRound, completedBy: currentPlayerId, completedName: me ? me.name : 'لاعب', room });
      sync._emit('answers-updated', { round: room.currentRound, completedBy: currentPlayerId, completedName: me ? me.name : 'لاعب', room });
    };

    sync.finalizeRound = async function (scores) {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      room.status = 'scoring';
      room.roundFinalized = true;
      writeJSON(roomKey(), room);
      writeJSON(scoresKey(room.currentRound), scores);
      // حدّث النقاط الإجمالية لكل لاعب
      const players = readJSON(playersKey(), []);
      scores.forEach(s => {
        const p = players.find(x => x.id === s.playerId);
        if (p) p.totalScore = (p.totalScore || 0) + s.roundScore;
      });
      writeJSON(playersKey(), players);
      broadcast({ type: 'round-finalized', round: room.currentRound, scores, players, room });
      broadcast({ type: 'players-updated', players });
      sync._emit('round-finalized', { round: room.currentRound, scores, players, room });
      sync._emit('players-updated', players);
    };

    sync.nextRound = async function ({ letter, roundNumber }) {
      return sync.startRound({ letter, roundNumber });
    };

    sync.endGame = async function () {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      room.status = 'finished';
      writeJSON(roomKey(), room);
      broadcast({ type: 'game-ended', room });
      sync._emit('game-ended', { room });
    };

    sync.resetGame = async function () {
      const room = readJSON(roomKey(), null);
      if (!room) return;
      room.status = 'lobby';
      room.currentRound = 0;
      room.currentLetter = null;
      room.completedBy = null;
      room.roundFinalized = false;
      writeJSON(roomKey(), room);
      const players = readJSON(playersKey(), []);
      players.forEach(p => { p.totalScore = 0; p.ready = p.isHost; });
      writeJSON(playersKey(), players);
      broadcast({ type: 'room-updated', room });
      broadcast({ type: 'players-updated', players });
      sync._emit('room-updated', room);
      sync._emit('players-updated', players);
    };

    sync.getRoundAnswers = async function (roundNumber) {
      return readJSON(answersKey(roundNumber), []);
    };

    sync.getRoomState = async function () {
      return loadRoomState();
    };

    sync.disconnect = function () {
      stopHeartbeat();
      if (bc) { bc.close(); bc = null; }
    };

    return sync;
  }

  /* ===========================================================
     الوضع الحقيقي (Supabase Realtime)
     يستخدم:
       - postgres_changes لمتابعة تغييرات الجداول
       - broadcast channels للأحداث اللحظية (COMPLETED)
     =========================================================== */
  function createSupabaseSync() {
    const sync = makeEventEmitter();
    sync.mode = 'supabase';

    const sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 20 } }
    });

    let currentRoomCode = null;
    let currentPlayerId = null;
    let currentRoomId = null;
    let channel = null;

    /* ---- بث حدث لحظي عبر Realtime channel ---- */
    function broadcastEvent(event, payload) {
      if (!channel) return;
      channel.send({ type: 'broadcast', event, payload });
    }

    /* ---- معالجة أحداث Broadcast ---- */
    function handleBroadcastEvent(event) {
      return (payload) => {
        switch (event) {
          case 'round-started':   sync._emit('round-started', payload); break;
          case 'answers-updated': sync._emit('answers-updated', payload); break;
          case 'round-finalized': sync._emit('round-finalized', payload); break;
          case 'game-ended':      sync._emit('game-ended', payload); break;
          case 'player-joined':   sync._emit('player-joined', payload); break;
          case 'player-left':     sync._emit('player-left', payload); break;
          case 'state-request':   sync._emit('state-request', payload); break;
        }
      };
    }

    /* ---- معالجة postgres_changes ---- */
    function handlePostgresChange(payload) {
      const { table, eventType, new: newRow, old: oldRow } = payload;
      const row = newRow || oldRow;
      if (!row) return;

      // فلترة بحسب room_id الحالي
      const roomIdField = row.room_id || row.id;
      if (currentRoomId && roomIdField && roomIdField !== currentRoomId) return;

      switch (table) {
        case 'rooms':
          sync._emit('room-updated', newRow);
          break;
        case 'players':
          // أعد تحميل قائمة اللاعبين
          refreshPlayers();
          if (eventType === 'INSERT') sync._emit('player-joined', { playerId: newRow.id, name: newRow.name });
          if (eventType === 'DELETE') sync._emit('player-left', { playerId: oldRow.id, name: oldRow.name });
          break;
        case 'round_answers':
          refreshAnswers();
          break;
      }
    }

    async function refreshPlayers() {
      if (!currentRoomId) return;
      const { data } = await sb.from('players')
        .select('*')
        .eq('room_id', currentRoomId)
        .order('joined_at', { ascending: true });
      sync._emit('players-updated', data || []);
    }

    async function refreshAnswers() {
      if (!currentRoomId) return;
      const { data: room } = await sb.from('rooms').select('current_round').eq('id', currentRoomId).single();
      if (!room) return;
      const { data } = await sb.from('round_answers')
        .select('*')
        .eq('room_id', currentRoomId)
        .eq('round_number', room.current_round);
      sync._emit('answers-updated', { round: room.current_round, answers: data || [] });
    }

    /* ===== API العامة ===== */

    sync.init = async function () {
      // تحقق من الاتصال
      const { error } = await sb.from('rooms').select('id').limit(1);
      if (error) console.warn('[Supabase] connection test failed:', error.message);
      return Promise.resolve();
    };

    sync.createRoom = async function ({ hostName, settings }) {
      const code = generateRoomCode();
      const playerId = uid();
      const now = new Date().toISOString();

      // 1) أنشئ الغرفة
      const { data: room, error: e1 } = await sb.from('rooms').insert({
        code,
        host_id: playerId,
        host_name: hostName,
        status: 'lobby',
        current_round: 0,
        total_rounds: settings.totalRounds,
        round_duration: settings.roundDuration,
        categories: settings.categories,
        scoring_mode: settings.scoringMode,
        current_letter: null,
        round_started_at: null,
        completed_by: null,
        completed_at: null,
        round_finalized: false,
        created_at: now
      }).select().single();
      if (e1) throw new Error('فشل إنشاء الغرفة: ' + e1.message);

      // 2) أضف الـ host كلاعب
      const { error: e2 } = await sb.from('players').insert({
        id: playerId,
        room_id: room.id,
        name: hostName,
        is_host: true,
        ready: true,
        total_score: 0,
        joined_at: now
      });
      if (e2) throw new Error('فشل إضافة اللاعب: ' + e2.message);

      currentRoomCode = code;
      currentRoomId = room.id;
      currentPlayerId = playerId;

      // 3) اشترك في قناة الغرفة
      subscribeChannel();

      sync._emit('room-updated', room);
      await refreshPlayers();

      return { roomCode: code, playerId };
    };

    sync.joinRoom = async function ({ roomCode, playerName }) {
      const code = roomCode.toUpperCase().trim();
      // ابحث عن الغرفة
      const { data: room, error } = await sb.from('rooms')
        .select('*').eq('code', code).single();
      if (error || !room) throw new Error('كود الغرفة غير صحيح');
      if (room.status === 'finished') throw new Error('انتهت اللعبة بالفعل');
      if (room.status === 'playing' && room.current_round > 0) {
        throw new Error('بدأت اللعبة بالفعل، لا يمكن الدخول الآن');
      }

      const playerId = uid();
      const now = new Date().toISOString();
      const { error: e2 } = await sb.from('players').insert({
        id: playerId,
        room_id: room.id,
        name: playerName,
        is_host: false,
        ready: false,
        total_score: 0,
        joined_at: now
      });
      if (e2) throw new Error('فشل الانضمام: ' + e2.message);

      currentRoomCode = code;
      currentRoomId = room.id;
      currentPlayerId = playerId;

      subscribeChannel();

      broadcastEvent('player-joined', { playerId, name: playerName });

      sync._emit('room-updated', room);
      await refreshPlayers();

      return { room, playerId };
    };

    function subscribeChannel() {
      if (channel) { try { sb.removeChannel(channel); } catch {} channel = null; }
      channel = sb.channel(`room-${currentRoomId}`);

      // استمع لـ postgres_changes على جداول الغرفة
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoomId}` },
        handlePostgresChange
      );
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${currentRoomId}` },
        handlePostgresChange
      );
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'round_answers', filter: `room_id=eq.${currentRoomId}` },
        handlePostgresChange
      );

      // استمع لأحداث البث اللحظية
      ['round-started','answers-updated','round-finalized','game-ended','player-joined','player-left','state-request']
        .forEach(ev => channel.on('broadcast', { event: ev }, handleBroadcastEvent(ev)));

      channel.subscribe();
    }

    sync.leaveRoom = async function () {
      if (!currentPlayerId || !currentRoomId) return;
      try {
        await sb.from('players').delete().eq('id', currentPlayerId);
        broadcastEvent('player-left', { playerId: currentPlayerId });
      } catch (e) { console.warn(e); }
      if (channel) { try { sb.removeChannel(channel); } catch {} channel = null; }
      currentRoomCode = null;
      currentRoomId = null;
      currentPlayerId = null;
    };

    sync.setPlayerReady = async function (ready) {
      if (!currentPlayerId) return;
      await sb.from('players').update({ ready }).eq('id', currentPlayerId);
    };

    sync.updateRoom = async function (changes) {
      if (!currentRoomId) return;
      // حول أسماء الحقول من camelCase إلى snake_case (تلقائيًا لمعظمها)
      const dbChanges = {};
      for (const k in changes) {
        const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
        dbChanges[snake] = changes[k];
      }
      await sb.from('rooms').update(dbChanges).eq('id', currentRoomId);
    };

    sync.startRound = async function ({ letter, roundNumber }) {
      if (!currentRoomId) return;
      const now = new Date().toISOString();
      const { error } = await sb.from('rooms').update({
        status: 'playing',
        current_round: roundNumber,
        current_letter: letter,
        round_started_at: now,
        completed_by: null,
        completed_at: null,
        round_finalized: false
      }).eq('id', currentRoomId);
      if (error) throw new Error('فشل بدء الجولة: ' + error.message);

      // اقرأ الغرفة المحدّثة وأرسلها محليًا + للآخرين
      const { data: updatedRoom } = await sb.from('rooms').select('*').eq('id', currentRoomId).single();
      const room = updatedRoom || {
        id: currentRoomId, current_round: roundNumber, current_letter: letter
      };
      const payload = { round: roundNumber, letter, room };
      // أرسل للآخرين عبر البث
      broadcastEvent('round-started', payload);
      // أرسل لنفسك محليًا فورًا (يضمن انتقال واجهة الـ host حتى لو لم يصل البث)
      sync._emit('round-started', payload);
    };

    sync.submitAnswers = async function (answers, completed = true) {
      if (!currentPlayerId || !currentRoomId) return;
      const { data: room, error: roomErr } = await sb.from('rooms')
        .select('current_round').eq('id', currentRoomId).single();
      if (roomErr || !room) throw new Error('تعذر قراءة الجولة الحالية');
      const round = room.current_round;

      // اقرأ اسم اللاعب الحقيقي من جدول players
      const { data: me } = await sb.from('players')
        .select('name').eq('id', currentPlayerId).single();
      const playerName = (me && me.name) || 'لاعب';

      const payload = {
        room_id: currentRoomId,
        round_number: round,
        player_id: currentPlayerId,
        player_name: playerName,
        answers,
        completed_at: completed ? new Date().toISOString() : null
      };
      // upsert (insert or update)
      const { data: existing } = await sb.from('round_answers')
        .select('id')
        .eq('room_id', currentRoomId)
        .eq('round_number', round)
        .eq('player_id', currentPlayerId)
        .maybeSingle();
      if (existing) {
        const { error } = await sb.from('round_answers')
          .update(payload).eq('id', existing.id);
        if (error) throw new Error('فشل تحديث الإجابات');
      } else {
        const { error } = await sb.from('round_answers').insert(payload);
        if (error) throw new Error('فشل إرسال الإجابات: ' + error.message);
      }
      broadcastEvent('answers-updated', { round, playerId: currentPlayerId, playerName });
    };

    sync.announceCompletion = async function () {
      if (!currentRoomId) return;
      const now = new Date().toISOString();
      const { error } = await sb.from('rooms').update({
        completed_by: currentPlayerId,
        completed_at: now
      }).eq('id', currentRoomId);
      if (error) throw new Error('فشل إعلان الإكمال: ' + error.message);

      // اقرأ اسم اللاعب
      const { data: me } = await sb.from('players')
        .select('name').eq('id', currentPlayerId).single();
      const completedName = (me && me.name) || 'لاعب';
      const round = await getCurrentRound();
      const payload = { round, completedBy: currentPlayerId, completedName };
      broadcastEvent('answers-updated', payload);
      // أرسل محليًا أيضًا حتى واجهة الـ host نفسه تتأكد
      sync._emit('answers-updated', payload);
    };

    async function getCurrentRound() {
      const { data: room } = await sb.from('rooms').select('current_round').eq('id', currentRoomId).single();
      return room ? room.current_round : 0;
    }

    sync.finalizeRound = async function (scores) {
      if (!currentRoomId) return;
      const round = await getCurrentRound();
      // حدّث نقاط كل لاعب في round_answers + total_score في players
      for (const s of scores) {
        const { error: e1 } = await sb.from('round_answers')
          .update({ round_score: s.roundScore, scores: s.scores, player_name: s.playerName })
          .eq('room_id', currentRoomId)
          .eq('round_number', round)
          .eq('player_id', s.playerId);
        if (e1) console.warn('[finalizeRound] answers update failed:', e1.message);
        // اقرأ ثم حدّث total_score
        const { data: p, error: e2 } = await sb.from('players')
          .select('total_score').eq('id', s.playerId).single();
        if (p) {
          const { error: e3 } = await sb.from('players')
            .update({ total_score: (p.total_score || 0) + s.roundScore }).eq('id', s.playerId);
          if (e3) console.warn('[finalizeRound] player update failed:', e3.message);
        }
      }
      const { error: e4 } = await sb.from('rooms')
        .update({ status: 'scoring', round_finalized: true }).eq('id', currentRoomId);
      if (e4) console.warn('[finalizeRound] room update failed:', e4.message);

      // اقرأ اللاعبين بعد التحديث لإرسالهم مع الحدث
      const { data: updatedPlayers } = await sb.from('players')
        .select('*').eq('room_id', currentRoomId).order('joined_at');
      const payload = { round, scores, players: updatedPlayers || [] };
      broadcastEvent('round-finalized', payload);
      // أرسل محليًا للـ host فورًا
      sync._emit('round-finalized', payload);
      sync._emit('players-updated', updatedPlayers || []);
    };

    sync.nextRound = async function ({ letter, roundNumber }) {
      return sync.startRound({ letter, roundNumber });
    };

    sync.endGame = async function () {
      if (!currentRoomId) return;
      const { error } = await sb.from('rooms').update({ status: 'finished' }).eq('id', currentRoomId);
      if (error) throw new Error('فشل إنهاء اللعبة: ' + error.message);
      // اقرأ الحالة النهائية لجميع اللاعبين
      const { data: players } = await sb.from('players')
        .select('*').eq('room_id', currentRoomId).order('joined_at');
      const payload = { players: players || [] };
      broadcastEvent('game-ended', payload);
      // أرسل محليًا للـ host فورًا
      sync._emit('game-ended', payload);
    };

    sync.resetGame = async function () {
      if (!currentRoomId) return;
      const { error: e1 } = await sb.from('rooms').update({
        status: 'lobby',
        current_round: 0,
        current_letter: null,
        completed_by: null,
        completed_at: null,
        round_finalized: false
      }).eq('id', currentRoomId);
      if (e1) throw new Error('فشل إعادة الضبط: ' + e1.message);
      // صفّر نقاط اللاعبين
      const { data: players } = await sb.from('players').select('id, is_host').eq('room_id', currentRoomId);
      for (const p of players || []) {
        await sb.from('players').update({ total_score: 0, ready: p.is_host }).eq('id', p.id);
      }
      const { data: room } = await sb.from('rooms').select('*').eq('id', currentRoomId).single();
      const { data: updatedPlayers } = await sb.from('players')
        .select('*').eq('room_id', currentRoomId).order('joined_at');
      broadcastEvent('room-updated', room);
      broadcastEvent('players-updated', updatedPlayers || []);
      sync._emit('room-updated', room);
      sync._emit('players-updated', updatedPlayers || []);
    };

    sync.getRoundAnswers = async function (roundNumber) {
      const { data } = await sb.from('round_answers')
        .select('*')
        .eq('room_id', currentRoomId)
        .eq('round_number', roundNumber);
      return data || [];
    };

    sync.getRoomState = async function () {
      const { data: room } = await sb.from('rooms').select('*').eq('id', currentRoomId).single();
      const { data: players } = await sb.from('players').select('*').eq('room_id', currentRoomId).order('joined_at');
      return { room, players: players || [] };
    };

    sync.disconnect = function () {
      if (channel) { try { sb.removeChannel(channel); } catch {} channel = null; }
    };

    return sync;
  }

  /* ====== اختيار الوضع وكشف الكائن العام ====== */
  const HuroufSync = HAS_SUPABASE ? createSupabaseSync() : createLocalSync();
  HuroufSync.HAS_SUPABASE = HAS_SUPABASE;
  HuroufSync.SUPABASE_URL = SUPABASE_URL;

  global.HuroufSync = HuroufSync;

  // عند إغلاق الصفحة، حاول مغادرة الغرفة بأدب
  global.addEventListener('beforeunload', () => {
    try { HuroufSync.disconnect(); } catch {}
  });

  console.info('[HuroufSync] mode:', HuroufSync.mode,
               HAS_SUPABASE ? '(Supabase Realtime)' : '(Local BroadcastChannel)');
})(window);
