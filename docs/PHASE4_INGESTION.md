# Phase 4 — Multi-Format Ingestion

DocCursor Phase 4 adds a unified `DocumentProcessor` pipeline on top of the existing AnythingLLM collector, extends document intelligence fields, and exposes workspace overview/search APIs.

## Supported formats

| Format | Processor | Structure captured |
|--------|-----------|-------------------|
| PDF | `PdfProcessor` | Existing OCR-capable PDF pipeline |
| DOCX | `DocxProcessor` | Headings via Mammoth markdown conversion |
| Markdown | `MarkdownProcessor` | Heading hierarchy |
| TXT | `TxtProcessor` | Plain text + detected section headings |
| CSV | `CsvProcessor` | Column schema + row count summary |
| XLSX | `XlsxProcessor` | Sheet names, headers, workbook summary |
| PPTX | `PptxProcessor` | Slide titles + structured slide text |
| URLs | `UrlProcessor` | Source URL + hostname (`processLink`) |

## Pipeline

```
Upload / URL
  → DocumentProcessor registry (`collector/utils/documentProcessor/`)
  → Parsed JSON in `server/storage/documents/`
  → Embed (`Document.addDocuments`)
  → `document_intelligence` queue
  → Background enrichment (`enrich-document-intelligence`)
  → Workspace APIs + project-wide chat context
```

## DocumentProcessor interface

Each processor implements:

```js
{
  id: "docx",
  extensions: [".docx"],
  canProcess(extension, filename) {},
  async process({ fullFilePath, filename, options, metadata }) {}
}
```

Parsed documents may include `documentStructure` JSON used during intelligence enrichment.

## Intelligence fields (Phase 4)

| Field | Description |
|-------|-------------|
| `summary` | 2–4 sentence overview |
| `category` | agreement, contract, policy, invoice, resume, presentation, spreadsheet, research_paper, technical_documentation, financial_report, legal_document, general |
| `documentType` | Short human label (e.g. "retainer agreement") |
| `keyTopics` | JSON array of topic labels |
| `keywords` | JSON array of search terms |
| `confidenceScore` | 0–1 classification confidence |

## API endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/workspace/:slug/intelligence` | List intelligence rows (`?category=&status=`) |
| GET | `/api/workspace/:slug/intelligence/overview` | Workspace rollup |
| GET | `/api/workspace/:slug/intelligence/search?q=` | Search summaries/topics/keywords |
| GET | `/api/workspace/:slug/intelligence/status` | Queue status counts |

## Example uploads

Sample files for manual testing live in `examples/phase4/`:

- `sample-policy.md`
- `sample-expenses.csv`
- `sample-notes.txt`

Upload via **Manage Workspace → Upload**, index the folder, then verify:

```bash
sqlite3 server/storage/anythingllm.db \
  "SELECT filename, fileType, category, documentType FROM document_intelligence;"
```

## Tests

```bash
npx jest collector/__tests__/documentProcessor/
npx jest server/__tests__/utils/intelligence/enrichDocument.test.js
npx jest server/__tests__/utils/chats/projectWideRetrieval.test.js
```

## Migration

```bash
cd server && npx prisma migrate deploy
```

Migration: `20260623120000_document_intelligence_phase4`

## Backward compatibility

- Existing PDFs and intelligence rows continue to work
- Legacy intelligence categories map to Phase 4 categories during normalization
- Unsupported extensions still fall back to the legacy converter map in `collector/utils/constants.js`
