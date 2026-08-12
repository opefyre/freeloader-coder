import { HourglassMedium } from "@phosphor-icons/react/HourglassMedium";
import { Microphone } from "@phosphor-icons/react/Microphone";
import { Stop } from "@phosphor-icons/react/Stop";
import { Trash } from "@phosphor-icons/react/Trash";
import { useEffect, useRef, useState } from "react";

import { transcribeAudioLocally } from "../../local-voice-transcriber.js";
import { Button } from "../ui/button.js";

export type LocalVoiceDraft = { blob: Blob; url: string; mediaType: string; bytes: number; durationSeconds: number; transcript: string; corrected: boolean };

export function LocalVoiceInput(props: { value: LocalVoiceDraft | null; disabled: boolean; onChange: (value: LocalVoiceDraft | null) => void; onNotice: (notice: string) => void }) {
  const [recording, setRecording] = useState(false); const [transcribing, setTranscribing] = useState(false); const [status, setStatus] = useState(""); const recorder = useRef<MediaRecorder | null>(null); const startedAt = useRef(0);
  useEffect(() => () => { if (recorder.current?.state === "recording") recorder.current.stop(); if (props.value?.url) URL.revokeObjectURL(props.value.url); }, [props.value?.url]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { props.onNotice("Voice recording is not supported in this browser. Attach an audio file or type your idea instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mediaType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
      const active = new MediaRecorder(stream, mediaType ? { mimeType: mediaType } : undefined); const chunks: BlobPart[] = [];
      active.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      active.onstop = () => { stream.getTracks().forEach((track) => track.stop()); const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" }); const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1_000)); setRecording(false); if (blob.size > 10_000_000 || durationSeconds > 120) { props.onNotice("Keep voice input under two minutes and 10 MB."); return; } if (props.value?.url) URL.revokeObjectURL(props.value.url); props.onChange({ blob, url: URL.createObjectURL(blob), mediaType: (active.mimeType || "audio/webm").split(";")[0]!, bytes: blob.size, durationSeconds, transcript: "", corrected: false }); props.onNotice("Recording stays on this device. Transcribe it locally, then review the result."); };
      active.onerror = () => { stream.getTracks().forEach((track) => track.stop()); setRecording(false); props.onNotice("Recording stopped safely. Try again or type your idea."); };
      recorder.current = active; startedAt.current = Date.now(); active.start(500); setRecording(true); props.onNotice("Recording locally…"); window.setTimeout(() => { if (active.state === "recording") active.stop(); }, 120_000);
    } catch { setRecording(false); props.onNotice("Microphone access was not granted. You can retry, attach a file, or type your idea."); }
  }
  function remove() { if (recorder.current?.state === "recording") recorder.current.stop(); if (props.value?.url) URL.revokeObjectURL(props.value.url); props.onChange(null); setRecording(false); }
  async function transcribe() { if (!props.value || transcribing) return; setTranscribing(true); setStatus("Preparing local transcription…"); try { const transcript = await transcribeAudioLocally(props.value.blob, setStatus); props.onChange({ ...props.value, transcript, corrected: false }); setStatus("Local transcript ready. Review or correct it before using it."); props.onNotice("Local transcript ready. Review or correct it before using it."); } catch (error) { const message = error instanceof Error ? error.message : "Local transcription failed safely. Retry or enter the transcript."; setStatus(message); props.onNotice(message); } finally { setTranscribing(false); } }
  async function upload(file: File | undefined) {
    if (!file) return; const mediaType = file.type.split(";")[0] ?? "";
    if (!["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav"].includes(mediaType) || file.size > 10_000_000) { props.onNotice("Use WebM, Ogg, MP4, or WAV audio under 10 MB."); return; }
    const url = URL.createObjectURL(file); const durationSeconds = await new Promise<number>((resolve) => { const audio = new Audio(url); audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.max(1, Math.ceil(audio.duration)) : 1); audio.onerror = () => resolve(1); });
    if (durationSeconds > 120) { URL.revokeObjectURL(url); props.onNotice("Keep voice input under two minutes."); return; }
    if (props.value?.url) URL.revokeObjectURL(props.value.url); props.onChange({ blob: file, url, mediaType: mediaType === "audio/x-wav" ? "audio/wav" : mediaType, bytes: file.size, durationSeconds, transcript: "", corrected: false }); props.onNotice("Audio loaded locally. Transcribe it on this computer, then review the result.");
  }
  return <div className="contents">
    {props.value && <div className="space-y-3 rounded-3xl bg-muted p-4"><div className="flex flex-wrap items-center gap-3"><audio controls src={props.value.url} className="h-9 min-w-0 flex-1" /><Button type="button" size="sm" variant="secondary" onClick={() => void transcribe()} disabled={transcribing}>{transcribing ? <HourglassMedium /> : <Microphone />}{transcribing ? "Transcribing…" : "Transcribe locally"}</Button><Button type="button" size="sm" variant="ghost" aria-label="Delete voice recording" onClick={remove}><Trash /></Button></div>{status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}<label className="block text-xs font-semibold" htmlFor="voice-transcript">Review transcript</label><textarea id="voice-transcript" value={props.value.transcript} onChange={(event) => props.onChange({ ...props.value!, transcript: event.target.value, corrected: true })} rows={3} maxLength={20_000} placeholder="Enter or correct what you said…" className="w-full resize-y rounded-2xl bg-background px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30" /><p className="text-xs text-muted-foreground">Audio remains local. The speech model runs on this computer; only the reviewed transcript is included after you press Start.</p></div>}
    <Button type="button" size="sm" variant={recording ? "secondary" : "ghost"} aria-label={recording ? "Stop voice recording" : props.value ? "Record voice again" : "Record voice"} onClick={() => recording ? recorder.current?.stop() : void start()} disabled={props.disabled}>{recording ? <Stop weight="fill" /> : <Microphone />}</Button>
    {!props.value && <label className="inline-flex h-8 cursor-pointer items-center rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><input type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/wav" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />Upload audio</label>}
  </div>;
}
