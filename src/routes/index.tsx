import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createRoom, joinRoom, setHost } from "@/lib/api";
import { COLORS, randomCode, randomPhrase, storePlayerId } from "@/lib/game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tabuleiro Ouija do Kernel — jogo multiplayer de Sistemas Operacionais" },
      {
        name: "description",
        content:
          "Jogo multiplayer em tempo real onde cada jogador é um processo disputando a memória compartilhada, e um processo fantasma espreita: exclusão mútua, deadlock, starvation e escalonamento.",
      },
      { property: "og:title", content: "Tabuleiro Ouija do Kernel" },
      {
        property: "og:description",
        content:
          "Sessão espírita concorrente: mutex, semáforos, deadlock, escalonadores FIFO/Round Robin/Prioridade e um processo fantasma que ninguém consegue colher.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter(roomCode: string, host: boolean) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    let player: { id: string };
    try {
      player = await joinRoom({ data: { code: roomCode, name: name.trim().slice(0, 18), color } });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Falha ao entrar");
    }
    storePlayerId(roomCode, player.id);
    if (host) {
      await setHost({ data: { playerId: player.id, code: roomCode } });
    }
    navigate({ to: "/sala/$code", params: { code: roomCode } });
  }

  async function createNewRoom() {
    if (!name.trim()) return setError("Diga seu nome de processo.");
    setBusy(true);
    setError(null);
    try {
      const newCode = randomCode();
      await createRoom({
        data: { code: newCode, hostId: crypto.randomUUID(), targetPhrase: randomPhrase() },
      });
      await enter(newCode, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
      setBusy(false);
    }
  }

  async function joinExistingRoom() {
    if (!name.trim()) return setError("Diga seu nome de processo.");
    if (code.trim().length < 4) return setError("Código inválido.");
    setBusy(true);
    setError(null);
    try {
      await enter(code.trim().toUpperCase(), false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sala não encontrada");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-5 py-16">
      <header className="text-center">
        <p className="terminal tracking-[0.4em] text-accent">SISTEMAS OPERACIONAIS</p>
        <h1 className="mt-3 text-4xl leading-tight text-primary flicker sm:text-5xl">
          Tabuleiro Ouija do Kernel
        </h1>
        <p className="mx-auto mt-4 max-w-xl font-serif text-lg text-muted-foreground">
          Vários processos, um único ponteiro. Cada jogador invoca uma letra na{" "}
          <em className="text-foreground">memória compartilhada</em>. Sem exclusão mútua, o espírito
          responde em ruído: condições de corrida, impasses e inanição. E existe um processo que
          ninguém conseguiu colher —{" "}
          <em className="ghost-line text-ghost">ele também está na mesa.</em>
        </p>
      </header>

      <section className="panel w-full max-w-md space-y-4 p-6">
        <label className="block">
          <span className="terminal text-muted-foreground">nome do processo</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={18}
            placeholder="ex.: proc_ana"
            className="mt-1 w-full rounded border border-border bg-input px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ember-glow"
          />
        </label>

        <button
          type="button"
          onClick={createNewRoom}
          disabled={busy}
          className="w-full rounded bg-primary px-4 py-3 font-display text-sm tracking-[0.25em] text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          ABRIR SESSÃO
        </button>

        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span className="terminal">ou entre em uma</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="CÓDIGO"
            className="w-full rounded border border-border bg-input px-3 py-2 text-center font-mono text-sm tracking-[0.4em] outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={joinExistingRoom}
            disabled={busy}
            className="shrink-0 rounded border border-accent px-4 py-2 font-display text-xs tracking-[0.2em] text-accent transition hover:bg-accent/10 disabled:opacity-50"
          >
            ENTRAR
          </button>
        </div>

        {error && <p className="terminal text-destructive">{error}</p>}
      </section>

      <section className="grid w-full gap-3 sm:grid-cols-3">
        {[
          ["Exclusão mútua", "O ponteiro é um mutex. Quem não o segura fica BLOQUEADO na fila."],
          ["Impasse", "Vogais exigem o ponteiro e a vela. Recursos cruzados = deadlock detectado."],
          ["Escalonamento", "FIFO, Round Robin com quantum e Prioridade com aging opcional."],
        ].map(([title, desc]) => (
          <article key={title} className="panel p-4">
            <h2 className="text-xs tracking-[0.2em] text-accent">{title}</h2>
            <p className="mt-2 font-serif text-sm text-muted-foreground">{desc}</p>
          </article>
        ))}
      </section>

      <p className="terminal max-w-md text-center text-muted-foreground">
        ative o áudio dentro da sessão para ouvir o sistema respirar — e para ouvi-lo quando ele
        decide falar de volta.
      </p>
    </main>
  );
}
