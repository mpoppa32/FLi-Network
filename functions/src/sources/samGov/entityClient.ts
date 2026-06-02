// SAM.gov Entity Information API client.
//
// Separate from the opportunities-search client (client.ts) because the
// endpoint, response shape, and call cadence are different. Both share
// the sam_gov rate-limit bucket via acquireTokens("sam_gov", 1) so the
// daily 1000/hr cap is respected across the whole plugin.
//
// Endpoint: GET https://api.sam.gov/entity-information/v3/entities
//   Query: ueiSAM={uei}&api_key={key}
//   Returns: { totalRecords, entityData: [ { entityRegistration, coreData, ... } ] }
//
// What we use:
//   coreData.entityInformation.entityURL  — public website URL
//   entityRegistration.legalBusinessName  — match-confidence anchor
//   entityRegistration.dbaName            — alt name for confidence match
//
// Doctrine: public SAM.gov records (operator-consented via SAM.gov
// registration; published openly via api.sam.gov).

import { acquireTokens } from "../../framework/rateLimit";
import { withRetry } from "../../framework/retry";
import { requireSecret } from "../../framework/secrets";
import { Logger } from "../../framework/logger";

const BASE_URL = "https://api.sam.gov/entity-information/v3/entities";
const USER_AGENT = "Corsair Defense BD Intel (mpoppa32@gmail.com)";

export interface SamEntityRecord {
  entityRegistration?: {
    samRegistered?: string;
    ueiSAM?: string;
    cageCode?: string;
    legalBusinessName?: string;
    dbaName?: string;
    registrationStatus?: string;
    registrationExpirationDate?: string;
    ueiStatus?: string;
    publicDisplayFlag?: string;
  };
  coreData?: {
    entityInformation?: {
      entityURL?: string;
      entityDivisionName?: string;
      entityDivisionNumber?: string;
      entityStartDate?: string;
    };
    physicalAddress?: {
      addressLine1?: string;
      city?: string;
      stateOrProvinceCode?: string;
      zipCode?: string;
      countryCode?: string;
    };
  };
}

export interface SamEntityResponse {
  totalRecords: number;
  entityData: SamEntityRecord[];
}

/** Fetch one SAM.gov entity by UEI. Returns null when totalRecords=0
 *  (UEI not in SAM.gov or not publicly displayed). Returns the first
 *  entity record otherwise. Throws on HTTP error after retries. */
export async function fetchEntityByUei(
  ueiSam: string,
  log?: Logger
): Promise<SamEntityRecord | null> {
  const apiKey = requireSecret("samgov").apiKey;
  await acquireTokens("sam_gov", 1);

  const query = new URLSearchParams();
  query.set("ueiSAM", ueiSam);
  query.set("api_key", apiKey);

  const op = async (): Promise<SamEntityResponse> => {
    const response = await fetch(`${BASE_URL}?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      const err = new Error(
        `SAM.gov entity-information failed: HTTP ${response.status} — ${text.slice(0, 200)}`
      );
      (err as { statusCode?: number }).statusCode = response.status;
      throw err;
    }
    return (await response.json()) as SamEntityResponse;
  };

  const data = await withRetry(op, {
    source: "sam_gov",
    operationName: "fetch_entity_by_uei",
    log,
  });

  if (!data?.entityData?.length) return null;
  return data.entityData[0];
}

/** Extract a normalized lowercase domain from an entityURL string.
 *  Handles: http://www.example.com/, https://example.com/path?x=1,
 *  example.com, www.example.com, mailto:..., invalid input.
 *  Returns "" when no usable domain can be parsed. */
export function deriveDomainFromUrl(url: string | undefined): string {
  if (!url) return "";
  let s = String(url).trim();
  if (!s) return "";
  // Strip mailto: / tel: / etc. — entity records sometimes have these
  if (/^(mailto|tel|fax):/i.test(s)) return "";
  // Prepend http:// if no protocol so URL() can parse
  if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(s)) s = "http://" + s;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return "";
  }
  // Strip leading www. (or m. for mobile mirrors)
  host = host.replace(/^(www|m)\./, "");
  // Sanity check: must have at least one dot + valid TLD-ish suffix
  if (!host.includes(".") || host.length < 4) return "";
  return host;
}
