import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { OuijaBoard } from "@/components/OuijaBoard";
import { EventLog, ProcessTable } from "@/components/KernelPanel";
import { Jumpscare } from "@/components/Jumpscare";
import {
  acquireCandle,
  acquirePointer,
  askGhost,
  configRoom,
  joinRoom,
  killProcess,
  releaseCandle,
  releasePointer,
  resetRoom,
  reviveProcess,
  startRoom,
  tickGhostAnswer,
  tickRoom,
  writeLetter,
} from "@/lib/api";
import {
  buildHints,
  COLORS,
  GHOST_ID,
  parseHints,
  SCHEDULER_LABEL,
  storePlayerId,
  storedPlayerId,
  type Scheduler,
} from "@/lib/game";
import { useRoomState } from "@/lib/use-room-state";
import {
  armAudio,
  muteAudio,
  isAudioArmed,
  playFakeWrite,
  playGlide,
  playJumpscare,
  playSteal,
  playWhisper,
  startHeartbeat,
  stopHeartbeat,
} from "@/lib/ghost-audio";

export const Route = createFileRoute("/sala/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Sessão ${params.code} — Tabuleiro Ouija do Kernel` },
      {
        name: "description",
        content:
          "Sala multiplayer em tempo real: dispute o ponteiro, respeite o mutex e revele a mensagem na memória compartilhada antes que o processo fantasma interfira.",
      },
      { property: "og:title", content: `Sessão ${params.code} — Tabuleiro Ouija do Kernel` },
      {
        property: "og:description",
        content: "Entre na sessão e jogue como um processo concorrente. Você não está sozinho.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoomPage,
});

const RESULT_MESSAGE: Record<string, string> = {
  ok: "Letra gravada na memória compartilhada.",
  wrong: "Letra incorreta — page fault, −3 pontos.",
  race: "CONDIÇÃO DE CORRIDA! Duas escritas simultâneas corromperam a memória.",
  no_lock: "Você não tem o ponteiro. Entrou na fila de espera (BLOQUEADO).",
  need_candle: "Vogais exigem a VELA. Requisição registrada — cuidado com o impasse.",
  deadlock: "Sistema em IMPASSE. Encerre um processo para liberar recursos.",
  not_playing: "A sessão ainda não começou.",
  dead: "Seu processo foi encerrado. Peça respawn ao kernel.",
  finished: "A mensagem foi revelada. Sessão encerrada!",
};

const ALL_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

function RoomPage() {
  const { code } = Route.useParams();
  const { room, players, events, loading } = useRoomState(code);
  const [meId, setMeId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastLetter, setLastLetter] = useState<string | null>(null);
  const [ghostMoving, setGhostMoving] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [audioOn, setAudioOn] = useState(false);
  const [scare, setScare] = useState<{ seq: number; message: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const lastHauntSeq = useRef(0);
  const lastAskSeq = useRef(0);
  const lastRevealed = useRef(0);

  useEffect(() => {
    setMeId(storedPlayerId(code));
  }, [code]);

  const me = players.find((p) => p.id === meId) ?? null;
  const isHost = !!me && room?.host_id === me.id;

  // relógio do sistema: só o kernel (host) avança o quantum, o deadlock e o fantasma
  useEffect(() => {
    if (!isHost || !room || room.phase !== "playing") return;
    const id = window.setInterval(() => {
      void tickRoom({ data: { roomId: room.id } });
    }, 1200);
    return () => window.clearInterval(id);
  }, [isHost, room?.id, room?.phase, room]);

  // conversa com o fantasma: soletra a resposta aos poucos, em qualquer fase
  useEffect(() => {
    if (!isHost || !room) return;
    const id = window.setInterval(() => {
      void tickGhostAnswer({ data: { roomId: room.id } });
    }, 1100);
    return () => window.clearInterval(id);
  }, [isHost, room?.id, room]);

  // reseta o acompanhamento da resposta a cada nova pergunta
  useEffect(() => {
    if (!room) return;
    if (room.ask_seq !== lastAskSeq.current) {
      lastAskSeq.current = room.ask_seq;
      lastRevealed.current = 0;
    }
  }, [room?.ask_seq]);

  // planchette desliza sozinha soletrando a resposta do fantasma
  useEffect(() => {
    if (!room || !room.ghost_answer) return;
    const revealed = room.ghost_answer_revealed;
    if (revealed <= lastRevealed.current) return;
    const ch = room.ghost_answer[revealed - 1];
    lastRevealed.current = revealed;
    if (!ch) return;
    playGlide();
    setGhostMoving(true);
    setLastLetter(ch === " " ? " " : ch.toUpperCase());
    window.setTimeout(() => setGhostMoving(false), 700);
  }, [room?.ghost_answer_revealed, room?.ghost_answer]);

  // reage às assombrações do processo fantasma
  useEffect(() => {
    if (!room) return;
    if (room.haunt_seq === lastHauntSeq.current) return;
    lastHauntSeq.current = room.haunt_seq;
    if (room.haunt_seq === 0) return;

    switch (room.haunt_kind) {
      case "whisper":
        playWhisper();
        break;
      case "fake_write":
        playFakeWrite();
        setGhostMoving(true);
        setLastLetter(ALL_GLYPHS[Math.floor(Math.random() * ALL_GLYPHS.length)] ?? null);
        window.setTimeout(() => setGhostMoving(false), 900);
        break;
      case "steal":
        playSteal();
        setGhostMoving(true);
        setLastLetter(ALL_GLYPHS[Math.floor(Math.random() * ALL_GLYPHS.length)] ?? null);
        window.setTimeout(() => setGhostMoving(false), 2800);
        break;
      case "jumpscare":
        playJumpscare();
        setScare({ seq: room.haunt_seq, message: room.haunt_message ?? "ELE ESTÁ AQUI" });
        break;
    }
  }, [room?.haunt_seq, room?.haunt_kind, room?.haunt_message]);

  // batimento cardíaco quando o sistema entra em impasse
  useEffect(() => {
    if (room?.deadlock) startHeartbeat();
    else stopHeartbeat();
    return () => stopHeartbeat();
  }, [room?.deadlock]);

  const toggleAudio = useCallback(async () => {
    if (audioOn) {
      await muteAudio();
      setAudioOn(false);
    } else {
      await armAudio();
      setAudioOn(isAudioArmed());
    }
  }, [audioOn]);

  async function join() {
    if (!joinName.trim()) return;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    try {
      const player = await joinRoom({ data: { code, name: joinName.trim().slice(0, 18), color } });
      storePlayerId(code, player.id);
      setMeId(player.id);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Falha ao entrar");
    }
  }

  async function start() {
    if (!room) return;
    const alive = players.map((p) => p.id);
    const hints = buildHints(room.target_phrase, alive);
    const flat: Record<string, string> = {};
    for (const id of alive) flat[id] = (hints[id] ?? []).join(",");
    await startRoom({ data: { roomId: room.id, hints: flat } });
  }

  async function reset() {
    if (!room) return;
    await resetRoom({ data: { roomId: room.id } });
  }

  async function config(patch: {
    mutex_enabled?: boolean;
    scheduler?: Scheduler;
    aging_enabled?: boolean;
    quantum_ms?: number;
  }) {
    if (!room) return;
    await configRoom({ data: { roomId: room.id, ...patch } });
  }

  async function pick(ch: string) {
    if (!me) return;
    setLastLetter(ch);
    try {
      const result = await writeLetter({ data: { playerId: me.id, ch } });
      setStatus(RESULT_MESSAGE[result.result] ?? result.result);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Erro ao escrever");
    }
  }

  async function askQuestion() {
    if (!me || !question.trim()) return;
    try {
      const out = await askGhost({ data: { playerId: me.id, question: question.trim() } });
      if (out === "busy") setAskStatus("O espírito ainda está respondendo a outra pergunta.");
      else if (out === "empty") setAskStatus(null);
      else setAskStatus(null);
      setQuestion("");
    } catch (e) {
      setAskStatus(e instanceof Error ? e.message : "Erro ao perguntar");
    }
  }

  if (loading) {
    return <p className="p-10 terminal text-muted-foreground">carregando sessão...</p>;
  }

  if (!room) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-3xl text-primary">Sessão não encontrada</h1>
        <Link to="/" className="terminal text-accent underline">
          voltar ao saguão
        </Link>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-3xl text-primary">Sessão {room.code}</h1>
        <div className="panel w-full max-w-sm space-y-3 p-6">
          <span className="terminal text-muted-foreground">nome do processo</span>
          <input
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            className="w-full rounded border border-border bg-input px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={join}
            className="w-full rounded bg-primary px-4 py-2 font-display text-xs tracking-[0.25em] text-primary-foreground"
          >
            FORK
          </button>
          {status && <p className="terminal text-destructive">{status}</p>}
        </div>
      </main>
    );
  }

  const hints = parseHints(me.letters);
  const revealed = room.shared_memory;
  const holdsPointer = room.pointer_holder === me.id;
  const holdsCandle = room.candle_holder === me.id;
  const pointerGhost = room.pointer_holder === GHOST_ID;
  const candleGhost = room.candle_holder === GHOST_ID;
  const pointerOwner = players.find((p) => p.id === room.pointer_holder);
  const candleOwner = players.find((p) => p.id === room.candle_holder);
  const canWrite = room.phase === "playing" && me.state !== "terminated" && !room.deadlock;

  return (
    <main className="mx-auto grid max-w-6xl gap-5 px-4 py-8 lg:grid-cols-[1.5fr_1fr]">
      {scare && <Jumpscare message={scare.message} onDone={() => setScare(null)} />}

      <header className="lg:col-span-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/" className="terminal text-muted-foreground hover:text-accent">
            ← saguão
          </Link>
          <h1 className="text-2xl text-primary sm:text-3xl">Sessão {room.code}</h1>
          <p className="terminal text-muted-foreground">
            compartilhe este código · {players.length} processo(s) ·{" "}
            {SCHEDULER_LABEL[room.scheduler]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleAudio()}
            className="rounded border border-border px-3 py-2 font-display text-xs tracking-[0.15em] text-muted-foreground hover:text-foreground"
            title="O sistema respira melhor com som"
          >
            {audioOn ? "🔊 ÁUDIO LIGADO" : "🔈 LIGAR ÁUDIO"}
          </button>
          {isHost && room.phase !== "playing" && (
            <button
              type="button"
              onClick={start}
              className="rounded bg-primary px-4 py-2 font-display text-xs tracking-[0.2em] text-primary-foreground"
            >
              INICIAR SESSÃO
            </button>
          )}
          {isHost && room.phase === "playing" && (
            <button
              type="button"
              onClick={reset}
              className="rounded border border-border px-4 py-2 font-display text-xs tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              REINICIAR
            </button>
          )}
        </div>
      </header>

      <section className="space-y-4">
        <div className="panel p-4">
          <h2 className="text-sm tracking-[0.25em] text-primary">MEMÓRIA COMPARTILHADA</h2>
          <p className="mt-3 break-words font-mono text-xl tracking-[0.25em] text-phosphor sm:text-2xl">
            {room.target_phrase.split("").map((ch, i) => {
              const done = i < revealed.length;
              const known = hints.find((h) => h.pos === i);
              return (
                <span
                  key={i}
                  className={
                    done ? "text-phosphor" : known ? "text-ember/80" : "text-muted-foreground/50"
                  }
                >
                  {done ? revealed[i] : ch === " " ? " " : known ? known.ch.toLowerCase() : "•"}
                </span>
              );
            })}
          </p>
          <p className="mt-2 terminal text-muted-foreground">
            em âmbar: as letras que só o SEU processo conhece · escreva na ordem correta
          </p>
        </div>

        <OuijaBoard
          onPick={pick}
          disabled={!canWrite}
          lastLetter={lastLetter}
          corruption={room.corruption}
          ghostMoving={ghostMoving || pointerGhost}
        />

        <div className="panel flex flex-wrap items-center gap-2 p-4">
          <button
            type="button"
            onClick={() =>
              void (holdsPointer
                ? releasePointer({ data: { playerId: me.id } })
                : acquirePointer({ data: { playerId: me.id } }))
            }
            className={`rounded px-3 py-2 font-display text-xs tracking-[0.15em] ${
              holdsPointer
                ? "bg-accent text-accent-foreground"
                : "border border-accent text-accent hover:bg-accent/10"
            }`}
          >
            {holdsPointer ? "🜚 LIBERAR PONTEIRO" : "🜚 PEGAR PONTEIRO"}
          </button>
          <button
            type="button"
            onClick={() =>
              void (holdsCandle
                ? releaseCandle({ data: { playerId: me.id } })
                : acquireCandle({ data: { playerId: me.id } }))
            }
            className={`rounded px-3 py-2 font-display text-xs tracking-[0.15em] ${
              holdsCandle
                ? "bg-primary text-primary-foreground"
                : "border border-primary text-primary hover:bg-primary/10"
            }`}
          >
            {holdsCandle ? "🕯 LIBERAR VELA" : "🕯 PEGAR VELA"}
          </button>
          {me.state === "terminated" && (
            <button
              type="button"
              onClick={() => void reviveProcess({ data: { playerId: me.id } })}
              className="rounded border border-border px-3 py-2 font-display text-xs tracking-[0.15em]"
            >
              RESPAWN
            </button>
          )}
          <span className="terminal ml-auto text-muted-foreground">
            ponteiro: {pointerGhost ? "O ESPÍRITO" : (pointerOwner?.name ?? "livre")} · vela:{" "}
            {candleGhost ? "O ESPÍRITO" : (candleOwner?.name ?? "livre")}
          </span>
        </div>

        <div className="panel space-y-3 p-4">
          <h2 className="text-sm tracking-[0.25em] text-primary">FALE COM O ESPÍRITO</h2>
          <p className="terminal text-muted-foreground">
            uma pergunta é uma mensagem assíncrona para o processo fantasma — ele responde quando
            quiser, uma letra por vez.
          </p>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void askQuestion()}
              disabled={room.ghost_answering}
              maxLength={140}
              placeholder="ex.: você está aqui?"
              className="w-full rounded border border-border bg-input px-3 py-2 font-mono text-sm outline-none focus:border-ghost disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void askQuestion()}
              disabled={room.ghost_answering || !question.trim()}
              className="shrink-0 rounded border border-ghost px-4 py-2 font-display text-xs tracking-[0.2em] text-ghost transition hover:bg-ghost/10 disabled:opacity-40"
            >
              PERGUNTAR
            </button>
          </div>

          {room.ghost_question && (
            <div className="terminal space-y-1">
              <p className="text-muted-foreground">
                pergunta: <span className="text-foreground">"{room.ghost_question}"</span>
              </p>
              <p
                className={`text-lg tracking-[0.2em] ${room.ghost_answering ? "ghost-line text-ghost" : "text-ghost"}`}
              >
                {room.ghost_answer
                  ?.split("")
                  .map((ch, i) => (i < room.ghost_answer_revealed ? ch : ch === " " ? " " : "▮"))
                  .join("")}
                {room.ghost_answering && <span className="animate-pulse">▮</span>}
              </p>
            </div>
          )}

          {askStatus && <p className="terminal text-destructive">{askStatus}</p>}
        </div>

        {room.deadlock && (
          <div className="panel border-destructive/70 p-4 text-center">
            <h2 className="text-sm tracking-[0.25em] text-destructive flicker">
              IMPASSE DETECTADO
            </h2>
            <p className="mt-2 font-serif text-sm text-muted-foreground">
              {pointerOwner?.name} espera a vela de {candleOwner?.name}, que espera o ponteiro.
              Ciclo fechado no grafo de alocação — o kernel precisa encerrar um processo.
            </p>
          </div>
        )}

        {status && (
          <p className="terminal rounded border border-border bg-card px-3 py-2 text-foreground">
            {status}
          </p>
        )}

        {room.phase === "finished" && (
          <div className="panel p-5 text-center">
            <h2 className="text-xl text-primary">“{room.target_phrase}”</h2>
            <p className="mt-2 font-serif text-muted-foreground">
              Mensagem revelada com {room.corruption} corrupção(ões) de memória.
            </p>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <ProcessTable
          players={players}
          room={room}
          meId={me.id}
          onKill={(id) => void killProcess({ data: { playerId: id } })}
        />

        {isHost && (
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm tracking-[0.25em] text-primary">PAINEL DO KERNEL</h2>
            <label className="flex items-center justify-between terminal">
              <span>exclusão mútua (mutex)</span>
              <input
                type="checkbox"
                checked={room.mutex_enabled}
                onChange={(e) => void config({ mutex_enabled: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between terminal">
              <span>aging (anti-inanição)</span>
              <input
                type="checkbox"
                checked={room.aging_enabled}
                onChange={(e) => void config({ aging_enabled: e.target.checked })}
              />
            </label>
            <label className="block terminal">
              <span className="text-muted-foreground">escalonador</span>
              <select
                value={room.scheduler}
                onChange={(e) => void config({ scheduler: e.target.value as Scheduler })}
                className="mt-1 w-full rounded border border-border bg-input px-2 py-1 font-mono text-xs"
              >
                <option value="fifo">FIFO</option>
                <option value="rr">Round Robin</option>
                <option value="priority">Prioridade</option>
              </select>
            </label>
            {room.scheduler === "rr" && (
              <label className="block terminal">
                <span className="text-muted-foreground">quantum: {room.quantum_ms} ms</span>
                <input
                  type="range"
                  min={2000}
                  max={15000}
                  step={1000}
                  value={room.quantum_ms}
                  onChange={(e) => void config({ quantum_ms: Number(e.target.value) })}
                  className="w-full"
                />
              </label>
            )}
            <p className="terminal text-muted-foreground">
              Desligue o mutex para ver condições de corrida acontecerem de verdade entre as
              máquinas.
            </p>
          </div>
        )}

        <EventLog events={events} />
      </aside>
    </main>
  );
}
