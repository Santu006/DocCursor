/* eslint-env jest, node */

/**
 * Tests for the document context drag protocol (Phase 8.6).
 * Logic mirrored from frontend/src/utils/documentContextDrag.js
 */

const DOCUMENT_CONTEXT_DRAG_MIME = "application/x-doccursor-context";

function normalizeContextDragItem(item = {}) {
  if (!item || typeof item !== "object") return null;
  const mentionType = item.mentionType || "document";
  const label = String(item.label || item.filename || "").trim();
  if (!label) return null;
  if (mentionType === "document" && !item.docId) return null;
  return {
    docId: item.docId || null,
    filename: item.filename || null,
    label,
    mentionType,
    docpath: item.docpath || null,
    documentIds: Array.isArray(item.documentIds)
      ? item.documentIds.filter(Boolean)
      : undefined,
  };
}

function buildContextDragPayload({ workspaceSlug, items = [] }) {
  const list = Array.isArray(items) ? items : [items];
  return {
    version: 1,
    workspaceSlug: String(workspaceSlug || ""),
    items: list.map(normalizeContextDragItem).filter(Boolean),
  };
}

function parseContextDragPayload(raw = "") {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    const items = (parsed.items || [])
      .map(normalizeContextDragItem)
      .filter(Boolean);
    if (!items.length) return null;
    return {
      version: parsed.version || 1,
      workspaceSlug: String(parsed.workspaceSlug || ""),
      items,
    };
  } catch {
    return null;
  }
}

function resolveContextDragItems(payload, workspaceDocuments = []) {
  if (!payload?.items?.length) return [];
  const byDocId = new Map(workspaceDocuments.map((doc) => [doc.docId, doc]));
  const resolved = [];
  const seen = new Set();

  for (const item of payload.items) {
    if (item.mentionType === "document" && item.docId) {
      const doc = byDocId.get(item.docId) || item;
      if (seen.has(doc.docId)) continue;
      seen.add(doc.docId);
      resolved.push({ ...doc, mentionType: "document" });
    }
  }
  return resolved;
}

describe("documentContextDrag protocol", () => {
  it("serializes and parses multi-document drag payloads", () => {
    const payload = buildContextDragPayload({
      workspaceSlug: "santosh",
      items: [
        {
          docId: "doc-a",
          label: "Contract_A.pdf",
          filename: "Contract_A.pdf",
          mentionType: "document",
        },
        {
          docId: "doc-b",
          label: "Contract_B.pdf",
          filename: "Contract_B.pdf",
          mentionType: "document",
        },
      ],
    });

    const raw = JSON.stringify(payload);
    const parsed = parseContextDragPayload(raw);

    expect(parsed.workspaceSlug).toBe("santosh");
    expect(parsed.items).toHaveLength(2);
    expect(DOCUMENT_CONTEXT_DRAG_MIME).toBe(
      "application/x-doccursor-context"
    );
  });

  it("resolves drag items to workspace mention chips by docId", () => {
    const payload = parseContextDragPayload(
      JSON.stringify(
        buildContextDragPayload({
          workspaceSlug: "santosh",
          items: [{ docId: "doc-stock", label: "StockReport_2017-06.pdf" }],
        })
      )
    );

    const workspaceDocuments = [
      {
        docId: "doc-stock",
        filename: "StockReport_2017-06.pdf",
        label: "StockReport_2017-06.pdf",
        mentionType: "document",
      },
    ];

    const resolved = resolveContextDragItems(payload, workspaceDocuments);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].docId).toBe("doc-stock");
    expect(resolved[0].label).toBe("StockReport_2017-06.pdf");
  });
});
