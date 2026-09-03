import type { GameEvent, Player, Room } from "@/lib/game";
import { GHOST_ID, GHOST_NAME, SCHEDULER_LABEL, STATE_LABEL } from "@/lib/game";

const KIND_COLOR: Record<string, string> = {
  race: "text-destructive",
  deadlock: "text-destructive",
  kill: "text-destructive",
  fault: "text-ember",
  preempt: "text-ember",
  wait: "text-muted-foreground",
  lock: "text-phosphor",
  unlock: "text-phosphor",
  grant: "text-phosphor",
  write: "text-foreground",
  end: "text-primary",
  proc: "text-muted-foreground",
  ghost: "text-ghost ghost-line",
  jumpscare: "text-ghost ghost-line",
};

export function ProcessTable({
  players,
  room,
  meId,
  onKill,
}: {
  players: Player[];
  room: Room;
  meId: string | null;
  onKill: (id: string) => void;
}) {
  const ghostPresent = room.pointer_holder === GHOST_ID || room.candle_holder === GHOST_ID;

  return (
    <div className="panel p-4">
      <h2 className="text-sm tracking-[0.25em] text-primary">TABELA DE PROCESSOS</h2>
      <div className="mt-3 space-y-2">
        {ghostPresent && (
          <div className="ghost-line flex items-center gap-3 rounded border border-ghost/60 bg-ghost/10 px-3 py-2 terminal">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ghost" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ghost">
              {GHOST_NAME} <span className="text-muted-foreground">·pid_0</span>
            </span>
            <span className="text-ghost">EXECUTANDO</span>
            <span className="w-8 text-center">
              {room.pointer_holder === GHOST_ID ? "🜚" : ""}
              {room.candle_holder === GHOST_ID ? "🕯" : ""}
            </span>
          </div>
        )}
        {players.map((p) => {
          const holdsPointer = room.pointer_holder === p.id;
          const holdsCandle = room.candle_holder === p.id;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded border px-3 py-2 terminal ${
                p.id === meId ? "border-primary/60 bg-primary/5" : "border-border/70"
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {p.name}
                {p.is_host && <span className="text-muted-foreground"> ·kernel</span>}
              </span>
              <span className="text-muted-foreground">p{p.priority}</span>
              <span
                className={
                  p.state === "running"
                    ? "text-running"
                    : p.state === "blocked"
                      ? "text-blocked"
                      : p.state === "terminated"
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                }
              >
                {STATE_LABEL[p.state]}
              </span>
              <span className="w-14 text-right text-primary">{p.score} pts</span>
              <span className="w-8 text-center">
                {holdsPointer ? "🜚" : ""}
                {holdsCandle ? "🕯" : ""}
              </span>
              {room.deadlock && (holdsPointer || holdsCandle) && (
                <button
                  type="button"
                  onClick={() => onKill(p.id)}
                  className="rounded border border-destructive/70 px-2 py-0.5 text-[0.6rem] text-destructive hover:bg-destructive/15"
                >
                  SIGKILL
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 terminal text-muted-foreground">
        Escalonador: {SCHEDULER_LABEL[room.scheduler]}
        {room.scheduler === "rr" && ` · quantum ${room.quantum_ms}ms`}
        {room.aging_enabled && " · aging ligado"} · mutex{" "}
        {room.mutex_enabled ? "ATIVO" : "DESLIGADO"}
      </p>
    </div>
  );
}

export function EventLog({ events }: { events: GameEvent[] }) {
  return (
    <div className="panel flex max-h-80 flex-col p-4">
      <h2 className="text-sm tracking-[0.25em] text-primary">REGISTRO DO KERNEL</h2>
      <div className="mt-3 flex-1 space-y-1 overflow-y-auto pr-1">
        {events.length === 0 && (
          <p className="terminal text-muted-foreground">aguardando chamadas de sistema...</p>
        )}
        {events.map((e) => (
          <p key={e.id} className={`terminal ${KIND_COLOR[e.kind] ?? "text-foreground"}`}>
            <span className="text-muted-foreground">
              [{new Date(e.created_at).toLocaleTimeString("pt-BR", { hour12: false })}]
            </span>{" "}
            {e.message}
          </p>
        ))}
      </div>
    </div>
  );
}
