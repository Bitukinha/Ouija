import { useEffect, useRef, useState } from "react";
import { getRoomState } from "@/lib/api";
import type { GameEvent, Player, Room } from "@/lib/game";

const POLL_MS = 900;

export function useRoomState(code: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const state = await getRoomState({ data: code });
        if (stopped) return;
        setRoom(state.room);
        setPlayers(state.players);
        setEvents(state.events);
      } catch {
        // rede instável — tenta de novo no próximo tick
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    }

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [code]);

  return { room, players, events, loading, setRoom, setPlayers, setEvents };
}
