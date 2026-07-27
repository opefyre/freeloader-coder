export const supportedBreakpoints = ["mobile", "tablet", "laptop", "wide"] as const;
export type Breakpoint = (typeof supportedBreakpoints)[number];

export const densityModes = ["guided", "advanced"] as const;
export type DensityMode = (typeof densityModes)[number];

export const operationalStates = [
  "loading",
  "empty",
  "working",
  "partial",
  "offline",
  "permission_denied",
  "quota_exhausted",
  "failed",
  "retrying",
  "recovering",
  "restored",
  "succeeded"
] as const;
export type OperationalState = (typeof operationalStates)[number];

export const semanticTones = [
  "neutral",
  "info",
  "active",
  "positive",
  "caution",
  "critical"
] as const;
export type SemanticTone = (typeof semanticTones)[number];

export const visualSystem = {
  typography: {
    family: "Geist",
    variable: "--ps-font-sans",
    weights: [400, 500, 600, 700]
  },
  iconography: {
    library: "lucide",
    strokeWidth: 1.75,
    decorativeIconAriaHidden: true,
    meaningfulIconRequiresName: true
  },
  surfaces: {
    decorativeBorders: false,
    treatment: "glass",
    blurSteps: [12, 20, 32],
    radiusSteps: [12, 16, 24, 32]
  },
  motion: {
    fastMs: 120,
    standardMs: 200,
    deliberateMs: 320,
    reducedMotionDurationMs: 0
  },
  focus: {
    minimumRingPx: 2,
    offsetPx: 3
  },
  density: {
    guided: { controlHeightPx: 44, gapPx: 16, contentWidthPx: 1120 },
    advanced: { controlHeightPx: 36, gapPx: 10, contentWidthPx: 1440 }
  }
} as const;

export function toneForState(state: OperationalState): SemanticTone {
  switch (state) {
    case "loading":
    case "empty":
      return "neutral";
    case "working":
    case "retrying":
    case "recovering":
      return "active";
    case "partial":
    case "quota_exhausted":
      return "caution";
    case "offline":
    case "permission_denied":
      return "critical";
    case "failed":
      return "critical";
    case "restored":
    case "succeeded":
      return "positive";
  }
}
