const STORAGE_KEY = 'sourceTraceSources';

function setStatus(message, tone = 'info') {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.className = 'status-message';
  statusEl.classList.add(tone);
}

function updateSavedCount() {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const sources = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const countEl = document.getElementById('sourceCount');
    if (countEl) {
      countEl.textContent = String(sources.length);
    }
  });
}

function normalizeUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    url.hash = '';
    const clean = url.toString().replace(/\/?$/, '');
    return clean;
  } catch (error) {
    return value.trim().replace(/\/?$/, '');
  }
}

async function saveCurrentPage() {
  const saveButton = document.getElementById('savePageBtn');
  if (saveButton) {
    saveButton.disabled = true;
  }

  setStatus('Checking the current page…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      setStatus('No active tab is available. Open a normal web page and try again.', 'warning');
      return;
    }

    const parsedUrl = new URL(tab.url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      setStatus('This page cannot be used for source extraction. Open a normal website page instead.', 'warning');
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['publication-date.js', 'content.js']
      });
    } catch (scriptError) {
      console.warn('Content script injection failed', scriptError);
      setStatus('This page is restricted or cannot be accessed by the extension. Try a standard webpage.', 'error');
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ARTICLE' });
    } catch (messageError) {
      console.warn('Failed to read page content', messageError);
      setStatus('The page could not be read. Try reloading the page or opening a different article.', 'error');
      return;
    }

    if (!response || !response.success || !response.data) {
      const reason = response && response.reason
        ? response.reason
        : 'Could not extract enough readable article text from this page.';
      const hint = response && response.hint ? ` ${response.hint}` : '';
      setStatus(`${reason}${hint}`, 'error');
      return;
    }

    const article = response.data;
    if (!article.text || !article.text.trim()) {
      setStatus('Could not extract enough readable article text from this page.', 'error');
      return;
    }

    const sourceList = await new Promise((resolve, reject) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      });
    });

    const canonical = normalizeUrl(article.url);
    const existingIndex = sourceList.findIndex((item) => normalizeUrl(item.url) === canonical);

    const existingSource = existingIndex >= 0 ? sourceList[existingIndex] : {};
    const savedEntry = {
      ...existingSource,
      id: existingIndex >= 0 ? sourceList[existingIndex].id : crypto.randomUUID(),
      sourceType: 'webpage',
      title: article.title || 'Untitled page',
      url: article.url,
      hostname: article.hostname || new URL(article.url).hostname,
      text: article.text.slice(0, 100000),
      notes: existingIndex >= 0 ? sourceList[existingIndex].notes || '' : '',
      ...(existingIndex >= 0 ? {} : { dateSaved: new Date().toISOString() }),
      lastUpdated: new Date().toISOString(),
      extractedAt: article.extractedAt || new Date().toISOString(),
      ...(article.publicationDate
        ? { publicationDate: article.publicationDate }
        : existingSource.publicationDate ? { publicationDate: existingSource.publicationDate } : {})
    };

    if (existingIndex >= 0) {
      sourceList[existingIndex] = savedEntry;
      setStatus('This source already existed, and it has been updated with the latest extraction.', 'success');
    } else {
      sourceList.unshift(savedEntry);
      setStatus('Page saved successfully to your local research library.', 'success');
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: sourceList }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });

    updateSavedCount();
  } catch (error) {
    console.error(error);
    setStatus('Saving failed because the page could not be read or stored safely. Please try again.', 'error');
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}

function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.create({ url: dashboardUrl });
}

document.addEventListener('DOMContentLoaded', () => {
  updateSavedCount();

  const saveButton = document.getElementById('savePageBtn');
  const dashboardButton = document.getElementById('openDashboardBtn');

  if (saveButton) {
    saveButton.addEventListener('click', saveCurrentPage);
  }

  if (dashboardButton) {
    dashboardButton.addEventListener('click', openDashboard);
  }
});
