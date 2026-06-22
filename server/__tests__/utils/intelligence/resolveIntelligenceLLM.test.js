/* eslint-env jest, node */

const { resolveIntelligenceLLM } = require("../../../utils/intelligence/resolveIntelligenceLLM");

describe("resolveIntelligenceLLM", () => {
  afterEach(() => {
    delete process.env.INTELLIGENCE_LLM_PROVIDER;
    delete process.env.INTELLIGENCE_MODEL_PREF;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPEN_MODEL_PREF;
  });

  it("uses intelligence env overrides over workspace chat settings", () => {
    process.env.INTELLIGENCE_LLM_PROVIDER = "openai";
    process.env.INTELLIGENCE_MODEL_PREF = "gpt-4o";

    const result = resolveIntelligenceLLM({
      chatProvider: "openai",
      chatModel: "gpt-4o-mini",
    });

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("falls back to workspace chat settings when intelligence env is unset", () => {
    delete process.env.INTELLIGENCE_LLM_PROVIDER;
    delete process.env.INTELLIGENCE_MODEL_PREF;

    const result = resolveIntelligenceLLM({
      chatProvider: "openai",
      chatModel: "gpt-4o-mini",
    });

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });

  it("falls back to system LLM defaults when workspace is missing", () => {
    delete process.env.INTELLIGENCE_LLM_PROVIDER;
    delete process.env.INTELLIGENCE_MODEL_PREF;
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_MODEL_PREF = "gpt-4o";

    const result = resolveIntelligenceLLM(null);

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("uses intelligence provider env with workspace model when model env is unset", () => {
    process.env.INTELLIGENCE_LLM_PROVIDER = "openai";
    delete process.env.INTELLIGENCE_MODEL_PREF;

    const result = resolveIntelligenceLLM({
      chatProvider: "anthropic",
      chatModel: "gpt-4o-mini",
    });

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
  });
});
