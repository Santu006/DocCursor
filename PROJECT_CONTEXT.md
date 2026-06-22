# DocCursor — Project Context

> **Product:** Universal Document Intelligence Platform (fork of AnythingLLM v1.14.1)  
> **Positioning:** Organizational knowledge platform for business documents — **not** a code assistant  
> **Last updated:** June 2026

---

## 1. Product overview

DocCursor enables organizations (law firms, CA/audit firms, consulting, compliance, HR, enterprises) to upload folder trees of business documents and **chat, analyze, compare, and report** across an entire project corpus.

### Core capabilities (shipped)

| Capability | How it works |
|------------|--------------|
| **Multi-format ingestion** | Unified `DocumentProcessor` pipeline (PDF, DOCX, PPTX, XLSX, CSV, MD, TXT, URLs) |
| **Semantic search (RAG)** | LanceDB chunk vectors per workspace/project |
| **Document intelligence** | Per-document LLM enrichment: summary, category, topics, keywords, confidence |
| **Project-wide chat** | “Summarise all files”, “compare all documents”, fee/retainer extraction |
| **Intelligence-aware retrieval** | DII summaries injected into project-wide context headers (Phase 3) |
| **Workspace intelligence APIs** | List, filter, search, and overview rollup |

### Two-layer index

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Chunk vector index** | LanceDB (per workspace) | Semantic retrieval, RAG, citations |
| **Document intelligence index** | SQLite `document_intelligence` | Per-document summary, category, topics, keywords, structure hints |

### Target users

- Law firms — contracts, retainers, fee agreements, matter files
- CA / audit firms — financial statements, audit reports, compliance filings
- Consulting & enterprises — policies, presentations, spreadsheets, project documentation

---

## 2. Architecture

### 2.1 High-level system diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Vite/React)                       │
│  Projects sidebar · Folder tree · Chat UI · Manage Workspace · Settings │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ HTTP / SSE / WS
┌───────────────────────────────────▼─────────────────────────────────────┐
│                         SERVER (Express, port 3001)                      │
│  endpoints/ · models/ · utils/chats/ · utils/intelligence/ · jobs/       │
└───────┬─────────────────────────────┬───────────────────┬───────────────┘
        │                             │                   │
        ▼                             ▼                   ▼
┌───────────────┐           ┌─────────────────┐   ┌──────────────────┐
│  COLLECTOR    │           │  SQLite (Prisma) │   │  LanceDB         │
│  (port 8888)  │           │  anythingllm.db  │   │  storage/lancedb │
│  Parse files  │           │  metadata + DII  │   │  chunk vectors   │
└───────────────┘           └─────────────────┘   └──────────────────┘
```

### 2.2 Monorepo layout

```
anything-llm/
├── collector/              # Document parsing + DocumentProcessor registry
│   └── utils/documentProcessor/   # Phase 4 unified ingestion
├── server/                 # API, RAG, intelligence workers, Prisma, LanceDB
├── frontend/               # React UI (DocCursor branding + project sidebar)
├── embed/                  # Embeddable chat widget
├── examples/phase4/        # Sample uploads for multi-format testing
├── docs/PHASE4_INGESTION.md
├── docker/
├── locales/
└── package.json            # anything-llm@1.14.1
```

### 2.3 Key architectural decisions

| Decision | Rationale |
|----------|-----------|
| **Fork AnythingLLM, not greenfield** | Reuse collector, LanceDB, agent framework, embed pipeline |
| **Workspace = Project** | `workspaces.slug` maps to Lance namespace; no org model yet |
| **LanceDB unchanged** | Chunk vectors in Lance; intelligence is parallel SQLite index |
| **Post-embed intelligence hook** | Never block embed SSE; async worker handles LLM latency |
| **Single `document_intelligence` table** | Poll `status=pending`; stale `processing` recovery after 10 min |
| **Project-wide retrieval in JS** | Regex intent detection — fast, deterministic |
| **DII + chunks in project-wide context** | Summaries for coverage; chunks for specific facts |
| **Native embedder default** | Local `Xenova/all-MiniLM-L6-v2`; no API key for embeddings |
| **Intelligence uses dedicated LLM when configured** | `INTELLIGENCE_MODEL_PREF` overrides workspace chat model for enrichment only |
| **DocumentProcessor registry** | Phase 4 wraps/enhances legacy converters behind one interface |
| **OpenAI `globalThis.fetch`** | Fixes Node 22 + openai@4.95 `ERR_STREAM_PREMATURE_CLOSE` |

---

## 3. Document ingestion pipeline

### 3.1 End-to-end flow

```
Upload / URL / hotdir
  → Processor selection (DocumentProcessor registry)
  → Text extraction + documentStructure metadata
  → JSON in server/storage/documents/{folder}/{uuid}.json
  → User indexes folder (update-embeddings)
  → TextSplitter → Embedder → LanceDB
  → workspace_documents + document_vectors rows
  → DocumentIntelligence.createPending()
  → enrich-document-intelligence job (30s)
  → document_intelligence (complete | failed)
```

### 3.2 Upload paths

| Path | Entry | Output |
|------|-------|--------|
| **File upload** | `POST /workspace/:slug/upload` → collector `POST /process` | Parsed JSON in `storage/documents/` |
| **URL upload** | `POST /workspace/:slug/upload-link` → `processLink` | JSON with `chunkSource: link://{url}` |
| **Folder index** | `POST /workspace/:slug/update-embeddings` | Vectors + intelligence queue |
| **Chat DnD** | `parseDocument` with `parseOnly` | Ephemeral parse for chat attachment |

### 3.3 DocumentProcessor interface

Location: `collector/utils/documentProcessor/`

```javascript
{
  id: "docx",                    // processor id
  extensions: [".docx"],         // file extensions handled
  canProcess(extension, filename) {},
  async process({ fullFilePath, filename, options, metadata }) {
    return { success, reason, documents: [...] };
  }
}
```

**Routing:** `collector/processSingleFile/index.js` checks the registry first; unsupported extensions fall back to `SUPPORTED_FILETYPE_CONVERTERS` in `collector/utils/constants.js`.

**Parsed document shape** (written to `storage/documents/`):

| Field | Purpose |
|-------|---------|
| `pageContent` | Extracted text for chunking |
| `title`, `docSource`, `chunkSource` | Metadata for RAG headers and citations |
| `documentStructure` | JSON string — headings, columns, sheets, slides, URL (used in enrichment) |
| `wordCount`, `token_count_estimate` | Sizing hints |

### 3.4 Processor registry

| Processor | Extensions | Structure captured |
|-----------|------------|-------------------|
| `PdfProcessor` | `.pdf` | Delegates to `asPDF/` (+ OCR fallback) |
| `DocxProcessor` | `.docx` | Mammoth → markdown; heading hierarchy |
| `MarkdownProcessor` | `.md` | `#` / `##` heading tree |
| `TxtProcessor` | `.txt` | Plain text; detected section headings |
| `CsvProcessor` | `.csv` | Column names, row count, schema summary prepended |
| `XlsxProcessor` | `.xlsx` | Sheet names, headers, workbook summary; per-sheet JSON on embed |
| `PptxProcessor` | `.pptx` | Slide titles, structured slide sections |
| `UrlProcessor` | (via `processLink`) | `sourceUrl`, hostname in `documentStructure` |

### 3.5 Legacy / additional collector formats

Still routed via `constants.js` (not Phase 4 processors): HTML, JSON, ODT, ODP, EPUB, MBOX, images (OCR), audio/video (Whisper). Legacy `.doc` / `.xls` / `.ppt` not supported.

### 3.6 Example test files

`examples/phase4/` — `sample-policy.md`, `sample-expenses.csv`, `sample-notes.txt`

---

## 4. Document Intelligence design

### 4.1 Lifecycle

```
embed success
  → createPending (status: pending)
  → claimPendingBatch (status: processing)
  → enrichDocument.js
      → load content via Document.content(docId)
      → summarize if >12k chars (summarizeContent)
      → LLM JSON classification
  → markComplete | markFailed
```

### 4.2 Enrichment output (Phase 4)

| Field | Source | Description |
|-------|--------|-------------|
| `summary` | LLM | 2–4 sentence factual overview |
| `category` | LLM | One of 12 taxonomy values (below) |
| `documentType` | LLM | Short label, e.g. “retainer agreement” |
| `keyTopics` | LLM | JSON array, 3–8 topic labels |
| `keywords` | LLM | JSON array, 5–12 search terms |
| `confidenceScore` | LLM | 0–1 classification confidence |
| `fileType` | Extension | pdf, docx, xlsx, md, csv, url, … |

**Enrichment prompt** also receives `documentStructure` from collector metadata when present (sheet names, CSV columns, headings, etc.).

### 4.3 Categories (Phase 4)

```
agreement, contract, policy, invoice, resume, presentation,
spreadsheet, research_paper, technical_documentation,
financial_report, legal_document, general
```

**Legacy mapping** (pre-Phase 4 rows): `filing` → `legal_document`, `correspondence` → `general`, `financial_statement` / `audit_report` → `financial_report`, `hr_document` → `resume`, `compliance` → `policy`, `other` → `general`.

### 4.4 Key files

| Path | Role |
|------|------|
| `server/models/documentIntelligence.js` | CRUD, overview, search, batch claim, stale recovery |
| `server/utils/intelligence/enrichDocument.js` | LLM classification + normalization |
| `server/utils/intelligence/resolveIntelligenceLLM.js` | Provider/model resolution for enrichment |
| `server/jobs/enrich-document-intelligence.js` | Bree worker (30s poll, batch 3) |
| `server/scripts/backfill-intelligence.js` | Backfill + `--retry-failed` |
| `server/endpoints/intelligence.js` | REST API |

### 4.5 Worker configuration

| Variable | Default |
|----------|---------|
| `DOCUMENT_INTELLIGENCE_ENABLED` | `true` |
| `INTELLIGENCE_POLL_INTERVAL` | `30s` |
| `INTELLIGENCE_BATCH_SIZE` | `3` |
| `INTELLIGENCE_MODEL_PREF` | *(unset — falls back to workspace `chatModel`)* |
| `INTELLIGENCE_LLM_PROVIDER` | *(unset — falls back to workspace `chatProvider`)* |

---

## 5. Supported formats summary

| Format | Ingestion | Structure | Intelligence | Chat RAG |
|--------|-----------|-----------|--------------|----------|
| **PDF** | ✅ PdfProcessor | Page text (+ OCR) | ✅ | ✅ |
| **DOCX** | ✅ DocxProcessor | Headings | ✅ | ✅ |
| **PPTX** | ✅ PptxProcessor | Slide titles | ✅ | ✅ |
| **XLSX** | ✅ XlsxProcessor | Sheets, headers | ✅ | ✅ (per sheet) |
| **CSV** | ✅ CsvProcessor | Column schema | ✅ | ✅ |
| **MD** | ✅ MarkdownProcessor | Heading hierarchy | ✅ | ✅ |
| **TXT** | ✅ TxtProcessor | Section headings | ✅ | ✅ |
| **URLs** | ✅ processLink | Source URL | ✅ | ✅ |

**Not yet:** EML, MSG, ZIP archives, legacy `.doc` / `.xls` / `.ppt`.

---

## 6. Database schema

### 6.1 Engine

- **SQLite:** `server/storage/anythingllm.db`
- **ORM:** Prisma (`server/prisma/schema.prisma`)
- **Vectors:** LanceDB only — not in SQLite

### 6.2 `document_intelligence` ✨

| Column | Type | Notes |
|--------|------|-------|
| `id` | Int PK | |
| `docId` | String UNIQUE | 1:1 with `workspace_documents` |
| `workspaceId` | Int FK | CASCADE delete |
| `filename` | String | Display name |
| `fileType` | String | Extension: pdf, docx, xlsx, md, csv, … |
| `category` | String? | Phase 4 taxonomy |
| `documentType` | String? | Short human label |
| `summary` | Text? | 2–4 sentences |
| `keyTopics` | String? | JSON array |
| `keywords` | String? | JSON array (Phase 4) |
| `confidenceScore` | Float? | 0–1 (Phase 4) |
| `status` | String | pending \| processing \| complete \| failed |
| `error` | String? | Last failure message |
| `enrichedAt` | DateTime? | |
| `createdAt`, `lastUpdatedAt` | DateTime | |

**Indexes:** `(workspaceId)`, `(workspaceId, status)`, `(workspaceId, category)`

**Migrations:**
- `20260622160311_document_intelligence` — initial table
- `20260623120000_document_intelligence_phase4` — `documentType`, `keywords`, `confidenceScore`, category index

### 6.3 Other core tables

| Table | Role |
|-------|------|
| `workspaces` | Project; `slug` = Lance namespace; `chatProvider`, `chatModel`, `topN`, `similarityThreshold` |
| `workspace_documents` | Embed registry; `metadata` JSON from collector |
| `document_vectors` | `docId` ↔ Lance `vectorId` |
| `workspace_chats` | History; `response` includes `sources[]`, `metrics` |

### 6.4 Filesystem stores

| Path | Contents |
|------|----------|
| `server/storage/documents/` | Parsed collector JSON |
| `server/storage/lancedb/{slug}.lance` | Chunk vectors |
| `server/storage/vector-cache/` | Cached embeddings |
| `collector/hotdir/` | Upload staging |

---

## 7. API endpoints

**Base:** `/api` · **Auth:** `validatedRequest` + `validWorkspaceSlug`

### 7.1 Intelligence (DocCursor)

| Method | Route | Query / body | Response |
|--------|-------|--------------|----------|
| `GET` | `/workspace/:slug/intelligence/status` | — | `{ status: { total, pending, processing, complete, failed } }` |
| `GET` | `/workspace/:slug/intelligence/overview` | — | `{ overview: { documents, categories[], topTopics[], fileTypes, embeddedDocuments, intelligence } }` |
| `GET` | `/workspace/:slug/intelligence/search` | `?q=&limit=` | `{ query, intelligence: [...] }` |
| `GET` | `/workspace/:slug/intelligence` | `?status=&category=&limit=&offset=` | `{ intelligence: [...] }` |
| `GET` | `/workspace/:slug/intelligence/:docId` | — | `{ intelligence: { ... } }` |

### 7.2 Workspace / chat (inherited)

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/workspace/:slug/upload` | Upload + parse |
| `POST` | `/workspace/:slug/upload-link` | URL ingestion |
| `POST` | `/workspace/:slug/update-embeddings` | Add/remove embedded docs |
| `POST` | `/workspace/:slug/stream-chat` | SSE chat with RAG |
| `GET` | `/system/local-files` | File picker tree |
| `GET` | `/system/document-processing-status` | Collector health |

### 7.3 Planned APIs

| Route | Purpose |
|-------|---------|
| `POST /workspace/:slug/intelligence/:docId/re-enrich` | Manual re-enrich |
| `POST /workspace/:slug/intelligence/search` (advanced) | Structured metadata filters (Phase 2) |

---

## 8. Workspace retrieval logic

### 8.1 Pipeline (`stream.js`)

```
streamChatWithWorkspace
  → performWorkspaceSimilaritySearch()   [projectWideRetrieval.js]
  → mergeRetrievalIntoContext()
  → applyProjectWideSystemPrompt() + coverage checklist
  → LLM stream → sources[] for citations
```

### 8.2 Query classification

| Intent | Detection examples | Behavior |
|--------|-------------------|----------|
| **Project-wide** | “summarise all files”, “compare all documents”, “all agreements” | topN=40, structured context, DII headers |
| **Factual extraction** | “list every monetary amount”, “all dates” | threshold 0.15 |
| **Standard** | Everything else | workspace `topN` (default 4) |

**Note:** British `summarise` and generic “all files” are supported. Project-wide uses **0.15 similarity threshold** (not 0.25) because generic queries embed poorly against legal text.

### 8.3 Project-wide retrieval steps

1. Vector search with `topN=40`, `similarityThreshold=0` at Lance layer
2. Filter by `PROJECT_WIDE_SIMILARITY_THRESHOLD` (0.15)
3. `ensureAtLeastOneChunkPerDocument` — every doc in candidate set gets ≥1 chunk
4. `balanceChunksByDocument` — dynamic per-doc caps (<10: all, 10–30: 5, >30: 8)
5. `resolveIntelligenceByTitles` — load completed DII rows
6. `buildStructuredDocumentContext` — inject summary headers + chunks

### 8.4 Project-wide context format (Phase 3)

```markdown
## Document: RETAINER AGREEMENT-2.pdf

**Document summary:** Sample retainer agreement between client and attorney…
**Document type:** retainer agreement
**Category:** agreement
**Key topics:** legal representation, attorney fees, retainer funds
**Keywords:** trust account, withdrawal, Oregon

<retrieved chunk text>
```

### 8.5 System prompt additions (project-wide)

- Analyze every document separately
- One table row per document in comparisons
- “Not specified” for missing data
- Ignore template placeholders (`[dollar amount]`, `____`)
- **Coverage checklist:** explicit bullet list of every document in context

### 8.6 Citations

- `sources[]` = all retrieved chunks (not LLM-selected)
- Frontend `combineLikeSources()` groups by `title`

### 8.7 Chunking

- LangChain `RecursiveCharacterTextSplitter`
- Defaults: **1000** chars, **20** overlap
- Each chunk prefixed with `<document_metadata>` (sourceDocument, published)

---

## 9. OpenAI integration

### 9.1 Usage

| Feature | Provider | Config |
|---------|----------|--------|
| **Chat** | Workspace `chatProvider` / `chatModel` | Settings → LLM or `server/.env.development` |
| **Document intelligence** | `INTELLIGENCE_LLM_PROVIDER` + `INTELLIGENCE_MODEL_PREF`, else workspace chat LLM | `server/.env.development` |
| **Embeddings** | Native embedder (default) | No OpenAI key required |

### 9.2 Required configuration

```bash
# server/.env.development
LLM_PROVIDER='openai'
OPEN_AI_KEY=sk-...
OPEN_MODEL_PREF='gpt-4o-mini'

# Stronger model for one-time document enrichment (optional)
INTELLIGENCE_MODEL_PREF='gpt-4o'
```

### 9.3 Node 22 compatibility fix

**Problem:** `openai@4.95` default fetch wrapper causes `ERR_STREAM_PREMATURE_CLOSE` on Node 22.

**Fix** in `server/utils/AiProviders/openAi/index.js`:

```javascript
this.openai = new OpenAIApi({
  apiKey: process.env.OPEN_AI_KEY,
  fetch: globalThis.fetch,
});
```

**Fallback:** `getChatCompletion` falls back from Responses API to `chat.completions` on failure.

### 9.4 SDK timeout patch

`server/utils/boot/patchSdkTimeouts.js` — extends undici/OpenAI/Anthropic timeouts for long document operations (600s).

### 9.5 Security note

Rotate API keys if exposed in chat or logs. `server/.env.development` is gitignored.

---

## 10. Completed phases

| Phase | Scope | Status |
|-------|-------|--------|
| **Rebrand** | DocCursor UI, projects sidebar, recent files | ✅ |
| **Project-wide retrieval** | Regex intent, structured context, coverage checklist, chunk balancing | ✅ |
| **Phase 1A** | `document_intelligence` table, worker, enrichment, REST API | ✅ |
| **Phase 3** | DII summaries injected into `buildStructuredDocumentContext()` | ✅ |
| **Phase 4** | DocumentProcessor registry, multi-format structure extraction, expanded DII fields, overview/search APIs | ✅ |
| **Phase 5** | Document diff & change analysis — section matching, semantic diff, LLM report, API + chat UI | ✅ |
| **Retrieval fixes** | 0.15 project-wide threshold, per-doc coverage guarantee, `summarise` spelling | ✅ |
| **OpenAI fixes** | `globalThis.fetch`, chat.completions fallback | ✅ |

### Validation workspace: `santosh`

3 PDFs · 53 Lance chunks · intelligence `complete` for all:

| Document | Notes |
|----------|-------|
| `TMC0058.pdf` | Willick Law Group; real monetary amounts |
| `Basic-Fee-Agreement-…pdf` | Limited-scope template |
| `RETAINER AGREEMENT-2.pdf` | Oregon OSB sample |

**Validated queries:** “summarise all files”, “compare all documents”, “compare retainer terms across all three documents”

---

## 11. Known limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Pre-Phase 4 rows lack new fields** | `documentType`, `keywords`, `confidenceScore` empty on old enrichments | `--retry-failed` backfill |
| **Intelligence UI badges** | No file-picker status chips yet | Use API / sqlite |
| **Standard (non-project-wide) chat** | DII summaries not injected; chunks only | Use “summarise all…” or “compare all…” |
| **CSV/XLSX NL querying** | Schema summary in text; no SQL engine | Ask specific questions in chat |
| **PPTX slide detection** | Heuristic split, not native slide parser | Acceptable for text extraction |
| **URL ingestion** | Separate `processLink` path, not file registry | Use upload-link UI |
| **No org multi-tenancy** | Workspace = project only | Single-tenant deployments |
| **SQLite at scale** | Fine for hundreds–low thousands of docs | PostgreSQL path planned |
| **Citations ≠ full coverage** | Sources = retrieved chunks only | Coverage checklist in system prompt |
| **Legacy Office** | No `.doc`, `.xls`, `.ppt` | Convert to DOCX/XLSX/PPTX |
| **Agents / reports** | No domain-specific agents or report export yet | Chat + tables manually |

---

## 12. Roadmap (next items)

### 12.1 Phase 1 — Intelligence depth

- [ ] Intelligence UI badges in file picker (pending / complete / failed)
- [ ] `POST /intelligence/:docId/re-enrich` HTTP endpoint
- [ ] **1B:** `dates`, `monetaryAmounts`, `entities` columns + extraction
- [ ] **1B:** `contentHash` idempotent re-enrich
- [ ] **1C:** `obligations`, `risks` extraction

### 12.2 Phase 2 — Metadata search

- [ ] `document_intelligence_fields` normalized table
- [ ] Pre-filter vector retrieval by category/keywords
- [ ] UI filter chips (category, date, amount)
- [ ] Hybrid keyword retrieval for `$` / dates

### 12.3 Phase 3 — Multi-document analysis (remaining)

- [x] Inject DII summaries into project-wide context
- [x] `compareDocuments()` document diff engine (Phase 5)
- [ ] `findConflicts()` server utilities
- [ ] Workspace-level intelligence rollup in UI
- [ ] Inject DII into standard (non-project-wide) retrieval headers

### 12.4 Phase 5 — Document diff & change analysis

- [x] `server/utils/documentDiff/` — section matching, semantic diff, LLM report
- [x] `document_comparisons` table + REST API
- [x] Chat intent detection for pairwise compare queries
- [x] Comparison Report UI in workspace chat
- [x] **5.1** Semantic clause diff — concept matching, severity, noise filtering, raw diff toggle
- [x] **5.2** Diff quality — clause naming, deduplication, modification detection, confidence + risk score
- [x] **5.3** Edit & re-run user questions — prompt edit UI, audit history, in-place re-run
- [x] **6.0** Reports, history & sharing — review history, export PDF/DOCX/MD, share links, dashboard, search
- [ ] Side-by-side document viewer
- [ ] Version history / auto-compare on re-upload

### 12.5 Phase 6 — Reports, history & sharing

- [x] Extended `document_comparisons` with review metadata + share tokens
- [x] Reviews API (list, get, dashboard, search, export, share)
- [x] Public share route `/review/:shareToken`
- [x] Auto-save from chat comparisons
- [x] Export PDF / DOCX / Markdown + report templates

### 12.6 Phase 7 — Domain agents

- [ ] Shared `doc-intelligence` agent tools plugin
- [ ] Contract, Due Diligence, Compliance, Audit, Executive Summary agents

### 12.7 Phase 8 — Report generation

- [ ] Report templates (DD memo, contract matrix)
- [ ] `generated_reports` table
- [ ] PDF/DOCX export · scheduled report jobs

### 12.8 Platform

- [ ] Organization multi-tenancy
- [ ] PostgreSQL migration for 10k+ docs
- [ ] EML/MSG/ZIP ingestion
- [ ] Document preview panel
- [ ] `filesCache` invalidation after upload

---

## 13. Development & operations

### 13.1 Commands

```bash
# Full stack
yarn dev

# Individual services
yarn dev:server      # http://localhost:3001
yarn dev:collector   # http://localhost:8888
yarn dev:frontend    # http://localhost:3000

# Database
cd server && npx prisma migrate deploy
yarn prisma:generate

# Intelligence
node server/scripts/backfill-intelligence.js --workspace=santosh --retry-failed
node server/jobs/enrich-document-intelligence.js

# Tests
npx jest collector/__tests__/documentProcessor/
npx jest server/__tests__/utils/intelligence/enrichDocument.test.js
npx jest server/__tests__/models/documentIntelligence.test.js
npx jest server/__tests__/utils/documentDiff/
npx jest server/__tests__/utils/chats/editMessage.test.js
```

### 13.2 Verification

```bash
# Intelligence rows
sqlite3 server/storage/anythingllm.db \
  "SELECT filename, fileType, category, documentType, status FROM document_intelligence;"

# Workspace overview (with auth token)
curl http://localhost:3001/api/workspace/santosh/intelligence/overview \
  -H "Authorization: Bearer <token>"
```

### 13.3 Background workers

| Job | Interval |
|-----|----------|
| `enrich-document-intelligence` | 30s |
| `cleanup-orphan-documents` | 12h |
| `cleanup-generated-files` | 8h |
| `embedding-worker` | On-demand |

### 13.4 Key custom file index

| Area | Path |
|------|------|
| DocumentProcessor | `collector/utils/documentProcessor/` |
| Project-wide retrieval | `server/utils/chats/projectWideRetrieval.js` |
| Intelligence enrichment | `server/utils/intelligence/enrichDocument.js`, `resolveIntelligenceLLM.js` |
| Intelligence model/API | `server/models/documentIntelligence.js`, `server/endpoints/intelligence.js` |
| OpenAI provider | `server/utils/AiProviders/openAi/index.js` |
| Phase 4 docs | `docs/PHASE4_INGESTION.md` |

---

## 14. Version & lineage

| Item | Value |
|------|-------|
| **Package** | `anything-llm@1.14.1` |
| **Upstream** | [Mintplex-Labs/AnythingLLM](https://github.com/Mintplex-Labs/AnythingLLM) |
| **Product name** | DocCursor |
| **DB file** | `anythingllm.db` |
| **Lance path** | `server/storage/lancedb/{workspace-slug}.lance` |

---

*Canonical context for DocCursor architecture and implementation. Update when schema, retrieval, ingestion, or phase boundaries change.*
