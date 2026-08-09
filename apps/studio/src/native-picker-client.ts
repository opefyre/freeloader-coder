import {
  nativePickerResponseSchema,
  type NativePickerResponse,
} from "../../../packages/runtime/src/native-picker.js";

const MAX_RESPONSE_BYTES = 96_000;

export async function openNativePicker(input: {
  endpoint: string;
  kind: "folder" | "files";
  fetcher?: typeof fetch;
}): Promise<NativePickerResponse> {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await (input.fetcher ?? fetch)(
    new URL(`/api/v1/system/pick-${input.kind}`, endpoint),
    { method: "POST", cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } }
  );
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Native picker response is too large.");
  if (!response.ok) throw new Error("The native picker could not be opened.");
  return nativePickerResponseSchema.parse(JSON.parse(text) as unknown);
}

function validateEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Native picker endpoint must remain on loopback.");
  }
  return url;
}
