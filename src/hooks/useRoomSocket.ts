"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";

export function useRoomSocket(roomId: string) {
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    socket.current = ws;
    setConnected(false);
    setMessages([]);
    setError(null);

    ws.addEventListener("open", () => {
      if (socket.current === ws) {
        setConnected(true);
      }
    });

    ws.addEventListener("close", () => {
      if (socket.current === ws) {
        setConnected(false);
        socket.current = null;
      }
    });

    ws.addEventListener("error", () => {
      if (socket.current === ws) {
        setError("Connection interrupted");
      }
    });

    ws.addEventListener("message", (event) => {
      if (socket.current !== ws) {
        return;
      }

      try {
        const parsed = JSON.parse(String(event.data)) as ServerMessage;
        setMessages((previous) => [...previous, parsed]);
      } catch {
        setError("Received an unreadable table update");
      }
    });

    return () => {
      ws.close();
    };
  }, [roomId]);

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
      return;
    }

    setError("Reconnecting to table");
  }, []);

  return { connected, error, messages, send };
}
