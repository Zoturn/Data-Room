import { applyStemRename, nthCandidateName, splitFileName } from "./file-name";

/**
 * The naming rules a reviewer will poke at directly: upload the same file twice, rename
 * something to a name already taken, try to relabel a PDF as a Word document.
 *
 * These are the cases the module's own comments promise, written down so a later change has to
 * break a test rather than only a paragraph.
 */
describe("splitFileName", () => {
  it("splits at the last dot, so a name with several keeps only the real extension", () => {
    expect(splitFileName("q4.report.final.pdf")).toEqual({
      stem: "q4.report.final",
      extension: ".pdf",
    });
  });

  it("treats a dotfile as all stem, because the dot names the file rather than its type", () => {
    // Suffixing this one as " (1).gitignore" would invent a file called " (1)".
    expect(splitFileName(".gitignore")).toEqual({ stem: ".gitignore", extension: "" });
  });

  it("keeps a trailing dot in the stem, because an empty extension is not an extension", () => {
    expect(splitFileName("report.")).toEqual({ stem: "report.", extension: "" });
  });

  it("returns an empty extension for a name with no dot at all", () => {
    expect(splitFileName("report")).toEqual({ stem: "report", extension: "" });
  });
});

describe("nthCandidateName", () => {
  it("returns the requested name unchanged at index 0, so no conflict needs no special path", () => {
    expect(nthCandidateName("report.pdf", 0)).toBe("report.pdf");
  });

  it("puts the counter before the extension, the shape every file manager produces", () => {
    expect(nthCandidateName("report.pdf", 1)).toBe("report (1).pdf");
    expect(nthCandidateName("report.pdf", 2)).toBe("report (2).pdf");
  });

  it("suffixes a name with no extension without inventing one", () => {
    expect(nthCandidateName("report", 1)).toBe("report (1)");
  });

  it("suffixes a dotfile after its name rather than splitting it", () => {
    expect(nthCandidateName(".gitignore", 1)).toBe(".gitignore (1)");
  });

  it("preserves a unicode stem exactly, including combining marks", () => {
    // Normalisation decides whether two names collide; it must not rewrite the stored name.
    expect(nthCandidateName("отчёт.pdf", 1)).toBe("отчёт (1).pdf");
  });
});

describe("applyStemRename", () => {
  it("re-attaches the original extension to a bare stem", () => {
    expect(applyStemRename("report.pdf", "q4-report")).toBe("q4-report.pdf");
  });

  it("does not double the extension when the dialog submits its own round trip", () => {
    expect(applyStemRename("report.pdf", "q4-report.pdf")).toBe("q4-report.pdf");
  });

  it("recognises the extension case-insensitively and restores the stored casing", () => {
    // The submitted ".PDF" is recognised rather than appended, and the extension the file
    // actually has wins — so its case cannot drift one rename at a time.
    expect(applyStemRename("report.pdf", "q4-report.PDF")).toBe("q4-report.pdf");
  });

  it("refuses to relabel the bytes: a submitted .docx keeps the real .pdf", () => {
    // The bytes did not change, so neither may the type.
    expect(applyStemRename("report.pdf", "q4-report.docx")).toBe("q4-report.docx.pdf");
  });

  it("returns the submission unchanged when the stem would be empty", () => {
    // ".pdf" submitted whole leaves nothing to be a stem; ".pdf.pdf" would be worse.
    expect(applyStemRename("report.pdf", ".pdf")).toBe(".pdf");
  });

  it("leaves an extensionless file's name entirely to the caller", () => {
    expect(applyStemRename("report", "q4-report")).toBe("q4-report");
  });
});
