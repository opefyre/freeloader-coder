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
