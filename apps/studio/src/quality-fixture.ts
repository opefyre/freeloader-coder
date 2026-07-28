export const qualityChecks = [
  { id: "type", label: "Type safety", kind: "Type", state: "passed", duration: "2.1s", command: "npm run typecheck", artifact: "artifacts/typecheck.log" },
  { id: "unit", label: "Unit and contract suite", kind: "Tests", state: "passed", duration: "0.8s", command: "npm test", artifact: "artifacts/test.tap" },
  { id: "build", label: "Production build", kind: "Build", state: "passed", duration: "0.2s", command: "npm run studio:build", artifact: "artifacts/build.log" },
  { id: "a11y", label: "Keyboard and responsive pass", kind: "Accessibility", state: "warning", duration: "1.4s", command: "browser evidence", artifact: "artifacts/a11y.json" },
] as const;

export const evidenceItems = [
  { id: "diff", kind: "Diffs", title: "19 changed files", note: "+1,829 −106 · unified and split views", state: "passed", source: "artifacts/sprint-8.diff" },
  { id: "checks", kind: "Checks", title: "287 deterministic checks", note: "All required gates passed", state: "passed", source: "artifacts/verification.json" },
  { id: "build", kind: "Builds", title: "Production bundle", note: "656.99 kB · local fonts included", state: "passed", source: "artifacts/studio-build.log" },
  { id: "commit", kind: "Commits", title: "7b1552c", note: "feat: add orchestration brain", state: "passed", source: "git:7b1552c" },
  { id: "visual", kind: "Visuals", title: "Responsive browser proof", note: "390px dark · 1512px light · no overflow", state: "warning", source: "artifacts/browser-proof.json" },
  { id: "limitation", kind: "Limits", title: "Known limitation", note: "Bundle splitting is recommended before public beta", state: "warning", source: "docs/known-limitations.md" },
] as const;

export const reviewers = [
  { role: "Functional", provider: "Groq", reviewer: "review-functional-01", verdict: "Passed", confidence: "99%", evidence: "AC1–AC3 · 9 assertions" },
  { role: "Design", provider: "Gemini", reviewer: "review-design-02", verdict: "Passed", confidence: "96%", evidence: "Desktop + mobile + keyboard" },
  { role: "Security", provider: "Cloudflare", reviewer: "review-security-03", verdict: "Passed", confidence: "97%", evidence: "Scope, paths, authority" },
] as const;

export const qualityDigest = "sha256:08d4c3a74b6e85c9";
