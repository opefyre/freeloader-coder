import {
  assessSnapshotFreshness,
  validateControlPlaneSnapshot,
  type ControlPlaneSnapshot,
} from "../../../packages/runtime/src/control-plane.js";

export type ControlPlaneConnectionState =
  | {
      status: "connecting";
      snapshot: null;
      observedAt: null;
      reason: null;
    }
  | {
      status: "live";
      snapshot: ControlPlaneSnapshot;
      observedAt: number;
      reason: null;
    }
  | {
      status: "stale" | "offline";
      snapshot: ControlPlaneSnapshot | null;
      observedAt: number | null;
      reason: "timeout" | "network" | "invalid_response" | "stale";
    };

export function liveControlPlaneState(
  input: unknown,
  now: number
): ControlPlaneConnectionState {
  const snapshot = validateControlPlaneSnapshot(input);
  if (assessSnapshotFreshness(snapshot, now) !== "current") {
    return {
      status: "stale",
      snapshot,
      observedAt: snapshot.observedAt,
      reason: "stale",
    };
  }
  return {
    status: "live",
    snapshot,
    observedAt: snapshot.observedAt,
    reason: null,
  };
}

export function failedControlPlaneState(input: {
  previous: ControlPlaneConnectionState;
  reason: "timeout" | "network" | "invalid_response";
  now: number;
}): ControlPlaneConnectionState {
  const previousSnapshot = input.previous.snapshot;
  if (
    previousSnapshot &&
    assessSnapshotFreshness(previousSnapshot, input.now) === "stale"
  ) {
    return {
      status: "stale",
      snapshot: previousSnapshot,
      observedAt: previousSnapshot.observedAt,
      reason: "stale",
    };
  }
  return {
    status: "offline",
    snapshot: previousSnapshot,
    observedAt: previousSnapshot?.observedAt ?? null,
    reason: input.reason,
  };
}

export async function fetchControlPlaneSnapshot(input: {
  endpoint: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const endpoint = validateEndpoint(input.endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await (input.fetcher ?? fetch)(
      new URL("/api/v1/snapshot", endpoint),
      {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    );
    if (!response.ok) throw new Error("Control plane returned a non-success status.");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 65_536) throw new Error("Control-plane response is too large.");
    const text = await response.text();
    if (text.length > 65_536) throw new Error("Control-plane response is too large.");
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Control-plane endpoint must be an origin-only loopback HTTP URL.");
  }
  return endpoint;
}
