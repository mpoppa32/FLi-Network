// Corsair framework — typed secret accessor
//
// Per framework spec Part Six: Phase 8.5 uses Firebase Functions config
// (CLI-managed) for low-sensitivity keys. Migration to Secret Manager
// planned for production hardening (Phase 9+).
//
// Set via:
//   firebase functions:config:set samgov.api_key="..."
//   firebase functions:config:set congressgov.api_key="..."
//   firebase functions:config:set sec_edgar.user_agent="Corsair ..."

import { ConfigError } from "./errors";

export interface Secrets {
  samgov: { apiKey: string };
  congressgov: { apiKey: string };
  secEdgar: { userAgent: string };
  // P13.124 (audit Finding 3.1): Anthropic API key for the in-browser AI
  // features (Ask Corsair, Brief synthesis, intel extraction). Was deployed
  // in the workspace's RTDB config and exfiltratable via window.apiKey in
  // the browser. Now held server-side only — anthropicProxy function
  // forwards /v1/messages calls.
  anthropic: { apiKey: string };
}

let cachedSecrets: Partial<Secrets> | null = null;

/**
 * Read secrets from environment variables or Functions config.
 *
 * Functions config is exposed via `process.env.FIREBASE_CONFIG` and dotted
 * env vars set by firebase-functions. In Cloud Functions 2nd gen, prefer
 * environment variables set via the deploy command or .env files.
 *
 * For local dev, set via `.env` file or `firebase functions:config:get`
 * and shell export.
 */
export function getSecrets(): Partial<Secrets> {
  if (cachedSecrets) return cachedSecrets;

  cachedSecrets = {
    samgov: {
      apiKey: process.env.SAMGOV_API_KEY ?? process.env.SAM_GOV_API_KEY ?? "",
    },
    congressgov: {
      apiKey: process.env.CONGRESSGOV_API_KEY ?? process.env.CONGRESS_GOV_API_KEY ?? "",
    },
    secEdgar: {
      userAgent:
        process.env.SEC_EDGAR_USER_AGENT ??
        process.env.SEC_USER_AGENT ??
        "Corsair Defense BD Intel ops@corsairhq.io",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    },
  };
  return cachedSecrets;
}

/**
 * Get a specific source's secret, throwing if missing.
 */
export function requireSecret<K extends keyof Secrets>(source: K): Secrets[K] {
  const all = getSecrets();
  const s = all[source];
  if (!s) {
    throw new ConfigError(`Secret not configured for source: ${source}`);
  }
  // For string-valued single-key secrets, check non-empty
  if (source === "samgov") {
    const v = (s as Secrets["samgov"]).apiKey;
    if (!v) throw new ConfigError(`SAM.gov API key not set. Set SAMGOV_API_KEY env var.`);
  }
  if (source === "congressgov") {
    const v = (s as Secrets["congressgov"]).apiKey;
    if (!v) throw new ConfigError(`Congress.gov API key not set. Set CONGRESSGOV_API_KEY env var.`);
  }
  if (source === "secEdgar") {
    const v = (s as Secrets["secEdgar"]).userAgent;
    if (!v) throw new ConfigError(`SEC EDGAR User-Agent not set. Set SEC_EDGAR_USER_AGENT env var.`);
  }
  if (source === "anthropic") {
    const v = (s as Secrets["anthropic"]).apiKey;
    if (!v) throw new ConfigError(`Anthropic API key not set. Set ANTHROPIC_API_KEY via firebase functions:secrets:set ANTHROPIC_API_KEY.`);
  }
  return s as Secrets[K];
}

/**
 * Check which secrets are configured. Useful for the operator-facing Source
 * Health view to surface "auth not configured" state cleanly rather than
 * letting a sync fail later.
 */
export function listConfiguredSecrets(): Record<keyof Secrets, boolean> {
  const all = getSecrets();
  return {
    samgov: Boolean(all.samgov?.apiKey),
    congressgov: Boolean(all.congressgov?.apiKey),
    secEdgar: Boolean(all.secEdgar?.userAgent),
    anthropic: Boolean(all.anthropic?.apiKey),
  };
}

/**
 * Clear the cache. Used in tests; not needed in production.
 */
export function _resetSecretsCache(): void {
  cachedSecrets = null;
}
