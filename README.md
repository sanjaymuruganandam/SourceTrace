# SourceTrace

SourceTrace is a local-first Chrome Extension Manifest V3 research workspace. It saves readable webpage text, helps investigate overlap between saved sources, and keeps notes and evidence classifications on the user's device.

## Features

- Save the active webpage and readable article text to `chrome.storage.local`.
- Search and delete saved sources, open original links, and add private source notes.
- Compare two to ten selected sources, with a similarity matrix, pairwise scores, phrase matches, and keywords.
- Search exact phrases across saved source text, with optional whole-word matching.
- Explore similarity connections in a native SVG map with an adjustable threshold.
- Generate a standalone HTML research report for download or print/PDF.
- Organize claims with associated sources and user-entered evidence labels.
- Review saved sources chronologically, keeping publication date distinct from saved date.
- Extract publication dates from structured metadata or clearly labeled page text, preserving year-only precision.
- Import text-based academic PDFs locally with PDF.js, page-level text locations, and available document metadata.

SourceTrace does not upload research data or use external APIs, analytics, or AI services. Similarity is a measure of textual overlap only. It does not establish plagiarism, truth, citation, agreement, causal relationships, or which source originated a claim. Claim evidence labels are manual user classifications.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the SourceTrace project folder.

## Use

1. Open a normal webpage and choose **Save Current Page** from the SourceTrace popup.
2. Open **Research Dashboard**.
3. In **Source Library**, search saved sources, add notes, or select up to ten sources.
4. Open **Compare Sources** and choose **Compare selected** to calculate each unique pair.
5. Use **Phrase Search** for exact text across the saved library.
6. Use **Relationship Map** to adjust the overlap threshold or choose the source subset.
7. Use **Research Reports** to download or print an HTML report based on selected saved sources.
8. Use **Claims & Evidence** to create claims and manually classify associated sources.
9. Use **Refresh source metadata** on a saved source to re-check its open webpage or recover an explicit date from its saved article text.
10. In Source Library, select one or more academic PDFs and choose **Import selected PDFs**. Imported PDFs can be searched, renamed, annotated, compared with PDFs or webpages, and included in reports.

## Similarity and comparison methodology

Comparison operates on cleaned saved text, normalizes case, punctuation, and whitespace, filters common English stop words and short tokens, and calculates Jaccard similarity. Exact phrase matches have a configurable minimum length of six words, merge overlapping runs, remove duplicates, and show up to ten phrases. Scores and pair matches are withheld when either source has insufficient readable content.

## Storage compatibility

The extension retains the existing `sourceTraceSources` storage key and existing source fields. Missing fields in older records are handled with in-memory defaults; source records are not migrated or rewritten merely by loading them. Source notes use an optional `notes` field on the same source record. Claims and their source associations use a separate `sourceTraceClaims` key.

PDF records use the same `sourceTraceSources` key with `sourceType: "pdf"`. SourceTrace stores extracted page text and PDF metadata locally, but never stores the uploaded PDF binary. Files are limited to 20 MB, 500 pages, and 500,000 extracted characters per PDF; imports also respect a 9 MiB SourceTrace local-storage budget. PDF.js 5.4.624 and its worker are bundled in `vendor/pdfjs/` under the included license. No remote script, service, or additional permission is used.

## Privacy and safety

- Article text, notes, and claims remain in `chrome.storage.local`.
- PDF extraction runs locally in the dashboard; imported text, page segments, title, file name, available PDF metadata, and import date remain in `chrome.storage.local`. The original PDF stays on your computer and is not saved by the extension.
- No article data is sent to an external service.
- SourceTrace does not monitor browsing history in the background.
- Original links are opened only for valid HTTP/HTTPS URLs.
- Exported report content is HTML-escaped and generated locally.

## Limitations

- Extraction works best on normal article pages; some sites may need a different strategy.
- PDF import extracts selectable text only. Scanned image PDFs require OCR, which SourceTrace does not implement. Password-protected, damaged, over-limit, or storage-budget-exceeding documents cannot be imported.
- PDF creation and modification dates are document metadata, not publication dates. PDF metadata and extracted text are not independently verified.
- Similarity is a deterministic token measure, not semantic analysis.
- Publication dates appear only if such metadata is present on a saved source; otherwise the timeline reports them as unknown.
- Refreshing metadata does not change the saved date or notes. A year inferred from explicit page text is not independently verified.
- Claims and evidence labels are user-created research organization, not an automatic assessment.

## Manual testing checklist

- [ ] Load the unpacked extension and save a normal article.
- [ ] Confirm a duplicate URL updates rather than duplicates the saved record.
- [ ] Open and delete a source from the library.
- [ ] Select 2–10 sources and verify the pair count and matrix; test the 10-source limit.
- [ ] Search a phrase with differing capitalization and whitespace, including empty input and whole-word mode.
- [ ] Change the map threshold and verify connections update.
- [ ] Download and print a report containing special characters in titles and notes.
- [ ] Save source notes, reopen the dashboard, and verify persistence.
- [ ] Create a claim, change a source label, remove an association, and delete the claim without deleting library sources.
- [ ] Verify unknown publication dates remain separate from saved dates.
- [ ] Import a text-based PDF, a scanned/empty-text PDF, a damaged file, and an oversized file; confirm error messages, page locations, comparisons, and report metadata.
