export interface ModelRequest {
  readonly taskId: string;
  readonly prompt: string;
}

export interface ModelResult {
  readonly provider: string;
  readonly output: string;
  readonly verified: false;
}

export async function runFakeProvider(request: ModelRequest): Promise<ModelResult> {
  return {
    provider: "fake",
    output: `Synthetic response for ${request.taskId}`,
    verified: false
  };
}

export * from "./cache.js";
export * from "./catalog.js";
export * from "./circuit.js";
export * from "./connection.js";
export * from "./router.js";
export * from "./telemetry.js";
