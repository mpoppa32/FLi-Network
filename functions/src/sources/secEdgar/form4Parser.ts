// SEC EDGAR — Form 4 (Statement of Changes in Beneficial Ownership) XML parser
//
// v1.2 deep parsing. Form 4 documents are XML at well-defined paths under
// sec.gov/Archives. The schema is stable (SEC X0306 / X0506 / X0606 etc.);
// shape changes are additive within a major schema version.
//
// We avoid pulling in a heavy XML library: a defensive regex walker over
// the document fields gives us the same data with no additional dependency,
// consistent with the RSS/scrape parsers used elsewhere in the codebase.
//
// Form 4 layout (canonical):
//   <ownershipDocument>
//     <issuer>{cik, name, tradingSymbol}</issuer>
//     <reportingOwner>{cik, name, relationship{isDirector,isOfficer,
//                      isTenPercentOwner, officerTitle}}</reportingOwner>+
//     <nonDerivativeTable>
//       <nonDerivativeTransaction>{date, code, shares, price, A|D,
//                                  sharesOwnedFollowing}</nonDerivativeTransaction>*
//     </nonDerivativeTable>
//     <derivativeTable>...same shape...</derivativeTable>
//   </ownershipDocument>
//
// Transaction codes that matter most to BD operators:
//   P = open-market purchase (insider buying — strong bullish posture signal)
//   S = open-market sale (insider selling — common; volume/price/relationship matter)
//   A = grant/award (compensation grant, not a real market action)
//   M = exercise/conversion of derivative
//   X = exercise of in-the-money derivative
//   F = tax withholding (mechanical; usually low-signal)
//   G = gift
//   J = other (worth flagging)
//   D = sale to issuer / repurchase

export interface Form4Issuer {
  cik: string;
  name: string;
  tradingSymbol: string;
}

export interface Form4ReportingOwner {
  cik: string;
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string;
  /** Convenient single label combining title + relationship flags. */
  derivedTitle: string;
}

export interface Form4Transaction {
  /** "non_derivative" or "derivative" */
  kind: "non_derivative" | "derivative";
  securityTitle: string;
  /** YYYY-MM-DD */
  transactionDate: string;
  transactionDateMs: number;
  /** Transaction code letter (P / S / A / D / M / X / F / G / J / etc.) */
  transactionCode: string;
  /** Human-readable code description. */
  transactionCodeLabel: string;
  /** Number of shares (positive — sign captured by acquiredDisposed). */
  shares: number;
  /** Per-share price; 0 when not market-priced (e.g., grants). */
  pricePerShare: number;
  /** A = acquired, D = disposed. */
  acquiredDisposed: "A" | "D" | "";
  /** Shares owned following transaction. */
  sharesOwnedFollowing: number;
  /** Direct (D) vs indirect (I) ownership. */
  directOrIndirect: "D" | "I" | "";
  /** Computed: shares * pricePerShare. */
  value: number;
  /** Computed: signed value (negative when D). */
  signedValue: number;
}

export interface ParsedForm4 {
  schemaVersion: string;
  documentType: string;
  periodOfReport: string;
  issuer: Form4Issuer;
  reportingOwners: Form4ReportingOwner[];
  transactions: Form4Transaction[];
  /** Highest-absolute-value transaction (the "headline" for the filing). */
  primaryTransaction: Form4Transaction | null;
  /** Sum of value across all transactions. */
  totalValue: number;
  /** Net signed value (purchases positive, sales negative). */
  netSignedValue: number;
  /** Distinct transaction codes seen, sorted. */
  uniqueCodes: string[];
  /** Parser flags for downstream debugging. */
  flags: string[];
}

const TRANSACTION_CODE_LABELS: Record<string, string> = {
  P: "Open-market purchase",
  S: "Open-market sale",
  A: "Grant / award",
  D: "Sale to issuer",
  F: "Tax withholding",
  G: "Gift",
  I: "Discretionary transaction",
  M: "Exercise/conversion of derivative",
  C: "Conversion of derivative",
  X: "Exercise of in-the-money derivative",
  V: "Voluntary reported transaction",
  J: "Other acquisition/disposition",
  K: "Equity swap",
  L: "Small acquisition",
  W: "Will / inheritance",
  Z: "Voting trust deposit/withdrawal",
};

export function describeTransactionCode(code: string): string {
  return TRANSACTION_CODE_LABELS[code] || `Code ${code}`;
}

/**
 * Parse a Form 4 XML document. Best-effort: unknown fields default to empty.
 */
export function parseForm4Xml(xml: string): ParsedForm4 {
  const flags: string[] = [];

  const schemaVersion = extractValue(xml, "schemaVersion") || "";
  const documentType = extractValue(xml, "documentType") || "";
  const periodOfReport = extractValue(xml, "periodOfReport") || "";

  // ─── Issuer ───
  const issuerBlock = extractBlock(xml, "issuer") || "";
  const issuer: Form4Issuer = {
    cik: extractValue(issuerBlock, "issuerCik") || "",
    name: extractValue(issuerBlock, "issuerName") || "",
    tradingSymbol: extractValue(issuerBlock, "issuerTradingSymbol") || "",
  };
  if (!issuer.cik || !issuer.name) flags.push("issuer_incomplete");

  // ─── Reporting owners ───
  const reportingOwners: Form4ReportingOwner[] = [];
  const ownerBlocks = extractAllBlocks(xml, "reportingOwner");
  for (const ob of ownerBlocks) {
    const idBlock = extractBlock(ob, "reportingOwnerId") || "";
    const relBlock = extractBlock(ob, "reportingOwnerRelationship") || "";
    const isDirector = isTruthyXmlFlag(relBlock, "isDirector");
    const isOfficer = isTruthyXmlFlag(relBlock, "isOfficer");
    const isTenPercentOwner = isTruthyXmlFlag(relBlock, "isTenPercentOwner");
    const isOther = isTruthyXmlFlag(relBlock, "isOther");
    const officerTitle = extractValue(relBlock, "officerTitle") || "";
    const derivedTitle = buildDerivedTitle(officerTitle, isDirector, isOfficer, isTenPercentOwner, isOther);
    reportingOwners.push({
      cik: extractValue(idBlock, "rptOwnerCik") || "",
      name: extractValue(idBlock, "rptOwnerName") || "",
      isDirector,
      isOfficer,
      isTenPercentOwner,
      isOther,
      officerTitle,
      derivedTitle,
    });
  }
  if (reportingOwners.length === 0) flags.push("no_reporting_owner");

  // ─── Transactions: non-derivative + derivative ───
  const transactions: Form4Transaction[] = [];
  const ndBlocks = extractAllBlocks(xml, "nonDerivativeTransaction");
  for (const tb of ndBlocks) {
    const t = parseTransaction(tb, "non_derivative");
    if (t) transactions.push(t);
  }
  const dBlocks = extractAllBlocks(xml, "derivativeTransaction");
  for (const tb of dBlocks) {
    const t = parseTransaction(tb, "derivative");
    if (t) transactions.push(t);
  }
  if (transactions.length === 0) flags.push("no_transactions");

  // ─── Aggregates ───
  let totalValue = 0;
  let netSignedValue = 0;
  let primary: Form4Transaction | null = null;
  const codeSet = new Set<string>();
  for (const t of transactions) {
    totalValue += t.value;
    netSignedValue += t.signedValue;
    if (t.transactionCode) codeSet.add(t.transactionCode);
    if (!primary || Math.abs(t.value) > Math.abs(primary.value)) {
      primary = t;
    }
  }

  return {
    schemaVersion,
    documentType,
    periodOfReport,
    issuer,
    reportingOwners,
    transactions,
    primaryTransaction: primary,
    totalValue,
    netSignedValue,
    uniqueCodes: Array.from(codeSet).sort(),
    flags,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────

function parseTransaction(
  block: string,
  kind: "non_derivative" | "derivative"
): Form4Transaction | null {
  const securityTitle =
    extractValueInValueWrap(block, "securityTitle") ||
    extractValue(block, "securityTitle") ||
    "";
  const transactionDate =
    extractValueInValueWrap(block, "transactionDate") ||
    extractValue(block, "transactionDate") ||
    "";
  const transactionCode =
    extractValue(extractBlock(block, "transactionCoding") || "", "transactionCode") || "";
  const amountsBlock = extractBlock(block, "transactionAmounts") || "";
  const shares = parseNum(
    extractValueInValueWrap(amountsBlock, "transactionShares") ||
      extractValue(amountsBlock, "transactionShares")
  );
  const pricePerShare = parseNum(
    extractValueInValueWrap(amountsBlock, "transactionPricePerShare") ||
      extractValue(amountsBlock, "transactionPricePerShare")
  );
  const acquiredDisposedRaw =
    extractValueInValueWrap(amountsBlock, "transactionAcquiredDisposedCode") ||
    extractValue(amountsBlock, "transactionAcquiredDisposedCode") ||
    "";
  const acquiredDisposed: "A" | "D" | "" =
    acquiredDisposedRaw === "A" || acquiredDisposedRaw === "D" ? acquiredDisposedRaw : "";
  const postBlock = extractBlock(block, "postTransactionAmounts") || "";
  const sharesOwnedFollowing = parseNum(
    extractValueInValueWrap(postBlock, "sharesOwnedFollowingTransaction") ||
      extractValue(postBlock, "sharesOwnedFollowingTransaction")
  );
  const ownershipNatureBlock = extractBlock(block, "ownershipNature") || "";
  const directOrIndirectRaw =
    extractValueInValueWrap(ownershipNatureBlock, "directOrIndirectOwnership") ||
    extractValue(ownershipNatureBlock, "directOrIndirectOwnership") ||
    "";
  const directOrIndirect: "D" | "I" | "" =
    directOrIndirectRaw === "D" || directOrIndirectRaw === "I" ? directOrIndirectRaw : "";

  if (!transactionCode && !transactionDate && shares === 0) return null;

  const value = shares * pricePerShare;
  const signedValue =
    acquiredDisposed === "A" ? value : acquiredDisposed === "D" ? -value : value;

  const transactionDateMs = transactionDate ? Date.parse(transactionDate + "T00:00:00Z") : 0;

  return {
    kind,
    securityTitle,
    transactionDate,
    transactionDateMs: Number.isFinite(transactionDateMs) ? transactionDateMs : 0,
    transactionCode,
    transactionCodeLabel: describeTransactionCode(transactionCode),
    shares,
    pricePerShare,
    acquiredDisposed,
    sharesOwnedFollowing,
    directOrIndirect,
    value,
    signedValue,
  };
}

function buildDerivedTitle(
  officerTitle: string,
  isDirector: boolean,
  isOfficer: boolean,
  isTenPercentOwner: boolean,
  isOther: boolean
): string {
  if (officerTitle && officerTitle.trim().length > 0) return officerTitle.trim();
  const parts: string[] = [];
  if (isOfficer) parts.push("Officer");
  if (isDirector) parts.push("Director");
  if (isTenPercentOwner) parts.push("10%+ Owner");
  if (isOther && parts.length === 0) parts.push("Other Insider");
  return parts.join(" / ") || "Insider";
}

/**
 * Extract the inner text of the first <tag>...</tag>. Returns "" if missing.
 * Strips CDATA, decodes basic entities.
 */
function extractValue(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(pattern);
  if (!m) return "";
  return cleanXml(m[1]);
}

/**
 * Some Form 4 fields wrap their value in an inner <value>X</value> element.
 * Useful for the value-of-value pattern in transaction amounts.
 */
function extractValueInValueWrap(xml: string, tag: string): string {
  const block = extractBlock(xml, tag);
  if (!block) return "";
  return extractValue(block, "value");
}

/**
 * Return the inner block of the first <tag>...</tag>.
 */
function extractBlock(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(pattern);
  if (!m) return "";
  return m[1];
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function isTruthyXmlFlag(xml: string, tag: string): boolean {
  const raw = (extractValueInValueWrap(xml, tag) || extractValue(xml, tag) || "").trim();
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

function parseNum(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function cleanXml(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
