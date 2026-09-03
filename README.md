# Tabuleiro Ouija do Kernel

Jogo multiplayer de terror para a disciplina de **Sistemas Operacionais**. Cada jogador
entra numa sessão como um _processo_ concorrente disputando dois recursos compartilhados —
o **ponteiro** (mutex) e a **vela** (segundo recurso, usado para forçar impasses) — para
revelar uma frase letra por letra numa "memória compartilhada". E ninguém entra sozinho: um
**processo fantasma**, órfão e nunca colhido pelo escalonador, também está na mesa.

## Conceitos de SO no jogo

| Mecânica do jogo                            | Conceito de Sistemas Operacionais                 |
| ------------------------------------------- | ------------------------------------------------- |
| Pegar/liberar o **ponteiro**                | Exclusão mútua (mutex/lock)                       |
| Fila de espera ao pedir o ponteiro          | Processo **BLOQUEADO**, fila de prontos           |
| Ponteiro + vela cruzados                    | **Deadlock** (impasse circular)                   |
| Botão SIGKILL num impasse                   | Recuperação de deadlock por término de processo   |
| Escalonador FIFO / Round Robin / Prioridade | Algoritmos de escalonamento de CPU                |
| "quantum" do Round Robin                    | Preempção por fatia de tempo                      |
| "aging" da fila de prioridade               | Prevenção de inanição (_starvation_)              |
| Mutex desligado + duas escritas próximas    | **Condição de corrida** (race condition)          |
| Letra errada                                | _Page fault_ (penalidade)                         |
| O processo fantasma (PID 0)                 | Processo **zumbi/órfão** e interrupção assíncrona |

O processo fantasma roda dentro do próprio "tick" do kernel: de tempos em tempos ele
sussurra no log, corrompe uma leitura da memória compartilhada, ou toma o ponteiro/vela à
força por alguns segundos — sempre no vocabulário de SO (interrupção não mascarável,
processo órfão, PID que o escalonador não lista).

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19 + Vite + Nitro) para SSR e
  _server functions_
- [Postgres via Neon](https://neon.tech) como banco — toda a lógica de jogo (mutex,
  escalonador, deadlock, fantasma) roda em funções PL/pgSQL (`db/schema.sql`), chamadas
  só pelo servidor
- Sincronização multiplayer por _polling_ (~900ms) — sem WebSocket, compatível com
  funções serverless da Vercel
- Áudio de terror 100% sintetizado via Web Audio API (sem arquivos externos)
- Tailwind CSS v4 + Radix UI

## Rodando localmente

Requer [Bun](https://bun.sh).

```sh
bun install
```

Crie um banco Postgres (ex.: [Neon](https://neon.tech), tem plano gratuito) e defina a
connection string:

```sh
cp .env.example .env
# edite .env e cole sua DATABASE_URL
```

Aplique o schema (tabelas + funções do jogo) no banco:

```sh
bun run db:migrate
```

Suba o servidor de desenvolvimento:

```sh
bun run dev
```

Abra `http://localhost:8080`, crie uma sala e abra o link em outra aba (ou peça para um
colega entrar) para jogar em multiplayer.

## Deploy

O projeto já está configurado para a Vercel (preset `vercel` do Nitro). Basta importar o
repositório na Vercel e configurar a variável de ambiente `DATABASE_URL` apontando para o
seu banco Neon.
