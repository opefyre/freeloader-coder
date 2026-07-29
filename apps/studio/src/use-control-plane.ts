import { useCallback, useEffect, useRef, useState } from "react";

import {
  failedControlPlaneState,
  fetchControlPlaneSnapshot,
  liveControlPlaneState,
  type ControlPlaneConnectionState,
} from "./control-plane-client.js";

const endpoint =
  import.meta.env.VITE_PIPELINE_STUDIO_CONTROL_URL ?? "http://127.0.0.1:4312";

export function useControlPlane() {
  const [state, setState] = useState<ControlPlaneConnectionState>({
    status: "connecting",
    snapshot: null,
    observedAt: null,
    reason: null,
  });
  const active = useRef(false);
  const disposed = useRef(false);

  const refresh = useCallback(async () => {
    if (active.current || disposed.current) return;
    active.current = true;
    try {
      const value = await fetchControlPlaneSnapshot({
        endpoint,
        timeoutMs: 2_500,
      });
      if (!disposed.current) {
        setState(liveControlPlaneState(value, Date.now()));
      }
    } catch (error) {
      if (!disposed.current) {
        const reason =
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : error instanceof SyntaxError
              ? "invalid_response"
              : "network";
        setState((previous) =>
          failedControlPlaneState({ previous, reason, now: Date.now() })
        );
      }
    } finally {
      active.current = false;
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5_000);
    return () => {
      disposed.current = true;
      window.clearInterval(poll);
    };
  }, [refresh]);

  return { state, refresh, endpoint };
}
