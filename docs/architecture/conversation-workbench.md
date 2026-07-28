# Conversation workbench

The conversation workbench is a project-scoped control surface over canonical
pipeline state. It is not an alternate source of truth.

## Boundaries

- The composer screens context locally before constructing a provider payload.
  Removed, denied, oversized, unsupported, insecure, or sensitive attachments
  are never cited or included in that payload.
- Accepted context receives a deterministic SHA-256 citation digest. The digest
  implementation runs in both the browser and Node.js.
- Blocking ambiguity prevents work creation. Non-blocking ambiguity is shown as
  an editable assumption.
- The timeline is reconstructed from ordered durable events. A `working` event
  appears active only while both lease and service evidence are active.
- Safe cancellation distinguishes a request to stop, an observed safe stop, and
  an outcome whose safe stop cannot be proven.
- Conversation search applies project permission before text matching.
- Remembered assertions expose source, confidence, scope, expiry, correction,
  and deletion. They never become canonical project truth.
- Selected export excludes credential-shaped text and hidden prompts and carries
  an explicit non-canonical disclaimer.

## User interface

The responsive workbench combines project conversation search, a multimodal
composer, a truthful execution timeline, memory controls, export, and evidence
navigation. It uses the shared shadcn-compatible primitives, Onest typography,
warm amber tokens, and Phosphor icons in both light and dark themes.

## Release verification

Release requires repository verification, a production Studio build, browser
interaction checks for every safety and control state, desktop and mobile
overflow checks, and a clean browser error log.
