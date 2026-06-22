const { bootstrapServerEnv } = require("../utils/bootstrapEnv");
bootstrapServerEnv();

const { log, conclude } = require("./helpers/index.js");
const {
  DocumentIntelligence,
} = require("../models/documentIntelligence.js");
const { enrichDocument } = require("../utils/intelligence/enrichDocument.js");

const BATCH_SIZE = Number(process.env.INTELLIGENCE_BATCH_SIZE || 3);
const ENABLED = process.env.DOCUMENT_INTELLIGENCE_ENABLED !== "false";

(async () => {
  try {
    if (!ENABLED) {
      log("Document intelligence enrichment is disabled. Exiting.");
      return;
    }

    if (!process.env.OPEN_AI_KEY) {
      log(
        "OPEN_AI_KEY is not set. Add it in server/.env.development (or via Settings → LLM) then requeue failed rows."
      );
      return;
    }

    const batch = await DocumentIntelligence.claimPendingBatch(BATCH_SIZE);
    if (batch.length === 0) {
      log("No pending document intelligence records found.");
      return;
    }

    log(`Processing ${batch.length} document intelligence record(s).`);

    for (const record of batch) {
      log(`Enriching docId=${record.docId} (${record.filename})`);
      const result = await enrichDocument(record);
      if (result.success) {
        log(`Completed docId=${record.docId}`);
        continue;
      }

      await DocumentIntelligence.markFailed(
        record.id,
        result.error || "Enrichment failed"
      );
      log(`Failed docId=${record.docId}: ${result.error}`);
    }

    log("Document intelligence enrichment batch complete.");
  } catch (error) {
    console.error(error);
    log(`errored with ${error.message}`);
  } finally {
    conclude();
  }
})();
