(() => {
if (globalThis.__sourceTraceContentScriptLoaded) {
  return;
}
globalThis.__sourceTraceContentScriptLoaded = true;

const MAX_ARTICLE_LENGTH = 100000;
const MIN_ARTICLE_CHARACTERS = 90;
const MIN_ARTICLE_WORDS = 15;
const EXTRACTION_ERROR = 'Could not extract enough readable article text from this page.';
const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'input', 'textarea',
  'select', 'label', '[role="navigation"]', '[role="banner"]',
  '[role="contentinfo"]', '[aria-hidden="true"]', '.sr-only',
  '.visually-hidden', '.screen-reader-only'
].join(',');
const AD_TRACKING_PATTERN = /(^|[\s_-])(ad|ads|advert|advertisement|advertising|sponsor|sponsored|promo|promoted|tracking|tracker|cookie-consent|consent-banner)([\s_-]|$)|\b(?:adsbygoogle|adunit|adslot)\b/i;
const CODE_LINE_PATTERNS = [
  /\bgoogletag\b|\bgoogle-analytics\b|\bgtag\s*\(|\b(?:adsbygoogle|googlesyndication|doubleclick|adservice)\b/i,
  /\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{|(?:^|[;{}])\s*(?:const|let|var)\s+[\w$]+\s*=|\breturn\b[^.!?]*;|\b(?:document|window|console)\s*\.\s*\w+\s*(?:\(|=)|=>/,
  /<\/?[a-z][^>]*>/i,
  /^\s*[\w$]+\s*=\s*[^=]+;|[{};]{2}|[{};]\s*$/,
  /^\s*(?:import|export|package|public|private|class|interface)\b/
];
const INLINE_SCRIPT_PATTERNS = [
  /\bgoogletag\s*\.\s*cmd\s*\.\s*push\s*\(\s*function\s*\([^)]*\)\s*\{[\s\S]{0,600}?\}\s*\)\s*;?/gi,
  /\b(?:gtag|ga|fbq)\s*\([^)]{0,300}\)\s*;?/gi,
  /\b(?:window\.)?dataLayer\s*\.\s*push\s*\([^)]{0,300}\)\s*;?/gi,
  /<script\b[^>]*>[\s\S]*?<\/script>/gi
];

function isRestrictedPage() {
  return RESTRICTED_PREFIXES.some((prefix) => window.location.href.startsWith(prefix));
}

function normalizeText(rawText) {
  return String(rawText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isCodeLikeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  const words = trimmed.match(/[a-z][a-z'-]*/gi) || [];
  const symbols = (trimmed.match(/[{}[\];=<>]|=>|\/\*|\*\//g) || []).length;
  return CODE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
    || (symbols >= 4 && symbols > words.length / 2);
}

function cleanArticleText(rawText) {
  let textWithoutScripts = String(rawText || '');
  INLINE_SCRIPT_PATTERNS.forEach((pattern) => {
    textWithoutScripts = textWithoutScripts.replace(pattern, ' ');
  });
  return normalizeText(textWithoutScripts)
    .split('\n')
    .filter((line) => !isCodeLikeLine(line))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_ARTICLE_LENGTH);
}

function wordCount(text) {
  return (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
}

function isReadableArticle(text) {
  const cleaned = cleanArticleText(text);
  if (cleaned.length < MIN_ARTICLE_CHARACTERS || wordCount(cleaned) < MIN_ARTICLE_WORDS) {
    return false;
  }

  const lines = normalizeText(text).split('\n').filter(Boolean);
  if (!lines.length) {
    return false;
  }

  const codeLikeLines = lines.filter(isCodeLikeLine).length;
  const letters = (cleaned.match(/\p{L}/gu) || []).length;
  const visibleCharacters = cleaned.replace(/\s/g, '').length;
  return codeLikeLines / lines.length < 0.4 && letters / Math.max(visibleCharacters, 1) > 0.45;
}

function isHidden(element) {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return true;
  }
  const style = window.getComputedStyle(element);
  return style.display === 'none'
    || style.visibility === 'hidden'
    || style.visibility === 'collapse'
    || Number(style.opacity) === 0;
}

function shouldRemoveElement(element) {
  const id = element.id || '';
  const className = typeof element.className === 'string' ? element.className : '';
  const description = [
    id,
    className,
    element.getAttribute('aria-label') || '',
    element.getAttribute('data-testid') || ''
  ].join(' ');
  return AD_TRACKING_PATTERN.test(description);
}

function isInsideExcludedContainer(element) {
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (current.matches(REMOVE_SELECTORS) || shouldRemoveElement(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function extractVisibleText(root) {
  if (!root || isHidden(root) || isInsideExcludedContainer(root)) {
    return '';
  }

  const clone = root.cloneNode(true);
  const originalElements = [root, ...root.querySelectorAll('*')];
  const clonedElements = [clone, ...clone.querySelectorAll('*')];
  const excludedElements = new Set();

  clonedElements.forEach((element, index) => {
    const original = originalElements[index];
    const inheritedExclusion = original !== root && excludedElements.has(original.parentElement);
    const shouldExclude = !original
      || inheritedExclusion
      || isHidden(original)
      || shouldRemoveElement(original)
      || original.matches(REMOVE_SELECTORS);
    if (shouldExclude) {
      if (original) {
        excludedElements.add(original);
      }
      element.remove();
    }
  });

  clone.querySelectorAll(REMOVE_SELECTORS).forEach((element) => element.remove());
  clone.querySelectorAll('*').forEach((element) => {
    if (shouldRemoveElement(element)) {
      element.remove();
    }
  });

  const blockElements = new Set([
    'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'MAIN', 'OL', 'P', 'SECTION', 'UL'
  ]);
  const collectText = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const content = Array.from(node.childNodes).map(collectText).join('');
    return node.tagName === 'BR' || blockElements.has(node.tagName)
      ? `${content}\n`
      : content;
  };

  return cleanArticleText(collectText(clone));
}

function scoreArticleText(text) {
  const words = wordCount(text);
  const sentenceEndings = (text.match(/[.!?](?:\s|$)/g) || []).length;
  return Math.min(text.length, 12000) + Math.min(words, 1800) * 2 + sentenceEndings * 12;
}

function extractBestCandidate(selectors, limit, seen) {
  const candidates = Array.from(document.querySelectorAll(selectors))
    .filter((candidate) => !seen.has(candidate) && !isInsideExcludedContainer(candidate))
    .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)
    .slice(0, limit);

  candidates.forEach((candidate) => seen.add(candidate));
  const usable = candidates
    .map((candidate) => extractVisibleText(candidate))
    .filter(isReadableArticle)
    .sort((a, b) => scoreArticleText(b) - scoreArticleText(a));
  return usable[0] || '';
}

function extractArticleText() {
  const seen = new Set();
  const candidateGroups = [
    ['article, [itemprop="articleBody"]', 8],
    ['main, [role="main"]', 4],
    [
      '.article-content, .article-body, .post-content, .post-body, .story-body, .entry-content, .content-body, #article-body, #main-content, .main-content',
      6
    ],
    ['[class*="article"], [class*="story"], [class*="post-content"]', 6]
  ];

  for (const [selectors, limit] of candidateGroups) {
    const text = extractBestCandidate(selectors, limit, seen);
    if (text) {
      return text;
    }
  }

  return document.body ? extractVisibleText(document.body) : '';
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'GET_ARTICLE') {
    return false;
  }

  if (isRestrictedPage()) {
    sendResponse({
      success: false,
      reason: 'This page is restricted by Chrome and cannot be read by the extension.'
    });
    return true;
  }

  const title = (document.title || '').trim() || 'Untitled page';
  const url = window.location.href;
  const publicationDate = globalThis.SourceTracePublicationDate
    ? globalThis.SourceTracePublicationDate.extract(document)
    : '';
  const extractedText = extractArticleText();

  if (!isReadableArticle(extractedText)) {
    sendResponse({
      success: false,
      reason: EXTRACTION_ERROR,
      hint: 'The page may contain mostly irrelevant content and may need a different extraction strategy.'
    });
    return true;
  }

  sendResponse({
    success: true,
    data: {
      title,
      url,
      hostname: getHostname(url),
      text: extractedText,
      publicationDate: publicationDate || (globalThis.SourceTracePublicationDate
        ? globalThis.SourceTracePublicationDate.extract(null, extractedText)
        : ''),
      extractedAt: new Date().toISOString()
    }
  });

  return true;
});
})();
