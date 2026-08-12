type TranscriptionResult = { text?: string } | Array<{ text?: string }>;

let transcriberPromise: Promise<(audio: Float32Array, options: Record<string, unknown>) => Promise<TranscriptionResult>> | null = null;

export async function transcribeAudioLocally(blob: Blob, onProgress?: (message: string) => void): Promise<string> {
  if (blob.size <= 0 || blob.size > 10_000_000) throw new Error("Keep voice input under 10 MB.");
  if (!["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"].includes(blob.type.split(";")[0] ?? "")) throw new Error("Use WebM, Ogg, MP4, or WAV audio.");
  onProgress?.("Preparing local audio…");
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const bytes = await blob.arrayBuffer();
    let mono: Float32Array;
    try {
      mono = mixAndResample(await context.decodeAudioData(bytes.slice(0)), 16_000);
    } catch (error) {
      if (!["audio/wav", "audio/x-wav"].includes(blob.type.split(";")[0] ?? "")) throw error;
      mono = decodePcmWav(bytes, 16_000);
    }
    onProgress?.("Loading the on-device speech model…");
    const transcriber = await getTranscriber((progress) => {
      const status = typeof progress === "object" && progress && "status" in progress ? String(progress.status) : "loading";
      onProgress?.(status === "ready" ? "Transcribing locally…" : "Downloading the free on-device model…");
    });
    const output = await transcriber(mono, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(output) ? output.map((item) => item.text ?? "").join(" ") : output.text ?? "").trim();
    if (!text) throw new Error("No speech was detected. Retry the recording or enter the transcript.");
    return text.slice(0, 20_000);
  } finally { await context.close(); }
}

export function decodePcmWav(bytes: ArrayBuffer, targetRate: number): Float32Array {
  const view = new DataView(bytes);
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") throw new Error("The WAV file is invalid.");
  let offset = 12; let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null; let data: { offset: number; size: number } | null = null;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4); const size = view.getUint32(offset + 4, true); const start = offset + 8; const end = start + size;
    if (end > view.byteLength) throw new Error("The WAV file is truncated.");
    if (id === "fmt " && size >= 16) format = { audioFormat: view.getUint16(start, true), channels: view.getUint16(start + 2, true), sampleRate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    if (id === "data") data = { offset: start, size };
    offset = end + (size % 2);
  }
  if (!format || !data || ![1, 3].includes(format.audioFormat) || format.channels < 1 || format.sampleRate < 1 || ![16, 32].includes(format.bits)) throw new Error("Use uncompressed 16-bit PCM or 32-bit float WAV audio.");
  const bytesPerSample = format.bits / 8; const frames = Math.floor(data.size / (bytesPerSample * format.channels));
  if (frames < 1) throw new Error("The WAV file has no audio samples.");
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < format.channels; channel += 1) {
    const sampleOffset = data.offset + (frame * format.channels + channel) * bytesPerSample;
    const sample = format.audioFormat === 3 ? view.getFloat32(sampleOffset, true) : view.getInt16(sampleOffset, true) / 32_768;
    mono[frame] = (mono[frame] ?? 0) + sample / format.channels;
  }
  return mixAndResample({ numberOfChannels: 1, sampleRate: format.sampleRate, length: mono.length, getChannelData: () => mono }, targetRate);
}

function readAscii(view: DataView, offset: number, length: number): string { return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index))); }

export function mixAndResample(buffer: Pick<AudioBuffer, "numberOfChannels" | "sampleRate" | "length" | "getChannelData">, targetRate: number): Float32Array {
  if (buffer.numberOfChannels < 1 || buffer.length < 1 || targetRate <= 0) throw new Error("The audio could not be decoded.");
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel); for (let index = 0; index < mono.length; index += 1) mono[index] = (mono[index] ?? 0) + (samples[index] ?? 0) / buffer.numberOfChannels;
  }
  if (buffer.sampleRate === targetRate) return mono;
  const output = new Float32Array(Math.max(1, Math.floor(mono.length * targetRate / buffer.sampleRate)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * buffer.sampleRate / targetRate; const left = Math.floor(position); const right = Math.min(mono.length - 1, left + 1); const fraction = position - left;
    output[index] = (mono[left] ?? 0) * (1 - fraction) + (mono[right] ?? 0) * fraction;
  }
  return output;
}

async function getTranscriber(progressCallback: (progress: unknown) => void) {
  transcriberPromise ??= import("@huggingface/transformers").then(async ({ env, pipeline }) => {
    env.allowLocalModels = false;
    const instance = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", { dtype: "fp32", device: "wasm", progress_callback: progressCallback });
    return instance as unknown as (audio: Float32Array, options: Record<string, unknown>) => Promise<TranscriptionResult>;
  });
  return transcriberPromise;
}
