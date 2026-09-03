export type Scheduler = "fifo" | "rr" | "priority";

export type Room = {
  id: string;
  code: string;
  host_id: string;
  phase: "lobby" | "playing" | "finished";
  mutex_enabled: boolean;
  scheduler: Scheduler;
  aging_enabled: boolean;
  quantum_ms: number;
  target_phrase: string;
  shared_memory: string;
  corruption: number;
  pointer_holder: string | null;
  pointer_since: string | null;
  candle_holder: string | null;
  deadlock: boolean;
  last_writer: string | null;
  last_write_at: string | null;
  haunt_seq: number;
  haunt_kind: string | null;
  haunt_message: string | null;
  ask_seq: number;
  ghost_question: string | null;
  ghost_answer: string | null;
  ghost_answer_revealed: number;
  ghost_answering: boolean;
};

/** PID sentinela do processo fantasma — nunca existe em `players`. */
export const GHOST_ID = "00000000-0000-0000-0000-000000000666";
export const GHOST_NAME = "O ESPÍRITO";

export type Player = {
  id: string;
  room_id: string;
  name: string;
  color: string;
  priority: number;
  state: "ready" | "running" | "blocked" | "terminated";
  score: number;
  letters: string;
  wants_pointer: boolean;
  wants_candle: boolean;
  wait_since: string | null;
  is_host: boolean;
  joined_at: string;
};

export type GameEvent = {
  id: number;
  room_id: string;
  kind: string;
  message: string;
  created_at: string;
};

export const ROW_1 = "ABCDEFGHIJKLM".split("");
export const ROW_2 = "NOPQRSTUVWXYZ".split("");
export const ROW_3 = "0123456789".split("");

export const PHRASES = [
  "O DEADLOCK ESPREITA",
  "SEMAFORO QUEBRADO",
  "MEMORIA COMPARTILHADA",
  "SECAO CRITICA ABERTA",
  "O ESCALONADOR CHAMA",
  "PROCESSO ZUMBI VIVE",
  "QUANTUM EXPIRADO",
  "EXCLUSAO MUTUA AGORA",
];

export const COLORS = ["#9ff2b5", "#f2c46b", "#f28b6b", "#a5b8f2", "#e2a2f2", "#6bd8f2"];

export const SCHEDULER_LABEL: Record<Scheduler, string> = {
  fifo: "FIFO (ordem de chegada)",
  rr: "Round Robin (quantum)",
  priority: "Prioridade",
};

export const STATE_LABEL: Record<Player["state"], string> = {
  ready: "PRONTO",
  running: "EXECUTANDO",
  blocked: "BLOQUEADO",
  terminated: "ENCERRADO",
};

export function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function randomPhrase() {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)]!;
}

/** Identidade anônima do jogador, por sala, guardada no navegador. */
export function storedPlayerId(code: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`ouija:player:${code}`);
}

export function storePlayerId(code: string, id: string) {
  window.localStorage.setItem(`ouija:player:${code}`, id);
}

export function clientId() {
  let id = window.localStorage.getItem("ouija:client");
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem("ouija:client", id);
  }
  return id;
}

/** Distribui as posições da frase entre os processos (fragmentos privados). */
export function buildHints(phrase: string, playerIds: string[]) {
  const map: Record<string, string[]> = {};
  playerIds.forEach((id) => (map[id] = []));
  let slot = 0;
  for (let i = 0; i < phrase.length; i++) {
    const ch = phrase[i]!;
    if (ch === " ") continue;
    const owner = playerIds[slot % playerIds.length]!;
    map[owner]!.push(`${i}:${ch}`);
    slot++;
  }
  return map;
}

export function parseHints(letters: string) {
  if (!letters) return [] as { pos: number; ch: string }[];
  return letters
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [pos, ch] = part.split(":");
      return { pos: Number(pos), ch: ch ?? "" };
    });
}
