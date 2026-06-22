#!/usr/bin/env node
/**
 * Backfill pending document_intelligence rows for embedded workspace documents.
 *
 * Usage:
 *   node server/scripts/backfill-intelligence.js
 *   node server/scripts/backfill-intelligence.js --workspace=santosh
 *   node server/scripts/backfill-intelligence.js --retry-failed
 *   node server/scripts/backfill-intelligence.js --workspace=santosh --retry-failed
 */

const { bootstrapServerEnv } = require("../utils/bootstrapEnv");
bootstrapServerEnv();

const { Document } = require("../models/documents");
const { Workspace } = require("../models/workspace");
const {
  DocumentIntelligence,
} = require("../models/documentIntelligence");
const { safeJsonParse } = require("../utils/http");

async function main() {
  const workspaceArg = process.argv.find((arg) =>
    arg.startsWith("--workspace=")
  );
  const workspaceSlug = workspaceArg ? workspaceArg.split("=")[1] : null;
  const retryFailed = process.argv.includes("--retry-failed");

  let workspaces = [];
  if (workspaceSlug) {
    const workspace = await Workspace.get({ slug: workspaceSlug });
    if (!workspace) {
      console.error(`Workspace not found: ${workspaceSlug}`);
      process.exit(1);
    }
    workspaces = [workspace];
  } else {
    workspaces = await Workspace.where({});
  }

  let created = 0;
  let skipped = 0;
  let requeued = 0;

  if (retryFailed) {
    for (const workspace of workspaces) {
      requeued += await DocumentIntelligence.requeueFailed(workspace.id);
    }
    console.log(`Requeued ${requeued} failed record(s) to pending.`);
  }

  for (const workspace of workspaces) {
    const documents = await Document.forWorkspace(workspace.id);
    console.log(
      `Workspace ${workspace.slug}: ${documents.length} embedded document(s)`
    );

    for (const doc of documents) {
      const existing = await DocumentIntelligence.getByDocId(doc.docId);
      if (existing) {
        skipped++;
        continue;
      }

      const metadata = safeJsonParse(doc.metadata, {});
      const filename = metadata.title || doc.filename;
      const fileType = DocumentIntelligence.detectFileType(filename);

      await DocumentIntelligence.createPending({
        docId: doc.docId,
        workspaceId: workspace.id,
        filename,
        fileType,
      });
      created++;
    }
  }

  console.log(
    `Backfill complete. created=${created} skipped=${skipped} requeued=${requeued}`
  );

  if (!process.env.OPEN_AI_KEY) {
    console.warn(
      "WARNING: OPEN_AI_KEY is not set in server/.env.development — enrichment will fail until configured."
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
