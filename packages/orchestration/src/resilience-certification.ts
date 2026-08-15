export const RESILIENCE_SCENARIOS = [
  "process_crash",
  "stale_lease",
  "provider_failure",
  "free_provider_exhaustion",
  "malformed_model_output",
  "connector_denial",
  "jira_conflict",
  "invalid_attachment",
  "reviewer_dissent",
  "deployment_failure",
  "owner_timeout",
] as const;

export type ResilienceScenario = (typeof RESILIENCE_SCENARIOS)[number];

export interface ResilienceObservation {
  readonly scenario: ResilienceScenario;
  readonly evidenceRef: string;
  readonly safeStatePreserved: boolean;
  readonly blocker: string;
  readonly smallestOwnerAction: string;
  readonly restartObserved: boolean;
  readonly resumed: boolean;
  readonly duplicateEffects: number;
}

export interface ResilienceCertification {
  readonly schemaVersion: 1;
  readonly certified: boolean;
  readonly scenarioCount: number;
  readonly evidenceRefs: readonly string[];
  readonly failures: readonly string[];
}

const evidencePattern = /^(?:test|event|receipt|journal|commit):[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,500}$/;

export function certifyResilience(observations: readonly ResilienceObservation[]): ResilienceCertification {
  const failures: string[] = [];
  const byScenario = new Map<ResilienceScenario, ResilienceObservation>();
  for (const observation of observations) {
    if (byScenario.has(observation.scenario)) {
      failures.push(`${observation.scenario}: duplicate observation`);
      continue;
    }
    byScenario.set(observation.scenario, observation);
  }
  for (const scenario of RESILIENCE_SCENARIOS) {
    const observation = byScenario.get(scenario);
    if (!observation) {
      failures.push(`${scenario}: missing fault-injection evidence`);
      continue;
    }
    if (!evidencePattern.test(observation.evidenceRef)) failures.push(`${scenario}: invalid evidence reference`);
    if (!observation.safeStatePreserved) failures.push(`${scenario}: safe state was not preserved`);
    if (observation.blocker.trim().length < 8) failures.push(`${scenario}: exact blocker is missing`);
    if (observation.smallestOwnerAction.trim().length < 3) failures.push(`${scenario}: smallest recovery action is missing`);
    if (!observation.restartObserved) failures.push(`${scenario}: restart recovery was not observed`);
    if (!observation.resumed) failures.push(`${scenario}: work did not resume`);
    if (observation.duplicateEffects !== 0) failures.push(`${scenario}: ${observation.duplicateEffects} duplicate effect(s) observed`);
  }
  return {
    schemaVersion: 1,
    certified: failures.length === 0,
    scenarioCount: byScenario.size,
    evidenceRefs: [...byScenario.values()].map((observation) => observation.evidenceRef).sort(),
    failures,
  };
}
