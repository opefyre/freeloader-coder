import type * as React from "react";

import { cn } from "../../lib/utils.js";

type Tone = "neutral" | "positive" | "active" | "caution" | "critical";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-400/12 text-emerald-300",
  active: "bg-primary/14 text-primary",
  caution: "bg-amber-400/12 text-amber-300",
  critical: "bg-destructive/14 text-red-300",
};

function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
