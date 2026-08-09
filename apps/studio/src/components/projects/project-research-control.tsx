import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Play } from "@phosphor-icons/react/Play";
import { Warning } from "@phosphor-icons/react/Warning";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectLifecycleRecord } from "../../../../../packages/orchestration/src/project-lifecycle.js";
import type { ProjectEgressPermit, SolutionRun } from "../../../../../packages/orchestration/src/solution-design.js";
import type { PublicProviderConnection } from "../../../../../packages/runtime/src/provider-connections.js";
import { generateProjectSolution, getProjectLifecycle, getProjectProviderConsent, getProjectSolutionRun, grantProjectProviderConsent, revokeProjectProviderConsent } from "../../local-project-client.js";
import { listProviderConnections } from "../../provider-connection-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function ProjectResearchControl(props: { endpoint: string; projectId: string }) {
  const [lifecycle, setLifecycle] = useState<ProjectLifecycleRecord | null>(null);
  const [providers, setProviders] = useState<readonly PublicProviderConnection[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dataClass, setDataClass] = useState<"non_personal_test" | "source_code">("non_personal_test");
  const [consent, setConsent] = useState<ProjectEgressPermit | null>(null);
  const [run, setRun] = useState<SolutionRun | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [nextLifecycle, providerCollection, nextConsent, nextRun] = await Promise.all([getProjectLifecycle({ endpoint: props.endpoint, projectId: props.projectId }), listProviderConnections({ endpoint: props.endpoint }), getProjectProviderConsent({ endpoint: props.endpoint, projectId: props.projectId }), getProjectSolutionRun({ endpoint: props.endpoint, projectId: props.projectId })]);
      const eligible = providerCollection.connections.filter((provider) => provider.state === "ready" && provider.admission.admitted && provider.cost.zeroCost && !provider.cost.billingEnabled);
      setLifecycle(nextLifecycle); setProviders(eligible); setConsent(nextConsent); setRun(nextRun);
      setSelected((current) => current.filter((id) => eligible.some((provider) => provider.providerId === id)));
    } catch { setNotice("Project research status is temporarily unavailable."); }
  }, [props.endpoint, props.projectId]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), run && ["queued", "running"].includes(run.state) ? 3_000 : 15_000); return () => window.clearInterval(timer); }, [refresh, run?.state]);
  const contextDigest = useMemo(() => lifecycle?.artifacts.filter((artifact) => artifact.kind === "context").at(-1)?.digest ?? null, [lifecycle]);
  const validConsent = consent && consent.contextDigest === contextDigest && consent.expiresAt > Date.now() ? consent : null;
  if (!lifecycle || !["solution_design", "awaiting_design_approval"].includes(lifecycle.stage)) return null;
  if (lifecycle.stage === "awaiting_design_approval") return <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-3 text-xs"><CheckCircle className="text-emerald-500" weight="fill" />Solution ready in Action Center</div>;
  async function confirmStart() {
    if (!contextDigest || selected.length === 0) return;
    setWorking(true); setNotice("");
    try {
      await grantProjectProviderConsent({ endpoint: props.endpoint, projectId: props.projectId, contextDigest, dataClass, providerIds: selected, expiresAt: Date.now() + 7 * 86_400_000, idempotencyKey: `research-consent:${crypto.randomUUID()}` });
      setRun(await generateProjectSolution({ endpoint: props.endpoint, projectId: props.projectId, idempotencyKey: `solution-generate:${crypto.randomUUID()}` })); setConfirming(false); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Research could not start safely."); }
    finally { setWorking(false); }
  }
  async function changeSharing() {
    setWorking(true); setNotice("");
    try { await revokeProjectProviderConsent({ endpoint: props.endpoint, projectId: props.projectId, idempotencyKey: `research-consent-revoke:${crypto.randomUUID()}` }); setConsent(null); setSelected([]); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Sharing could not be changed safely."); }
    finally { setWorking(false); }
  }
  const active = run && ["queued", "running", "deferred"].includes(run.state);
  return <><div className="mt-4 rounded-2xl bg-muted/55 p-4">
    <div className="flex items-center justify-between gap-3"><strong className="text-sm">Solution research</strong>{run && <Badge tone={run.state === "needs_user" ? "caution" : run.state === "completed" ? "positive" : "neutral"}>{run.state.replaceAll("_", " ")}</Badge>}</div>
    {providers.length === 0 ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Warning className="text-amber-500" />Connect one free provider in Settings.</p> : <>
      {!validConsent ? <><div className="mt-3 flex flex-wrap gap-2" aria-label="Choose free providers">{providers.map((provider) => { const chosen = selected.includes(provider.providerId); return <button key={provider.id} type="button" aria-pressed={chosen} onClick={() => setSelected((current) => chosen ? current.filter((id) => id !== provider.providerId) : [...current, provider.providerId])} className={`rounded-full px-3 py-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30 ${chosen ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>{provider.providerLabel}</button>; })}</div><div className="mt-3 grid grid-cols-2 gap-2" aria-label="Choose shared data"><button type="button" aria-pressed={dataClass === "non_personal_test"} onClick={() => setDataClass("non_personal_test")} className={`rounded-2xl px-3 py-2 text-xs ${dataClass === "non_personal_test" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>Test context</button><button type="button" aria-pressed={dataClass === "source_code"} onClick={() => setDataClass("source_code")} className={`rounded-2xl px-3 py-2 text-xs ${dataClass === "source_code" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>Project context</button></div></> : <div className="mt-3 flex items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{validConsent.providerIds.map((providerId) => <Badge key={providerId}>{providers.find((provider) => provider.providerId === providerId)?.providerLabel ?? providerId}</Badge>)}</div><Button variant="ghost" size="sm" onClick={() => void changeSharing()} disabled={working || Boolean(active)}>Change sharing</Button></div>}
      <Button className="mt-3 w-full" size="sm" disabled={working || Boolean(active) || !contextDigest || (!validConsent && selected.length === 0)} onClick={() => validConsent ? void generateProjectSolution({ endpoint: props.endpoint, projectId: props.projectId, idempotencyKey: `solution-generate:${crypto.randomUUID()}` }).then(setRun).catch((error) => setNotice(error instanceof Error ? error.message : "Research could not start safely.")) : setConfirming(true)}><Play weight="fill" />{active ? "Research in progress" : "Start research"}</Button>
    </>}
    {(notice || run?.safeMessage) && <p aria-live="polite" className="mt-3 text-xs leading-5 text-muted-foreground">{notice || run?.safeMessage}</p>}
  </div>{confirming && <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="provider-sharing-title"><Card className="w-full max-w-md"><CardContent className="p-6"><h2 id="provider-sharing-title" className="text-lg font-semibold">Start solution research?</h2><div className="mt-5 space-y-3 text-sm"><Fact label="Providers" value={selected.map((providerId) => providers.find((provider) => provider.providerId === providerId)?.providerLabel ?? providerId).join(", ")} /><Fact label="Data" value={dataClass === "source_code" ? "Generated project context" : "Non-personal test context"} /><Fact label="Context version" value={contextDigest?.slice(0, 12) ?? "Unavailable"} /><Fact label="Expires" value="7 days" /><Fact label="Maximum cost" value="$0" /></div><div className="mt-6 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button><Button onClick={() => void confirmStart()} disabled={working}>Allow and start</Button></div></CardContent></Card></div>}</>;
}
function Fact(props: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/55 px-4 py-3"><span className="text-muted-foreground">{props.label}</span><strong className="text-right">{props.value}</strong></div>; }
