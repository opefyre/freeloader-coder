export type BundleAsset = {
  file: string;
  bytes: number;
  kind: "entry" | "shared" | "feature";
};

export type BundleBudgets = {
  entry: number;
  shared: number;
  feature: number;
};

export const studioBundleBudgets: BundleBudgets = {
  entry: 450_000,
  shared: 210_000,
  feature: 75_000,
};

export type BundleBudgetResult = {
  passed: boolean;
  failures: readonly string[];
  assets: readonly BundleAsset[];
};

export function assessBundleBudgets(
  assets: readonly BundleAsset[],
  budgets: BundleBudgets = studioBundleBudgets
): BundleBudgetResult {
  const failures: string[] = [];
  const entries = assets.filter((asset) => asset.kind === "entry");
  if (entries.length !== 1) {
    failures.push(`Expected exactly one entry chunk; observed ${entries.length}.`);
  }

  for (const asset of assets) {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1) {
      failures.push(`${asset.file}: byte measurement is invalid.`);
      continue;
    }
    const limit = budgets[asset.kind];
    if (asset.bytes > limit) {
      failures.push(
        `${asset.file}: ${asset.kind} chunk is ${asset.bytes} bytes; limit is ${limit}.`
      );
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    assets: [...assets].sort((left, right) => right.bytes - left.bytes),
  };
}
