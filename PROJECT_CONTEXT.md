# DocCursor — Project Context

> **Product:** Universal Document Intelligence Platform (fork of AnythingLLM v1.14.1)  
> **Positioning:** Organizational knowledge platform for business documents — **not** a code assistant  
> **Last updated:** June 2026

---

## 1. Executive summary

DocCursor enables organizations (law firms, CA/audit firms, consulting, compliance, HR, enterprises) to upload folder trees of business documents and **chat, analyze, compare, and report** across an entire project corpus.

The system is built on a **two-layer index**:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Chunk vector index** | LanceDB (per workspace) | Semantic retrieval, RAG, citations |
| **Document intelligence index** | SQLite `document_intelligence` | Per-document summary, category, topics (Phase 1A) |

Retrieval today operates on **chunks** with project-wide structured context and coverage enforcement. The intelligence index is **write + read via API**; not yet wired into chat retrieval.

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
├── collector/          # Document parsing service (PDF, DOCX, XLSX, …)
├── server/             # API, RAG, intelligence workers, Prisma, LanceDB
├── frontend/           # React UI (DocCursor branding + project sidebar)
├── embed/              # Embeddable chat widget
├── docker/             # Container deployment
├── locales/            # i18n (25+ locale files rebranded)
└── package.json        # anything-llm@1.14.1
```

### 2.3 Core pipelines

#### Ingestion (parse only)

```
Upload / hotdir
  → collector/processSingleFile
  → JSON in server/storage/documents/{folder}/{uuid}.json
  → pageContent + metadata (title, chunkSource, wordCount, …)
```

#### Embedding (chunk + vector)

```
Index folder / update-embeddings
  → Document.addDocuments() OR embedding-worker.js (native embedder)
  → fileData() loads JSON
  → TextSplitter (1000 / 20 default)
  → EmbedderEngine (NativeEmbedder default)
  → LanceDB.addDocumentToNamespace(workspace.slug)
  → workspace_documents + document_vectors rows
  → DocumentIntelligence.createPending()   [Phase 1A]
```

#### Chat / retrieval

```
stream.js
  → performWorkspaceSimilaritySearch() [projectWideRetrieval.js]
  → mergeRetrievalIntoContext()
  → applyProjectWideSystemPrompt() + coverage checklist
  → compressMessages() → LLM stream
  → sources[] attached to response (citations UI)
```

#### Document intelligence (Phase 1A)

```
createPending (status: pending)
  → enrich-document-intelligence job (every 30s, batch 3)
  → enrichDocument.js (summarizeContent if >12k chars → LLM JSON)
  → document_intelligence (status: complete | failed)
```

---

## 3. Key architectural decisions

| Decision | Rationale |
|----------|-----------|
| **Fork AnythingLLM, not greenfield** | Reuse collector, LanceDB, agent framework, embed pipeline |
| **Workspace = Project** | Existing `workspaces.slug` maps to Lance namespace; no org model yet |
| **LanceDB unchanged** | Chunk vectors stay in Lance; intelligence is parallel SQLite index |
| **Post-embed intelligence hook** | Never block embed SSE; async worker handles LLM latency |
| **Single `document_intelligence` table (1A)** | No queue table; poll `status=pending`; stale `processing` recovery after 10 min |
| **Project-wide retrieval in JS** | Regex intent detection, not LLM router — fast, deterministic |
| **Structured context by document** | `## Document: {title}` blocks force per-document reasoning |
| **Coverage enforcement checklist** | Explicit “Documents to cover” list in system prompt |
| **Native embedder default** | Local `Xenova/all-MiniLM-L6-v2`; no API key for embeddings |
| **Intelligence uses workspace LLM** | Same `chatProvider`/`chatModel` as chat; requires `OPEN_AI_KEY` for OpenAI |
| **Frontend-only sidebar redesign** | No backend/schema changes for Projects / Recent Files UI |
| **DocCursor rebrand (Phase 1)** | User-facing strings + logos; package names unchanged for compatibility |

---

## 4. File structure (custom / DocCursor-specific)

### 4.1 Server — retrieval & intelligence

| Path | Role |
|------|------|
| `server/utils/chats/projectWideRetrieval.js` | Project-wide search, balancing, structured context, coverage |
| `server/utils/chats/stream.js` | Main chat orchestrator; wires retrieval + system prompt |
| `server/models/documentIntelligence.js` | DII CRUD, claim batch, stale recovery, requeue failed |
| `server/utils/intelligence/enrichDocument.js` | LLM enrichment: category, summary, keyTopics |
| `server/jobs/enrich-document-intelligence.js` | Bree worker (30s poll) |
| `server/endpoints/intelligence.js` | GET intelligence API |
| `server/scripts/backfill-intelligence.js` | Backfill + `--retry-failed` |
| `server/utils/bootstrapEnv.js` | Standalone job/script env loading |
| `server/__tests__/utils/chats/projectWideRetrieval.test.js` | 48 tests |
| `server/__tests__/utils/intelligence/enrichDocument.test.js` | 9 tests |

### 4.2 Server — ingestion & vectors (inherited, touched lightly)

| Path | Role |
|------|------|
| `server/models/documents.js` | Embed orchestration; intelligence hooks |
| `server/jobs/embedding-worker.js` | Native embedder isolated process |
| `server/utils/vectorDbProviders/lance/index.js` | LanceDB provider; `getDocumentChunkCounts()` |
| `server/utils/TextSplitter/index.js` | Chunking |
| `server/utils/EmbeddingEngines/native/index.js` | Default embedder |

### 4.3 Frontend — DocCursor UI

| Path | Role |
|------|------|
| `frontend/src/components/Sidebar/ActiveWorkspaces/index.jsx` | PROJECTS / CHATS sections |
| `frontend/src/components/FolderSidebar/WorkspaceFolderTree.jsx` | Flat file list per project |
| `frontend/src/components/FolderSidebar/RecentFilesSection.jsx` | Recent files (localStorage) |
| `frontend/src/components/FolderSidebar/FileTypeIcon.jsx` | PDF/DOCX/XLSX/TXT icons |
| `frontend/src/utils/workspaceDocumentsTree.js` | Tree flattening |
| `frontend/src/utils/recentProjectFiles.js` | `doccursor_recent_project_files` cache |
| `frontend/src/LogoContext.jsx` | DocCursor logo assets |

### 4.4 Collector

| Path | Role |
|------|------|
| `collector/processSingleFile/` | Extension → converter routing |
| `collector/utils/constants.js` | Supported file types |
| `collector/hotdir/` | Upload staging |

---

## 5. Indexing strategy

### 5.1 Document storage index (filesystem)

| Store | Path | Contents |
|-------|------|----------|
| Parsed documents | `server/storage/documents/` | Collector JSON (`pageContent`, metadata) |
| Vector cache | `server/storage/vector-cache/` | Cached chunk embeddings per file path |
| Upload staging | `collector/hotdir/` | Raw uploads before parse |

**Folder indexing (UI):** `ManageWorkspace/Documents/index.jsx` → `indexFolder()` → `POST /workspace/:slug/update-embeddings` with all JSON paths in folder.

### 5.2 Vector index (LanceDB)

| Aspect | Detail |
|--------|--------|
| **Location** | `server/storage/lancedb/` |
| **Namespace** | One table per `workspace.slug` |
| **Row schema** | `{ id, vector, text, title, …metadata }` |
| **Mapping** | `document_vectors` table: `docId` ↔ Lance `vectorId` |
| **Search** | `performSimilaritySearch()` — cosine similarity, optional rerank |
| **Default topN** | 4 per workspace (`workspaces.topN`) |
| **Project-wide topN** | 40 candidates → threshold filter → per-doc balance |

### 5.3 Document intelligence index (SQLite) — Phase 1A

| Aspect | Detail |
|--------|--------|
| **Table** | `document_intelligence` |
| **Granularity** | 1 row per embedded document (`docId` unique) |
| **Lifecycle** | `pending` → `processing` → `complete` \| `failed` |
| **Trigger** | `createPending()` after successful embed |
| **Enrichment** | Background worker + optional manual job run |
| **Not yet used in** | Chat retrieval, metadata search, agents |

### 5.4 Planned indexes (future)

| Phase | Index | Purpose |
|-------|-------|---------|
| 1B | `dates`, `monetaryAmounts`, `entities` columns | Structured extraction |
| 1C | `obligations`, `risks` columns | Domain fields |
| 2 | `document_intelligence_fields` table | SQL metadata search |
| 3 | Wire DII into `projectWideRetrieval` | Summary in context headers |

---

## 6. Chunking strategy

### 6.1 Splitter

- **Engine:** LangChain `RecursiveCharacterTextSplitter`
- **Defaults:** `chunkSize = 1000` characters, `chunkOverlap = 20`
- **Overrides:** `system_settings.text_splitter_chunk_size` / `text_splitter_chunk_overlap`
- **Cap:** Cannot exceed embedder `embeddingMaxChunkLength` (1000 for default native model)

### 6.2 Chunk metadata header

Each chunk is prefixed with:

```xml
<document_metadata>
sourceDocument: {title}
published: {timestamp}
</document_metadata>
```

Optional `chunkSource` → `source` field in header.

### 6.3 Project-wide chunk balancing

After retrieving up to 40 candidates:

| Document size (chunks in corpus) | Max chunks per doc in context |
|-------------------------------|--------------------------------|
| < 10 | All that pass threshold |
| 10–30 | 5 |
| > 30 | 8 |

Factual extraction queries use **similarity threshold 0.15** (vs workspace default 0.25).

Chunks are then **grouped by document** into structured context (not flat `[CONTEXT i]` interleaving).

---

## 7. Embedding model

| Setting | Default |
|---------|---------|
| **Engine** | `native` (`EMBEDDING_ENGINE` unset) |
| **Model** | `Xenova/all-MiniLM-L6-v2` |
| **Max chunk length** | 1000 chars |
| **Max concurrent chunks** | 25 |
| **Alternatives** | `Xenova/nomic-embed-text-v1`, `MintplexLabs/multilingual-e5-small` |
| **Other engines** | OpenAI, Ollama, Azure, Cohere, Gemini, etc. |

**Native embed path:** `embedding-worker.js` runs in isolated child process (OOM protection) via `EmbeddingWorkerManager`.

**Vector DB:** LanceDB default (`VECTOR_DB=lancedb`). Pinecone, Chroma, pgvector, Qdrant, etc. supported via same interface.

---

## 8. Database schema

### 8.1 Engine

- **SQLite:** `server/storage/anythingllm.db`
- **ORM:** Prisma (`server/prisma/schema.prisma`)
- **Vectors:** Stored in LanceDB, **not** in SQLite

### 8.2 Core tables

#### `workspaces` (project)

| Column | Notes |
|--------|-------|
| `slug` | Unique; LanceDB namespace |
| `topN` | Default 4 chunks retrieved |
| `similarityThreshold` | Default 0.25 |
| `chatProvider`, `chatModel` | Workspace LLM |
| `openAiPrompt` | System prompt |
| `vectorSearchMode` | `default` \| `rerank` |

#### `workspace_documents` (embed registry)

| Column | Notes |
|--------|-------|
| `docId` | UUID; links to Lance chunks |
| `filename`, `docpath` | Logical path under `documents/` |
| `metadata` | JSON string from collector |
| `pinned`, `watched` | Chat / sync flags |

#### `document_vectors` (chunk mapping)

| Column | Notes |
|--------|-------|
| `docId` | FK logical to workspace_documents |
| `vectorId` | Lance row UUID |

#### `document_intelligence` (Phase 1A) ✨

| Column | Type | Notes |
|--------|------|-------|
| `id` | Int PK | |
| `docId` | String UNIQUE | 1:1 with embedded doc |
| `workspaceId` | Int FK | CASCADE delete |
| `filename` | String | Display name |
| `fileType` | String | Extension: pdf, docx, xlsx, … |
| `category` | String? | LLM-assigned enum |
| `summary` | Text? | 2–4 sentence summary |
| `keyTopics` | String? | JSON array |
| `status` | String | pending \| processing \| complete \| failed |
| `error` | String? | Last failure message |
| `enrichedAt` | DateTime? | |
| `createdAt`, `lastUpdatedAt` | DateTime | |

**Migration:** `server/prisma/migrations/20260622160311_document_intelligence/`

#### `workspace_chats`

Chat history; `response` JSON includes `text`, `sources[]`, `metrics`.

### 8.3 Valid intelligence categories

`contract`, `agreement`, `invoice`, `policy`, `filing`, `correspondence`, `financial_statement`, `audit_report`, `hr_document`, `compliance`, `presentation`, `spreadsheet`, `other`

---

## 9. API design

### 9.1 Base

- **Prefix:** `/api`
- **Auth:** `validatedRequest` + workspace membership (`validWorkspaceSlug`)

### 9.2 Intelligence endpoints (Phase 1A)

| Method | Route | Response |
|--------|-------|----------|
| `GET` | `/api/workspace/:slug/intelligence/status` | `{ status: { total, pending, processing, complete, failed } }` |
| `GET` | `/api/workspace/:slug/intelligence` | `{ intelligence: [...] }` — query: `?status=&limit=&offset=` |
| `GET` | `/api/workspace/:slug/intelligence/:docId` | `{ intelligence: { ... } }` |

### 9.3 Core workspace / chat endpoints (inherited)

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/workspace/:slug/update-embeddings` | Add/remove embedded docs |
| `POST` | `/api/workspace/:slug/upload` | Upload to hotdir + parse |
| `POST` | `/api/workspace/:slug/stream-chat` | SSE chat with RAG |
| `GET` | `/api/system/local-files` | File picker tree |

### 9.4 Planned APIs (not implemented)

| Phase | Route | Purpose |
|-------|-------|---------|
| 2 | `POST /workspace/:slug/intelligence/search` | Metadata filters |
| 2 | `GET /workspace/:slug/intelligence?category=&dateFrom=` | Field filters |
| 1B+ | `POST /workspace/:slug/intelligence/:docId/re-enrich` | Manual retry |

---

## 10. Retrieval & prompt assembly (current)

### 10.1 Query classification (`projectWideRetrieval.js`)

| Intent | Detection | Behavior |
|--------|-----------|----------|
| Project-wide | “summarize all”, “all PDFs”, “compare documents” | topN=40, structured context |
| Factual extraction | “list every monetary amount”, “all dates” | threshold 0.15 |
| Standard | Everything else | workspace topN (4), fillSourceWindow |

### 10.2 Context format (project-wide)

```markdown
## Document: TMC0058.pdf

<chunk text>

## Document: RETAINER AGREEMENT-2.pdf

<chunk text>
```

Wrapped in `[CONTEXT 0]` by OpenAI `#appendContext()`.

### 10.3 System prompt additions (project-wide)

- Analyze every document separately
- One table row per document
- “Not specified” for missing data
- Ignore template placeholders (`[dollar amount]`, `____`)
- **Coverage checklist:** explicit bullet list of every document in context

### 10.4 Citations

- `sources[]` = all retrieved chunks (not LLM-selected)
- Frontend `combineLikeSources()` groups by `title` → citation icons per PDF

---

## 11. Supported file types

| Type | Collector converter |
|------|---------------------|
| PDF | `asPDF/` (+ OCR fallback) |
| DOCX | `asDocx.js` |
| XLSX | `asXlsx.js` |
| CSV, TXT, MD, HTML, JSON | `asTxt.js` |
| PPTX, ODT, ODP | `asOfficeMime.js` |
| Images | `asImage.js` (OCR) |
| Audio/Video | `asAudio.js` (Whisper) |

**Future:** EML, MSG, scanned PDF OCR pipeline, ZIP archives.

---

## 12. Background workers

| Job | Interval | Enabled when |
|-----|----------|--------------|
| `cleanup-orphan-documents` | 12h | Always |
| `cleanup-generated-files` | 8h | Always |
| `extract-memories` | 3h | `memory_auto_extraction` setting |
| `enrich-document-intelligence` | 30s | `DOCUMENT_INTELLIGENCE_ENABLED !== false` |
| `sync-watched-documents` | 1h | Experimental live sync |
| `embedding-worker` | On-demand | Native embedder batch |

**Intelligence worker env:**

| Variable | Default |
|----------|---------|
| `DOCUMENT_INTELLIGENCE_ENABLED` | `true` |
| `INTELLIGENCE_POLL_INTERVAL` | `30s` |
| `INTELLIGENCE_BATCH_SIZE` | `3` |

---

## 13. Environment variables (key)

| Variable | Purpose |
|----------|---------|
| `SERVER_PORT` | 3001 |
| `LLM_PROVIDER`, `OPEN_AI_KEY`, `OPEN_MODEL_PREF` | Chat + intelligence LLM |
| `EMBEDDING_ENGINE`, `EMBEDDING_MODEL_PREF` | Embedder selection |
| `VECTOR_DB` | `lancedb` (default) |
| `STORAGE_DIR` | Override storage root |
| `DOCUMENT_INTELLIGENCE_ENABLED` | Intelligence worker toggle |
| `COLLECTOR_PORT` | 8888 |

**Note:** Intelligence enrichment requires `OPEN_AI_KEY` when workspace uses OpenAI. Set via **Settings → LLM** or `server/.env.development`.

---

## 14. Test workspaces & validation

**Workspace `santosh`:** 3 PDFs (53 Lance chunks total)

| Document | Intelligence expected |
|----------|----------------------|
| `TMC0058.pdf` | Real monetary amounts in content |
| `Basic-Fee-Agreement-…pdf` | Template placeholders |
| `RETAINER AGREEMENT-2.pdf` | `[dollar amount]` placeholders |

**Validation commands:**

```bash
# Migration
cd server && npx prisma migrate dev --name document_intelligence

# Tests
npx jest server/__tests__/utils/intelligence/enrichDocument.test.js
npx jest server/__tests__/utils/chats/projectWideRetrieval.test.js

# Backfill + retry
node server/scripts/backfill-intelligence.js --workspace=santosh --retry-failed
node server/jobs/enrich-document-intelligence.js

# DB check
sqlite3 server/storage/anythingllm.db \
  "SELECT filename, status, category FROM document_intelligence;"
```

---

## 15. Pending tasks

### 15.1 Phase 1 — Document Intelligence Index (in progress)

| Task | Status |
|------|--------|
| 1A: `document_intelligence` table + worker + API | ✅ Implemented |
| 1A: `OPEN_AI_KEY` configured in all environments | ⏳ User action |
| 1A: Intelligence UI badges in file picker | ⏳ Pending |
| 1B: `dates`, `monetaryAmounts`, `entities` extraction | ⏳ Planned |
| 1B: `contentHash` idempotent re-enrich | ⏳ Planned |
| 1C: `obligations`, `risks` extraction | ⏳ Planned |

### 15.2 Phase 2 — Metadata search

- [ ] `document_intelligence_fields` normalized table
- [ ] `POST /intelligence/search` API
- [ ] Pre-filter retrieval before vector search
- [ ] UI filter chips (category, date, amount)

### 15.3 Phase 3 — Multi-document analysis

- [ ] Inject DII summaries into `buildStructuredDocumentContext()`
- [ ] `compareDocuments()` / `findConflicts()` utilities
- [ ] Workspace-level intelligence rollup

### 15.4 Phase 4 — Domain agents

- [ ] Shared `doc-intelligence` agent tools plugin
- [ ] Contract, Due Diligence, Compliance, Audit, Executive Summary agents
- [ ] Agent picker per workspace

### 15.5 Phase 5 — Report generation

- [ ] Report templates (DD memo, contract matrix)
- [ ] `generated_reports` table
- [ ] PDF/DOCX export via create-files agent
- [ ] Scheduled report jobs

### 15.6 Product / platform

- [ ] Organization multi-tenancy model
- [ ] PostgreSQL migration path for 10k+ docs
- [ ] EML/MSG/ZIP ingestion
- [ ] Document preview panel
- [ ] Translate `projects` / `chats` / `recent_files` to all locales
- [ ] `filesCache` invalidation after upload
- [ ] Hybrid keyword retrieval for `$` / dates (complements vector search)
- [ ] Re-enrich HTTP API (admin)

### 15.7 Known issues / ops notes

| Issue | Mitigation |
|-------|------------|
| Rows stuck in `processing` | `recoverStaleProcessing()` after 10 min |
| Failed rows (`No OpenAI API key`) | Set `OPEN_AI_KEY`; `--retry-failed` |
| Manual job run needs env | `bootstrapServerEnv()` in job + scripts |
| Intelligence not in chat answers yet | Phase 3 wiring required |
| Citations ≠ answer coverage | Coverage checklist helps; DII summaries will help further |

---

## 16. Development commands

```bash
# Full dev stack
yarn dev                    # or separate: dev:server, dev:collector, dev:frontend

# Server only
yarn dev:server             # http://localhost:3001

# Prisma
yarn prisma:generate
cd server && npx prisma migrate dev

# Tests
yarn test
npx jest server/__tests__/utils/intelligence/
npx jest server/__tests__/utils/chats/projectWideRetrieval.test.js
```

---

## 17. Version & lineage

| Item | Value |
|------|-------|
| **Package** | `anything-llm@1.14.1` |
| **Upstream** | [Mintplex-Labs/AnythingLLM](https://github.com/Mintplex-Labs/AnythingLLM) |
| **Product name** | DocCursor |
| **DB file** | `anythingllm.db` (intentionally unchanged) |
| **Lance path** | `server/storage/lancedb/{workspace-slug}.lance` |

---

*This document is the canonical context for DocCursor architecture and implementation state. Update it when schema, retrieval, or phase boundaries change.*
