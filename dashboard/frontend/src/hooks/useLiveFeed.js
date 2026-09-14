import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, getToken, logout } from "../lib/auth.js";

// Default to the backend's own host so the dashboard works when opened from
// another device on the LAN, not just localhost. Override via .env if needed.
const DEFAULT_HOST = typeof window !== "undefined" ? window.location.hostname : "localhost";
const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${DEFAULT_HOST}:8000/ws/live-feed`;
const REST_URL = import.meta.env.VITE_API_URL || `http://${DEFAULT_HOST}:8000/api/initial-state`;

const MAX_METRIC_HISTORY = 60; // ~6-20s of sparkline history depending on feed rate
const MAX_TRAIL_LENGTH = 8; // last N positions per tracked object

function emptyMetricsHistory() {
  return { fps: [], latency_ms: [], miou: [], compute_savings_pct: [] };
}

/**
 * Connects to the dashboard backend's WebSocket live feed, with a REST
 * snapshot for the very first paint and automatic reconnect with backoff.
 * Also derives client-side motion trails per track_id, since the data
 * contract only carries the current position -- trails are a rendering
 * concern, not something the backend needs to compute.
 */
export function useLiveFeed() {
  const [status, setStatus] = useState("connecting"); // connecting | open | closed | error | unauthorized
  const [meta, setMeta] = useState(null);
  const [frame, setFrame] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState(emptyMetricsHistory());
  const [trailsVersion, setTrailsVersion] = useState(0);

  const trailsRef = useRef(new Map()); // track_id -> [[x, y], ...]
  const retryRef = useRef(0);

  const applyFrame = useCallback((f) => {
    if (!f) return;

    const seen = new Set();
    for (const obj of f.objects || []) {
      seen.add(obj.track_id);
      const prev = trailsRef.current.get(obj.track_id) || [];
      const next = [...prev, [obj.position[0], obj.position[1]]];
      while (next.length > MAX_TRAIL_LENGTH) next.shift();
      trailsRef.current.set(obj.track_id, next);
    }
    for (const id of Array.from(trailsRef.current.keys())) {
      if (!seen.has(id)) trailsRef.current.delete(id);
    }

    setFrame(f);
    setTrailsVersion((v) => v + 1);
    if (f.metrics) {
      setMetricsHistory((prev) => ({
        fps: [...prev.fps, f.metrics.fps].slice(-MAX_METRIC_HISTORY),
        latency_ms: [...prev.latency_ms, f.metrics.latency_ms].slice(-MAX_METRIC_HISTORY),
        miou: [...prev.miou, f.metrics.miou].slice(-MAX_METRIC_HISTORY),
        compute_savings_pct: [...prev.compute_savings_pct, f.metrics.compute_savings_pct].slice(-MAX_METRIC_HISTORY),
      }));
    }
  }, []);

  // One-shot REST snapshot so the UI paints before the WebSocket connects.
  useEffect(() => {
    let cancelled = false;
    fetch(REST_URL, { headers: authHeaders() })
      .then((r) => {
        if (r.status === 401) {
          logout();
          if (!cancelled) setStatus("unauthorized");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setMeta(data.meta);
        applyFrame(data.frame);
      })
      .catch(() => {
        // WebSocket connection below will still establish the feed; the
        // initial paint just waits a beat longer.
      });
    return () => {
      cancelled = true;
    };
  }, [applyFrame]);

  useEffect(() => {
    let cancelled = false;
    let socket;
    let reconnectTimer;

    function connect() {
      if (cancelled) return;
      const token = getToken();
      if (!token) {
        setStatus("unauthorized");
        return;
      }
      setStatus("connecting");
      socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);

      socket.onopen = () => {
        retryRef.current = 0;
        setStatus("open");
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "meta") setMeta(msg.meta);
          else if (msg.type === "frame") applyFrame(msg.frame);
        } catch {
          // ignore malformed message, keep the connection alive
        }
      };
      socket.onclose = (event) => {
        if (cancelled) return;
        // 4401 is this backend's app-level "bad/expired token" close code
        // (sent before the handshake completes) -- retrying with the same
        // token would just fail again, so stop and send the user to login.
        if (event.code === 4401) {
          logout();
          setStatus("unauthorized");
          return;
        }
        setStatus("closed");
        const delay = Math.min(5000, 500 * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        setStatus("error");
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [applyFrame]);

  return {
    status,
    meta,
    frame,
    metricsHistory,
    trails: trailsRef.current,
    trailsVersion,
  };
}
