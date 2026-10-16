import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

const STORAGE_KEY = 'sourceTraceSources';
const MAX_PDF_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_PDF_TEXT_CHARACTERS = 500000;
const MAX_LOCAL_STORAGE_BYTES = 9 * 1024 * 1024;
const pdfInput = document.getElementById('pdfFilesInput');
const queueNode = document.getElementById('pdfQueue');
const importButton = document.getElementById('importPdfsBtn');
const cancelButton = document.getElementById('cancelPdfImportBtn');
const clearButton = document.getElementById('clearPdfQueueBtn');
const statusNode = document.getElementById('pdfImportStatus');
let queuedFiles = [];
let isImporting = false;
let cancelRequested = false;
let activeLoadingTask = null;

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

function setPdfStatus(message, tone = 'info') {
  statusNode.textContent = message;
  statusNode.className = `status-box ${tone}-box`;
}

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file) {
  if (!/\.pdf$/i.test(file.name)) {
    return 'File name must end in .pdf.';
  }
  if (file.type && file.type !== 'application/pdf' && file.type !== 'application/octet-stream') {
    return 'The selected file is not identified as a PDF.';
  }
  if (!file.size) {
    return 'The selected file is empty.';
  }
  if (file.size > MAX_PDF_FILE_BYTES) {
    return `File exceeds the ${formatFileSize(MAX_PDF_FILE_BYTES)} upload limit.`;
  }
  return '';
}

function renderQueue() {
  queueNode.replaceChildren();
  queuedFiles.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'pdf-queue-item';
    const name = document.createElement('span');
    name.className = 'pdf-queue-name';
    name.textContent = `${entry.file.name} · ${formatFileSize(entry.file.size)}${entry.error ? ` · ${entry.error}` : ''}`;
    const remove = document.createElement('button');
    remove.className = 'ghost-btn';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.disabled = isImporting;
    remove.setAttribute('aria-label', `Remove ${entry.file.name} from PDF import queue`);
    remove.addEventListener('click', () => {
      queuedFiles = queuedFiles.filter((candidate) => candidate.id !== entry.id);
      renderQueue();
    });
    item.append(name, remove);
    queueNode.appendChild(item);
  });
  importButton.disabled = isImporting || !queuedFiles.some((entry) => !entry.error);
  clearButton.disabled = isImporting || !queuedFiles.length;
  pdfInput.disabled = isImporting;
  cancelButton.classList.toggle('hidden', !isImporting);
}

function addFiles(files) {
  const known = new Set(queuedFiles.map((entry) => `${entry.file.name.toLowerCase()}:${entry.file.size}`));
  const added = [];
  Array.from(files).forEach((file) => {
    const key = `${file.name.toLowerCase()}:${file.size}`;
    if (known.has(key)) {
      return;
    }
    known.add(key);
    added.push({ id: crypto.randomUUID(), file, error: validateFile(file) });
  });
  queuedFiles.push(...added);
  renderQueue();
  if (added.some((entry) => entry.error)) {
    setPdfStatus('Some files were not eligible for import. Remove invalid files or choose a PDF.', 'error');
  } else if (added.length) {
    setPdfStatus(`${added.length} PDF file${added.length === 1 ? '' : 's'} ready. Review the file names and sizes, then import.`, 'info');
  }
}

function getSourceList() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

function getStorageBytesInUse() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(bytes);
    });
  });
}

function saveSourceList(sources) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: sources }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function normalizePageText(items) {
  let text = '';
  items.forEach((item) => {
    if (typeof item.str !== 'string' || !item.str) {
      return;
    }
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  });
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePdfDate(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) {
    return value;
  }
  const [, year, month, day, hour, minute, second] = match;
  const precisionParts = [year];
  if (month) precisionParts.push(month);
  if (day) precisionParts.push(day);
  if (hour) precisionParts.push(hour);
  if (minute) precisionParts.push(minute);
  if (second) precisionParts.push(second);
  return precisionParts.join('-');
}

async function readPdfSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return bytes.length === 5 && bytes[0] === 0x25 && bytes[1] === 0x50
    && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

async function extractPdf(file, onProgress) {
  if (!await readPdfSignature(file)) {
    throw new Error('The file does not have a valid PDF header.');
  }
  const buffer = await file.arrayBuffer();
  const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (cancelRequested) {
    throw new Error('Import cancelled.');
  }
  activeLoadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWasm: false,
    useSystemFonts: true,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/')
  });
  let pdf;
  try {
    pdf = await activeLoadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`This document has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}.`);
    }

    const pageSegments = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (cancelRequested) {
        throw new Error('Import cancelled.');
      }
      onProgress(pageNumber, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizePageText(content.items);
      if (text) {
        totalCharacters += text.length;
        if (totalCharacters > MAX_PDF_TEXT_CHARACTERS) {
          throw new Error(`Extracted text exceeds the ${MAX_PDF_TEXT_CHARACTERS.toLocaleString()} character limit.`);
        }
        pageSegments.push({ pageNumber, text });
      }
    }
    const metadata = await pdf.getMetadata();
    const pdfInfo = metadata.info || {};
    const titleFromMetadata = String(pdfInfo.Title || '').trim();
    const fileNameTitle = file.name.replace(/\.pdf$/i, '').trim();
    const title = titleFromMetadata || fileNameTitle || 'Untitled PDF';
    const text = pageSegments.map((segment) => segment.text).join('\n\n');
    return {
      id: crypto.randomUUID(),
      sourceType: 'pdf',
      title,
      filename: file.name,
      text,
      pageCount: pdf.numPages,
      pageSegments,
      documentSize: file.size,
      importDate: new Date().toISOString(),
      dateSaved: new Date().toISOString(),
      notes: '',
      contentHash,
      publicationDate: '',
      pdfMetadata: {
        title: titleFromMetadata,
        author: String(pdfInfo.Author || '').trim(),
        subject: String(pdfInfo.Subject || '').trim(),
        creator: String(pdfInfo.Creator || '').trim(),
        producer: String(pdfInfo.Producer || '').trim(),
        creationDate: normalizePdfDate(pdfInfo.CreationDate),
        modificationDate: normalizePdfDate(pdfInfo.ModDate)
      },
      textExtractionWarning: text.length < 120
        ? 'Little selectable text was found. Scanned image pages require OCR, which SourceTrace does not provide.'
        : ''
    };
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch (error) {
        console.warn('PDF document cleanup failed after extraction', error);
      }
    }
    activeLoadingTask = null;
  }
}

function isPasswordError(error) {
  return Boolean(error && (error.name === 'PasswordException' || /password/i.test(error.message || '')));
}

async function importQueuedFiles() {
  if (isImporting) {
    return;
  }
  const pending = queuedFiles.filter((entry) => !entry.error);
  if (!pending.length) {
    setPdfStatus('Select a valid PDF file before importing.', 'error');
    return;
  }

  isImporting = true;
  cancelRequested = false;
  renderQueue();
  const imported = [];
  const failures = [];
  try {
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      if (cancelRequested) {
        break;
      }
      setPdfStatus(`Reading ${entry.file.name} (${index + 1} of ${pending.length})…`, 'info');
      try {
        const source = await extractPdf(entry.file, (page, total) => {
          setPdfStatus(`Extracting ${entry.file.name}: page ${page} of ${total}…`, 'info');
        });
        if (cancelRequested) {
          break;
        }
        if (!source.text.trim()) {
          throw new Error('No selectable text was found. This may be a scanned PDF; OCR is not supported.');
        }

        const sources = await getSourceList();
        if (sources.some((saved) => saved.sourceType === 'pdf' && saved.contentHash === source.contentHash)) {
          failures.push(`${entry.file.name}: already imported (identical PDF).`);
          continue;
        }
        const nextSources = [source, ...sources];
        const usedBytes = await getStorageBytesInUse();
        const estimatedAddedBytes = new Blob([JSON.stringify(source)]).size;
        if (usedBytes + estimatedAddedBytes > MAX_LOCAL_STORAGE_BYTES) {
          throw new Error('Import would exceed SourceTrace’s local storage budget. Remove older sources or import a smaller PDF.');
        }
        await saveSourceList(nextSources);
        imported.push(source);
      } catch (error) {
        if (cancelRequested) {
          break;
        }
        console.error(`Could not import PDF ${entry.file.name}`, error);
        failures.push(`${entry.file.name}: ${isPasswordError(error) ? 'password-protected PDFs are not supported.' : error.message || 'PDF could not be read.'}`);
      }
    }
  } finally {
    activeLoadingTask = null;
    isImporting = false;
    if (imported.length) {
      window.dispatchEvent(new CustomEvent('sourceTrace:pdf-imported', { detail: { imported } }));
    }
    queuedFiles = queuedFiles.filter((entry) => !pending.some((item) => item.id === entry.id));
    renderQueue();
  }

  const parts = [];
  if (imported.length) {
    parts.push(`Imported ${imported.length} PDF${imported.length === 1 ? '' : 's'} locally.`);
  }
  if (failures.length) {
    parts.push(failures.join(' '));
  }
  if (cancelRequested) {
    parts.push('Import cancelled; completed PDFs were kept.');
  }
  if (!parts.length) {
    parts.push('No PDFs were imported.');
  }
  const hasWarnings = failures.length > 0 || imported.some((source) => source.textExtractionWarning);
  if (imported.some((source) => source.textExtractionWarning)) {
    parts.push('At least one PDF has little selectable text. Scanned image content is not OCRed.');
  }
  setPdfStatus(parts.join(' '), failures.length && !imported.length ? 'error' : hasWarnings ? 'info' : 'success');
}

pdfInput.addEventListener('change', () => {
  addFiles(pdfInput.files);
  pdfInput.value = '';
});
importButton.addEventListener('click', importQueuedFiles);
clearButton.addEventListener('click', () => {
  queuedFiles = [];
  renderQueue();
});
cancelButton.addEventListener('click', () => {
  cancelRequested = true;
  if (activeLoadingTask) {
    activeLoadingTask.destroy().catch((error) => {
      console.warn('PDF extraction cleanup after cancellation failed', error);
    });
  }
  setPdfStatus('Cancelling PDF extraction… already imported files will be kept.', 'info');
});
renderQueue();
