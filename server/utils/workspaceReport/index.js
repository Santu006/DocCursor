const {
  buildWorkspaceReport,
  formatReportAsContext,
  invalidateReportCache,
} = require("./buildWorkspaceReport");
const {
  containsAdvisoryLanguage,
  findAdvisoryPhrases,
} = require("./objectivity");

module.exports = {
  buildWorkspaceReport,
  formatReportAsContext,
  invalidateReportCache,
  containsAdvisoryLanguage,
  findAdvisoryPhrases,
};
