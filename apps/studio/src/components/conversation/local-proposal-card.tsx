import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Fingerprint } from "@phosphor-icons/react/Fingerprint";
import { Stop } from "@phosphor-icons/react/Stop";
import { useState } from "react";
import type { LocalRequest } from "../../../../../packages/runtime/src/local-requests.js";
import {
  advanceLocalProposal,
  decideLocalProposal,
  requestLocalProposal,
} from "../../local-request-client.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export function LocalProposalCard(props: {
  proposal: NonNullable<NonNullable<LocalRequest["execution"]>["proposal"]>;
}) {
  const session = props.proposal;
  return (
    <div className="mt-3 bg-primary/[.055] p-3" aria-label="Generated implementation proposal">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong className="text-[11px]">Grounded model proposal</strong>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Untrusted suggestion · never applied automatically
          </p>
        </div>
        <Badge
          tone={
            session.state === "accepted"
              ? "positive"
              : session.state === "interrupted" || session.state === "needs_user"
                ? "critical"
                : "active"
          }
        >
          {session.state}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Fact label="Provider" value={session.proposal?.providerId ?? "Not called"} />
        <Fact label="Model" value={session.proposal?.modelId ?? "Not selected"} />
        <Fact label="Bounded sources" value={String(session.prompt.sources.length)} />
      </div>
      {session.proposal && (
        <>
          <p className="mt-3 text-[11px] font-semibold">{session.proposal.summary}</p>
          <div className="mt-2 grid gap-2">
            {session.proposal.operations.map((operation) => (
              <div key={operation.path} className="bg-background/65 p-3 text-[10px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {operation.type} · {operation.path}
                  </strong>
                  <span className="text-muted-foreground">
                    {operation.content === null
                      ? "delete"
                      : `${new TextEncoder().encode(operation.content).length.toLocaleString()} bytes`}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{operation.rationale}</p>
                <p className="mt-1">Sources: {operation.citations.join(" · ")}</p>
              </div>
            ))}
          </div>
          {session.proposal.findings.length > 0 && (
            <div className="mt-2 grid gap-1">
              {session.proposal.findings.map((finding, index) => (
                <p
                  key={`${finding.code}-${index}`}
                  className={
                    finding.severity === "blocking"
                      ? "text-[10px] font-medium text-destructive"
                      : "text-[10px] text-muted-foreground"
                  }
                >
                  {finding.severity === "blocking" ? "Blocked" : "Review"} · {finding.detail}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {session.safeMessage && (
        <p className="mt-2 text-[10px] text-muted-foreground">{session.safeMessage}</p>
      )}
    </div>
  );
}

export function LocalProposalControls(props: {
  endpoint: string;
  request: LocalRequest;
  working: boolean;
  onComplete: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const execution = props.request.execution;
  const session = execution?.proposal;

  async function prepare() {
    const taskId = execution?.authority.manifest.order[0];
    if (!execution?.run || !taskId) return;
    setBusy(true);
    try {
      await requestLocalProposal({
        endpoint: props.endpoint,
        requestId: props.request.id,
        proposal: {
          schemaVersion: 1,
          expectedAuthorityDigest: execution.authority.digest,
          expectedRunDigest: execution.run.digest,
          taskId,
        },
        idempotencyKey: `proposal-request:${props.request.id}:${execution.run.digest}:${taskId}`,
      });
      await props.onComplete(
        "Grounded coding prompt compiled locally. No provider has written or changed any file."
      );
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Proposal request failed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "accept" | "reject") {
    const proposal = session?.proposal;
    if (!proposal) return;
    setBusy(true);
    try {
      await decideLocalProposal({
        endpoint: props.endpoint,
        requestId: props.request.id,
        decision: { schemaVersion: 1, expectedProposalDigest: proposal.digest, decision },
        idempotencyKey: `proposal-${decision}:${props.request.id}:${proposal.digest}`,
      });
      await props.onComplete(
        decision === "accept"
          ? "Proposal accepted into a separate unapproved atomic preview. Files remain unchanged."
          : "Proposal rejected. No files changed."
      );
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Proposal decision failed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!session) return;
    setBusy(true);
    try {
      await advanceLocalProposal({
        endpoint: props.endpoint,
        requestId: props.request.id,
        action: "reconcile",
        idempotencyKey: `proposal-reconcile:${props.request.id}:${session.prompt.digest}`,
      });
      await props.onComplete(
        "Interrupted provider work preserved as outcome unknown. No retry or file mutation occurred."
      );
    } catch (error) {
      props.onError(
        error instanceof Error ? error.message : "Proposal reconciliation failed safely."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <Button size="sm" onClick={() => void prepare()} disabled={props.working || busy}>
        <Fingerprint />
        Prepare grounded AI proposal
      </Button>
    );
  }
  if (session.state === "review_ready") {
    const proposal = session.proposal;
    return (
      <>
        <Button
          size="sm"
          onClick={() => void decide("accept")}
          disabled={
            props.working || busy || proposal?.findings.some((item) => item.severity === "blocking")
          }
        >
          <CheckCircle />
          Accept proposal preview
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void decide("reject")}
          disabled={props.working || busy}
        >
          <Stop />
          Reject proposal
        </Button>
      </>
    );
  }
  if (session.state === "generating" || session.state === "interrupted") {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void reconcile()}
        disabled={props.working || busy}
      >
        <ArrowClockwise />
        Reconcile provider outcome
      </Button>
    );
  }
  return null;
}

function Fact(props: { label: string; value: string }) {
  return (
    <div className="bg-background/65 p-3">
      <span className="block text-[9px] uppercase tracking-[.12em] text-muted-foreground">
        {props.label}
      </span>
      <strong className="mt-1 block truncate text-[11px]">{props.value}</strong>
    </div>
  );
}
