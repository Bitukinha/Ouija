import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sql } from "@/lib/db.server";
import type { GameEvent, Player, Room } from "@/lib/game";

function firstRow<T>(rows: unknown): T | null {
  const arr = rows as T[];
  return arr.length > 0 ? (arr[0] as T) : null;
}

export const getRoomState = createServerFn({ method: "GET" })
  .validator((code: string) => code)
  .handler(async ({ data: code }) => {
    const db = sql();
    const room = firstRow<Room>(await db`SELECT * FROM rooms WHERE code = ${code.toUpperCase()}`);
    if (!room) return { room: null, players: [] as Player[], events: [] as GameEvent[] };
    const [players, events] = await Promise.all([
      db`SELECT * FROM players WHERE room_id = ${room.id} ORDER BY joined_at`,
      db`SELECT * FROM events WHERE room_id = ${room.id} ORDER BY id DESC LIMIT 40`,
    ]);
    return {
      room,
      players: players as Player[],
      events: (events as GameEvent[]).slice().reverse(),
    };
  });

export const createRoom = createServerFn({ method: "POST" })
  .validator((d: { code: string; hostId: string; targetPhrase: string }) => d)
  .handler(async ({ data }) => {
    const db = sql();
    await db`
      INSERT INTO rooms(code, host_id, target_phrase)
      VALUES (${data.code}, ${data.hostId}, ${data.targetPhrase})
    `;
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator((d: { code: string; name: string; color: string }) => d)
  .handler(async ({ data }) => {
    const db = sql();
    const rows = await db`SELECT * FROM join_room(${data.code}, ${data.name}, ${data.color})`;
    const player = firstRow<Player>(rows);
    if (!player) throw new Error("Sala não encontrada");
    return player;
  });

export const setHost = createServerFn({ method: "POST" })
  .validator((d: { playerId: string; code: string }) => d)
  .handler(async ({ data }) => {
    const db = sql();
    await db`UPDATE players SET is_host = true WHERE id = ${data.playerId}`;
    await db`UPDATE rooms SET host_id = ${data.playerId} WHERE code = ${data.code}`;
  });

const playerIdValidator = (d: { playerId: string }) => d;

export const acquirePointer = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT acquire_pointer(${data.playerId})`;
  });

export const releasePointer = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT release_pointer(${data.playerId})`;
  });

export const acquireCandle = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT acquire_candle(${data.playerId})`;
  });

export const releaseCandle = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT release_candle(${data.playerId})`;
  });

export const killProcess = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT kill_process(${data.playerId})`;
  });

export const reviveProcess = createServerFn({ method: "POST" })
  .validator(playerIdValidator)
  .handler(async ({ data }) => {
    await sql()`SELECT revive_process(${data.playerId})`;
  });

export const writeLetter = createServerFn({ method: "POST" })
  .validator((d: { playerId: string; ch: string }) => d)
  .handler(async ({ data }) => {
    const rows = await sql()`SELECT write_letter(${data.playerId}, ${data.ch}) AS out`;
    const row = firstRow<{ out: unknown }>(rows);
    const out = row?.out;
    const parsed =
      typeof out === "string"
        ? (JSON.parse(out) as { result: string })
        : (out as { result: string });
    return parsed ?? { result: "ok" };
  });

export const tickRoom = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    await sql()`SELECT tick_room(${data.roomId})`;
  });

export const askGhost = createServerFn({ method: "POST" })
  .validator((d: { playerId: string; question: string }) => d)
  .handler(async ({ data }) => {
    const rows = await sql()`SELECT ask_ghost(${data.playerId}, ${data.question}) AS out`;
    const row = firstRow<{ out: string }>(rows);
    return row?.out ?? "ok";
  });

export const tickGhostAnswer = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    await sql()`SELECT progress_ghost_answer(${data.roomId})`;
  });

const roomConfigSchema = z.object({
  roomId: z.string(),
  mutex_enabled: z.boolean().optional(),
  scheduler: z.enum(["fifo", "rr", "priority"]).optional(),
  aging_enabled: z.boolean().optional(),
  quantum_ms: z.number().optional(),
});

export const configRoom = createServerFn({ method: "POST" })
  .validator(roomConfigSchema)
  .handler(async ({ data }) => {
    const db = sql();
    if (data.mutex_enabled !== undefined) {
      await db`UPDATE rooms SET mutex_enabled = ${data.mutex_enabled}, updated_at = now() WHERE id = ${data.roomId}`;
    }
    if (data.scheduler !== undefined) {
      await db`UPDATE rooms SET scheduler = ${data.scheduler}, updated_at = now() WHERE id = ${data.roomId}`;
    }
    if (data.aging_enabled !== undefined) {
      await db`UPDATE rooms SET aging_enabled = ${data.aging_enabled}, updated_at = now() WHERE id = ${data.roomId}`;
    }
    if (data.quantum_ms !== undefined) {
      await db`UPDATE rooms SET quantum_ms = ${data.quantum_ms}, updated_at = now() WHERE id = ${data.roomId}`;
    }
  });

export const startRoom = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; hints: Record<string, string> }) => d)
  .handler(async ({ data }) => {
    const db = sql();
    for (const [playerId, letters] of Object.entries(data.hints)) {
      await db`UPDATE players SET letters = ${letters}, score = 0, state = 'ready' WHERE id = ${playerId}`;
    }
    await db`
      UPDATE rooms SET phase = 'playing', shared_memory = '', corruption = 0, deadlock = false,
        haunt_seq = 0, haunt_kind = NULL, haunt_message = NULL
      WHERE id = ${data.roomId}
    `;
  });

export const resetRoom = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    const db = sql();
    await db`
      UPDATE rooms SET phase = 'lobby', shared_memory = '', corruption = 0, deadlock = false,
        pointer_holder = NULL, candle_holder = NULL, last_writer = NULL, last_write_at = NULL,
        haunt_seq = 0, haunt_kind = NULL, haunt_message = NULL
      WHERE id = ${data.roomId}
    `;
    await db`
      UPDATE players SET state = 'ready', wants_pointer = false, wants_candle = false, wait_since = NULL
      WHERE room_id = ${data.roomId}
    `;
  });
