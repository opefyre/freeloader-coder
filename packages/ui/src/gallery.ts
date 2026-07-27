import {
  assertPrimitiveContract,
  primitiveKinds,
  type GalleryScenario,
  type PrimitiveContract
} from "./contracts.js";
import {
  densityModes,
  operationalStates,
  supportedBreakpoints,
  toneForState,
  type OperationalState
} from "./tokens.js";

const blockedStates = new Set<OperationalState>([
  "offline",
  "permission_denied",
  "quota_exhausted",
  "failed"
]);

function primitiveFor(
  state: OperationalState,
  kind: (typeof primitiveKinds)[number],
  index: number
): PrimitiveContract {
  const blocked = blockedStates.has(state);
  return {
    id: `${state}-${kind}-${index}`,
    kind,
    state,
    tone: toneForState(state),
    title: `${kind[0]?.toUpperCase()}${kind.slice(1)}`,
    summary: `Representative ${state.replace("_", " ")} ${kind} state.`,
    ...(blocked
      ? {
          preservedWork: "Your project changes and verified evidence remain saved.",
          recommendedAction: "Review the cause and use the recommended safe recovery."
        }
      : {}),
    icon: {
      decorative: false,
      accessibleName: `${kind} is ${state.replace("_", " ")}`
    },
    actions: []
  };
}

export const componentGallery: readonly GalleryScenario[] = operationalStates.flatMap(
  (state, stateIndex) =>
    supportedBreakpoints.flatMap((breakpoint, breakpointIndex) =>
      densityModes.map((density) => ({
        id: `${state}-${breakpoint}-${density}`,
        name: `${state.replace("_", " ")} · ${breakpoint} · ${density}`,
        breakpoint,
        density,
        state,
        primitives: primitiveKinds.map((kind, kindIndex) =>
          primitiveFor(state, kind, stateIndex + breakpointIndex + kindIndex)
        )
      }))
    )
);

export function validateComponentGallery(
  gallery: readonly GalleryScenario[] = componentGallery
): void {
  const required = new Set(
    operationalStates.flatMap((state) =>
      supportedBreakpoints.flatMap((breakpoint) =>
        densityModes.map((density) => `${state}:${breakpoint}:${density}`)
      )
    )
  );

  for (const scenario of gallery) {
    required.delete(`${scenario.state}:${scenario.breakpoint}:${scenario.density}`);
    const kinds = new Set(scenario.primitives.map((primitive) => primitive.kind));
    for (const kind of primitiveKinds) {
      if (!kinds.has(kind)) throw new Error(`${scenario.id} is missing ${kind}.`);
    }
    scenario.primitives.forEach(assertPrimitiveContract);
  }

  if (required.size) {
    throw new Error(`Gallery coverage missing: ${[...required].join(", ")}`);
  }
}
