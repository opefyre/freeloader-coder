import type {
  Breakpoint,
  DensityMode,
  OperationalState,
  SemanticTone
} from "./tokens.js";

export const primitiveKinds = [
  "status",
  "evidence",
  "approval",
  "risk",
  "cost",
  "provider",
  "task",
  "timeline",
  "preview",
  "recovery"
] as const;
export type PrimitiveKind = (typeof primitiveKinds)[number];

export type IconContract =
  | { decorative: true; ariaHidden: true; accessibleName?: never }
  | { decorative: false; ariaHidden?: false; accessibleName: string };

export interface ActionContract {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "danger";
  effect: "local" | "external";
  reversible: boolean;
  paid: boolean;
}

export interface PrimitiveContract {
  id: string;
  kind: PrimitiveKind;
  state: OperationalState;
  tone: SemanticTone;
  title: string;
  summary: string;
  evidenceLabel?: string;
  preservedWork?: string;
  recommendedAction?: string;
  icon: IconContract;
  actions: readonly ActionContract[];
}

export interface GalleryScenario {
  id: string;
  name: string;
  breakpoint: Breakpoint;
  density: DensityMode;
  state: OperationalState;
  primitives: readonly PrimitiveContract[];
}

export function assertPrimitiveContract(primitive: PrimitiveContract): void {
  if (!primitive.id.trim() || !primitive.title.trim() || !primitive.summary.trim()) {
    throw new Error("Primitive identity, title, and summary are required.");
  }
  if (!primitive.icon.decorative && !primitive.icon.accessibleName.trim()) {
    throw new Error("Meaningful icons require an accessible name.");
  }
  if (
    ["failed", "offline", "permission_denied", "quota_exhausted"].includes(
      primitive.state
    ) &&
    (!primitive.preservedWork?.trim() || !primitive.recommendedAction?.trim())
  ) {
    throw new Error("Blocking states must name preserved work and a recommended action.");
  }
  const actionIds = new Set<string>();
  for (const action of primitive.actions) {
    if (actionIds.has(action.id)) throw new Error(`Duplicate action: ${action.id}`);
    actionIds.add(action.id);
    if (action.kind === "danger" && !action.reversible) {
      throw new Error("Irreversible dangerous actions cannot be offered inline.");
    }
  }
}
