import { z } from "zod";

import { sha256 } from "./sha256.js";

export const voicePolicySchema = z.strictObject({
  allowRawAudioExternal: z.boolean(),
  maxDurationSeconds: z.number().int().min(1).max(120),
});

export const voiceAdapterSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9._-]{1,80}$/),
  location: z.enum(["local", "external"]),
  supportedMediaTypes: z.array(z.enum(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"])).min(1).max(4),
  available: z.boolean(),
});

export type VoiceAdapter = z.infer<typeof voiceAdapterSchema>;

export function selectVoiceAdapter(input: { adapters: readonly VoiceAdapter[]; mediaType: string; policy: z.infer<typeof voicePolicySchema> }): VoiceAdapter {
  const policy = voicePolicySchema.parse(input.policy);
  const candidates = input.adapters.map((adapter) => voiceAdapterSchema.parse(adapter)).filter((adapter) => adapter.available && adapter.supportedMediaTypes.includes(input.mediaType as never) && (adapter.location === "local" || policy.allowRawAudioExternal));
  const selected = candidates.sort((left, right) => Number(left.location === "external") - Number(right.location === "external") || left.id.localeCompare(right.id))[0];
  if (!selected) throw new VoiceIntakeError("adapter_unavailable", "No policy-approved transcription option is available. Keep the recording local and enter or retry the transcript.");
  return selected;
}

export function prepareVoiceEvidence(input: { transcript: string; mediaType: string; audioBytes: number; durationSeconds: number; adapterId: string; corrected: boolean }): { transcript: string; citation: string; digest: string; markdown: string } {
  const transcript = input.transcript.trim();
  if (!transcript) throw new VoiceIntakeError("transcript_required", "Review or enter the transcript before using it.");
  if (transcript.length > 20_000) throw new VoiceIntakeError("transcript_limit", "Keep the transcript under 20,000 characters.");
  if (!voiceAdapterSchema.shape.supportedMediaTypes.element.safeParse(input.mediaType).success) throw new VoiceIntakeError("unsupported_audio", "Use WebM, Ogg, MP4, or WAV audio.");
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 120 || input.audioBytes > 10_000_000) throw new VoiceIntakeError("audio_limit", "Keep voice input under two minutes and 10 MB.");
  const digest = `sha256:${sha256([input.mediaType, input.audioBytes, input.durationSeconds, input.adapterId, transcript].join("\u0000"))}`;
  const citation = `voice-transcript:${digest}`;
  return { transcript, citation, digest, markdown: `## Voice transcript\n\n${transcript}\n\nSource: ${citation}\nAdapter: ${input.adapterId}\nCorrected: ${input.corrected ? "yes" : "no"}` };
}

export class VoiceIntakeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "VoiceIntakeError"; }
}
