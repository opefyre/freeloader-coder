# Accessibility release gate

Pipeline Studio treats accessibility as a release decision. The supported
standard is WCAG 2.2 AA for critical workflows.

## Required dimensions

- keyboard-only operation;
- visible focus and logical focus order;
- semantic names, roles, states, and landmarks;
- text and control contrast in light and dark themes;
- reduced-motion behavior;
- 200% zoom without lost content or actions;
- mobile and narrow-window reflow without horizontal overflow;
- meaningful text or table alternatives for charts.

Required checks may be automated or named manual evidence. Both must identify
the affected surfaces, owner, observation time, review deadline, evidence, and
remediation.

## Fail-closed rule

A required failed, missing, not-run, or stale check blocks release. One critical
failure is sufficient. The gate cannot be waived by changing its severity,
renaming it, hiding the alternative, or presenting a screenshot as proof of
keyboard or assistive-technology behavior.

## Manual review

Manual evidence names the reviewer role, workflow, browser/theme/viewport,
assistive setting, observable result, and date. Critical journeys include adding
a project, approving work, reviewing evidence, restoring work, and changing
consent.

## Chart alternatives

Every chart exposes the same material conclusion and exact values through
nearby text or a semantic table. Color is never the only carrier of status. If
the alternative is absent or disagrees with the chart, the release is blocked.

The `/accessibility` simulation modifies local fixture state only. It creates no
release, issue, workflow, deployment, or external write.

Owner: Accessibility and quality reviewers  
Last reviewed: 2026-07-29  
Next review: 2026-10-29
