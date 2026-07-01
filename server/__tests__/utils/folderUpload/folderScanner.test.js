/* eslint-env jest, node */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isSupportedFile,
  scanDirectoryRecursive,
  summarizeRelativePaths,
} = require("../../../utils/folderUpload/folderScanner");

describe("folderScanner", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "folder-upload-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("recursively discovers supported files in nested folders", () => {
    const contracts = path.join(tempDir, "Legal Documents", "Contracts");
    const finance = path.join(tempDir, "Legal Documents", "Finance");
    fs.mkdirSync(contracts, { recursive: true });
    fs.mkdirSync(finance, { recursive: true });

    fs.writeFileSync(path.join(contracts, "NDA.pdf"), "pdf");
    fs.writeFileSync(path.join(contracts, "Agreement.docx"), "docx");
    fs.writeFileSync(path.join(finance, "Invoice.xlsx"), "xlsx");
    fs.writeFileSync(path.join(finance, "Budget.csv"), "csv");
    fs.writeFileSync(path.join(finance, "readme.exe"), "binary");

    const { files, summary } = scanDirectoryRecursive(tempDir);

    expect(files).toHaveLength(4);
    expect(summary.total).toBe(4);
    expect(files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("NDA.pdf"),
        expect.stringContaining("Agreement.docx"),
        expect.stringContaining("Invoice.xlsx"),
        expect.stringContaining("Budget.csv"),
      ])
    );
  });

  it("skips unsupported file extensions", () => {
    expect(isSupportedFile("report.pdf")).toBe(true);
    expect(isSupportedFile("image.png")).toBe(false);
    expect(isSupportedFile(".DS_Store")).toBe(false);
  });

  it("summarizes relative paths from browser folder picker", () => {
    const summary = summarizeRelativePaths([
      "Legal/Contracts/NDA.pdf",
      "Legal/Finance/Invoice.xlsx",
      "Legal/Finance/photo.jpg",
    ]);

    expect(summary.total).toBe(2);
    expect(summary.supported).toHaveLength(2);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "PDF", count: 1 }),
        expect.objectContaining({ label: "XLSX", count: 1 }),
      ])
    );
  });
});
