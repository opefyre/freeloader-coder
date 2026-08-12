import assert from "node:assert/strict";
import test from "node:test";

import { decodePcmWav, mixAndResample } from "../apps/studio/src/local-voice-transcriber.js";

test("local voice preprocessing mixes channels and resamples deterministically", () => {
  const channels = [new Float32Array([1, 0, -1, 0]), new Float32Array([0, 1, 0, -1])];
  const output = mixAndResample({ numberOfChannels: 2, sampleRate: 8_000, length: 4, getChannelData: (channel) => channels[channel]! }, 16_000);
  assert.equal(output.length, 8);
  assert.deepEqual([...output.slice(0, 4)].map((value) => Number(value.toFixed(2))), [0.5, 0.5, 0.5, 0]);
});

test("local voice preprocessing rejects empty decoded audio", () => {
  assert.throws(() => mixAndResample({ numberOfChannels: 0, sampleRate: 16_000, length: 0, getChannelData: () => new Float32Array() }, 16_000), /could not be decoded/);
});

test("local voice preprocessing decodes bounded PCM WAV when browser decoding is unavailable", () => {
  const bytes = new ArrayBuffer(48); const view = new DataView(bytes);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 40, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, 4, true); view.setInt16(44, 16_384, true); view.setInt16(46, -16_384, true);
  assert.deepEqual([...decodePcmWav(bytes, 16_000)].map((value) => Number(value.toFixed(2))), [0.5, -0.5]);
});

test("local voice preprocessing rejects malformed or compressed WAV", () => {
  assert.throws(() => decodePcmWav(new ArrayBuffer(12), 16_000), /invalid/);
});
