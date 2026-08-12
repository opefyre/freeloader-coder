import assert from "node:assert/strict";
import test from "node:test";

import { prepareVoiceEvidence, selectVoiceAdapter, VoiceIntakeError } from "../packages/conversation/src/voice.js";

const local = { id: "local-whisper", location: "local" as const, supportedMediaTypes: ["audio/webm" as const], available: true };
const external = { id: "external-stt", location: "external" as const, supportedMediaTypes: ["audio/webm" as const], available: true };

test("voice adapter selection prefers local and never sends raw audio without policy", () => {
  assert.equal(selectVoiceAdapter({ adapters: [external, local], mediaType: "audio/webm", policy: { allowRawAudioExternal: false, maxDurationSeconds: 120 } }).id, "local-whisper");
  assert.throws(() => selectVoiceAdapter({ adapters: [external], mediaType: "audio/webm", policy: { allowRawAudioExternal: false, maxDurationSeconds: 120 } }), (error: unknown) => error instanceof VoiceIntakeError && error.code === "adapter_unavailable");
  assert.equal(selectVoiceAdapter({ adapters: [external], mediaType: "audio/webm", policy: { allowRawAudioExternal: true, maxDurationSeconds: 120 } }).id, "external-stt");
});

test("corrected transcript becomes bounded cited intake evidence", () => {
  const evidence = prepareVoiceEvidence({ transcript: "  Build a calm family planner.  ", mediaType: "audio/webm", audioBytes: 2_048, durationSeconds: 8, adapterId: "manual-local", corrected: true });
  assert.equal(evidence.transcript, "Build a calm family planner.");
  assert.match(evidence.citation, /^voice-transcript:sha256:[a-f0-9]{64}$/);
  assert.match(evidence.markdown, /Corrected: yes/);
});

test("unsupported, empty, excessive, and failed voice inputs recover with named errors", () => {
  const base = { transcript: "Idea", mediaType: "audio/webm", audioBytes: 100, durationSeconds: 2, adapterId: "manual-local", corrected: false };
  for (const [override, code] of [[{ transcript: "" }, "transcript_required"], [{ mediaType: "audio/flac" }, "unsupported_audio"], [{ durationSeconds: 121 }, "audio_limit"], [{ audioBytes: 10_000_001 }, "audio_limit"]] as const) {
    assert.throws(() => prepareVoiceEvidence({ ...base, ...override }), (error: unknown) => error instanceof VoiceIntakeError && error.code === code);
  }
});
