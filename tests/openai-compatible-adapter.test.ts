import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiCompatibleAdapter,
  ProviderAdapterFailure,
} from "../packages/providers/src/index.js";

test("OpenAI-compatible adapter fixes the verified endpoint and normalizes structured output", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const adapter = createOpenAiCompatibleAdapter({
    providerId: "cerebras",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/models")) {
        return json({ data: [{ id: "gpt-oss-120b" }] });
      }
      return json(
        {
          id: "provider-request-1",
          model: "gpt-oss-120b",
          choices: [
            {
              finish_reason: "stop",
              message: { content: "{\"summary\":\"safe\",\"operations\":[]}" },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        },
        { "x-request-id": "provider-request-1" }
      );
    },
  });
  const credential = { secret: "local-test-secret" };
  const validity = await adapter.validateCredential(credential);
  assert.equal(validity.valid, true);
  const models = await adapter.discoverModels(credential);
  assert.deepEqual(models.map((model) => model.id), ["gpt-oss-120b"]);
  const response = await adapter.chat(credential, {
    requestId: "request-1",
    modelId: "gpt-oss-120b",
    messages: [{ role: "user", content: "Return JSON." }],
    maxOutputTokens: 100,
    temperature: 0,
    responseSchema: { type: "object" },
    tools: [],
    timeoutMs: 2_000,
  });
  assert.equal(response.providerId, "cerebras");
  assert.equal(response.usage.totalTokens, 30);
  assert.equal(response.verified, false);
  assert.equal(requests.every((entry) => entry.url.startsWith("https://api.cerebras.ai/v1/")), true);
  assert.equal(
    requests.every(
      (entry) =>
        new Headers(entry.init.headers).get("authorization") ===
        "Bearer local-test-secret"
    ),
    true
  );
  assert.doesNotMatch(JSON.stringify(response), /local-test-secret/);
  const body = JSON.parse(String(requests.at(-1)?.init.body));
  assert.equal(body.response_format.type, "json_schema");
  assert.deepEqual(body.tools, undefined);
});

test("OpenAI-compatible adapter rejects redirects, oversized bodies, and safe-normalizes failures", async () => {
  const redirecting = createOpenAiCompatibleAdapter({
    providerId: "cerebras",
    fetch: async () =>
      new Response("", {
        status: 302,
        headers: { location: "https://attacker.invalid/" },
      }),
  });
  await assert.rejects(
    () =>
      redirecting.chat(
        { secret: "local-test-secret" },
        requestFixture()
      ),
    ProviderAdapterFailure
  );

  const oversized = createOpenAiCompatibleAdapter({
    providerId: "cerebras",
    fetch: async () =>
      new Response("x", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "9999999",
        },
      }),
  });
  await assert.rejects(
    () => oversized.chat({ secret: "local-test-secret" }, requestFixture()),
    (error: unknown) =>
      error instanceof ProviderAdapterFailure &&
      error.code === "malformed_response"
  );

  const limited = createOpenAiCompatibleAdapter({
    providerId: "cerebras",
    fetch: async () =>
      new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      }),
  });
  await assert.rejects(
    () => limited.chat({ secret: "local-test-secret" }, requestFixture()),
    (error: unknown) =>
      error instanceof ProviderAdapterFailure &&
      error.status === 429 &&
      error.retryAt !== null
  );
});

function requestFixture() {
  return {
    requestId: "request-1",
    modelId: "gpt-oss-120b",
    messages: [{ role: "user" as const, content: "Return JSON." }],
    maxOutputTokens: 100,
    temperature: 0,
    tools: [],
    timeoutMs: 2_000,
  };
}

function json(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

