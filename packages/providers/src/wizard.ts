export type ProviderWizardId =
  | "groq"
  | "gemini"
  | "openrouter"
  | "cloudflare"
  | "github-models"
  | "local-model-runtime";

export type ProviderAuthMode =
  | "guided_key"
  | "pkce"
  | "github_authorization"
  | "local_discovery";

export type ProviderValidationFailure =
  | "invalid"
  | "expired"
  | "wrong_project"
  | "paid_only"
  | "insufficient_permission"
  | "offline";

export interface ProviderConnectionGuide {
  readonly id: ProviderWizardId;
  readonly label: string;
  readonly authMode: ProviderAuthMode;
  readonly dashboardUrl: string;
  readonly freeStatus: string;
  readonly dataUse: string;
  readonly minimumPermission: string;
  readonly steps: readonly string[];
  readonly revocation: string;
}

export const providerConnectionGuides: readonly ProviderConnectionGuide[] = [
  {
    id: "groq",
    label: "Groq",
    authMode: "guided_key",
    dashboardUrl: "https://console.groq.com/keys",
    freeStatus: "Free developer limits · no paid fallback",
    dataUse: "External processing under the connected account policy",
    minimumPermission: "Inference only",
    steps: [
      "Open the Groq API Keys page.",
      "Create a key for Pipeline Studio.",
      "Return and use secure key entry.",
      "Run free-status, quota, model, and live-canary checks."
    ],
    revocation: "Delete the key in Groq, then disconnect the local reference."
  },
  {
    id: "gemini",
    label: "Gemini",
    authMode: "guided_key",
    dashboardUrl: "https://aistudio.google.com/apikey",
    freeStatus: "Free-tier project required · billing-enabled projects denied",
    dataUse: "Free-tier prompts may be retained under Google account terms",
    minimumPermission: "Generative Language API key for one selected project",
    steps: [
      "Open Google AI Studio API keys.",
      "Choose or create a project without billing enabled.",
      "Create a minimum-scope key and return.",
      "Verify project identity, billing state, quota, and a live canary."
    ],
    revocation: "Revoke the key in Google AI Studio and remove the local reference."
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    authMode: "pkce",
    dashboardUrl: "https://openrouter.ai/settings/keys",
    freeStatus: "Free-model routes only · paid models denied",
    dataUse: "Varies by selected model; the router displays the route policy",
    minimumPermission: "PKCE session limited to key creation and inference",
    steps: [
      "Open the OpenRouter authorization page.",
      "Approve the minimum requested access.",
      "Return through the verified PKCE callback.",
      "Admit only current zero-cost models after a live canary."
    ],
    revocation: "Revoke the key or session in OpenRouter and disconnect locally."
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    authMode: "pkce",
    dashboardUrl: "https://dash.cloudflare.com/profile/api-tokens",
    freeStatus: "Daily Workers AI allowance · neuron budget enforced",
    dataUse: "Processed within the selected Cloudflare account",
    minimumPermission: "Account Workers AI read and inference only",
    steps: [
      "Authorize the selected Cloudflare account.",
      "Confirm the account identifier and minimum permissions.",
      "Return through the verified PKCE callback.",
      "Measure neuron allowance and run a bounded model canary."
    ],
    revocation: "Revoke the token in Cloudflare and disconnect the local reference."
  },
  {
    id: "github-models",
    label: "GitHub Models",
    authMode: "github_authorization",
    dashboardUrl: "https://github.com/marketplace/models",
    freeStatus: "Account-limited preview allowance · paid use disabled",
    dataUse: "Subject to GitHub Models and selected model-provider terms",
    minimumPermission: "Models read and inference; no repository write access",
    steps: [
      "Authorize GitHub Models with the displayed scopes.",
      "Confirm no repository write permission is requested.",
      "Choose a free-eligible model.",
      "Verify account limits and run a bounded canary."
    ],
    revocation: "Revoke the authorization in GitHub and disconnect locally."
  },
  {
    id: "local-model-runtime",
    label: "Local models",
    authMode: "local_discovery",
    dashboardUrl: "http://127.0.0.1:11434",
    freeStatus: "Runs locally · no provider charge",
    dataUse: "Prompt and response stay on the selected local computer",
    minimumPermission: "Loopback model discovery and inference",
    steps: [
      "Discover a supported loopback runtime.",
      "List installed models without sending project content.",
      "Choose a model that fits available memory.",
      "Run a bounded local canary and record capability evidence."
    ],
    revocation: "Disable local discovery or remove the runtime connection."
  }
] as const;

export interface ProviderWizardSession {
  readonly schemaVersion: 1;
  readonly providerId: ProviderWizardId;
  readonly stage:
    | "instructions"
    | "secure_entry"
    | "validating"
    | "connected"
    | "repair";
  readonly credentialState: "not_received" | "stored_reference" | "revoked";
  readonly maskedCredential: string | null;
  readonly validationFailure: ProviderValidationFailure | null;
  readonly message: string;
}

export function startProviderWizard(
  providerId: ProviderWizardId
): ProviderWizardSession {
  providerGuide(providerId);
  return {
    schemaVersion: 1,
    providerId,
    stage: "instructions",
    credentialState: "not_received",
    maskedCredential: null,
    validationFailure: null,
    message: "Follow the provider-specific steps, then return to continue."
  };
}

export function requestSecureEntry(
  session: ProviderWizardSession
): ProviderWizardSession {
  const guide = providerGuide(session.providerId);
  return {
    ...session,
    stage: guide.authMode === "local_discovery" ? "validating" : "secure_entry",
    message: guide.authMode === "local_discovery"
      ? "Checking the loopback runtime without sending project data."
      : "The local core will store the credential directly in the operating-system vault."
  };
}

export function recordProviderValidation(input: {
  readonly session: ProviderWizardSession;
  readonly outcome: "passed" | ProviderValidationFailure;
  readonly credentialFingerprint?: string | undefined;
}): ProviderWizardSession {
  if (input.outcome === "passed") {
    const maskedCredential = input.session.providerId === "local-model-runtime"
      ? null
      : maskFingerprint(input.credentialFingerprint);
    return {
      ...input.session,
      stage: "connected",
      credentialState: maskedCredential ? "stored_reference" : "not_received",
      maskedCredential,
      validationFailure: null,
      message: "Connection verified: free status, account scope, quota, model, and canary passed."
    };
  }
  return {
    ...input.session,
    stage: "repair",
    credentialState: "not_received",
    maskedCredential: null,
    validationFailure: input.outcome,
    message: repairForValidationFailure(input.outcome)
  };
}

export function repairForValidationFailure(
  failure: ProviderValidationFailure
): string {
  const repairs: Record<ProviderValidationFailure, string> = {
    invalid: "The provider rejected this credential. Create a new key and try secure entry again.",
    expired: "The credential expired. Rotate it in the provider dashboard, then reconnect.",
    wrong_project: "Choose the intended free-tier account or project and reconnect its credential.",
    paid_only: "This account or route is paid-only. Select a verified free project or free model.",
    insufficient_permission: "Create a replacement with the displayed minimum permission—nothing broader.",
    offline: "The provider could not be reached. Your key was not retained; retry when connectivity returns."
  };
  return repairs[failure];
}

export function revokeWizardConnection(
  session: ProviderWizardSession
): ProviderWizardSession {
  return {
    ...session,
    stage: "instructions",
    credentialState: "revoked",
    maskedCredential: null,
    validationFailure: null,
    message: "The local reference was removed. Complete the provider-side revocation shown below."
  };
}

export function providerGuide(providerId: ProviderWizardId): ProviderConnectionGuide {
  const guide = providerConnectionGuides.find((entry) => entry.id === providerId);
  if (!guide) throw new Error(`Unknown provider connection guide: ${providerId}`);
  return guide;
}

function maskFingerprint(value: string | undefined): string {
  if (!value || !/^[a-f0-9]{12}$/.test(value)) {
    throw new Error("A validated 12-character fingerprint is required.");
  }
  return `vault:•••• · ${value.slice(-4)}`;
}

