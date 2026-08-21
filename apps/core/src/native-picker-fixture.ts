import { isAbsolute } from "node:path";

export function resolveNativePickerFixture(
  env: NodeJS.ProcessEnv,
  nodeEnv = env.NODE_ENV,
): string | undefined {
  const fixture = env.CODKESH_NATIVE_PICKER_FIXTURE?.trim();
  if (!fixture) return undefined;
  if (
    env.CODKESH_ENABLE_TEST_HOOKS !== "1" ||
    nodeEnv === "production" ||
    !isAbsolute(fixture)
  ) {
    throw new Error(
      "CODKESH_NATIVE_PICKER_FIXTURE requires explicit non-production test hooks and an absolute path.",
    );
  }
  return fixture;
}
