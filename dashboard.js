const STORAGE_KEY = 'sourceTraceSources';
const CLAIMS_STORAGE_KEY = 'sourceTraceClaims';
const MAX_SELECTED_SOURCES = 10;
const MAX_MAP_SOURCES = 24;
let allSources = [];
let selectedIds = new Set();
let allClaims = [];
let claimsLoaded = false;
let reportObjectUrl = '';
let phraseSearchTimer = 0;
const preparedSourceCache = new Map();

function setStatus(message, tone = 'info') {
  ['workspaceStatus', 'comparisonStatus'].forEach((id) => {
    const statusBox = document.getElementById(id);
    if (!statusBox) {
      return;
    }

    statusBox.textContent = message;
    statusBox.className = 'status-box';
    if (tone === 'error') {
      statusBox.classList.add('error-box');
    } else if (tone === 'success') {
      statusBox.classList.add('success-box');
    } else {
      statusBox.classList.add('info-box');
    }
  });
}

function setReportStatus(message, tone = 'info') {
  const statusBox = document.getElementById('reportStatus');
  if (!statusBox) {
    return;
  }

  statusBox.textContent = message;
  statusBox.className = 'status-box';
  if (tone === 'error') {
    statusBox.classList.add('error-box');
  } else if (tone === 'success') {
    statusBox.classList.add('success-box');
  } else {
    statusBox.classList.add('info-box');
  }
}

function sortSourcesByNewest(sources) {
  return [...sources].sort((a, b) =>
    new Date(b.dateSaved || b.lastUpdated || 0) - new Date(a.dateSaved || a.lastUpdated || 0)
  );
}

function formatDate(value) {
  if (!value) {
    return 'Unknown date';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function normalizeWhitespace(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (error) {
    return '';
  }
}

function getPublicationDate(source) {
  const value = source.publicationDate || source.publishedAt || source.datePublished || '';
  return globalThis.SourceTracePublicationDate
    ? globalThis.SourceTracePublicationDate.normalizeValue(value)
    : value && !Number.isNaN(new Date(value).getTime()) ? value : '';
}

function formatPublicationDate(value) {
  const normalized = globalThis.SourceTracePublicationDate
    ? globalThis.SourceTracePublicationDate.normalizeValue(value)
    : value;
  if (!normalized) {
    return 'Unknown';
  }
  if (/^\d{4}(?:-\d{2})?$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  return normalized;
}

function normalizeSource(source, index) {
  const safeSource = source && typeof source === 'object' ? source : {};
  return {
    ...safeSource,
    id: String(safeSource.id || safeHttpUrl(safeSource.url) || `legacy-source-${index}`),
    sourceType: safeSource.sourceType === 'pdf' ? 'pdf' : 'webpage',
    title: String(safeSource.title || 'Untitled page'),
    url: String(safeSource.url || ''),
    hostname: String(safeSource.hostname || ''),
    text: typeof safeSource.text === 'string' ? safeSource.text : '',
    notes: typeof safeSource.notes === 'string' ? safeSource.notes : '',
    pageSegments: Array.isArray(safeSource.pageSegments) ? safeSource.pageSegments : []
  };
}

function sourceTypeLabel(source) {
  return source.sourceType === 'pdf' ? 'PDF' : 'WEBPAGE';
}

function sourceBadgeHtml(source) {
  return `<span class="source-type-badge">${sourceTypeLabel(source)}</span>`;
}

function sourceLinkHtml(source, className = '') {
  const url = source.sourceType === 'pdf' ? '' : safeHttpUrl(source.url);
  const title = escapeHtml(source.title || 'Untitled source');
  return url
    ? `<a${className ? ` class="${className}"` : ''} href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<strong>${title}</strong>`;
}

function truncateText(value, limit = 180) {
  const clean = normalizeWhitespace(value || '');
  if (clean.length <= limit) {
    return clean;
  }

  return `${clean.slice(0, limit).trim()}…`;
}

function formatSourceSize(size) {
  if (!size) {
    return 'Unknown size';
  }
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getSourceById(sourceId) {
  return allSources.find((source) => source.id === sourceId) || null;
}

function updateTotalSources() {
  const totalSourcesNode = document.getElementById('totalSources');
  if (totalSourcesNode) {
    totalSourcesNode.textContent = String(allSources.length);
  }
  updateSelectionCount();
}

function updateSelectionCount() {
  const count = selectedIds.size;
  const selectedCount = document.getElementById('selectedCount');
  if (selectedCount) {
    selectedCount.textContent = `${count} selected`;
  }

  const reportSummary = document.getElementById('reportSelectionSummary');
  if (reportSummary) {
    reportSummary.textContent = count
      ? `${count} source${count === 1 ? '' : 's'} selected. Reports include source details${count >= 2 && count <= MAX_SELECTED_SOURCES ? ' and pairwise comparisons' : ''}.`
      : 'Select one or more sources in Source Library. Select 2–10 to include pairwise comparisons.';
  }
}

function getSearchValue() {
  const input = document.getElementById('sourceSearch');
  return (input ? input.value : '').trim().toLowerCase();
}

function matchesSearch(source, query) {
  if (!query) {
    return true;
  }

  const haystacks = [
    source.title,
    source.filename || '',
    source.hostname,
    source.url,
    source.text,
    source.notes || ''
  ].filter(Boolean).join(' ').toLowerCase();

  return haystacks.includes(query);
}

function renderSourceList() {
  const sourceList = document.getElementById('sourceList');
  const emptyState = document.getElementById('emptyState');
  const query = getSearchValue();
  const visibleSources = allSources.filter((source) => matchesSearch(source, query));

  sourceList.innerHTML = '';

  if (visibleSources.length === 0) {
    sourceList.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  sourceList.classList.remove('hidden');
  emptyState.classList.add('hidden');

  visibleSources.forEach((source) => {
    const card = document.createElement('article');
    card.className = 'source-card';
    card.dataset.id = source.id;

    const checked = selectedIds.has(source.id) ? 'checked' : '';
    const preview = truncateText(source.text, 220);
    const sourceUrl = safeHttpUrl(source.url);
    const sourceLink = source.sourceType === 'pdf'
      ? '<span class="subtle-text">Local PDF · no public URL</span>'
      : sourceUrl
      ? `<a class="link-btn" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original source</a>`
      : '<span class="subtle-text">No valid original URL</span>';
    const publicationDate = getPublicationDate(source);
    const pdfMetadata = source.sourceType === 'pdf' ? source.pdfMetadata || {} : {};
    const pdfMetadataRows = [
      ['Author', pdfMetadata.author],
      ['Subject', pdfMetadata.subject],
      ['Creator', pdfMetadata.creator],
      ['Producer', pdfMetadata.producer],
      ['PDF creation date', pdfMetadata.creationDate],
      ['PDF modification date', pdfMetadata.modificationDate]
    ].filter(([, value]) => value);

    card.innerHTML = `
      <div class="card-header">
        <div>
          <h3>${sourceBadgeHtml(source)}${escapeHtml(source.title || 'Untitled page')}</h3>
          <div class="source-meta">${source.sourceType === 'pdf' ? `Imported ${escapeHtml(formatDate(source.importDate || source.dateSaved))}` : `${escapeHtml(source.hostname || 'unknown host')} • ${escapeHtml(formatDate(source.lastUpdated || source.dateSaved))}`}</div>
          ${source.sourceType === 'webpage' ? `<div class="source-meta">Publication date: ${escapeHtml(formatPublicationDate(publicationDate))}</div>` : ''}
          ${source.sourceType === 'pdf' ? `<div class="source-meta">File: ${escapeHtml(source.filename || 'Unknown filename')} · ${Number(source.pageCount) || 0} pages · ${formatSourceSize(Number(source.documentSize) || 0)}</div>` : ''}
        </div>
        <label class="compare-toggle">
          <input type="checkbox" class="compare-check" data-source-id="${escapeAttribute(source.id)}" ${checked} />
          Include
        </label>
      </div>
      <p class="preview-text">${escapeHtml(preview)}</p>
      ${source.textExtractionWarning ? `<p class="status-box info-box">${escapeHtml(source.textExtractionWarning)}</p>` : ''}
      ${source.sourceType === 'pdf' ? `<details class="pdf-metadata"><summary>PDF metadata and title</summary>
        <div class="pdf-title-editor"><label>Research title<input class="pdf-title-input" data-title-id="${escapeAttribute(source.id)}" maxlength="300" value="${escapeAttribute(source.title)}" /></label><button class="secondary-btn save-pdf-title-btn" data-save-title-id="${escapeAttribute(source.id)}" type="button">Save title</button></div>
        <p><strong>Filename:</strong> ${escapeHtml(source.filename || 'Unknown')}</p>
        <p><strong>Pages:</strong> ${Number(source.pageCount) || 'Unknown'}</p>
        <p><strong>Import date:</strong> ${escapeHtml(formatDate(source.importDate))}</p>
        <p><strong>Publication date:</strong> Unknown (PDF file dates are not publication dates)</p>
        ${pdfMetadataRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join('')}
      </details>` : ''}
      ${source.notes ? `<p class="source-note-preview"><strong>Notes:</strong> ${escapeHtml(truncateText(source.notes, 160))}</p>` : ''}
      <div class="card-actions">
        ${sourceLink}
        ${source.sourceType === 'webpage' ? `<button class="secondary-btn refresh-metadata-btn" data-refresh-id="${escapeAttribute(source.id)}" type="button">Refresh source metadata</button>` : ''}
        <button class="delete-btn" data-delete-id="${escapeAttribute(source.id)}" type="button">Delete</button>
      </div>
      <details class="source-notes">
        <summary>${source.notes ? 'Edit research notes' : 'Add research notes'}</summary>
        <label class="search-box" for="note-${escapeAttribute(source.id)}"><span>Private local notes</span>
          <textarea id="note-${escapeAttribute(source.id)}" class="source-note-input" data-note-id="${escapeAttribute(source.id)}" rows="3" maxlength="5000">${escapeHtml(source.notes)}</textarea>
        </label>
        <button class="secondary-btn save-note-btn" data-save-note-id="${escapeAttribute(source.id)}" type="button">Save notes</button>
      </details>
    `;

    sourceList.appendChild(card);
  });
  updateSelectionCount();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value || '').replace(/`/g, '&#96;');
}

function getSelectedSources() {
  return Array.from(selectedIds)
    .map((id) => getSourceById(id))
    .filter(Boolean);
}

function renderTimeline() {
  const timeline = document.getElementById('sourceTimeline');
  if (!timeline) {
    return;
  }
  timeline.replaceChildren();
  [...allSources].sort((left, right) => {
    const leftDate = getPublicationDate(left) || left.dateSaved || left.lastUpdated || 0;
    const rightDate = getPublicationDate(right) || right.dateSaved || right.lastUpdated || 0;
    return new Date(rightDate) - new Date(leftDate);
  }).forEach((source) => {
    const item = document.createElement('li');
    item.className = 'timeline-item';
    const title = document.createElement('strong');
    title.textContent = source.title;
    const saved = document.createElement('span');
    saved.textContent = `Saved ${formatDate(source.dateSaved || source.lastUpdated)}`;
    const publication = document.createElement('span');
    const publicationDate = getPublicationDate(source);
    publication.textContent = publicationDate
      ? `Publication date: ${formatPublicationDate(publicationDate)}`
      : 'Publication date: Unknown';
    const safeUrl = safeHttpUrl(source.url);
    item.append(title, saved, publication);
    if (safeUrl) {
      const link = document.createElement('a');
      link.href = safeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open original source';
      item.appendChild(link);
    }
    timeline.appendChild(item);
  });

  if (!allSources.length) {
    const empty = document.createElement('li');
    empty.className = 'subtle-text';
    empty.textContent = 'Saved sources will appear here in chronological order.';
    timeline.appendChild(empty);
  }
}

function updateSelectionSummary() {
  const selected = getSelectedSources();
  const statusBox = document.getElementById('comparisonStatus');

  updateSelectionCount();
  if (selected.length === 0) {
    statusBox.textContent = 'Select between 2 and 10 sources in the Source Library.';
    statusBox.className = 'status-box info-box';
    return;
  }

  if (selected.length === 1) {
    statusBox.textContent = 'One source selected. Select one more to compare.';
    statusBox.className = 'status-box info-box';
    return;
  }

  statusBox.textContent = selected.length > MAX_SELECTED_SOURCES
    ? `Select no more than ${MAX_SELECTED_SOURCES} sources per comparison.`
    : `${selected.length} sources selected. ${selected.length * (selected.length - 1) / 2} unique source pairs will be compared.`;
  statusBox.className = 'status-box info-box';
}

const COMPARISON_MIN_PHRASE_WORDS = 6;
const MAX_DISPLAYED_MATCHES = 10;
const MIN_COMPARISON_CHARACTERS = 120;
const MIN_COMPARISON_WORDS = 20;
const AD_CODE_PATTERN = /\b(?:googletag|googlesyndication|doubleclick|gtag|google-analytics|dataLayer|fbq|adservice|adsbygoogle|adunit|adslot)\b/i;
const INLINE_SCRIPT_PATTERNS = [
  /\bgoogletag\s*\.\s*cmd\s*\.\s*push\s*\(\s*function\s*\([^)]*\)\s*\{[\s\S]{0,600}?\}\s*\)\s*;?/gi,
  /\b(?:gtag|ga|fbq)\s*\([^)]{0,300}\)\s*;?/gi,
  /\b(?:window\.)?dataLayer\s*\.\s*push\s*\([^)]{0,300}\)\s*;?/gi,
  /<script\b[^>]*>[\s\S]*?<\/script>/gi
];
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between',
  'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no',
  'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'also', 'said', 'one', 'two'
]);

function cleanComparisonText(text) {
  let cleaned = String(text || '').replace(/\u00a0/g, ' ');
  INLINE_SCRIPT_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, ' ');
  });

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || AD_CODE_PATTERN.test(line)) {
        return false;
      }

      const words = line.match(/[a-z][a-z'-]*/gi) || [];
      const symbols = (line.match(/[{}[\];=<>]|=>|\/\*|\*\//g) || []).length;
      const codeLike = /<\/?[a-z][^>]*>|\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{|(?:^|[;{}])\s*(?:const|let|var)\s+[\w$]+\s*=|\breturn\b[^.!?]*;|\b(?:document|window|console)\s*\.\s*\w+\s*(?:\(|=)|^\s*(?:package\s+[\w.]+;|import\s+[\w.{*]|export\s+(?:default|const|function|class))/i.test(line)
        || (symbols >= 4 && symbols > words.length / 2);
      return !codeLike;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWords(text) {
  return cleanComparisonText(text)
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function getKeywordTokens(text) {
  return tokenizeWords(text).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function hasSufficientContent(text) {
  const cleaned = cleanComparisonText(text);
  const words = getKeywordTokens(cleaned);
  return cleaned.length >= MIN_COMPARISON_CHARACTERS && words.length >= MIN_COMPARISON_WORDS;
}

function countWords(text) {
  const counts = new Map();
  getKeywordTokens(text).forEach((word) => {
    counts.set(word, (counts.get(word) || 0) + 1);
  });
  return counts;
}

function isUsefulPhrase(phrase) {
  if (AD_CODE_PATTERN.test(phrase) || /[{}[\];=<>]|=>|<\/?/i.test(phrase)) {
    return false;
  }
  return new Set(phrase.split(' ').filter((word) => !STOP_WORDS.has(word) && word.length > 2)).size >= 2;
}

function findContextSnippet(words, start, length) {
  const contextStart = Math.max(0, start - 5);
  const contextEnd = Math.min(words.length, start + length + 5);
  return words.slice(contextStart, contextEnd).join(' ');
}

function findPageSegmentMatch(source, targetWords) {
  if (source.sourceType !== 'pdf' || !Array.isArray(source.pageSegments)) {
    return null;
  }
  for (const segment of source.pageSegments) {
    const words = tokenizeWords(segment.text || '');
    for (let start = 0; start <= words.length - targetWords.length; start += 1) {
      if (targetWords.every((word, index) => words[start + index] === word)) {
        const contextStart = Math.max(0, start - 5);
        const contextEnd = Math.min(words.length, start + targetWords.length + 5);
        return {
          pageNumber: Number(segment.pageNumber) || null,
          context: words.slice(contextStart, contextEnd).join(' ')
        };
      }
    }
  }
  return null;
}

function findPhraseMatches(leftText, rightText, minWords = COMPARISON_MIN_PHRASE_WORDS, leftSource = null, rightSource = null) {
  const leftWords = tokenizeWords(leftText);
  const rightWords = tokenizeWords(rightText);
  const rightWindows = new Map();
  const maxAlignmentsPerWindow = 5;

  for (let index = 0; index <= rightWords.length - minWords; index += 1) {
    const window = rightWords.slice(index, index + minWords).join(' ');
    if (!rightWindows.has(window)) {
      rightWindows.set(window, []);
    }
    if (rightWindows.get(window).length < maxAlignmentsPerWindow) {
      rightWindows.get(window).push(index);
    }
  }

  const runs = [];
  const leftWindowOccurrences = new Map();
  for (let leftStart = 0; leftStart <= leftWords.length - minWords; leftStart += 1) {
    const window = leftWords.slice(leftStart, leftStart + minWords).join(' ');
    const rightStarts = rightWindows.get(window) || [];
    if (!rightStarts.length) {
      continue;
    }

    const occurrences = leftWindowOccurrences.get(window) || 0;
    if (occurrences >= maxAlignmentsPerWindow) {
      continue;
    }
    leftWindowOccurrences.set(window, occurrences + 1);

    rightStarts.forEach((rightStart) => {
      if (leftStart > 0 && rightStart > 0 && leftWords[leftStart - 1] === rightWords[rightStart - 1]) {
        return;
      }

      let length = 0;
      while (
        leftStart + length < leftWords.length
        && rightStart + length < rightWords.length
        && leftWords[leftStart + length] === rightWords[rightStart + length]
      ) {
        length += 1;
      }

      if (length < minWords) {
        return;
      }

      const phrase = leftWords.slice(leftStart, leftStart + length).join(' ');
      if (isUsefulPhrase(phrase)) {
        runs.push({ leftStart, rightStart, length, phrase });
      }
    });
  }

  const mergedRuns = [];
  runs.sort((a, b) =>
    (a.leftStart - a.rightStart) - (b.leftStart - b.rightStart)
    || a.leftStart - b.leftStart
    || b.length - a.length
  );
  runs.forEach((run) => {
    const previous = mergedRuns[mergedRuns.length - 1];
    if (
      previous
      && previous.leftStart + previous.length >= run.leftStart
      && previous.rightStart + previous.length >= run.rightStart
      && previous.leftStart - previous.rightStart === run.leftStart - run.rightStart
    ) {
      const end = Math.max(previous.leftStart + previous.length, run.leftStart + run.length);
      previous.length = end - previous.leftStart;
      previous.phrase = leftWords.slice(previous.leftStart, end).join(' ');
    } else {
      mergedRuns.push({ ...run });
    }
  });

  const unique = new Map();
  mergedRuns.forEach((run) => {
    const phrase = run.phrase;
    if (!isUsefulPhrase(phrase)) {
      return;
    }

    const key = phrase.toLocaleLowerCase();
    if (!unique.has(key)) {
      const matchedWords = leftWords.slice(run.leftStart, run.leftStart + run.length);
      const leftPageMatch = findPageSegmentMatch(leftSource || {}, matchedWords);
      const rightPageMatch = findPageSegmentMatch(rightSource || {}, matchedWords);
      unique.set(key, {
        phrase,
        leftContext: leftPageMatch?.context
          || findContextSnippet(leftWords, run.leftStart, run.length),
        rightContext: rightPageMatch?.context
          || findContextSnippet(rightWords, run.rightStart, run.length),
        leftPageNumber: leftPageMatch?.pageNumber || null,
        rightPageNumber: rightPageMatch?.pageNumber || null,
        wordCount: run.length
      });
    }
  });

  return [...unique.values()]
    .sort((a, b) => b.wordCount - a.wordCount || a.phrase.localeCompare(b.phrase))
    .slice(0, MAX_DISPLAYED_MATCHES);
}

function calculateJaccardSimilarity(leftText, rightText) {
  const leftTokens = new Set(getKeywordTokens(leftText));
  const rightTokens = new Set(getKeywordTokens(rightText));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = new Set([...leftTokens].filter((token) => rightTokens.has(token)));
  const union = new Set([...leftTokens, ...rightTokens]);
  return Number(((intersection.size / union.size) * 100).toFixed(2));
}

function buildSharedKeywords(leftText, rightText) {
  const leftCounts = countWords(leftText);
  const rightCounts = countWords(rightText);
  return [...leftCounts.entries()]
    .filter(([word]) => rightCounts.has(word))
    .sort((a, b) => (rightCounts.get(b[0]) + b[1]) - (rightCounts.get(a[0]) + a[1]))
    .slice(0, 12)
    .map(([word]) => word);
}

function buildComparisonReport(leftSource, rightSource) {
  const leftText = cleanComparisonText(leftSource.text);
  const rightText = cleanComparisonText(rightSource.text);
  const sufficientContent = hasSufficientContent(leftText) && hasSufficientContent(rightText);
  const explanationText = 'The percentage measures textual overlap in the cleaned article text only. It does not prove plagiarism or identify which source, if either, came first.';

  return {
    exactMatches: sufficientContent ? findPhraseMatches(leftText, rightText) : [],
    similarity: sufficientContent ? calculateJaccardSimilarity(leftText, rightText) : null,
    sharedKeywords: sufficientContent ? buildSharedKeywords(leftText, rightText) : [],
    sufficientContent,
    explanationText
  };
}

function getPreparedSource(source) {
  if (!preparedSourceCache.has(source)) {
    const text = cleanComparisonText(source.text);
    const keywords = getKeywordTokens(text);
    preparedSourceCache.set(source, {
      text,
      tokens: new Set(keywords),
      sufficient: text.length >= MIN_COMPARISON_CHARACTERS && keywords.length >= MIN_COMPARISON_WORDS
    });
  }
  return preparedSourceCache.get(source);
}

function calculatePreparedSimilarity(left, right) {
  if (!left.sufficient || !right.sufficient || !left.tokens.size || !right.tokens.size) {
    return null;
  }
  let sharedCount = 0;
  left.tokens.forEach((token) => {
    if (right.tokens.has(token)) {
      sharedCount += 1;
    }
  });
  return Number(((sharedCount / (left.tokens.size + right.tokens.size - sharedCount)) * 100).toFixed(2));
}

function buildPairReport(leftSource, rightSource) {
  const left = getPreparedSource(leftSource);
  const right = getPreparedSource(rightSource);
  const similarity = calculatePreparedSimilarity(left, right);
  const hasEnoughText = similarity !== null;
  return {
    leftSource,
    rightSource,
    similarity,
    sufficientContent: hasEnoughText,
    exactMatches: hasEnoughText ? findPhraseMatches(left.text, right.text, COMPARISON_MIN_PHRASE_WORDS, leftSource, rightSource) : [],
    sharedKeywords: hasEnoughText ? buildSharedKeywords(left.text, right.text) : []
  };
}

function getUniquePairs(sources, includeDetails = true) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      if (includeDetails) {
        pairs.push(buildPairReport(sources[leftIndex], sources[rightIndex]));
      } else {
        const leftSource = sources[leftIndex];
        const rightSource = sources[rightIndex];
        const left = getPreparedSource(leftSource);
        const right = getPreparedSource(rightSource);
        pairs.push({
          leftSource,
          rightSource,
          similarity: calculatePreparedSimilarity(left, right),
          sufficientContent: left.sufficient && right.sufficient
        });
      }
    }
  }
  return pairs;
}

function renderPairDetails(pair) {
  const target = document.getElementById('pairDetail');
  if (!pair || !target) {
    return;
  }
  const leftInfo = `${sourceBadgeHtml(pair.leftSource)}${sourceLinkHtml(pair.leftSource)}${pair.leftSource.sourceType === 'pdf' ? `<p class="subtle-text">${escapeHtml(pair.leftSource.filename || 'Local PDF')}</p>` : ''}`;
  const rightInfo = `${sourceBadgeHtml(pair.rightSource)}${sourceLinkHtml(pair.rightSource)}${pair.rightSource.sourceType === 'pdf' ? `<p class="subtle-text">${escapeHtml(pair.rightSource.filename || 'Local PDF')}</p>` : ''}`;
  const phraseList = pair.exactMatches.length
    ? `<ul class="match-list">${pair.exactMatches.map((match) => `<li class="match-item"><strong class="match-phrase">${escapeHtml(match.phrase)}</strong><p class="match-context"><b>Source A${match.leftPageNumber ? ` · PDF page ${match.leftPageNumber}` : ''}:</b> ${escapeHtml(match.leftContext)}</p><p class="match-context"><b>Source B${match.rightPageNumber ? ` · PDF page ${match.rightPageNumber}` : ''}:</b> ${escapeHtml(match.rightContext)}</p></li>`).join('')}</ul>`
    : '<p class="empty-compare">No qualifying shared phrases for this pair.</p>';
  const keywordList = pair.sharedKeywords.length
    ? `<ul class="keyword-list">${pair.sharedKeywords.map((word) => `<li class="keyword-pill">${escapeHtml(word)}</li>`).join('')}</ul>`
    : '<p class="subtle-text">No shared keywords available.</p>';

  target.classList.remove('hidden');
  target.innerHTML = `
    <div class="panel-header"><h3>Pair details</h3><button id="closePairDetail" class="ghost-btn" type="button">Close details</button></div>
    <div class="selection-summary">
      <div class="summary-card"><h3>Source A</h3>${leftInfo}</div>
      <div class="summary-card"><h3>Source B</h3>${rightInfo}</div>
    </div>
    <p>${pair.sufficientContent ? `Measured textual overlap: <strong>${pair.similarity}%</strong>` : 'Comparison unavailable: one or both sources do not contain enough readable article text.'}</p>
    <h4>Shared phrases (${pair.exactMatches.length})</h4>${phraseList}
    <h4>Shared keywords</h4>${keywordList}
    <p class="subtle-text">Textual similarity does not prove plagiarism or identify which source originated a claim.</p>
  `;
  target.querySelector('#closePairDetail').addEventListener('click', () => target.classList.add('hidden'));
}

function renderComparisonResults(pairReports = null) {
  const comparisonResults = document.getElementById('comparisonResults');
  document.getElementById('pairDetail').classList.add('hidden');
  const selectedSources = getSelectedSources();

  if (selectedSources.length < 2 || selectedSources.length > MAX_SELECTED_SOURCES) {
    comparisonResults.innerHTML = '<div class="empty-compare">Select between 2 and 10 sources in the Source Library, then choose Compare selected.</div>';
    document.getElementById('pairDetail').classList.add('hidden');
    return;
  }

  const pairs = pairReports || getUniquePairs(selectedSources);
  const matrixRows = selectedSources.map((source, rowIndex) => `
    <tr>
      <th scope="row">${escapeHtml(source.title)}</th>
      ${selectedSources.map((columnSource, columnIndex) => {
        if (rowIndex === columnIndex) {
          return '<td class="matrix-self" aria-label="Same source">—</td>';
        }
        const pair = pairs.find((item) =>
          (item.leftSource.id === source.id && item.rightSource.id === columnSource.id)
          || (item.leftSource.id === columnSource.id && item.rightSource.id === source.id)
        );
        return `<td>${pair && pair.sufficientContent ? `${pair.similarity}%` : '<span title="Insufficient readable text">N/A</span>'}</td>`;
      }).join('')}
    </tr>
  `).join('');
  const pairsHtml = pairs.map((pair) => {
    const leftTitle = `${sourceBadgeHtml(pair.leftSource)}${sourceLinkHtml(pair.leftSource)}`;
    const rightTitle = `${sourceBadgeHtml(pair.rightSource)}${sourceLinkHtml(pair.rightSource)}`;
    return `<article class="pair-card">
      <div class="pair-titles"><strong>${leftTitle}</strong><span>and</span><strong>${rightTitle}</strong></div>
      <p>${pair.sufficientContent ? `Textual overlap: <strong>${pair.similarity}%</strong>` : 'Textual overlap unavailable: insufficient readable text.'}
        · ${pair.exactMatches.length} shared phrase${pair.exactMatches.length === 1 ? '' : 's'}</p>
      <button class="secondary-btn pair-detail-btn" type="button" data-pair-left="${escapeAttribute(pair.leftSource.id)}" data-pair-right="${escapeAttribute(pair.rightSource.id)}">Open pair details</button>
    </article>`;
  }).join('');

  comparisonResults.innerHTML = `
    <section class="matrix-card">
      <h3>Similarity matrix</h3>
      <p class="subtle-text">Jaccard overlap across normalized, cleaned article text. N/A means one source has insufficient readable text.</p>
      <div class="matrix-scroll" tabindex="0" aria-label="Scrollable similarity matrix">
        <table class="similarity-matrix"><thead><tr><th scope="col">Source</th>${selectedSources.map((source) => `<th scope="col">${escapeHtml(source.title)}</th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table>
      </div>
    </section>
    <section class="pair-list"><h3>Unique source pairs (${pairs.length})</h3>${pairsHtml}</section>
    <p class="subtle-text">Textual overlap does not prove plagiarism or identify an original source.</p>
  `;
  comparisonResults.querySelectorAll('.pair-detail-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const pair = pairs.find((item) =>
        item.leftSource.id === button.dataset.pairLeft && item.rightSource.id === button.dataset.pairRight
      );
      renderPairDetails(pair);
    });
  });
}

function compareSelectedSources() {
  const selectedSources = getSelectedSources();

  if (selectedSources.length < 2) {
    setStatus('Select at least two sources in the Source Library to compare.', 'error');
    return;
  }
  if (selectedSources.length > MAX_SELECTED_SOURCES) {
    setStatus(`A comparison can include no more than ${MAX_SELECTED_SOURCES} sources. Clear some selections and try again.`, 'error');
    return;
  }

  const pairs = getUniquePairs(selectedSources);
  renderComparisonResults(pairs);
  const unavailablePairs = pairs.filter((pair) => !pair.sufficientContent).length;
  setStatus(`Compared ${pairs.length} unique pairs${unavailablePairs ? `; ${unavailablePairs} pair${unavailablePairs === 1 ? '' : 's'} had insufficient text` : ''}.`, unavailablePairs ? 'info' : 'success');
}

function loadSources() {
  const loadingState = document.getElementById('loadingState');
  if (loadingState) {
    loadingState.classList.remove('hidden');
  }

  try {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      try {
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }

        const items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        allSources = sortSourcesByNewest(items.map(normalizeSource));
        preparedSourceCache.clear();
        updateTotalSources();
        renderSourceList();
        renderTimeline();
        renderMap();
        renderClaimSourcePicker();
      } catch (error) {
        console.error('Failed to load saved sources', error);
        setStatus('The saved source library could not be loaded or displayed.', 'error');
      } finally {
        if (loadingState) {
          loadingState.classList.add('hidden');
        }
      }
    });
  } catch (error) {
    console.error('Failed to request saved sources', error);
    setStatus('The saved source library could not be loaded from local storage.', 'error');
    if (loadingState) {
      loadingState.classList.add('hidden');
    }
  }
}

function deleteSource(sourceId) {
  const target = getSourceById(sourceId);
  if (!target) {
    return;
  }

  const confirmed = window.confirm(`Delete “${target.title}” from your research library?`);
  if (!confirmed) {
    return;
  }

  const nextSources = allSources.filter((source) => source.id !== sourceId);
  chrome.storage.local.set({ [STORAGE_KEY]: nextSources }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to delete source', chrome.runtime.lastError);
      setStatus('The source could not be deleted from local storage.', 'error');
      return;
    }
    allSources = nextSources;
    preparedSourceCache.delete(target);
    selectedIds.delete(sourceId);
    updateTotalSources();
    renderSourceList();
    renderTimeline();
    renderMap();
    renderClaimSourcePicker();
    renderClaimsList();
    renderComparisonResults();
    updateSelectionSummary();
    setStatus('Source deleted from the library.', 'success');
  });
}

function saveSourceNotes(sourceId) {
  const textarea = document.querySelector(`.source-note-input[data-note-id="${CSS.escape(sourceId)}"]`);
  const source = getSourceById(sourceId);
  if (!source || !textarea) {
    return;
  }
  const updatedSources = allSources.map((item) => item.id === sourceId
    ? { ...item, notes: textarea.value.trim() }
    : item);
  chrome.storage.local.set({ [STORAGE_KEY]: updatedSources }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to save source notes', chrome.runtime.lastError);
      setStatus('Source notes could not be saved to local storage.', 'error');
      return;
    }
    allSources = updatedSources;
    renderSourceList();
    setStatus('Source notes saved locally.', 'success');
  });
}

function savePdfTitle(sourceId) {
  const source = getSourceById(sourceId);
  const input = document.querySelector(`.pdf-title-input[data-title-id="${CSS.escape(sourceId)}"]`);
  if (!source || source.sourceType !== 'pdf' || !input) {
    return;
  }
  const title = input.value.trim();
  if (!title) {
    setStatus('A PDF research title cannot be empty.', 'error');
    return;
  }
  const updatedSources = allSources.map((item) => item.id === sourceId ? { ...item, title } : item);
  chrome.storage.local.set({ [STORAGE_KEY]: updatedSources }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to save PDF title', chrome.runtime.lastError);
      setStatus('The PDF title could not be saved locally.', 'error');
      return;
    }
    allSources = updatedSources;
    renderSourceList();
    renderTimeline();
    renderClaimSourcePicker();
    setStatus('PDF research title saved locally.', 'success');
  });
}

function normalizeSourceUrl(value) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) {
    return '';
  }
  const url = new URL(safeUrl);
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

async function refreshSourceMetadata(sourceId) {
  const source = getSourceById(sourceId);
  if (!source) {
    return;
  }

  let refreshedDate = '';
  let refreshedFrom = 'saved article text';
  try {
    const sourceUrl = normalizeSourceUrl(source.url);
    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find((tab) => tab.id && normalizeSourceUrl(tab.url) === sourceUrl);
    if (matchingTab) {
      await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        files: ['publication-date.js']
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        func: () => globalThis.SourceTracePublicationDate
          ? globalThis.SourceTracePublicationDate.extract(document)
          : ''
      });
      if (results[0] && results[0].result) {
        refreshedDate = globalThis.SourceTracePublicationDate.normalizeValue(results[0].result);
        refreshedFrom = 'open webpage metadata';
      }
    }
  } catch (error) {
    console.warn('Could not refresh publication metadata from an open source tab', error);
  }

  if (!refreshedDate && globalThis.SourceTracePublicationDate) {
    refreshedDate = globalThis.SourceTracePublicationDate.extract(null, source.text);
  }
  if (!refreshedDate) {
    setStatus('No reliable publication date was found. Existing metadata and saved dates were left unchanged.', 'info');
    return;
  }

  const updatedSources = allSources.map((item) => item.id === sourceId
    ? { ...item, publicationDate: refreshedDate }
    : item);
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updatedSources }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
    allSources = updatedSources;
    renderSourceList();
    renderTimeline();
    setStatus(`Publication date refreshed from ${refreshedFrom}: ${formatPublicationDate(refreshedDate)}. Year-only dates are inferred from page content and have not been independently verified.`, 'success');
  } catch (error) {
    console.error('Failed to refresh publication metadata', error);
    setStatus('Publication metadata could not be saved. Existing source data was left unchanged.', 'error');
  }
}

function handleSearchInput() {
  renderSourceList();
  if (selectedIds.size > 0) {
    updateSelectionSummary();
  }
}

function toggleSelection(sourceId, checked) {
  if (checked) {
    if (!selectedIds.has(sourceId) && selectedIds.size >= MAX_SELECTED_SOURCES) {
      const checkbox = document.querySelector(`.compare-check[data-source-id="${CSS.escape(sourceId)}"]`);
      if (checkbox) {
        checkbox.checked = false;
      }
      setStatus(`You can select up to ${MAX_SELECTED_SOURCES} sources for comparisons and reports.`, 'error');
      return;
    }
    selectedIds.add(sourceId);
  } else {
    selectedIds.delete(sourceId);
  }

  updateSelectionSummary();
  const results = document.getElementById('comparisonResults');
  document.getElementById('pairDetail').classList.add('hidden');
  results.innerHTML = selectedIds.size >= 2
    ? '<div class="empty-compare">Selection changed. Choose Compare selected to calculate pairwise overlap.</div>'
    : '<div class="empty-compare">Select between 2 and 10 sources in the Source Library.</div>';
  updateSelectionCount();
}

const EVIDENCE_LABELS = ['Supports the claim', 'Challenges the claim', 'Context only', 'Not yet reviewed'];

function searchLibraryForPhrase(phrase, wholeWord) {
  phrase = normalizeWhitespace(phrase);
  if (!phrase) {
    return [];
  }
  const normalizedPhrase = phrase.toLocaleLowerCase();
  const matches = [];
  allSources.forEach((source) => {
    const text = normalizeWhitespace(cleanComparisonText(source.text));
    const lowerText = text.toLocaleLowerCase();
    let index = lowerText.indexOf(normalizedPhrase);
    if (wholeWord && index >= 0) {
      const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'iu').exec(text);
      index = match ? match.index + match[1].length : -1;
    }
    if (index >= 0) {
      const before = Math.max(0, index - 120);
      const after = Math.min(text.length, index + phrase.length + 160);
      matches.push({ source, excerpt: text.slice(before, after), matchOffset: index - before });
    }
  });
  return matches;
}

function renderPhraseSearch() {
  const input = document.getElementById('phraseSearchInput');
  const results = document.getElementById('phraseSearchResults');
  const summary = document.getElementById('phraseSearchSummary');
  const phrase = normalizeWhitespace(input.value);
  const wholeWord = document.getElementById('wholeWordToggle').checked;
  results.replaceChildren();

  if (!phrase) {
    summary.textContent = 'Enter a phrase to search the saved library.';
    return;
  }

  const matches = searchLibraryForPhrase(phrase, wholeWord);

  summary.textContent = `${matches.length} matching source${matches.length === 1 ? '' : 's'} found.`;
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-compare';
    empty.textContent = 'No saved sources contain this phrase.';
    results.appendChild(empty);
    return;
  }

  matches.forEach(({ source, excerpt, matchOffset }) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    const heading = document.createElement('h3');
    const url = safeHttpUrl(source.url);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title;
      heading.appendChild(link);
    } else {
      heading.textContent = source.title;
    }
    const meta = document.createElement('p');
    meta.className = 'source-meta';
    meta.textContent = `${source.hostname || 'Unknown host'} · ${url ? source.url : 'No valid original URL'}`;
    const excerptNode = document.createElement('p');
    excerptNode.className = 'phrase-excerpt';
    const matchedText = excerpt.slice(matchOffset, matchOffset + phrase.length);
    excerptNode.append(document.createTextNode(`…${excerpt.slice(0, matchOffset)}`));
    const mark = document.createElement('mark');
    mark.className = 'phrase-highlight';
    mark.textContent = matchedText;
    excerptNode.append(mark, document.createTextNode(`${excerpt.slice(matchOffset + phrase.length)}…`));
    card.append(heading, meta, excerptNode);
    results.appendChild(card);
  });
}

function renderMapDetail(source, pair, sourcePairs) {
  const detail = document.getElementById('mapDetail');
  detail.replaceChildren();
  if (pair) {
    const p = document.createElement('p');
    p.textContent = `${pair.leftSource.title} ↔ ${pair.rightSource.title}: ${pair.sufficientContent ? `${pair.similarity}% textual overlap` : 'insufficient readable text for comparison'}.`;
    detail.appendChild(p);
    return;
  }
  if (!source) {
    detail.textContent = 'Select a node or connection to inspect its details.';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = source.title;
  const host = document.createElement('p');
  host.textContent = `Hostname: ${source.hostname || 'Unknown host'}`;
  const connections = sourcePairs.filter((item) =>
    item.leftSource.id === source.id || item.rightSource.id === source.id
  );
  const list = document.createElement('ul');
  connections.forEach((item) => {
    const other = item.leftSource.id === source.id ? item.rightSource : item.leftSource;
    const entry = document.createElement('li');
    entry.textContent = `${other.title}: ${item.sufficientContent ? `${item.similarity}%` : 'N/A'}`;
    list.appendChild(entry);
  });
  if (!connections.length) {
    const entry = document.createElement('li');
    entry.textContent = 'No qualifying similarity connections at the current threshold.';
    list.appendChild(entry);
  }
  detail.append(title, host, list);
  const url = safeHttpUrl(source.url);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open original source';
    detail.appendChild(link);
  }
}

function renderMap() {
  const svg = document.getElementById('relationshipMap');
  if (!svg) {
    return;
  }
  svg.replaceChildren();
  const empty = document.getElementById('mapEmptyState');
  const notice = document.getElementById('mapNotice');
  const limitValue = document.getElementById('mapSourceLimit').value;
  const maxNodes = limitValue === 'selected'
    ? MAX_MAP_SOURCES
    : Number(limitValue);
  const selectedMapMode = limitValue === 'selected';
  const baseSources = limitValue === 'selected' && selectedIds.size >= 2
    ? getSelectedSources()
    : allSources;
  const sources = baseSources.slice(0, Math.min(maxNodes, MAX_MAP_SOURCES));
  const wasLimited = baseSources.length > sources.length;

  if (!sources.length) {
    empty.classList.remove('hidden');
    empty.textContent = 'Save sources to see measured relationships here.';
    svg.classList.add('hidden');
    notice.textContent = '';
    return;
  }
  empty.classList.add('hidden');
  svg.classList.remove('hidden');
  svg.setAttribute('viewBox', '0 0 920 620');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const threshold = Number(document.getElementById('similarityThreshold').value);
  const thresholdValue = document.getElementById('thresholdValue');
  thresholdValue.value = `${threshold}%`;
  thresholdValue.textContent = `${threshold}%`;
  const pairs = getUniquePairs(sources, false);
  const qualifyingPairs = pairs.filter((pair) => pair.sufficientContent && pair.similarity >= threshold);
  const centerX = 460;
  const centerY = 300;
  const radiusX = Math.min(360, Math.max(120, sources.length * 22));
  const radiusY = Math.min(220, Math.max(90, sources.length * 14));
  const positions = new Map();
  sources.forEach((source, index) => {
    const angle = sources.length === 1 ? 0 : (-Math.PI / 2) + (2 * Math.PI * index / sources.length);
    positions.set(source.id, {
      x: sources.length === 1 ? centerX : centerX + Math.cos(angle) * radiusX,
      y: sources.length === 1 ? centerY : centerY + Math.sin(angle) * radiusY
    });
  });

  qualifyingPairs.forEach((pair) => {
    const start = positions.get(pair.leftSource.id);
    const end = positions.get(pair.rightSource.id);
    if (!start || !end) {
      return;
    }
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'map-edge-group');
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `${pair.leftSource.title} and ${pair.rightSource.title}: ${pair.similarity}% textual overlap`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', start.x);
    line.setAttribute('y1', start.y);
    line.setAttribute('x2', end.x);
    line.setAttribute('y2', end.y);
    line.setAttribute('class', 'map-edge');
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', (start.x + end.x) / 2);
    label.setAttribute('y', (start.y + end.y) / 2 - 5);
    label.setAttribute('class', 'map-edge-label');
    label.textContent = `${pair.similarity}%`;
    group.append(line, label);
    const showPair = () => renderMapDetail(null, pair, qualifyingPairs);
    group.addEventListener('click', showPair);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showPair();
      }
    });
    svg.appendChild(group);
  });

  sources.forEach((source) => {
    const position = positions.get(source.id);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'map-node-group');
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `Source: ${source.title}`);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', position.x);
    circle.setAttribute('cy', position.y);
    circle.setAttribute('r', '12');
    circle.setAttribute('class', 'map-node');
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', position.x);
    label.setAttribute('y', position.y + 32);
    label.setAttribute('class', 'map-node-label');
    label.textContent = truncateText(source.title, 24);
    group.append(circle, label);
    const showSource = () => renderMapDetail(source, null, pairs);
    group.addEventListener('click', showSource);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showSource();
      }
    });
    svg.appendChild(group);
  });

  notice.textContent = `${selectedMapMode && selectedIds.size < 2 ? 'Select at least two sources to map only the selection; showing the library. · ' : ''}${sources.length} source${sources.length === 1 ? '' : 's'} shown · ${qualifyingPairs.length} connection${qualifyingPairs.length === 1 ? '' : 's'} at or above ${threshold}%${wasLimited ? ` · Showing ${sources.length} of ${baseSources.length}; choose a smaller selection or larger limit to inspect others.` : ''}${qualifyingPairs.length ? '' : ' · No relationships meet this threshold.'}`;
  renderMapDetail(null, null, qualifyingPairs);
}

function buildResearchReportHtml(sources, includeClaims) {
  const generatedAt = new Date().toLocaleString();
  const sourceSections = sources.map((source, index) => {
    const isPdf = source.sourceType === 'pdf';
    const url = isPdf ? '' : safeHttpUrl(source.url);
    const link = isPdf
      ? 'Local PDF file; no public URL is associated with this source.'
      : url ? `<a href="${escapeAttribute(url)}" rel="noopener noreferrer">${escapeHtml(source.url)}</a>` : 'No valid original URL was saved.';
    const publicationDate = isPdf ? '' : getPublicationDate(source);
    const pdfMetadata = isPdf ? source.pdfMetadata || {} : {};
    return `<section class="source"><h2>${index + 1}. ${escapeHtml(source.title)}</h2>
      <p><strong>Source type:</strong> ${isPdf ? 'PDF' : 'Webpage'}</p>
      <p><strong>Original URL:</strong> ${link}</p>
      <p><strong>Publication date:</strong> ${publicationDate ? escapeHtml(formatPublicationDate(publicationDate)) : 'Unknown'}</p>
      ${isPdf ? `<p><strong>Filename:</strong> ${escapeHtml(source.filename || 'Unknown')}</p>
      <p><strong>Author in PDF metadata:</strong> ${escapeHtml(pdfMetadata.author || 'Unknown')}</p>
      <p><strong>Subject:</strong> ${escapeHtml(pdfMetadata.subject || 'Unknown')}</p>
      <p><strong>Creator:</strong> ${escapeHtml(pdfMetadata.creator || 'Unknown')}</p>
      <p><strong>Producer:</strong> ${escapeHtml(pdfMetadata.producer || 'Unknown')}</p>
      <p><strong>Page count:</strong> ${Number(source.pageCount) || 'Unknown'}</p>
      <p><strong>PDF creation date (metadata):</strong> ${escapeHtml(pdfMetadata.creationDate || 'Unknown')}</p>
      <p><strong>PDF modification date (metadata):</strong> ${escapeHtml(pdfMetadata.modificationDate || 'Unknown')}</p>
      <p><strong>Import date:</strong> ${escapeHtml(formatDate(source.importDate))}</p>
      <p><strong>Document size:</strong> ${escapeHtml(formatSourceSize(Number(source.documentSize) || 0))}</p>` : ''}
      <p><strong>Date saved:</strong> ${escapeHtml(formatDate(source.dateSaved || source.lastUpdated || source.importDate))}</p>
      <h3>Collected text excerpt</h3><blockquote>${escapeHtml(truncateText(cleanComparisonText(source.text), 1200) || 'No readable article text was saved.')}</blockquote>
      <h3>Research notes</h3><p>${escapeHtml(source.notes || 'No notes recorded.')}</p></section>`;
  }).join('');
  const pairs = sources.length >= 2 && sources.length <= MAX_SELECTED_SOURCES ? getUniquePairs(sources) : [];
  const pairSections = pairs.length ? `<section><h2>Pairwise textual overlap</h2>${pairs.map((pair) => `
    <article class="pair"><h3>${escapeHtml(pair.leftSource.title)} and ${escapeHtml(pair.rightSource.title)}</h3>
    <p>${pair.sufficientContent ? `${pair.similarity}% measured textual overlap` : 'Not available: insufficient readable text.'}; ${pair.exactMatches.length} shared phrase${pair.exactMatches.length === 1 ? '' : 's'}.</p>
    ${pair.exactMatches.length ? `<ul>${pair.exactMatches.map((match) => `<li>${escapeHtml(match.phrase)}${match.leftPageNumber || match.rightPageNumber ? ` — ${match.leftPageNumber ? `PDF page ${match.leftPageNumber} in ${escapeHtml(pair.leftSource.title)}` : ''}${match.leftPageNumber && match.rightPageNumber ? '; ' : ''}${match.rightPageNumber ? `PDF page ${match.rightPageNumber} in ${escapeHtml(pair.rightSource.title)}` : ''}` : ''}</li>`).join('')}</ul>` : ''}
    <p><strong>Common keywords:</strong> ${escapeHtml(pair.sharedKeywords.join(', ') || 'None available')}</p></article>`).join('')}</section>` : '';
  const selectedIdsForReport = new Set(sources.map((source) => source.id));
  const claims = includeClaims ? allClaims.filter((claim) =>
    Array.isArray(claim.evidence) && claim.evidence.some((item) => selectedIdsForReport.has(item.sourceId))
  ) : [];
  const claimSections = claims.length ? `<section><h2>Claims and user-entered evidence labels</h2><p>These classifications were entered by the user and are not objective or automated truth assessments.</p>${claims.map((claim) => `
    <article class="pair"><h3>${escapeHtml(claim.title || 'Untitled claim')}</h3><p>${escapeHtml(claim.notes || 'No claim notes recorded.')}</p><ul>
      ${claim.evidence.filter((item) => selectedIdsForReport.has(item.sourceId)).map((item) => {
        const source = getSourceById(item.sourceId);
        return `<li>${escapeHtml(source ? source.title : 'Source no longer in library')} — ${escapeHtml(item.label || 'Not yet reviewed')}${item.note ? `: ${escapeHtml(item.note)}` : ''}</li>`;
      }).join('')}</ul></article>`).join('')}</section>` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(`SourceTrace Research Report — ${generatedAt}`)}</title>
    <style>body{font:16px/1.6 Georgia,serif;max-width:900px;margin:40px auto;padding:0 24px;color:#1d2433}h1,h2,h3{font-family:Arial,sans-serif;line-height:1.25}h1{font-size:2rem}h2{margin-top:2em;border-bottom:1px solid #ccd2df;padding-bottom:.4em}a{color:#324db8;overflow-wrap:anywhere}blockquote{margin:0;padding:12px 18px;background:#f3f5fa;border-left:4px solid #6578d9}.pair,.source{break-inside:avoid;margin:18px 0;padding:16px;border:1px solid #dce0e9;border-radius:8px}.method{margin-top:2em;padding:16px;background:#f3f5fa}@media print{body{margin:0 auto}.no-print{display:none}}</style></head>
    <body><h1>SourceTrace Research Report</h1><p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
    <section><h2>Research scope</h2><p>Report generated from ${sources.length} locally saved source${sources.length === 1 ? '' : 's'} selected by the user.</p><ol>${sources.map((source) => `<li>${escapeHtml(source.title)}</li>`).join('')}</ol></section>
    <section><h2>Sources</h2>${sourceSections}</section>${pairSections}${claimSections}
    <section><h2>Research notes</h2><p>Use the source-specific notes above to record observations. This report does not create summaries or claims beyond saved text and user-entered notes.</p></section>
    <section class="method"><h2>Methodology and limitations</h2><p>Textual overlap is calculated locally as Jaccard similarity over normalized, cleaned extracted source text after common stop words and short tokens are removed. Phrase matches use the local exact-token comparison rule. PDF page numbers are shown only when preserved from extraction.</p>
    <p>Textual similarity does not establish plagiarism and does not prove which source originated a claim. Webpage publication dates are extracted from page metadata or explicit page text and are not independently verified; year-only values reflect the precision available. PDF creation and modification metadata are not treated as publication dates. Saved and import dates are separately labeled. Excerpts may omit context.</p></section>
    <p class="no-print">Print this page or choose “Save as PDF” in your browser’s print dialog.</p></body></html>`;
}

function createReport() {
  const sources = getSelectedSources();
  if (!sources.length) {
    setReportStatus('Select at least one source in Source Library before generating a report.', 'error');
    return '';
  }
  if (sources.length > MAX_SELECTED_SOURCES) {
    setReportStatus(`Reports with comparisons support up to ${MAX_SELECTED_SOURCES} selected sources.`, 'error');
    return '';
  }
  const includeClaims = document.getElementById('includeClaimsToggle').checked;
  if (includeClaims && !claimsLoaded) {
    setReportStatus('Claims are still loading from local storage. Please try again shortly.', 'error');
    return '';
  }
  const html = buildResearchReportHtml(sources, includeClaims);
  setReportStatus(`Report prepared with ${sources.length} selected source${sources.length === 1 ? '' : 's'}${sources.length >= 2 ? ' and pairwise results' : ''}.`, 'success');
  return html;
}

function revokeReportObjectUrl() {
  if (reportObjectUrl) {
    URL.revokeObjectURL(reportObjectUrl);
    reportObjectUrl = '';
  }
}

function openReport(printWhenReady) {
  const html = createReport();
  if (!html) {
    return;
  }
  revokeReportObjectUrl();
  reportObjectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const reportWindow = window.open(reportObjectUrl, '_blank');
  if (!reportWindow) {
    revokeReportObjectUrl();
    setReportStatus('The report tab was blocked. Allow pop-ups for this extension and try again.', 'error');
    return;
  }
  if (printWhenReady) {
    reportWindow.addEventListener('load', () => reportWindow.print(), { once: true });
  }
  window.setTimeout(revokeReportObjectUrl, 60000);
}

function renderClaimSourcePicker(claim = null) {
  const picker = document.getElementById('claimSourcePicker');
  if (!picker) {
    return;
  }
  const evidenceBySource = new Map((claim && Array.isArray(claim.evidence) ? claim.evidence : [])
    .map((item) => [item.sourceId, item]));
  picker.innerHTML = allSources.length ? allSources.map((source) => {
    const evidence = evidenceBySource.get(source.id) || {};
    return `<div class="claim-picker-row">
      <label><input type="checkbox" class="claim-source-check" data-source-id="${escapeAttribute(source.id)}" ${evidence.sourceId ? 'checked' : ''} /> ${escapeHtml(source.title)}</label>
      <select class="claim-source-label" data-source-id="${escapeAttribute(source.id)}" aria-label="Evidence classification for ${escapeAttribute(source.title)}">
        ${EVIDENCE_LABELS.map((label) => `<option ${label === (evidence.label || EVIDENCE_LABELS[3]) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
      </select>
      <textarea class="claim-source-note" data-source-id="${escapeAttribute(source.id)}" rows="2" maxlength="2000" aria-label="Evidence notes for ${escapeAttribute(source.title)}" placeholder="Notes about this evidence">${escapeHtml(evidence.note || '')}</textarea>
    </div>`;
  }).join('') : '<p class="subtle-text">Save sources before associating evidence.</p>';
}

function readClaims() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(CLAIMS_STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(result[CLAIMS_STORAGE_KEY]) ? result[CLAIMS_STORAGE_KEY] : []);
    });
  });
}

function persistClaims() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CLAIMS_STORAGE_KEY]: allClaims }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function renderClaimsList() {
  const list = document.getElementById('claimsList');
  const empty = document.getElementById('claimsEmptyState');
  list.replaceChildren();
  empty.classList.toggle('hidden', allClaims.length > 0);
  allClaims.forEach((claim) => {
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    const counts = Object.fromEntries(EVIDENCE_LABELS.map((label) => [label, evidence.filter((item) => (item.label || EVIDENCE_LABELS[3]) === label).length]));
    const card = document.createElement('article');
    card.className = 'claim-card';
    const evidenceHtml = evidence.map((item, index) => {
      const source = getSourceById(item.sourceId);
      const url = source ? safeHttpUrl(source.url) : '';
      const title = source ? source.title : 'Source no longer in library';
      return `<div class="claim-evidence-row">
        <div>${url ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</div>
        <label class="claim-label-control">Your label
          <select class="claim-evidence-label" data-claim-id="${escapeAttribute(claim.id)}" data-evidence-index="${index}">${EVIDENCE_LABELS.map((label) => `<option ${label === (item.label || EVIDENCE_LABELS[3]) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
        </label>
        <textarea class="claim-evidence-note" data-claim-id="${escapeAttribute(claim.id)}" data-evidence-index="${index}" rows="2" maxlength="2000" placeholder="Your notes for this source">${escapeHtml(item.note || '')}</textarea>
        <button type="button" class="ghost-btn save-evidence-note" data-claim-id="${escapeAttribute(claim.id)}" data-evidence-index="${index}">Save evidence note</button>
        <button type="button" class="delete-btn remove-evidence-btn" data-claim-id="${escapeAttribute(claim.id)}" data-evidence-index="${index}">Remove association</button>
      </div>`;
    }).join('');
    card.innerHTML = `<div class="claim-card-header"><div><h3>${escapeHtml(claim.title || 'Untitled claim')}</h3><p>${escapeHtml(claim.notes || 'No research notes recorded.')}</p></div>
      <div class="card-actions"><button type="button" class="secondary-btn edit-claim-btn" data-claim-id="${escapeAttribute(claim.id)}">Edit</button><button type="button" class="delete-btn delete-claim-btn" data-claim-id="${escapeAttribute(claim.id)}">Delete claim</button></div></div>
      <p class="evidence-counts">${EVIDENCE_LABELS.map((label) => `${escapeHtml(label)}: ${counts[label]}`).join(' · ')}</p>
      <div class="claim-evidence-list">${evidenceHtml || '<p class="subtle-text">No sources associated with this claim yet.</p>'}</div>`;
    list.appendChild(card);
  });
}

function resetClaimForm() {
  document.getElementById('claimForm').reset();
  document.getElementById('claimIdInput').value = '';
  document.getElementById('saveClaimBtn').textContent = 'Save claim';
  renderClaimSourcePicker();
}

function editClaim(claim) {
  document.getElementById('claimIdInput').value = claim.id;
  document.getElementById('claimTitleInput').value = claim.title || '';
  document.getElementById('claimNotesInput').value = claim.notes || '';
  document.getElementById('saveClaimBtn').textContent = 'Update claim';
  renderClaimSourcePicker(claim);
  document.getElementById('claimTitleInput').focus();
}

async function saveClaim(event) {
  event.preventDefault();
  if (!claimsLoaded) {
    setStatus('Claims are still loading from local storage. Please try again shortly.', 'error');
    return;
  }
  const id = document.getElementById('claimIdInput').value || crypto.randomUUID();
  const previous = allClaims.find((claim) => claim.id === id);
  const evidence = [...document.querySelectorAll('.claim-source-check:checked')].map((checkbox) => {
    const sourceId = checkbox.dataset.sourceId;
    const label = document.querySelector(`.claim-source-label[data-source-id="${CSS.escape(sourceId)}"]`);
    const note = document.querySelector(`.claim-source-note[data-source-id="${CSS.escape(sourceId)}"]`);
    const oldEvidence = (previous && previous.evidence || []).find((item) => item.sourceId === sourceId);
    return {
      sourceId,
      label: label ? label.value : EVIDENCE_LABELS[3],
      note: note ? note.value.trim() : oldEvidence && oldEvidence.note || ''
    };
  });
  const claim = {
    id,
    title: document.getElementById('claimTitleInput').value.trim(),
    notes: document.getElementById('claimNotesInput').value.trim(),
    evidence,
    createdAt: previous && previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const previousClaims = allClaims;
  allClaims = previous ? allClaims.map((item) => item.id === id ? claim : item) : [claim, ...allClaims];
  try {
    await persistClaims();
    renderClaimsList();
    resetClaimForm();
    setStatus('Claim and evidence associations saved locally.', 'success');
  } catch (error) {
    allClaims = previousClaims;
    console.error('Failed to save claim', error);
    setStatus('The claim could not be saved to local storage. Please try again.', 'error');
  }
}

async function handleClaimListClick(event) {
  const target = event.target;
  const claimId = target.dataset.claimId;
  const claim = allClaims.find((item) => item.id === claimId);
  if (!claim) {
    return;
  }
  if (target.matches('.edit-claim-btn')) {
    editClaim(claim);
  } else if (target.matches('.delete-claim-btn')) {
    if (!window.confirm(`Delete claim “${claim.title}”? Saved sources will not be deleted.`)) {
      return;
    }
    const previousClaims = allClaims;
    allClaims = allClaims.filter((item) => item.id !== claimId);
    try {
      await persistClaims();
      renderClaimsList();
      setStatus('Claim deleted. The source library was not changed.', 'success');
    } catch (error) {
      allClaims = previousClaims;
      console.error('Failed to delete claim', error);
      setStatus('The claim could not be deleted from local storage.', 'error');
    }
  } else if (target.matches('.save-evidence-note')) {
    const index = Number(target.dataset.evidenceIndex);
    const textarea = document.querySelector(`.claim-evidence-note[data-claim-id="${CSS.escape(claimId)}"][data-evidence-index="${index}"]`);
    const previousNote = claim.evidence[index].note;
    claim.evidence[index].note = textarea ? textarea.value.trim() : '';
    claim.updatedAt = new Date().toISOString();
    try {
      await persistClaims();
      setStatus('Evidence note saved locally.', 'success');
    } catch (error) {
      claim.evidence[index].note = previousNote;
      console.error('Failed to save evidence note', error);
      setStatus('The evidence note could not be saved.', 'error');
    }
  } else if (target.matches('.remove-evidence-btn')) {
    const index = Number(target.dataset.evidenceIndex);
    const previousEvidence = claim.evidence;
    claim.evidence = claim.evidence.filter((_, evidenceIndex) => evidenceIndex !== index);
    claim.updatedAt = new Date().toISOString();
    try {
      await persistClaims();
      renderClaimsList();
      setStatus('Source association removed. The source remains in your library.', 'success');
    } catch (error) {
      claim.evidence = previousEvidence;
      console.error('Failed to remove evidence association', error);
      setStatus('The source association could not be removed.', 'error');
    }
  }
}

async function handleClaimListChange(event) {
  const target = event.target;
  if (!target.matches('.claim-evidence-label')) {
    return;
  }
  const claim = allClaims.find((item) => item.id === target.dataset.claimId);
  if (!claim) {
    return;
  }
  const index = Number(target.dataset.evidenceIndex);
  const previousLabel = claim.evidence[index].label;
  claim.evidence[index].label = target.value;
  claim.updatedAt = new Date().toISOString();
  try {
    await persistClaims();
    renderClaimsList();
    setStatus('Evidence classification updated. This is a user-entered label.', 'success');
  } catch (error) {
    claim.evidence[index].label = previousLabel;
    console.error('Failed to update evidence label', error);
    setStatus('The evidence classification could not be saved.', 'error');
  }
}

function loadClaims() {
  readClaims()
    .then((claims) => {
      claimsLoaded = true;
      allClaims = claims.filter((claim) => claim && typeof claim === 'object').map((claim, index) => ({
        ...claim,
        id: String(claim.id || `legacy-claim-${index}`),
        title: String(claim.title || 'Untitled claim'),
        notes: typeof claim.notes === 'string' ? claim.notes : '',
        evidence: Array.isArray(claim.evidence) ? claim.evidence.filter((item) => item && item.sourceId).map((item) => ({
          sourceId: String(item.sourceId),
          label: EVIDENCE_LABELS.includes(item.label) ? item.label : EVIDENCE_LABELS[3],
          note: typeof item.note === 'string' ? item.note : ''
        })) : []
      }));
      renderClaimsList();
      renderClaimSourcePicker();
    })
    .catch((error) => {
      console.error('Failed to load claims', error);
      setStatus('Saved claims could not be loaded from local storage.', 'error');
    });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.view-panel').forEach((panel) => {
        const active = panel.id === `view-${tab.dataset.view}`;
        panel.hidden = !active;
        panel.classList.toggle('active', active);
      });
      if (tab.dataset.view === 'map') {
        renderMap();
      } else if (tab.dataset.view === 'claims') {
        renderClaimsList();
      }
    });
  });

  const sourceSearch = document.getElementById('sourceSearch');
  const compareBtn = document.getElementById('compareBtn');
  const clearSelectionBtn = document.getElementById('clearSelectionBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (sourceSearch) {
    sourceSearch.addEventListener('input', handleSearchInput);
  }
  if (compareBtn) {
    compareBtn.addEventListener('click', compareSelectedSources);
  }
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      selectedIds.clear();
      document.querySelectorAll('.compare-check').forEach((checkbox) => {
        checkbox.checked = false;
      });
      updateSelectionSummary();
      renderComparisonResults();
      renderMap();
    });
  }
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const visibleCards = [...document.querySelectorAll('.source-card')];
      const availableSlots = MAX_SELECTED_SOURCES - selectedIds.size;
      const unselectedCards = visibleCards.filter((card) => !selectedIds.has(card.dataset.id));
      unselectedCards.slice(0, Math.max(availableSlots, 0)).forEach((card) => {
        selectedIds.add(card.dataset.id);
        const checkbox = card.querySelector('.compare-check');
        if (checkbox) {
          checkbox.checked = true;
        }
      });
      updateSelectionSummary();
      document.getElementById('comparisonResults').innerHTML = selectedIds.size >= 2
        ? '<div class="empty-compare">Selection changed. Choose Compare selected to calculate pairwise overlap.</div>'
        : '<div class="empty-compare">Select between 2 and 10 sources in the Source Library.</div>';
      renderMap();
      if (unselectedCards.length > availableSlots) {
        setStatus(`Selection limited to ${MAX_SELECTED_SOURCES} sources. Clear some selections to add more.`, 'error');
      }
    });
  }

  const sourceList = document.getElementById('sourceList');
  sourceList.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('.compare-check')) {
      toggleSelection(target.dataset.sourceId, target.checked);
    }
  });
  sourceList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-id]');
    const saveNoteButton = event.target.closest('[data-save-note-id]');
    const refreshButton = event.target.closest('[data-refresh-id]');
    const saveTitleButton = event.target.closest('[data-save-title-id]');
    if (deleteButton) {
      deleteSource(deleteButton.dataset.deleteId);
    } else if (saveNoteButton) {
      saveSourceNotes(saveNoteButton.dataset.saveNoteId);
    } else if (refreshButton) {
      refreshSourceMetadata(refreshButton.dataset.refreshId);
    } else if (saveTitleButton) {
      savePdfTitle(saveTitleButton.dataset.saveTitleId);
    }
  });

  const phraseInput = document.getElementById('phraseSearchInput');
  phraseInput.addEventListener('input', () => {
    window.clearTimeout(phraseSearchTimer);
    phraseSearchTimer = window.setTimeout(renderPhraseSearch, 180);
  });
  document.getElementById('wholeWordToggle').addEventListener('change', renderPhraseSearch);

  document.getElementById('similarityThreshold').addEventListener('input', renderMap);
  document.getElementById('mapSourceLimit').addEventListener('change', renderMap);

  document.getElementById('downloadReportBtn').addEventListener('click', () => {
    const html = createReport();
    if (!html) {
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `sourcetrace-report-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  });
  document.getElementById('printReportBtn').addEventListener('click', () => openReport(true));

  document.getElementById('claimForm').addEventListener('submit', saveClaim);
  document.getElementById('cancelClaimEditBtn').addEventListener('click', resetClaimForm);
  const claimsList = document.getElementById('claimsList');
  claimsList.addEventListener('click', handleClaimListClick);
  claimsList.addEventListener('change', handleClaimListChange);

  window.addEventListener('beforeunload', revokeReportObjectUrl);
  window.addEventListener('sourceTrace:pdf-imported', () => {
    loadSources();
    setStatus('PDF import completed. The documents are available in your research library.', 'success');
  });
  loadSources();
  loadClaims();
  updateSelectionSummary();
  renderComparisonResults();
});
