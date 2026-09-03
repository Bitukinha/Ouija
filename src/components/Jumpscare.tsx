import { useEffect, useState } from "react";

type Props = {
  message: string;
  onDone: () => void;
};

/** Overlay de tela cheia para o susto do processo fantasma — só CSS/SVG, sem imagens. */
export function Jumpscare({ message, onDone }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(false), 650);
    const id2 = window.setTimeout(onDone, 900);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(id2);
    };
  }, [onDone]);

  return (
    <div
      className={`jumpscare-overlay fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden="true"
    >
      <div className="jumpscare-static absolute inset-0" />
      <svg
        viewBox="0 0 200 200"
        className="jumpscare-eyes relative h-40 w-40 sm:h-56 sm:w-56"
      >
        <circle cx="55" cy="100" r="26" fill="var(--color-destructive)" />
        <circle cx="145" cy="100" r="26" fill="var(--color-destructive)" />
        <circle cx="55" cy="100" r="8" fill="black" />
        <circle cx="145" cy="100" r="8" fill="black" />
      </svg>
      <p className="jumpscare-text absolute bottom-[15%] px-6 text-center font-display text-2xl tracking-[0.2em] text-destructive sm:text-4xl">
        {message}
      </p>
    </div>
  );
}
