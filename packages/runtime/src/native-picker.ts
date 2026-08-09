import { z } from "zod";

export const nativePickerResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["selected", "cancelled"]),
  selections: z.array(z.strictObject({
    path: z.string().trim().min(1).max(4_096),
    label: z.string().trim().min(1).max(255),
  })).max(20),
});

export type NativePickerResponse = z.infer<typeof nativePickerResponseSchema>;
