/**
 * Canonical business section concepts for semantic matching across documents.
 * Sections with different titles but the same concept are treated as comparable.
 */
const SECTION_CONCEPTS = [
  {
    id: "scope_of_services",
    label: "Scope of Services",
    patterns: [
      /\bscope of (?:services|representation|work|legal services)\b/i,
      /\blimited scope\b/i,
      /\blegal services to be provided\b/i,
      /\bmatters?\s+covered\b/i,
    ],
    keywords: ["scope", "services", "representation", "limited", "matters"],
  },
  {
    id: "payment_terms",
    label: "Payment Terms",
    patterns: [
      /\bpayment terms?\b/i,
      /\bbilling\b/i,
      /\bfees?\b/i,
      /\bhourly rate\b/i,
      /\bflat fee\b/i,
      /\bnet\s+\d+\b/i,
      /\binvoice\b/i,
      /\bcompensation\b/i,
    ],
    keywords: ["payment", "billing", "fee", "hourly", "flat", "invoice", "net"],
  },
  {
    id: "retainer",
    label: "Retainer",
    patterns: [
      /\bretainer\b/i,
      /\badvance fee\b/i,
      /\bdeposit\b/i,
      /\btrust account\b/i,
      /\bevergreen retainer\b/i,
      /\binitial deposit\b/i,
    ],
    keywords: ["retainer", "deposit", "advance", "trust", "prepaid"],
  },
  {
    id: "confidentiality",
    label: "Confidentiality",
    patterns: [
      /\bconfidential/i,
      /\bnon[- ]disclosure\b/i,
      /\bnda\b/i,
      /\bproprietary information\b/i,
      /\btrade secret\b/i,
    ],
    keywords: ["confidential", "disclosure", "nda", "proprietary", "secret"],
  },
  {
    id: "termination",
    label: "Termination",
    patterns: [
      /\bterminat/i,
      /\bexpir/i,
      /\bend of (?:term|agreement)\b/i,
      /\bnotice period\b/i,
    ],
    keywords: ["termination", "terminate", "expire", "notice", "cancel"],
  },
  {
    id: "withdrawal",
    label: "Withdrawal Rights",
    patterns: [
      /\bwithdraw/i,
      /\bdischarge\b/i,
      /\bresign\b/i,
      /\bstop representing\b/i,
    ],
    keywords: ["withdraw", "withdrawal", "discharge", "resign"],
  },
  {
    id: "liability",
    label: "Liability",
    patterns: [
      /\bliabil/i,
      /\bindemnif/i,
      /\blimitation of liability\b/i,
      /\bdisclaimer\b/i,
      /\bno guarantee\b/i,
      /\bwarrant/i,
    ],
    keywords: ["liability", "indemnif", "damages", "warranty", "disclaimer"],
  },
  {
    id: "arbitration",
    label: "Arbitration",
    patterns: [
      /\barbitrat/i,
      /\bdispute resolution\b/i,
      /\bmediation\b/i,
      /\bjurisdiction\b/i,
      /\bgoverning law\b/i,
      /\bvenue\b/i,
    ],
    keywords: ["arbitration", "arbitrate", "mediation", "jurisdiction", "venue"],
  },
  {
    id: "file_retention",
    label: "File Retention",
    patterns: [
      /\bfile retention\b/i,
      /\bclient file\b/i,
      /\brecords retention\b/i,
      /\bstorage of (?:the )?file\b/i,
      /\bdestroy\b.*\bfile\b/i,
    ],
    keywords: ["file", "retention", "storage", "records", "archive"],
  },
  {
    id: "client_responsibilities",
    label: "Client Responsibilities",
    patterns: [
      /\bclient responsibilities\b/i,
      /\bclient (?:shall|must|agrees to)\b/i,
      /\bcooperat/i,
      /\bclient obligations\b/i,
      /\bduties of (?:the )?client\b/i,
    ],
    keywords: ["client", "cooperate", "responsibilities", "obligations", "duties"],
  },
  {
    id: "compliance",
    label: "Compliance",
    patterns: [
      /\bcompliance\b/i,
      /\bregulat/i,
      /\baudit\b/i,
      /\bgdpr\b/i,
      /\bhipaa\b/i,
    ],
    keywords: ["compliance", "regulatory", "audit", "gdpr"],
  },
];

/**
 * @param {string} title
 * @param {string} [body=""]
 * @returns {{ id: string, label: string, score: number }|null}
 */
function resolveSectionConcept(title = "", body = "") {
  const haystack = `${title}\n${body}`.slice(0, 2000);
  let best = null;

  for (const concept of SECTION_CONCEPTS) {
    let score = 0;
    for (const pattern of concept.patterns) {
      if (pattern.test(title)) score += 3;
      else if (pattern.test(haystack)) score += 1;
    }

    const titleNorm = title.toLowerCase();
    for (const keyword of concept.keywords) {
      if (titleNorm.includes(keyword)) score += 2;
    }

    if (!best || score > best.score) {
      best = { id: concept.id, label: concept.label, score };
    }
  }

  return best && best.score >= 2 ? best : null;
}

/**
 * @param {string} id
 * @returns {string}
 */
function getConceptLabel(id) {
  return SECTION_CONCEPTS.find((c) => c.id === id)?.label || id;
}

module.exports = {
  SECTION_CONCEPTS,
  resolveSectionConcept,
  getConceptLabel,
};
