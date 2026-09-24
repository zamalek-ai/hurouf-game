/* ===========================================================
   حروف 🎯 — طبقة المزامنة (Supabase + Local Fallback)
   -----------------------------------------------------------
   - Supabase Realtime عند توفر الإعدادات.
   - Local BroadcastChannel كبديل للتجربة المحلية.
   - مزامنة اللاعبين والجولات والإجابات والنتائج والنهاية.
   =========================================================== */

(function (global) {
  'use strict';

  /* ===========================================================
     الإعدادات
     =========================================================== */

  const SUPABASE_URL =
    (global.SUPABASE_CONFIG && global.SUPABASE_CONFIG.url) ||
    localStorage.getItem('hurouf_sb_url') ||
    '';

  const SUPABASE_KEY =
    (global.SUPABASE_CONFIG && global.SUPABASE_CONFIG.anonKey) ||
    localStorage.getItem('hurouf_sb_anon_key') ||
    '';

  const HAS_SUPABASE = !!(
    SUPABASE_URL &&
    SUPABASE_KEY &&
    global.supabase &&
    global.supabase.createClient
  );

  /* ===========================================================
     أدوات مساعدة
     =========================================================== */

  function uid() {
    return (
      'p_' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
  }

  function emit(target, event, payload) {
    if (!target._listeners[event]) return;

    target._listeners[event].forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error('[HuroufSync] listener error:', e);
      }
    });
  }

  function makeEventEmitter() {
    return {
      _listeners: {},

      on(event, cb) {
        (this._listeners[event] = this._listeners[event] || []).push(cb);

        return () => {
          this._listeners[event] = (
            this._listeners[event] || []
          ).filter((x) => x !== cb);
        };
      },

      _emit(event, payload) {
        emit(this, event, payload);
      }
    };
  }

  /* ===========================================================
     الوضع المحلي
     =========================================================== */

  function createLocalSync() {
    const sync = makeEventEmitter();

    sync.mode = 'local';

    let currentRoomCode = null;
    let currentPlayerId = null;
    let bc = null;
    let heartbeatTimer = null;
    let pruneTimer = null;

    function roomKey() {
      return `hurouf:room:${currentRoomCode}`;
    }

    function playersKey() {
      return `hurouf:room:${currentRoomCode}:players`;
    }

    function answersKey(roundNumber) {
      return `hurouf:room:${currentRoomCode}:round:${roundNumber}:answers`;
    }

    function scoresKey(roundNumber) {
      return `hurouf:room:${currentRoomCode}:round:${roundNumber}:scores`;
    }

    function readJSON(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    }

    function writeJSON(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('[HuroufSync] localStorage error:', e);
      }
    }

    function loadRoomState() {
      return {
        room: readJSON(roomKey(), null),
        players: readJSON(playersKey(), [])
      };
    }

    function broadcast(message) {
      if (!bc) return;

      try {
        bc.postMessage(message);
      } catch (e) {
        console.warn('[HuroufSync] BroadcastChannel error:', e);
      }
    }

    function handleBCMessage(ev) {
      const msg = ev.data;

      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'room-updated':
          sync._emit('room-updated', msg.room);
          break;

        case 'players-updated':
          sync._emit('players-updated', msg.players || []);
          break;

        case 'round-started':
          sync._emit('round-started', msg);
          break;

        case 'answers-updated':
          sync._emit('answers-updated', msg);
          break;

        case 'round-finalized':
          sync._emit('round-finalized', msg);
          break;

        case 'game-ended':
          sync._emit('game-ended', msg);
          break;

        case 'player-joined':
          sync._emit('player-joined', msg);
          break;

        case 'player-left':
          sync._emit('player-left', msg);
          break;

        case 'request-state': {
          const state = loadRoomState();

          broadcast({
            type: 'state-snapshot',
            room: state.room,
            players: state.players,
            to: msg.from
          });

          break;
        }

        case 'state-snapshot': {
          if (msg.to !== currentPlayerId) return;

          if (msg.room) {
            sync._emit('room-updated', msg.room);
          }

          if (msg.players) {
            sync._emit('players-updated', msg.players);
          }

          break;
        }
      }
    }

    function startHeartbeat() {
      stopHeartbeat();

      heartbeatTimer = setInterval(() => {
        if (!currentPlayerId) return;

        const players = readJSON(playersKey(), []);

        const index = players.findIndex(
          (p) => p.id === currentPlayerId
        );

        if (index >= 0) {
          players[index].lastSeen = Date.now();
          writeJSON(playersKey(), players);
        }
      }, 4000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function pruneStalePlayers() {
      const players = readJSON(playersKey(), []);
      const now = Date.now();

      const fresh = players.filter(
        (p) =>
          !p.lastSeen ||
          now - p.lastSeen < 15000
      );

      if (fresh.length !== players.length) {
        writeJSON(playersKey(), fresh);

        broadcast({
          type: 'players-updated',
          players: fresh
        });

        sync._emit('players-updated', fresh);
      }
    }

    /* ===========================================================
       إنشاء غرفة
       =========================================================== */

    sync.init = async function () {
      return Promise.resolve();
    };

    sync.createRoom = async function ({ hostName, settings }) {
      const code = generateRoomCode();
      const playerId = uid();

      currentRoomCode = code;
      currentPlayerId = playerId;

      const now = Date.now();

      const room = {
        code,
        status: 'lobby',
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

      const players = [
        {
          id: playerId,
          name: hostName,
          isHost: true,
          ready: true,
          totalScore: 0,
          lastSeen: now,
          joinedAt: now
        }
      ];

      writeJSON(roomKey(), room);
      writeJSON(playersKey(), players);

      bc = new BroadcastChannel(
        `hurouf-room-${code}`
      );

      bc.onmessage = handleBCMessage;

      startHeartbeat();

      if (pruneTimer) clearInterval(pruneTimer);

      pruneTimer = setInterval(
        pruneStalePlayers,
        5000
      );

      sync._emit('room-updated', room);
      sync._emit('players-updated', players);

      return {
        roomCode: code,
        playerId
      };
    };

    /* ===========================================================
       الانضمام
       =========================================================== */

    sync.joinRoom = async function ({
      roomCode,
      playerName
    }) {
      const code = roomCode.toUpperCase().trim();

      const room = readJSON(
        `hurouf:room:${code}`,
        null
      );

      if (!room) {
        throw new Error(
          'كود الغرفة غير صحيح أو الغرفة غير موجودة'
        );
      }

      if (room.status === 'finished') {
        throw new Error(
          'انتهت اللعبة بالفعل'
        );
      }

      if (
        room.status === 'playing' &&
        room.currentRound > 0
      ) {
        throw new Error(
          'بدأت اللعبة بالفعل، لا يمكن الدخول الآن'
        );
      }

      const playerId = uid();

      currentRoomCode = code;
      currentPlayerId = playerId;

      const now = Date.now();

      const players = readJSON(
        playersKey(),
        []
      );

      players.push({
        id: playerId,
        name: playerName,
        isHost: false,

        // اللاعب الجديد جاهز تلقائياً
        ready: true,

        totalScore: 0,
        lastSeen: now,
        joinedAt: now
      });

      writeJSON(playersKey(), players);

      bc = new BroadcastChannel(
        `hurouf-room-${code}`
      );

      bc.onmessage = handleBCMessage;

      startHeartbeat();

      if (pruneTimer) clearInterval(pruneTimer);

      pruneTimer = setInterval(
        pruneStalePlayers,
        5000
      );

      broadcast({
        type: 'player-joined',
        playerId,
        name: playerName
      });

      broadcast({
        type: 'players-updated',
        players
      });

      broadcast({
        type: 'request-state',
        from: playerId
      });

      sync._emit('room-updated', room);
      sync._emit('players-updated', players);

      return {
        room,
        playerId
      };
    };

    /* ===========================================================
       مغادرة
       =========================================================== */

    sync.leaveRoom = async function () {
      if (!currentRoomCode || !currentPlayerId) {
        return;
      }

      const players = readJSON(
        playersKey(),
        []
      );

      const index = players.findIndex(
        (p) => p.id === currentPlayerId
      );

      if (index >= 0) {
        const left = players[index];

        players.splice(index, 1);

        writeJSON(playersKey(), players);

        broadcast({
          type: 'player-left',
          playerId: currentPlayerId,
          name: left.name
        });

        broadcast({
          type: 'players-updated',
          players
        });
      }

      stopHeartbeat();

      if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }

      if (bc) {
        bc.close();
        bc = null;
      }

      currentRoomCode = null;
      currentPlayerId = null;
    };

    /* ===========================================================
       جاهزية اللاعب
       =========================================================== */

    sync.setPlayerReady = async function (ready) {
      if (!currentPlayerId) return;

      const players = readJSON(
        playersKey(),
        []
      );

      const index = players.findIndex(
        (p) => p.id === currentPlayerId
      );

      if (index >= 0) {
        players[index].ready = !!ready;
        players[index].lastSeen = Date.now();

        writeJSON(playersKey(), players);

        broadcast({
          type: 'players-updated',
          players
        });

        sync._emit(
          'players-updated',
          players
        );
      }
    };

    /* ===========================================================
       تحديث الغرفة
       =========================================================== */

    sync.updateRoom = async function (changes) {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      Object.assign(room, changes);

      writeJSON(roomKey(), room);

      broadcast({
        type: 'room-updated',
        room
      });

      sync._emit(
        'room-updated',
        room
      );
    };

    /* ===========================================================
       بدء الجولة
       =========================================================== */

    sync.startRound = async function ({
      letter,
      roundNumber
    }) {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      room.status = 'playing';
      room.currentRound = roundNumber;
      room.currentLetter = letter;

      room.roundStartedAt = Date.now();

      room.completedBy = null;
      room.completedAt = null;

      room.roundFinalized = false;

      writeJSON(roomKey(), room);

      writeJSON(
        answersKey(roundNumber),
        []
      );

      writeJSON(
        scoresKey(roundNumber),
        []
      );

      const payload = {
        type: 'round-started',
        round: roundNumber,
        letter,
        room
      };

      broadcast(payload);

      sync._emit(
        'round-started',
        {
          round: roundNumber,
          letter,
          room
        }
      );
    };

    /* ===========================================================
       إرسال الإجابات
       =========================================================== */

    sync.submitAnswers = async function (
      answers,
      completed = true
    ) {
      if (!currentPlayerId) return;

      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      const players = readJSON(
        playersKey(),
        []
      );

      const me = players.find(
        (p) => p.id === currentPlayerId
      );

      const payload = {
        playerId: currentPlayerId,
        playerName: me
          ? me.name
          : 'لاعب',
        answers,
        completedAt: completed
          ? Date.now()
          : null
      };

      const list = readJSON(
        answersKey(room.currentRound),
        []
      );

      const index = list.findIndex(
        (a) =>
          a.playerId === currentPlayerId
      );

      if (index >= 0) {
        list[index] = payload;
      } else {
        list.push(payload);
      }

      writeJSON(
        answersKey(room.currentRound),
        list
      );

      const event = {
        type: 'answers-updated',
        round: room.currentRound,
        answers: list
      };

      broadcast(event);

      sync._emit(
        'answers-updated',
        {
          round: room.currentRound,
          answers: list
        }
      );
    };

    /* ===========================================================
       إعلان إكمال اللاعب
       =========================================================== */

    sync.announceCompletion = async function () {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      room.completedBy = currentPlayerId;
      room.completedAt = Date.now();

      writeJSON(
        roomKey(),
        room
      );

      const players = readJSON(
        playersKey(),
        []
      );

      const me = players.find(
        (p) => p.id === currentPlayerId
      );

      const payload = {
        type: 'answers-updated',
        round: room.currentRound,
        completedBy: currentPlayerId,
        completedName: me
          ? me.name
          : 'لاعب',
        room
      };

      broadcast(payload);

      sync._emit(
        'answers-updated',
        {
          round: room.currentRound,
          completedBy: currentPlayerId,
          completedName: me
            ? me.name
            : 'لاعب',
          room
        }
      );
    };

    /* ===========================================================
       إنهاء الجولة
       =========================================================== */

    sync.finalizeRound = async function (
      scores
    ) {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      room.status = 'scoring';
      room.roundFinalized = true;

      writeJSON(roomKey(), room);

      writeJSON(
        scoresKey(room.currentRound),
        scores
      );

      const players = readJSON(
        playersKey(),
        []
      );

      scores.forEach((score) => {
        const player = players.find(
          (p) =>
            p.id === score.playerId
        );

        if (player) {
          player.totalScore =
            (player.totalScore || 0) +
            score.roundScore;
        }
      });

      writeJSON(
        playersKey(),
        players
      );

      const payload = {
        type: 'round-finalized',
        round: room.currentRound,
        scores,
        players,
        room
      };

      broadcast(payload);

      broadcast({
        type: 'players-updated',
        players
      });

      sync._emit(
        'round-finalized',
        {
          round: room.currentRound,
          scores,
          players,
          room
        }
      );

      sync._emit(
        'players-updated',
        players
      );
    };

    sync.nextRound = async function ({
      letter,
      roundNumber
    }) {
      return sync.startRound({
        letter,
        roundNumber
      });
    };

    /* ===========================================================
       إنهاء اللعبة
       =========================================================== */

    sync.endGame = async function () {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      room.status = 'finished';

      writeJSON(
        roomKey(),
        room
      );

      const players = readJSON(
        playersKey(),
        []
      );

      const payload = {
        type: 'game-ended',
        room,
        players
      };

      broadcast(payload);

      sync._emit(
        'game-ended',
        {
          room,
          players
        }
      );
    };

    /* ===========================================================
       إعادة اللعبة
       =========================================================== */

    sync.resetGame = async function () {
      const room = readJSON(
        roomKey(),
        null
      );

      if (!room) return;

      room.status = 'lobby';
      room.currentRound = 0;
      room.currentLetter = null;
      room.completedBy = null;
      room.completedAt = null;
      room.roundFinalized = false;

      writeJSON(
        roomKey(),
        room
      );

      const players = readJSON(
        playersKey(),
        []
      );

      players.forEach((p) => {
        p.totalScore = 0;
        p.ready = !!p.isHost;
      });

      writeJSON(
        playersKey(),
        players
      );

      broadcast({
        type: 'room-updated',
        room
      });

      broadcast({
        type: 'players-updated',
        players
      });

      sync._emit(
        'room-updated',
        room
      );

      sync._emit(
        'players-updated',
        players
      );
    };

    sync.getRoundAnswers = async function (
      roundNumber
    ) {
      return readJSON(
        answersKey(roundNumber),
        []
      );
    };

    sync.getRoomState = async function () {
      return loadRoomState();
    };

    sync.disconnect = function () {
      stopHeartbeat();

      if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }

      if (bc) {
        bc.close();
        bc = null;
      }
    };

    return sync;
  }

  /* ===========================================================
     Supabase Realtime
     =========================================================== */

  function createSupabaseSync() {
    const sync = makeEventEmitter();

    sync.mode = 'supabase';

    const sb = global.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_KEY,
      {
        realtime: {
          params: {
            eventsPerSecond: 20
          }
        }
      }
    );

    let currentRoomCode = null;
    let currentPlayerId = null;
    let currentRoomId = null;
    let channel = null;

    /* ===========================================================
       إرسال Broadcast
       =========================================================== */

    function broadcastEvent(event, payload) {
      if (!channel) return;

      try {
        channel.send({
          type: 'broadcast',
          event,
          payload
        });
      } catch (e) {
        console.warn(
          '[Supabase Broadcast]',
          e
        );
      }
    }

    /* ===========================================================
       استقبال Broadcast
       
       مهم جداً:
       Supabase يرسل wrapper بالشكل:
       
       {
         event: "...",
         type: "broadcast",
         payload: {...}
       }
       
       لذلك نحتاج message.payload
       =========================================================== */

    function handleBroadcastEvent(event) {
      return (message) => {
        const payload =
          message &&
          message.payload
            ? message.payload
            : message;

        if (!payload) return;

        switch (event) {
          case 'round-started':
            sync._emit(
              'round-started',
              payload
            );
            break;

          case 'answers-updated':
            sync._emit(
              'answers-updated',
              payload
            );
            break;

          case 'round-finalized':
            sync._emit(
              'round-finalized',
              payload
            );
            break;

          case 'game-ended':
            sync._emit(
              'game-ended',
              payload
            );
            break;

          case 'player-joined':
            sync._emit(
              'player-joined',
              payload
            );
            break;

          case 'player-left':
            sync._emit(
              'player-left',
              payload
            );
            break;

          case 'state-request':
            sync._emit(
              'state-request',
              payload
            );
            break;
        }
      };
    }

    /* ===========================================================
       PostgreSQL Changes
       =========================================================== */

    function handlePostgresChange(payload) {
      const {
        table,
        eventType,
        new: newRow,
        old: oldRow
      } = payload;

      const row = newRow || oldRow;

      if (!row) return;

      const roomIdField =
        row.room_id || row.id;

      if (
        currentRoomId &&
        roomIdField &&
        roomIdField !== currentRoomId
      ) {
        return;
      }

      switch (table) {
        case 'rooms':
          sync._emit(
            'room-updated',
            newRow
          );
          break;

        case 'players':
          refreshPlayers();

          if (
            eventType === 'INSERT' &&
            newRow
          ) {
            sync._emit(
              'player-joined',
              {
                playerId: newRow.id,
                name: newRow.name
              }
            );
          }

          if (
            eventType === 'DELETE' &&
            oldRow
          ) {
            sync._emit(
              'player-left',
              {
                playerId: oldRow.id,
                name: oldRow.name
              }
            );
          }

          break;

        case 'round_answers':
          refreshAnswers();
          break;
      }
    }

    /* ===========================================================
       تحديث اللاعبين
       =========================================================== */

    async function refreshPlayers() {
      if (!currentRoomId) return;

      const {
        data,
        error
      } = await sb
        .from('players')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .order(
          'joined_at',
          {
            ascending: true
          }
        );

      if (error) {
        console.warn(
          '[Supabase] refreshPlayers:',
          error.message
        );

        return;
      }

      sync._emit(
        'players-updated',
        data || []
      );
    }

    /* ===========================================================
       تحديث الإجابات
       =========================================================== */

    async function refreshAnswers() {
      if (!currentRoomId) return;

      const {
        data: room
      } = await sb
        .from('rooms')
        .select('current_round')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      if (!room) return;

      const {
        data
      } = await sb
        .from('round_answers')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .eq(
          'round_number',
          room.current_round
        );

      sync._emit(
        'answers-updated',
        {
          round: room.current_round,
          answers: data || []
        }
      );
    }

    /* ===========================================================
       تهيئة
       =========================================================== */

    sync.init = async function () {
      const {
        error
      } = await sb
        .from('rooms')
        .select('id')
        .limit(1);

      if (error) {
        console.warn(
          '[Supabase] connection test failed:',
          error.message
        );
      }

      return Promise.resolve();
    };

    /* ===========================================================
       إنشاء غرفة
       =========================================================== */

    sync.createRoom = async function ({
      hostName,
      settings
    }) {
      const code = generateRoomCode();
      const playerId = uid();
      const now =
        new Date().toISOString();

      const {
        data: room,
        error: e1
      } = await sb
        .from('rooms')
        .insert({
          code,

          host_id: playerId,
          host_name: hostName,

          status: 'lobby',

          current_round: 0,

          total_rounds:
            settings.totalRounds,

          round_duration:
            settings.roundDuration,

          categories:
            settings.categories,

          scoring_mode:
            settings.scoringMode,

          current_letter: null,

          round_started_at: null,

          completed_by: null,
          completed_at: null,

          round_finalized: false,

          created_at: now
        })
        .select()
        .single();

      if (e1) {
        throw new Error(
          'فشل إنشاء الغرفة: ' +
          e1.message
        );
      }

      const {
        error: e2
      } = await sb
        .from('players')
        .insert({
          id: playerId,
          room_id: room.id,
          name: hostName,
          is_host: true,
          ready: true,
          total_score: 0,
          joined_at: now
        });

      if (e2) {
        throw new Error(
          'فشل إضافة اللاعب: ' +
          e2.message
        );
      }

      currentRoomCode = code;
      currentRoomId = room.id;
      currentPlayerId = playerId;

      subscribeChannel();

      sync._emit(
        'room-updated',
        room
      );

      await refreshPlayers();

      return {
        roomCode: code,
        playerId
      };
    };

    /* ===========================================================
       الانضمام لغرفة
       =========================================================== */

    sync.joinRoom = async function ({
      roomCode,
      playerName
    }) {
      const code =
        roomCode.toUpperCase().trim();

      const {
        data: room,
        error
      } = await sb
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single();

      if (error || !room) {
        throw new Error(
          'كود الغرفة غير صحيح'
        );
      }

      if (room.status === 'finished') {
        throw new Error(
          'انتهت اللعبة بالفعل'
        );
      }

      if (
        room.status === 'playing' &&
        room.current_round > 0
      ) {
        throw new Error(
          'بدأت اللعبة بالفعل، لا يمكن الدخول الآن'
        );
      }

      const playerId = uid();
      const now =
        new Date().toISOString();

      const {
        error: e2
      } = await sb
        .from('players')
        .insert({
          id: playerId,
          room_id: room.id,
          name: playerName,
          is_host: false,

          // اللاعب الجديد جاهز تلقائياً
          ready: true,

          total_score: 0,
          joined_at: now
        });

      if (e2) {
        throw new Error(
          'فشل الانضمام: ' +
          e2.message
        );
      }

      currentRoomCode = code;
      currentRoomId = room.id;
      currentPlayerId = playerId;

      subscribeChannel();

      broadcastEvent(
        'player-joined',
        {
          playerId,
          name: playerName
        }
      );

      sync._emit(
        'room-updated',
        room
      );

      await refreshPlayers();

      return {
        room,
        playerId
      };
    };

    /* ===========================================================
       الاشتراك في قناة الغرفة
       =========================================================== */

    function subscribeChannel() {
      if (channel) {
        try {
          sb.removeChannel(channel);
        } catch {}

        channel = null;
      }

      channel = sb.channel(
        `room-${currentRoomId}`
      );

      /* ---- الغرف ---- */

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter:
            `id=eq.${currentRoomId}`
        },
        handlePostgresChange
      );

      /* ---- اللاعبين ---- */

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter:
            `room_id=eq.${currentRoomId}`
        },
        handlePostgresChange
      );

      /* ---- الإجابات ---- */

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'round_answers',
          filter:
            `room_id=eq.${currentRoomId}`
        },
        handlePostgresChange
      );

      /* ---- Broadcast ---- */

      [
        'round-started',
        'answers-updated',
        'round-finalized',
        'game-ended',
        'player-joined',
        'player-left',
        'state-request'
      ].forEach((eventName) => {
        channel.on(
          'broadcast',
          {
            event: eventName
          },
          handleBroadcastEvent(
            eventName
          )
        );
      });

      channel.subscribe(
        (status) => {
          console.info(
            '[HuroufSync] channel status:',
            status
          );
        }
      );
    }

    /* ===========================================================
       مغادرة الغرفة
       =========================================================== */

    sync.leaveRoom = async function () {
      if (
        !currentPlayerId ||
        !currentRoomId
      ) {
        return;
      }

      try {
        await sb
          .from('players')
          .delete()
          .eq(
            'id',
            currentPlayerId
          );

        broadcastEvent(
          'player-left',
          {
            playerId: currentPlayerId
          }
        );
      } catch (e) {
        console.warn(
          '[Supabase] leaveRoom:',
          e
        );
      }

      if (channel) {
        try {
          sb.removeChannel(channel);
        } catch {}

        channel = null;
      }

      currentRoomCode = null;
      currentRoomId = null;
      currentPlayerId = null;
    };

    /* ===========================================================
       جاهزية اللاعب
       =========================================================== */

    sync.setPlayerReady = async function (
      ready
    ) {
      if (!currentPlayerId) return;

      const {
        error
      } = await sb
        .from('players')
        .update({
          ready: !!ready
        })
        .eq(
          'id',
          currentPlayerId
        );

      if (error) {
        console.warn(
          '[Supabase] setPlayerReady:',
          error.message
        );
      }

      await refreshPlayers();
    };

    /* ===========================================================
       تحديث الغرفة
       =========================================================== */

    sync.updateRoom = async function (
      changes
    ) {
      if (!currentRoomId) return;

      const dbChanges = {};

      for (const key in changes) {
        const snake =
          key.replace(
            /[A-Z]/g,
            (m) =>
              '_' +
              m.toLowerCase()
          );

        dbChanges[snake] =
          changes[key];
      }

      const {
        error
      } = await sb
        .from('rooms')
        .update(dbChanges)
        .eq(
          'id',
          currentRoomId
        );

      if (error) {
        console.warn(
          '[Supabase] updateRoom:',
          error.message
        );
      }
    };

    /* ===========================================================
       بدء الجولة
       =========================================================== */

    sync.startRound = async function ({
      letter,
      roundNumber
    }) {
      if (!currentRoomId) return;

      const now =
        new Date().toISOString();

      const {
        error
      } = await sb
        .from('rooms')
        .update({
          status: 'playing',
          current_round: roundNumber,
          current_letter: letter,
          round_started_at: now,
          completed_by: null,
          completed_at: null,
          round_finalized: false
        })
        .eq(
          'id',
          currentRoomId
        );

      if (error) {
        throw new Error(
          'فشل بدء الجولة: ' +
          error.message
        );
      }

      const {
        data: updatedRoom
      } = await sb
        .from('rooms')
        .select('*')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      const room =
        updatedRoom || {
          id: currentRoomId,
          current_round:
            roundNumber,
          current_letter: letter
        };

      const payload = {
        round: roundNumber,
        letter,
        room
      };

      /* أرسل لكل اللاعبين */

      broadcastEvent(
        'round-started',
        payload
      );

      /* أرسل للـ Host نفسه */

      sync._emit(
        'round-started',
        payload
      );
    };

    /* ===========================================================
       إرسال الإجابات
       =========================================================== */

    sync.submitAnswers = async function (
      answers,
      completed = true
    ) {
      if (
        !currentPlayerId ||
        !currentRoomId
      ) {
        return;
      }

      const {
        data: room,
        error: roomErr
      } = await sb
        .from('rooms')
        .select('current_round')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      if (roomErr || !room) {
        throw new Error(
          'تعذر قراءة الجولة الحالية'
        );
      }

      const round =
        room.current_round;

      const {
        data: me
      } = await sb
        .from('players')
        .select('name')
        .eq(
          'id',
          currentPlayerId
        )
        .single();

      const playerName =
        (me && me.name) ||
        'لاعب';

      const payload = {
        room_id: currentRoomId,
        round_number: round,
        player_id: currentPlayerId,
        player_name: playerName,
        answers,
        completed_at: completed
          ? new Date().toISOString()
          : null
      };

      const {
        data: existing
      } = await sb
        .from('round_answers')
        .select('id')
        .eq(
          'room_id',
          currentRoomId
        )
        .eq(
          'round_number',
          round
        )
        .eq(
          'player_id',
          currentPlayerId
        )
        .maybeSingle();

      if (existing) {
        const {
          error
        } = await sb
          .from('round_answers')
          .update(payload)
          .eq(
            'id',
            existing.id
          );

        if (error) {
          throw new Error(
            'فشل تحديث الإجابات: ' +
            error.message
          );
        }
      } else {
        const {
          error
        } = await sb
          .from('round_answers')
          .insert(payload);

        if (error) {
          throw new Error(
            'فشل إرسال الإجابات: ' +
            error.message
          );
        }
      }

      broadcastEvent(
        'answers-updated',
        {
          round,
          playerId: currentPlayerId,
          playerName
        }
      );
    };

    /* ===========================================================
       إعلان الإكمال
       =========================================================== */

    sync.announceCompletion = async function () {
      if (!currentRoomId) return;

      const now =
        new Date().toISOString();

      const {
        error
      } = await sb
        .from('rooms')
        .update({
          completed_by: currentPlayerId,
          completed_at: now
        })
        .eq(
          'id',
          currentRoomId
        );

      if (error) {
        throw new Error(
          'فشل إعلان الإكمال: ' +
          error.message
        );
      }

      const {
        data: me
      } = await sb
        .from('players')
        .select('name')
        .eq(
          'id',
          currentPlayerId
        )
        .single();

      const completedName =
        (me && me.name) ||
        'لاعب';

      const round =
        await getCurrentRound();

      const payload = {
        round,
        completedBy:
          currentPlayerId,
        completedName
      };

      broadcastEvent(
        'answers-updated',
        payload
      );

      sync._emit(
        'answers-updated',
        payload
      );
    };

    /* ===========================================================
       الجولة الحالية
       =========================================================== */

    async function getCurrentRound() {
      const {
        data: room
      } = await sb
        .from('rooms')
        .select('current_round')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      return room
        ? room.current_round
        : 0;
    }

    /* ===========================================================
       إنهاء الجولة
       =========================================================== */

    sync.finalizeRound = async function (
      scores
    ) {
      if (!currentRoomId) return;

      const round =
        await getCurrentRound();

      for (const score of scores) {
        const {
          error: e1
        } = await sb
          .from('round_answers')
          .update({
            round_score:
              score.roundScore,

            scores:
              score.scores,

            player_name:
              score.playerName
          })
          .eq(
            'room_id',
            currentRoomId
          )
          .eq(
            'round_number',
            round
          )
          .eq(
            'player_id',
            score.playerId
          );

        if (e1) {
          console.warn(
            '[finalizeRound] answers update failed:',
            e1.message
          );
        }

        const {
          data: player
        } = await sb
          .from('players')
          .select('total_score')
          .eq(
            'id',
            score.playerId
          )
          .single();

        if (player) {
          const {
            error: e3
          } = await sb
            .from('players')
            .update({
              total_score:
                (player.total_score || 0) +
                score.roundScore
            })
            .eq(
              'id',
              score.playerId
            );

          if (e3) {
            console.warn(
              '[finalizeRound] player update failed:',
              e3.message
            );
          }
        }
      }

      const {
        error: e4
      } = await sb
        .from('rooms')
        .update({
          status: 'scoring',
          round_finalized: true
        })
        .eq(
          'id',
          currentRoomId
        );

      if (e4) {
        console.warn(
          '[finalizeRound] room update failed:',
          e4.message
        );
      }

      const {
        data: updatedPlayers
      } = await sb
        .from('players')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .order(
          'joined_at',
          {
            ascending: true
          }
        );

      const payload = {
        round,
        scores,
        players:
          updatedPlayers || []
      };

      /* النتيجة تصل لكل اللاعبين */

      broadcastEvent(
        'round-finalized',
        payload
      );

      /* واجهة الـ Host */

      sync._emit(
        'round-finalized',
        payload
      );

      sync._emit(
        'players-updated',
        updatedPlayers || []
      );
    };

    /* ===========================================================
       الجولة التالية
       =========================================================== */

    sync.nextRound = async function ({
      letter,
      roundNumber
    }) {
      return sync.startRound({
        letter,
        roundNumber
      });
    };

    /* ===========================================================
       إنهاء اللعبة وإظهار الفائز للجميع
       =========================================================== */

    sync.endGame = async function () {
      if (!currentRoomId) return;

      const {
        error
      } = await sb
        .from('rooms')
        .update({
          status: 'finished'
        })
        .eq(
          'id',
          currentRoomId
        );

      if (error) {
        throw new Error(
          'فشل إنهاء اللعبة: ' +
          error.message
        );
      }

      /* اقرأ الترتيب النهائي */

      const {
        data: players
      } = await sb
        .from('players')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .order(
          'total_score',
          {
            ascending: false
          }
        );

      const payload = {
        players:
          players || []
      };

      /* مهم:
         أرسل اللاعبين النهائيين داخل الحدث نفسه
         حتى كل جهاز يعرف الفائز فوراً */

      broadcastEvent(
        'game-ended',
        payload
      );

      /* Host */

      sync._emit(
        'game-ended',
        payload
      );

      /* تأكيد تحديث قائمة اللاعبين */

      sync._emit(
        'players-updated',
        players || []
      );
    };

    /* ===========================================================
       إعادة اللعبة
       =========================================================== */

    sync.resetGame = async function () {
      if (!currentRoomId) return;

      const {
        error: e1
      } = await sb
        .from('rooms')
        .update({
          status: 'lobby',
          current_round: 0,
          current_letter: null,
          completed_by: null,
          completed_at: null,
          round_finalized: false
        })
        .eq(
          'id',
          currentRoomId
        );

      if (e1) {
        throw new Error(
          'فشل إعادة الضبط: ' +
          e1.message
        );
      }

      const {
        data: players
      } = await sb
        .from('players')
        .select(
          'id, is_host'
        )
        .eq(
          'room_id',
          currentRoomId
        );

      for (const player of players || []) {
        await sb
          .from('players')
          .update({
            total_score: 0,
            ready: !!player.is_host
          })
          .eq(
            'id',
            player.id
          );
      }

      const {
        data: room
      } = await sb
        .from('rooms')
        .select('*')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      const {
        data: updatedPlayers
      } = await sb
        .from('players')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .order(
          'joined_at',
          {
            ascending: true
          }
        );

      /* مهم:
         هذه الأحداث أيضاً تُرسل عبر Broadcast
         وكل جهاز يستقبلها */
      broadcastEvent(
        'room-updated',
        room
      );

      broadcastEvent(
        'players-updated',
        updatedPlayers || []
      );

      sync._emit(
        'room-updated',
        room
      );

      sync._emit(
        'players-updated',
        updatedPlayers || []
      );
    };

    /* ===========================================================
       إجابات الجولة
       =========================================================== */

    sync.getRoundAnswers = async function (
      roundNumber
    ) {
      const {
        data
      } = await sb
        .from('round_answers')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .eq(
          'round_number',
          roundNumber
        );

      return data || [];
    };

    /* ===========================================================
       حالة الغرفة
       =========================================================== */

    sync.getRoomState = async function () {
      const {
        data: room
      } = await sb
        .from('rooms')
        .select('*')
        .eq(
          'id',
          currentRoomId
        )
        .single();

      const {
        data: players
      } = await sb
        .from('players')
        .select('*')
        .eq(
          'room_id',
          currentRoomId
        )
        .order(
          'joined_at',
          {
            ascending: true
          }
        );

      return {
        room,
        players: players || []
      };
    };

    /* ===========================================================
       قطع الاتصال
       =========================================================== */

    sync.disconnect = function () {
      if (channel) {
        try {
          sb.removeChannel(channel);
        } catch {}

        channel = null;
      }
    };

    return sync;
  }

  /* ===========================================================
     اختيار وضع التشغيل
     =========================================================== */

  const HuroufSync =
    HAS_SUPABASE
      ? createSupabaseSync()
      : createLocalSync();

  HuroufSync.HAS_SUPABASE =
    HAS_SUPABASE;

  HuroufSync.SUPABASE_URL =
    SUPABASE_URL;

  global.HuroufSync =
    HuroufSync;

  /* ===========================================================
     إغلاق الصفحة
     =========================================================== */

  global.addEventListener(
    'beforeunload',
    () => {
      try {
        HuroufSync.disconnect();
      } catch {}
    }
  );

  console.info(
    '[HuroufSync] mode:',
    HuroufSync.mode,
    HAS_SUPABASE
      ? '(Supabase Realtime)'
      : '(Local BroadcastChannel)'
  );

})(window);
