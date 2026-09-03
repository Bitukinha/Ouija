import { useLayoutEffect, useRef, useState } from "react";
import { ROW_1, ROW_2, ROW_3 } from "@/lib/game";

type Props = {
  onPick: (ch: string) => void;
  disabled: boolean;
  lastLetter: string | null;
  corruption: number;
  ghostMoving?: boolean;
};

function Glyph({
  ch,
  onPick,
  disabled,
  active,
  buttonRef,
}: {
  ch: string;
  onPick: (c: string) => void;
  disabled: boolean;
  active: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={() => onPick(ch)}
      className={`glyph-btn h-9 w-8 text-xl leading-none sm:h-11 sm:w-10 sm:text-2xl ${
        disabled ? "cursor-not-allowed opacity-40" : "hover:glyph-btn-hover cursor-pointer"
      } ${active ? "glyph-btn-hover" : ""}`}
    >
      {ch}
    </button>
  );
}

export function OuijaBoard({ onPick, disabled, lastLetter, corruption, ghostMoving }: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [planchette, setPlanchette] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!lastLetter) return;
    const key = lastLetter === " " ? "SPACE" : lastLetter;
    const el = buttonRefs.current[key];
    if (!el) return;
    setPlanchette({
      x: el.offsetLeft + el.offsetWidth / 2,
      y: el.offsetTop + el.offsetHeight / 2,
    });
  }, [lastLetter]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border p-5 shadow-2xl sm:p-8">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, oklch(0.68 0.05 70), oklch(0.5 0.055 55) 60%, oklch(0.32 0.05 40))",
        }}
      />
      <div
        className="absolute inset-0 opacity-30 mix-blend-multiply"
        style={{
          backgroundImage:
            "repeating-linear-gradient(96deg, oklch(0.15 0.04 40 / 0.6) 0 2px, transparent 2px 9px)",
        }}
      />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, oklch(0 0 0 / 0.55) 100%)",
        }}
      />

      <div className="relative" ref={boardRef}>
        <div className="flex items-center justify-between text-board-ink">
          <span className="font-display text-sm tracking-[0.35em] sm:text-base">SIM</span>
          <span className="font-serif text-center text-xs italic opacity-70 sm:text-sm">
            memória compartilhada · região crítica
          </span>
          <span className="font-display text-sm tracking-[0.35em] sm:text-base">NÃO</span>
        </div>

        <div className="mt-6 flex flex-col items-center gap-1">
          <div className="flex flex-wrap justify-center">
            {ROW_1.map((c) => (
              <Glyph
                key={c}
                ch={c}
                onPick={onPick}
                disabled={disabled}
                active={lastLetter === c}
                buttonRef={(el) => {
                  buttonRefs.current[c] = el;
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap justify-center">
            {ROW_2.map((c) => (
              <Glyph
                key={c}
                ch={c}
                onPick={onPick}
                disabled={disabled}
                active={lastLetter === c}
                buttonRef={(el) => {
                  buttonRefs.current[c] = el;
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap justify-center">
            {ROW_3.map((c) => (
              <Glyph
                key={c}
                ch={c}
                onPick={onPick}
                disabled={disabled}
                active={lastLetter === c}
                buttonRef={(el) => {
                  buttonRefs.current[c] = el;
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 text-board-ink">
          <button
            ref={(el) => {
              buttonRefs.current["SPACE"] = el;
            }}
            type="button"
            disabled={disabled}
            onClick={() => onPick(" ")}
            className="glyph-btn rounded border border-board-ink/40 px-4 py-1 text-xs tracking-[0.3em] disabled:opacity-40"
          >
            ESPAÇO
          </button>
          <span className="font-display text-xs tracking-[0.35em] opacity-70">ADEUS</span>
        </div>

        <div
          className={`planchette ${planchette ? "planchette-active" : ""} ${ghostMoving ? "planchette-ghost" : ""}`}
          style={planchette ? { transform: `translate(${planchette.x}px, ${planchette.y}px) translate(-50%, -65%)` } : undefined}
        >
          <div className="planchette-body">
            <span className="planchette-eye" />
          </div>
        </div>

        {corruption > 0 && (
          <div className="mt-4 text-center font-mono text-[0.65rem] tracking-widest text-destructive">
            {corruption} escrita(s) corrompida(s) por concorrência
          </div>
        )}
      </div>
    </div>
  );
}
