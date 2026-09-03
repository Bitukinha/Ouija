-- Esquema do "Tabuleiro Ouija do Kernel" para Postgres (Neon).
-- Mesma mecânica de SO da versão original (mutex, deadlock, escalonadores,
-- race conditions, page faults, SIGKILL) + o "processo fantasma": um processo
-- zumbi/órfão que a tabela de processos nunca consegue colher, e que gera os
-- sustos do jogo (sussurros no log, roubo temporário de recursos, escritas
-- falsas na memória compartilhada, jumpscares).
--
-- Sem RLS/roles do Supabase: o acesso a este banco é feito só pelo servidor
-- (TanStack Start server functions), nunca diretamente pelo navegador.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  host_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'lobby',
  mutex_enabled boolean NOT NULL DEFAULT true,
  scheduler text NOT NULL DEFAULT 'fifo',
  aging_enabled boolean NOT NULL DEFAULT false,
  quantum_ms integer NOT NULL DEFAULT 8000,
  target_phrase text NOT NULL,
  shared_memory text NOT NULL DEFAULT '',
  corruption integer NOT NULL DEFAULT 0,
  pointer_holder uuid,
  pointer_since timestamptz,
  candle_holder uuid,
  candle_since timestamptz,
  deadlock boolean NOT NULL DEFAULT false,
  last_writer uuid,
  last_write_at timestamptz,
  haunt_seq integer NOT NULL DEFAULT 0,
  haunt_kind text,
  haunt_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8fe3a1',
  priority integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'ready',
  score integer NOT NULL DEFAULT 0,
  letters text NOT NULL DEFAULT '',
  wants_pointer boolean NOT NULL DEFAULT false,
  wants_candle boolean NOT NULL DEFAULT false,
  wait_since timestamptz,
  is_host boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
CREATE INDEX IF NOT EXISTS idx_events_room ON events(room_id, id DESC);

-- PID sentinela do processo fantasma: nunca existe em `players`, então ele
-- pode "segurar" o ponteiro/vela como qualquer outro processo sem violar
-- nada, e o cliente reconhece esse UUID fixo para desenhar "O ESPÍRITO".
-- 00000000-0000-0000-0000-000000000666

CREATE OR REPLACE FUNCTION log_event(_room uuid, _kind text, _msg text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO events(room_id, kind, message) VALUES (_room, _kind, _msg);
$$;

-- concede o ponteiro ao próximo da fila, segundo o escalonador da sala
CREATE OR REPLACE FUNCTION grant_pointer(_room uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r rooms; nxt players;
BEGIN
  SELECT * INTO r FROM rooms WHERE id = _room;
  IF r.pointer_holder IS NOT NULL THEN RETURN; END IF;

  IF r.scheduler = 'priority' THEN
    SELECT * INTO nxt FROM players
      WHERE room_id = _room AND wants_pointer AND state <> 'terminated'
      ORDER BY (priority + CASE WHEN r.aging_enabled
                 THEN floor(EXTRACT(EPOCH FROM (now() - COALESCE(wait_since, now())))/5)::int
                 ELSE 0 END) DESC, wait_since ASC
      LIMIT 1;
  ELSE
    SELECT * INTO nxt FROM players
      WHERE room_id = _room AND wants_pointer AND state <> 'terminated'
      ORDER BY wait_since ASC LIMIT 1;
  END IF;

  IF nxt.id IS NULL THEN RETURN; END IF;

  UPDATE rooms SET pointer_holder = nxt.id, pointer_since = now(), updated_at = now()
    WHERE id = _room;
  UPDATE players SET state = 'running', wants_pointer = false, wait_since = NULL
    WHERE id = nxt.id;
  PERFORM log_event(_room, 'grant', nxt.name || ' obteve o PONTEIRO (' || r.scheduler || ')');
END;
$$;

-- ============ join ============
CREATE OR REPLACE FUNCTION join_room(_code text, _name text, _color text)
RETURNS players LANGUAGE plpgsql AS $$
DECLARE r rooms; p players; n int;
BEGIN
  SELECT * INTO r FROM rooms WHERE code = upper(_code);
  IF r.id IS NULL THEN RAISE EXCEPTION 'Sala não encontrada'; END IF;
  SELECT count(*) INTO n FROM players WHERE room_id = r.id;
  INSERT INTO players(room_id, name, color, priority)
    VALUES (r.id, _name, _color, 1 + (n % 3)) RETURNING * INTO p;
  PERFORM log_event(r.id, 'proc', 'Processo ' || _name || ' criado (fork)');
  RETURN p;
END;
$$;

-- ============ pointer / candle ============
CREATE OR REPLACE FUNCTION acquire_pointer(_player uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE p players; r rooms; ok boolean;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Jogador inválido'; END IF;
  SELECT * INTO r FROM rooms WHERE id = p.room_id;

  IF NOT r.mutex_enabled THEN
    UPDATE players SET state = 'running' WHERE id = _player;
    RETURN 'free';
  END IF;

  IF r.pointer_holder = _player THEN RETURN 'held'; END IF;

  UPDATE rooms SET pointer_holder = _player, pointer_since = now(), updated_at = now()
    WHERE id = r.id AND pointer_holder IS NULL;
  GET DIAGNOSTICS ok = ROW_COUNT;

  IF ok THEN
    UPDATE players SET state = 'running', wants_pointer = false, wait_since = NULL WHERE id = _player;
    PERFORM log_event(r.id, 'lock', p.name || ' adquiriu o mutex do PONTEIRO');
    RETURN 'acquired';
  ELSE
    UPDATE players SET state = 'blocked', wants_pointer = true,
      wait_since = COALESCE(wait_since, now()) WHERE id = _player;
    PERFORM log_event(r.id, 'wait', p.name || ' BLOQUEADO na fila do ponteiro');
    RETURN 'blocked';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_pointer(_player uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p players;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  UPDATE rooms SET pointer_holder = NULL, pointer_since = NULL, deadlock = false, updated_at = now()
    WHERE id = p.room_id AND pointer_holder = _player;
  UPDATE players SET state = 'ready', wants_candle = false WHERE id = _player;
  PERFORM log_event(p.room_id, 'unlock', p.name || ' liberou o PONTEIRO');
  PERFORM grant_pointer(p.room_id);
END;
$$;

CREATE OR REPLACE FUNCTION acquire_candle(_player uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE p players; r rooms; ok boolean;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  SELECT * INTO r FROM rooms WHERE id = p.room_id;
  IF NOT r.mutex_enabled THEN RETURN 'free'; END IF;
  IF r.candle_holder = _player THEN RETURN 'held'; END IF;

  UPDATE rooms SET candle_holder = _player, candle_since = now(), updated_at = now()
    WHERE id = r.id AND candle_holder IS NULL;
  GET DIAGNOSTICS ok = ROW_COUNT;

  IF ok THEN
    UPDATE players SET wants_candle = false WHERE id = _player;
    PERFORM log_event(r.id, 'lock', p.name || ' adquiriu a VELA');
    RETURN 'acquired';
  ELSE
    UPDATE players SET wants_candle = true, wait_since = COALESCE(wait_since, now()) WHERE id = _player;
    PERFORM log_event(r.id, 'wait', p.name || ' espera pela VELA');
    PERFORM detect_deadlock(r.id);
    RETURN 'blocked';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_candle(_player uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p players;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  UPDATE rooms SET candle_holder = NULL, candle_since = NULL, deadlock = false, updated_at = now()
    WHERE id = p.room_id AND candle_holder = _player;
  PERFORM log_event(p.room_id, 'unlock', p.name || ' liberou a VELA');
END;
$$;

-- ============ deadlock ============
CREATE OR REPLACE FUNCTION detect_deadlock(_room uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r rooms; a players; b players; d boolean := false;
BEGIN
  SELECT * INTO r FROM rooms WHERE id = _room;
  IF r.pointer_holder IS NOT NULL AND r.candle_holder IS NOT NULL
     AND r.pointer_holder <> r.candle_holder THEN
    SELECT * INTO a FROM players WHERE id = r.pointer_holder;
    SELECT * INTO b FROM players WHERE id = r.candle_holder;
    IF a.wants_candle AND b.wants_pointer THEN d := true; END IF;
  END IF;
  IF d <> r.deadlock THEN
    UPDATE rooms SET deadlock = d, updated_at = now() WHERE id = _room;
    IF d THEN
      PERFORM log_event(_room, 'deadlock',
        'IMPASSE: ' || a.name || ' -> VELA -> ' || b.name || ' -> PONTEIRO -> ' || a.name);
    END IF;
  END IF;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION kill_process(_player uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p players;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  UPDATE rooms SET
    pointer_holder = CASE WHEN pointer_holder = _player THEN NULL ELSE pointer_holder END,
    candle_holder  = CASE WHEN candle_holder  = _player THEN NULL ELSE candle_holder END,
    deadlock = false, updated_at = now()
    WHERE id = p.room_id;
  UPDATE players SET state = 'terminated', wants_pointer = false, wants_candle = false,
    wait_since = NULL, score = score - 5 WHERE id = _player;
  PERFORM log_event(p.room_id, 'kill', 'SIGKILL enviado para ' || p.name || ' (recursos liberados)');
  PERFORM grant_pointer(p.room_id);
END;
$$;

CREATE OR REPLACE FUNCTION revive_process(_player uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p players;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  UPDATE players SET state = 'ready' WHERE id = _player;
  PERFORM log_event(p.room_id, 'proc', p.name || ' reiniciado (respawn)');
END;
$$;

-- ============ write ============
CREATE OR REPLACE FUNCTION write_letter(_player uuid, _ch text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p players; r rooms; expected text; ch text; race boolean := false; res text;
BEGIN
  SELECT * INTO p FROM players WHERE id = _player;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Jogador inválido'; END IF;
  SELECT * INTO r FROM rooms WHERE id = p.room_id FOR UPDATE;

  IF p.state = 'terminated' THEN RETURN jsonb_build_object('result','dead'); END IF;
  IF r.phase <> 'playing' THEN RETURN jsonb_build_object('result','not_playing'); END IF;
  IF r.deadlock THEN RETURN jsonb_build_object('result','deadlock'); END IF;

  ch := upper(_ch);

  IF r.mutex_enabled THEN
    IF r.pointer_holder IS DISTINCT FROM _player THEN
      PERFORM acquire_pointer(_player);
      RETURN jsonb_build_object('result','no_lock');
    END IF;
    IF ch IN ('A','E','I','O','U') AND r.candle_holder IS DISTINCT FROM _player THEN
      PERFORM acquire_candle(_player);
      RETURN jsonb_build_object('result','need_candle');
    END IF;
  ELSE
    IF r.last_write_at IS NOT NULL
       AND r.last_writer IS DISTINCT FROM _player
       AND now() - r.last_write_at < interval '1200 milliseconds' THEN
      race := true;
    END IF;
  END IF;

  expected := upper(substr(r.target_phrase, length(r.shared_memory) + 1, 1));
  WHILE expected = ' ' LOOP
    UPDATE rooms SET shared_memory = shared_memory || ' ' WHERE id = r.id;
    SELECT * INTO r FROM rooms WHERE id = r.id;
    expected := upper(substr(r.target_phrase, length(r.shared_memory) + 1, 1));
  END LOOP;

  IF race THEN
    UPDATE rooms SET corruption = corruption + 1,
      shared_memory = substr(shared_memory, 1, greatest(length(shared_memory) - 1, 0)),
      last_writer = _player, last_write_at = now(), updated_at = now() WHERE id = r.id;
    UPDATE players SET score = score - 5 WHERE id IN (_player, r.last_writer);
    PERFORM log_event(r.id, 'race',
      'RACE CONDITION: ' || p.name || ' escreveu sem exclusão mútua — memória corrompida');
    RETURN jsonb_build_object('result','race');
  END IF;

  IF ch = expected THEN
    UPDATE rooms SET shared_memory = shared_memory || ch,
      last_writer = _player, last_write_at = now(), updated_at = now() WHERE id = r.id;
    UPDATE players SET score = score + 10 WHERE id = _player;
    PERFORM log_event(r.id, 'write', p.name || ' escreveu "' || ch || '" na memória compartilhada');
    res := 'ok';
    SELECT * INTO r FROM rooms WHERE id = r.id;
    IF length(r.shared_memory) >= length(r.target_phrase) THEN
      UPDATE rooms SET phase = 'finished', pointer_holder = NULL, candle_holder = NULL WHERE id = r.id;
      PERFORM log_event(r.id, 'end', 'A mensagem foi revelada. Sessão encerrada.');
      res := 'finished';
    END IF;
  ELSE
    UPDATE rooms SET last_writer = _player, last_write_at = now(), updated_at = now() WHERE id = r.id;
    UPDATE players SET score = score - 3 WHERE id = _player;
    PERFORM log_event(r.id, 'fault', p.name || ' escreveu "' || ch || '" — letra incorreta (page fault)');
    res := 'wrong';
  END IF;

  RETURN jsonb_build_object('result', res);
END;
$$;

-- ============ processo fantasma ============
-- Um processo zumbi/órfão que o escalonador nunca lista e que ninguém nunca
-- dá `wait()`: de vez em quando ele interrompe o sistema de forma assíncrona
-- (como uma interrupção não mascarável), sussurra no log do kernel, rouba o
-- ponteiro/vela por alguns segundos ou assusta de verdade (jumpscare).
CREATE OR REPLACE FUNCTION haunt_room(_room uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r rooms;
  roll double precision;
  kind text;
  phrases text[] := ARRAY[
    'processo zumbi não foi colhido pelo pai',
    'há um PID que o escalonador não lista',
    'interrupção não-mascarável recebida',
    'eu habito o segmento não mapeado',
    'sua página foi trocada por mim',
    'o watchdog não vai latir a tempo',
    'seu mutex nunca foi realmente seu',
    'PID 0 sente fome',
    'o kernel panic está apenas dormindo',
    'eu conto seus ciclos de CPU',
    'ninguém chamou wait() por mim',
    'sou o processo órfão que não morre'
  ];
  jumpscares text[] := ARRAY[
    'ELE ESTÁ NA MEMÓRIA',
    'VOCÊ NÃO ESTÁ SOZINHO NESTE PROCESSO',
    'PID 0 ACORDOU'
  ];
  ghost_id constant uuid := '00000000-0000-0000-0000-000000000666';
BEGIN
  SELECT * INTO r FROM rooms WHERE id = _room;
  IF r.id IS NULL OR r.phase <> 'playing' THEN RETURN; END IF;

  -- o fantasma solta o que roubou depois de alguns segundos
  IF r.pointer_holder = ghost_id AND r.pointer_since < now() - interval '3 seconds' THEN
    UPDATE rooms SET pointer_holder = NULL, pointer_since = NULL, updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'unlock', 'O ESPÍRITO devolveu o PONTEIRO');
    PERFORM grant_pointer(_room);
  END IF;
  IF r.candle_holder = ghost_id AND r.candle_since < now() - interval '3 seconds' THEN
    UPDATE rooms SET candle_holder = NULL, candle_since = NULL, updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'unlock', 'O ESPÍRITO devolveu a VELA');
  END IF;

  roll := random();
  IF roll > 0.12 THEN RETURN; END IF;

  SELECT * INTO r FROM rooms WHERE id = _room;

  IF roll < 0.012 THEN
    kind := 'jumpscare';
  ELSIF roll < 0.05 THEN
    kind := 'steal';
  ELSIF roll < 0.08 THEN
    kind := 'fake_write';
  ELSE
    kind := 'whisper';
  END IF;

  IF kind = 'steal' AND r.pointer_holder = ghost_id THEN kind := 'whisper'; END IF;

  IF kind = 'whisper' THEN
    UPDATE rooms SET haunt_seq = haunt_seq + 1, haunt_kind = 'whisper',
      haunt_message = phrases[1 + floor(random() * array_length(phrases,1))::int],
      updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'ghost', '"' || (SELECT haunt_message FROM rooms WHERE id = _room) || '"');

  ELSIF kind = 'fake_write' THEN
    UPDATE rooms SET corruption = corruption + 1, haunt_seq = haunt_seq + 1,
      haunt_kind = 'fake_write', haunt_message = 'uma mão que não é sua tocou a memória',
      updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'ghost', 'O ESPÍRITO tocou a memória compartilhada — leitura corrompida');

  ELSIF kind = 'steal' THEN
    IF r.pointer_holder IS NOT NULL AND r.pointer_holder <> ghost_id THEN
      UPDATE players SET state = 'blocked', wants_pointer = true, wait_since = now()
        WHERE id = r.pointer_holder;
    END IF;
    UPDATE rooms SET pointer_holder = ghost_id, pointer_since = now(),
      haunt_seq = haunt_seq + 1, haunt_kind = 'steal',
      haunt_message = 'O ESPÍRITO tomou o PONTEIRO', updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'ghost', 'O ESPÍRITO (PID 0) tomou o PONTEIRO à força');

  ELSIF kind = 'jumpscare' THEN
    UPDATE rooms SET haunt_seq = haunt_seq + 1, haunt_kind = 'jumpscare',
      haunt_message = jumpscares[1 + floor(random() * array_length(jumpscares,1))::int],
      updated_at = now() WHERE id = _room;
    PERFORM log_event(_room, 'jumpscare', (SELECT haunt_message FROM rooms WHERE id = _room));
  END IF;
END;
$$;

-- ============ tick (quantum + deadlock + aging + fantasma) ============
CREATE OR REPLACE FUNCTION tick_room(_room uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r rooms; holder players;
BEGIN
  SELECT * INTO r FROM rooms WHERE id = _room;
  IF r.id IS NULL OR r.phase <> 'playing' THEN RETURN; END IF;

  PERFORM detect_deadlock(_room);
  PERFORM haunt_room(_room);

  SELECT * INTO r FROM rooms WHERE id = _room;

  IF r.scheduler = 'rr' AND r.pointer_holder IS NOT NULL
     AND r.pointer_holder <> '00000000-0000-0000-0000-000000000666' AND NOT r.deadlock
     AND now() - r.pointer_since > (r.quantum_ms || ' milliseconds')::interval THEN
    SELECT * INTO holder FROM players WHERE id = r.pointer_holder;
    UPDATE rooms SET pointer_holder = NULL, pointer_since = NULL, updated_at = now() WHERE id = _room;
    UPDATE players SET state = 'ready', wants_pointer = true, wait_since = now()
      WHERE id = holder.id AND state <> 'terminated';
    PERFORM log_event(_room, 'preempt',
      'QUANTUM expirado: ' || holder.name || ' sofreu preempção e voltou para a fila');
    PERFORM grant_pointer(_room);
  END IF;

  IF r.pointer_holder IS NULL THEN
    PERFORM grant_pointer(_room);
  END IF;
END;
$$;
