const { getBaseLLMProviderModel } = require("../helpers");

/**
 * Resolve the LLM provider/model for document intelligence enrichment.
 *
 * Priority:
 * 1. INTELLIGENCE_LLM_PROVIDER / INTELLIGENCE_MODEL_PREF env overrides
 * 2. Workspace chatProvider / chatModel
 * 3. System LLM_PROVIDER + provider default model pref
 *
 * @param {object|null} workspace
 * @returns {{ provider: string, model: string|null }}
 */
function resolveIntelligenceLLM(workspace = null) {
  const provider =
    process.env.INTELLIGENCE_LLM_PROVIDER?.trim() ||
    workspace?.chatProvider ||
    process.env.LLM_PROVIDER ||
    null;

  const model =
    process.env.INTELLIGENCE_MODEL_PREF?.trim() ||
    workspace?.chatModel ||
    (provider ? getBaseLLMProviderModel({ provider }) : null) ||
    null;

  return { provider, model };
}

module.exports = {
  resolveIntelligenceLLM,
};
