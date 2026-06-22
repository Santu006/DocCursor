const { resolveSectionConcept } = require("./sectionConcepts");
const { normalizeSectionTitle, titleSimilarity } = require("./sectionMatcher");

/**
 * Named clause templates keyed by concept + change type.
 * @type {Record<string, Record<string, { title: string, description: string, confidence: number }>>}
 */
const NAMED_CLAUSE_TEMPLATES = {
  retainer: {
    added: {
      title: "Retainer Deposit Requirement Added",
      description: "A retainer or advance fee deposit is now required before services begin.",
      confidence: 0.94,
    },
    removed: {
      title: "Retainer Deposit Requirement Removed",
      description: "The retainer or advance fee deposit obligation has been eliminated.",
      confidence: 0.92,
    },
    modified: {
      title: "Retainer Structure Revised",
      description: "The retainer amount, timing, or replenishment terms have changed.",
      confidence: 0.9,
    },
  },
  payment_terms: {
    added: {
      title: "Payment Terms Added",
      description: "New billing, invoicing, or payment schedule provisions were introduced.",
      confidence: 0.91,
    },
    removed: {
      title: "Payment Terms Removed",
      description: "Existing payment or billing provisions were eliminated.",
      confidence: 0.9,
    },
    modified: {
      title: "Payment Structure Revised",
      description: "Billing frequency, payment timing, or fee calculation method changed.",
      confidence: 0.93,
    },
  },
  scope_of_services: {
    added: {
      title: "Scope of Services Added",
      description: "New scope or representation boundaries were defined.",
      confidence: 0.88,
    },
    removed: {
      title: "Scope Restriction Removed",
      description: "A limitation on the scope of legal services was removed.",
      confidence: 0.89,
    },
    modified: {
      title: "Scope of Representation Expanded",
      description: "The breadth or limits of legal services covered by the agreement changed.",
      confidence: 0.92,
    },
  },
  arbitration: {
    added: {
      title: "Arbitration Clause Added",
      description: "Dispute resolution via arbitration or mediation was introduced.",
      confidence: 0.95,
    },
    removed: {
      title: "Arbitration Clause Removed",
      description: "Mandatory arbitration or alternative dispute resolution was eliminated.",
      confidence: 0.96,
    },
    modified: {
      title: "Arbitration Process Revised",
      description: "Dispute resolution forum, jurisdiction, or arbitration rules changed.",
      confidence: 0.93,
    },
  },
  withdrawal: {
    added: {
      title: "Attorney Withdrawal Rights Added",
      description: "The attorney may now withdraw from representation under defined conditions.",
      confidence: 0.91,
    },
    removed: {
      title: "Attorney Withdrawal Rights Removed",
      description: "Attorney withdrawal provisions were eliminated or restricted.",
      confidence: 0.89,
    },
    modified: {
      title: "Withdrawal Terms Revised",
      description: "Notice periods or conditions for attorney withdrawal changed.",
      confidence: 0.88,
    },
  },
  confidentiality: {
    added: {
      title: "Confidentiality Obligations Added",
      description: "New confidentiality or non-disclosure requirements were introduced.",
      confidence: 0.9,
    },
    removed: {
      title: "Confidentiality Protections Removed",
      description: "Confidentiality or non-disclosure obligations were weakened or removed.",
      confidence: 0.92,
    },
    modified: {
      title: "Confidentiality Terms Revised",
      description: "The scope or duration of confidentiality obligations changed.",
      confidence: 0.9,
    },
  },
  termination: {
    added: {
      title: "Termination Provisions Added",
      description: "New termination rights or notice requirements were introduced.",
      confidence: 0.88,
    },
    removed: {
      title: "Termination Protections Removed",
      description: "Termination rights or notice protections were eliminated.",
      confidence: 0.9,
    },
    modified: {
      title: "Termination Terms Revised",
      description: "Notice periods or termination conditions changed.",
      confidence: 0.89,
    },
  },
  liability: {
    added: {
      title: "Liability Provision Added",
      description: "New liability, indemnification, or warranty terms were introduced.",
      confidence: 0.91,
    },
    removed: {
      title: "Liability Limitation Removed",
      description: "A cap on liability or indemnification protection was removed.",
      confidence: 0.93,
    },
    modified: {
      title: "Liability Terms Revised",
      description: "Liability caps, indemnification scope, or warranty terms changed.",
      confidence: 0.9,
    },
  },
  client_responsibilities: {
    added: {
      title: "Client Responsibilities Added",
      description: "New client cooperation or compliance obligations were introduced.",
      confidence: 0.86,
    },
    removed: {
      title: "Client Responsibilities Removed",
      description: "Client cooperation or compliance obligations were eliminated.",
      confidence: 0.85,
    },
    modified: {
      title: "Client Obligations Expanded",
      description: "Client duties such as cooperation, attendance, or notification changed.",
      confidence: 0.87,
    },
  },
  file_retention: {
    added: {
      title: "File Retention Policy Added",
      description: "Provisions for storage, return, or destruction of client files were added.",
      confidence: 0.84,
    },
    removed: {
      title: "File Retention Policy Removed",
      description: "File management or retention obligations were eliminated.",
      confidence: 0.83,
    },
    modified: {
      title: "File Management Terms Revised",
      description: "Client file storage, return, or destruction terms changed.",
      confidence: 0.85,
    },
  },
  compliance: {
    added: {
      title: "Compliance Requirement Added",
      description: "New regulatory or compliance obligations were introduced.",
      confidence: 0.88,
    },
    removed: {
      title: "Compliance Requirement Removed",
      description: "Regulatory or compliance obligations were eliminated.",
      confidence: 0.87,
    },
    modified: {
      title: "Compliance Terms Revised",
      description: "Regulatory or audit compliance requirements changed.",
      confidence: 0.86,
    },
  },
};

/** Pattern-based naming when concept template is unavailable. */
const TEXT_PATTERNS = [
  {
    pattern: /\bhourly (?:rate|billing|fee)\b|\bbilled at the rate\b|\bper hour\b/i,
    added: { title: "Hourly Billing Provision Added", confidence: 0.88 },
    removed: { title: "Hourly Billing Provision Removed", confidence: 0.86 },
    modified: { title: "Hourly Billing Rate Revised", confidence: 0.9 },
  },
  {
    pattern: /\bflat fee\b/i,
    added: { title: "Flat Fee Provision Added", confidence: 0.87 },
    removed: { title: "Flat Fee Provision Removed", confidence: 0.85 },
    modified: { title: "Flat Fee Structure Revised", confidence: 0.88 },
  },
  {
    pattern: /\bappoint another attorney\b/i,
    added: { title: "Attorney Succession Provision Added", confidence: 0.9 },
    removed: { title: "Attorney Succession Provision Removed", confidence: 0.88 },
    modified: { title: "Attorney Succession Terms Revised", confidence: 0.87 },
  },
  {
    pattern: /\bmonthly statement\b/i,
    added: { title: "Monthly Billing Statement Added", confidence: 0.86 },
    modified: { title: "Billing Frequency Revised", confidence: 0.89 },
  },
  {
    pattern: /\bnet\s+(\d+)\b/i,
    modified: { title: "Payment Terms Revised", confidence: 0.88 },
  },
  {
    pattern: /\blimited scope\b/i,
    removed: { title: "Limited Scope Restriction Removed", confidence: 0.91 },
    modified: { title: "Scope of Representation Expanded", confidence: 0.92 },
  },
  {
    pattern: /\bgoverning law\b|\bjurisdiction\b|\bvenue\b/i,
    modified: { title: "Governing Law / Jurisdiction Revised", confidence: 0.91 },
  },
];

/**
 * @param {object} change
 * @returns {{ title: string, description: string, confidence: number }}
 */
function nameClause(change = {}) {
  const changeType = change.changeType || "modified";
  const conceptId = change.conceptId || change.concept?.id;
  const combinedText = `${change.before || ""} ${change.after || ""} ${change.previous || ""} ${change.next || ""} ${change.summary || ""}`;

  if (conceptId && NAMED_CLAUSE_TEMPLATES[conceptId]?.[changeType]) {
    const template = NAMED_CLAUSE_TEMPLATES[conceptId][changeType];
    return {
      title: template.title,
      description: template.description,
      confidence: template.confidence,
    };
  }

  for (const rule of TEXT_PATTERNS) {
    if (!rule.pattern.test(combinedText)) continue;
    const match = rule[changeType] || rule.modified;
    if (match) {
      return {
        title: match.title,
        description: change.summary || match.title,
        confidence: match.confidence,
      };
    }
  }

  const concept = conceptId
    ? { id: conceptId, label: change.label }
    : resolveSectionConcept(change.section || "", combinedText);

  if (concept?.label) {
    const verb =
      changeType === "added"
        ? "Added"
        : changeType === "removed"
          ? "Removed"
          : "Revised";
    return {
      title: `${concept.label} ${verb}`,
      description: change.summary || `${concept.label} ${changeType}`,
      confidence: 0.72,
    };
  }

  return {
    title: humanizeFallback(change),
    description: change.summary || humanizeFallback(change),
    confidence: 0.55,
  };
}

/**
 * @param {object} change
 * @returns {string}
 */
function humanizeFallback(change = {}) {
  const changeType = change.changeType || "modified";
  const verb =
    changeType === "added" ? "Added" : changeType === "removed" ? "Removed" : "Revised";
  const section = change.section || "Clause";
  if (section && section !== "Clause" && section !== "Preamble") {
    return `${section} ${verb}`;
  }
  return `Contract Provision ${verb}`;
}

/**
 * @param {object} removed
 * @param {object} added
 * @returns {{ title: string, description: string, confidence: number }}
 */
function nameModification(removed, added) {
  const conceptId = removed.conceptId || added.conceptId;
  const combinedText = `${removed.before || removed.previous || ""} ${added.after || added.next || ""}`;

  if (conceptId === "scope_of_services") {
    return {
      title: "Scope of Representation Expanded",
      description: "The agreement scope shifted from limited to broader representation.",
      confidence: 0.92,
    };
  }
  if (conceptId === "payment_terms" || conceptId === "retainer") {
    return {
      title: "Payment Structure Revised",
      description: "Billing, retainer, or payment timing terms evolved between versions.",
      confidence: 0.93,
    };
  }
  if (conceptId === "arbitration") {
    return {
      title: "Arbitration Process Revised",
      description: "Dispute resolution or jurisdiction terms changed between versions.",
      confidence: 0.94,
    };
  }
  if (conceptId === "confidentiality") {
    return {
      title: "Confidentiality Terms Revised",
      description: "Confidentiality obligations changed between versions.",
      confidence: 0.9,
    };
  }
  if (conceptId === "termination") {
    return {
      title: "Termination Terms Revised",
      description: "Termination notice or conditions changed between versions.",
      confidence: 0.89,
    };
  }
  if (conceptId === "withdrawal") {
    return {
      title: "Withdrawal Terms Revised",
      description: "Attorney withdrawal rights or notice requirements changed.",
      confidence: 0.88,
    };
  }

  const synthetic = {
    changeType: "modified",
    conceptId,
    section: removed.section || added.section,
    before: removed.before || removed.previous,
    after: added.after || added.next,
    summary: "",
  };
  return nameClause(synthetic);
}

/**
 * @param {string} textA
 * @param {string} textB
 * @returns {number}
 */
function textSimilarity(textA = "", textB = "") {
  const normA = normalizeSectionTitle(textA);
  const normB = normalizeSectionTitle(textB);
  if (!normA || !normB) return 0;
  return titleSimilarity(normA, normB);
}

module.exports = {
  nameClause,
  nameModification,
  textSimilarity,
  NAMED_CLAUSE_TEMPLATES,
};
