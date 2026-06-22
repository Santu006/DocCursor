const {
  canProcessExtension,
} = require("../base");

const extensions = [".pdf"];

async function process(ctx) {
  const asPdf = require("../../../processSingleFile/convert/asPDF/index.js");
  return asPdf(ctx);
}

module.exports = {
  id: "pdf",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
