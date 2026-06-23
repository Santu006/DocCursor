# Phase 7 — Workspace Intelligence (Handoff for Next Chat)

> **Product:** DocCursor (AnythingLLM fork)  
> **Last updated:** June 2026  
> **Purpose:** Continuation context for Phase 7.2–7.3 work — workspace knowledge graph, executive report, and related UI/APIs.

---

## 1. What was shipped in this session

| Phase | Scope | Status |
|-------|-------|--------|
| **7.2** | Workspace Knowledge Graph (deterministic, no LLM) | ✅ |
| **7.2.1** | Semantic clustering (not file-type clustering) | ✅ |
| **7.3** | Executive Workspace Intelligence Report | ✅ |
| **7.3.1** | Category vs file-type distribution fix | ✅ |
| **7.3.2** | Executive report BI dashboard (no legal advice) | ✅ |

---

## 2. Architecture overview

```
document_intelligence (SQLite)
        │
        ├─► workspaceGraph/     clusters, edges, duplicates, distributions
        │
        └─► workspaceReport/    executive summary, risks, review order
                │
                ├─► GET /api/workspace/:slug/executive-report
                ├─► Topic Graph UI
                └─► Executive Report UI
```

**Design principle:** Graph and report data are built from stored intelligence metadata + LanceDB document centroid embeddings. **No LLM calls** on graph/report generation. 60s in-memory cache per workspace.

---

## 3. Workspace Knowledge Graph (`server/utils/workspaceGraph/`)

### Files

| File | Role |
|------|------|
| `similarityGraph.js` | Cosine similarity, relationship rules, embedding load, duplicate detection |
| `clusterDocuments.js` | Union-find clustering, cluster labels, confidence scores |
| `topicGraph.js` | Topic mappings, **category distribution**, **file type distribution** |
| `graphBuilder.js` | Main orchestrator, cache, related-documents |
| `index.js` | Public exports |

### Relationship rules (edges created only when)

1. **Topic overlap > 30%** (Jaccard on `keyTopics`)
2. **Embedding similarity > 0.75** (document centroid from LanceDB)

**NOT used for clustering:** same category alone, file type, `documentType`.

**Duplicate detection:** embedding similarity ≥ 0.95.

### Cluster rules

- Clusters form only via semantic edges (topic or embedding).
- Single-doc clusters get topic-based labels (e.g. `Game Statistics`, `Harassment Reports`).
- Multi-doc unanimous `agreement`/`contract` → `Legal Agreements`.
- `spreadsheet` / `presentation` categories are **never** used as cluster labels by themselves.

### Graph output shape

```javascript
{
  nodes: [],           // document nodes + topic nodes
  edges: [],           // document-document + topic-document
  clusters: [{
    id, label, documentIds, documents, topics,
    documentCount, confidence, confidenceScore
  }],
  topicMappings: [],
  duplicates: [],
  majorTopics: [],
  categoryDistribution: [{ key, label, count, percentage }],
  fileTypeDistribution: [{ key, label, count, percentage }],
  distributions: {
    category: { items, totalDocuments, sumCounts },
    fileType: { items, totalDocuments, sumCounts }
  },
  meta: { documentCount, clusterCount, relationshipCount, ... }
}
```

### APIs

| Method | Route | Response |
|--------|-------|----------|
| GET | `/api/workspace/:slug/topic-graph` | `{ graph }` |
| GET | `/api/workspace/:slug/clusters` | `{ clusters }` |
| GET | `/api/workspace/:slug/related-documents/:documentId` | `{ related, cluster }` |
| GET | `/api/workspace/:slug/intelligence/topic-graph` | Legacy alias → same graph |

### UI

- **Route:** `/workspace/:slug/topic-graph`
- **Sidebar:** Topic Graph
- **Shows:** KPIs, category distribution, file type distribution, clusters with confidence, duplicates, topic mappings

### Chat (`workspaceGraphRetrieval.js`)

Detects: major topics, related docs, clusters, duplicates, topic search. Injects deterministic markdown context into `stream.js` (skipped if executive report query matches first).

---

## 4. Executive Report (`server/utils/workspaceReport/`)

### Files

| File | Role |
|------|------|
| `buildWorkspaceReport.js` | Orchestrator, cache, `formatReportAsContext` |
| `executiveSummary.js` | Single factual summary paragraph + KPIs |
| `riskSummary.js` | Clause/financial/review risk detection from metadata |
| `recommendationEngine.js` | `buildReviewOrder()` — documents ranked by risk score |
| `objectivity.js` | Blocks advisory language (`ideal`, `clients should`, etc.) |
| `index.js` | Public exports |

### Report sections

| Section | Source |
|---------|--------|
| Executive Summary | Factual one-paragraph rollup |
| KPIs | documents, categories, topics, clusters, duplicates, highRiskDocuments |
| Category Distribution | `document_intelligence.category` only |
| File Type Distribution | `document_intelligence.fileType` only |
| Top Topics | Graph `majorTopics` |
| Document Clusters | Graph clusters |
| Risk Indicators | Table: Document \| Risk Reason \| Severity |
| Recommended Review Order | Numbered filenames by risk score |
| Duplicates | Near-duplicate pairs |

### Risk detection (metadata only, no LLM)

On `agreement` / `contract` / `legal_document` rows, scan `summary`, `keyTopics`, `keywords` for:

- Missing arbitration clause
- Missing confidentiality clause
- Missing termination clause
- High financial obligations (monetary patterns)

Plus **high-risk comparison reviews** from `document_comparisons` (score ≥ 70).

### Executive summary example

> This workspace contains 5 documents across 3 categories. Legal Agreements is the dominant category (60%). No duplicate files detected. One document is classified as high risk.

**No legal advice.** No narrative like "clients should choose" or "this agreement is ideal."

### API

| Method | Route | Response |
|--------|-------|----------|
| GET | `/api/workspace/:slug/executive-report` | `{ report }` |

### UI

- **Route:** `/workspace/:slug/executive-report`
- **Sidebar:** Executive Report
- **Model:** `frontend/src/models/workspaceReport.js`

### Chat (`workspaceReportRetrieval.js`)

Patterns: "Summarize this workspace", "Give me an executive report", "What should I review first?", "Show key risks".

Runs **before** topic graph retrieval in `stream.js`. System prompt enforces BI-only responses.

---

## 5. Distribution rules (important)

### Category distribution

- **Field:** `document_intelligence.category` only
- **One count per document**
- Invariant: `sum(counts) === totalDocuments`
- Labels via `CATEGORY_CLUSTER_LABELS` in `clusterDocuments.js` (e.g. `agreement` → "Legal Agreements")

### File type distribution

- **Field:** `document_intelligence.fileType` only (fallback: filename extension)
- **Separate section** from category
- Invariant: `sum(counts) === totalDocuments`
- Labels: uppercase extension (PDF, CSV, XLSX)

**Do not mix** category, documentType, or topics into either distribution.

---

## 6. Key file index

```
server/
├── utils/
│   ├── workspaceGraph/
│   │   ├── similarityGraph.js
│   │   ├── clusterDocuments.js
│   │   ├── topicGraph.js
│   │   ├── graphBuilder.js
│   │   └── index.js
│   ├── workspaceReport/
│   │   ├── buildWorkspaceReport.js
│   │   ├── executiveSummary.js
│   │   ├── riskSummary.js
│   │   ├── recommendationEngine.js
│   │   ├── objectivity.js
│   │   └── index.js
│   ├── intelligence/buildTopicGraph.js    # shim → workspaceGraph
│   └── chats/
│       ├── workspaceGraphRetrieval.js
│       └── workspaceReportRetrieval.js
├── endpoints/
│   ├── workspaceGraph.js
│   └── workspaceReport.js
└── __tests__/utils/
    ├── workspaceGraph/     # 34 tests
    └── workspaceReport/    # 12 tests

frontend/
├── src/pages/
│   ├── TopicGraph/index.jsx
│   └── ExecutiveReport/index.jsx
├── src/models/
│   ├── intelligence.js
│   └── workspaceReport.js
└── src/utils/paths.js     # topicGraph(), executiveReport()
```

---

## 7. Tests

```bash
# Workspace graph (clustering, similarity, distributions)
npx jest server/__tests__/utils/workspaceGraph/

# Executive report (objectivity, risk table, review order)
npx jest server/__tests__/utils/workspaceReport/

# Legacy shim
npx jest server/__tests__/utils/intelligence/buildTopicGraph.test.js
```

**Key assertions:**
- `sample4.csv` has **no edges** to legal or harassment documents
- Two spreadsheets without semantic similarity stay in **separate clusters**
- `sum(categoryCounts) === totalDocuments`
- `sum(fileTypeCounts) === totalDocuments`
- Report text contains **no advisory language**

---

## 8. Verification commands

```bash
# Dev stack
yarn dev:server    # :3001
yarn dev:frontend  # :3000

# Executive report API
curl http://localhost:3001/api/workspace/<slug>/executive-report \
  -H "Authorization: Bearer <token>"

# Topic graph API
curl http://localhost:3001/api/workspace/<slug>/topic-graph \
  -H "Authorization: Bearer <token>"

# Intelligence rows
sqlite3 server/storage/anythingllm.db \
  "SELECT filename, fileType, category, documentType, status FROM document_intelligence;"
```

---

## 9. Validation workspace notes

Expected cluster separation for mixed corpora:

| Cluster | Example files |
|---------|---------------|
| Legal Agreements | Basic Fee Agreement, TMC0058, Retainer Agreement |
| Harassment Reports | Allegations-of-Harassment-or-Bullying.xlsx |
| Game Statistics | sample4.csv |

`sample4.csv` must **not** link to legal or harassment docs unless topic/embedding rules match (they should not).

---

## 10. Known limitations

| Limitation | Notes |
|------------|-------|
| Risk clause detection | Scans DII metadata text only — not full document body |
| No per-document `obligations`/`risks` columns | Roadmap Phase 1B/1C |
| Graph limit | 500 complete intelligence rows per workspace |
| Cache | 60s TTL — invalidate on enrich via `invalidateGraphCache` / `invalidateReportCache` |
| `PROJECT_CONTEXT.md` | Not yet updated with Phase 7.2–7.3 APIs — this doc is the interim source |

---

## 11. Suggested next steps (not started)

- [ ] Update `PROJECT_CONTEXT.md` §7 APIs and §12 roadmap with Phase 7.2–7.3
- [ ] Cache invalidation hook after intelligence enrichment completes
- [ ] Executive report PDF/export
- [ ] `generated_reports` table (Phase 8)
- [ ] Phase 7 domain agents (`doc-intelligence` plugin)
- [ ] Intelligence UI badges in file picker
- [ ] `findConflicts()` server utilities
- [ ] Pre-filter vector retrieval by category (Phase 2)

---

## 12. Chat integration order (`stream.js`)

1. Document diff analysis (`documentDiffRetrieval.js`)
2. Executive report query (`workspaceReportRetrieval.js`) — if matched, skip graph query
3. Workspace graph query (`workspaceGraphRetrieval.js`)
4. Vector similarity search (`projectWideRetrieval.js`)

---

## 13. Thresholds reference

| Constant | Value | Location |
|----------|-------|----------|
| Topic overlap | > 30% (Jaccard) | `similarityGraph.js` |
| Embedding similarity | > 0.75 | `similarityGraph.js` |
| Duplicate similarity | ≥ 0.95 | `similarityGraph.js` |
| High-risk review | ≥ 70 | `riskSummary.js` |
| Graph cache TTL | 60s | `graphBuilder.js` |
| Report cache TTL | 60s | `buildWorkspaceReport.js` |

---

*Paste or reference this file at the start of the next chat to continue Phase 7+ work without re-explaining the workspace graph and executive report stack.*
