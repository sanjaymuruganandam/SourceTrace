(() => {
  const MONTHS = {
    january: '01', jan: '01', february: '02', feb: '02',
    march: '03', mar: '03', april: '04', apr: '04',
    may: '05', june: '06', jun: '06', july: '07', jul: '07',
    august: '08', aug: '08', september: '09', sep: '09', sept: '09',
    october: '10', oct: '10', november: '11', nov: '11',
    december: '12', dec: '12'
  };

  function isValidDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  function isValidYear(year) {
    return Number.isInteger(year) && year >= 1000 && year <= 2999;
  }

  function normalizeValue(value) {
    const text = String(value || '').trim();
    let match = /^(\d{4})$/.exec(text);
    if (match && isValidYear(Number(match[1]))) {
      return match[1];
    }

    match = /^(\d{4})-(\d{2})$/.exec(text);
    if (match && isValidYear(Number(match[1])) && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
      return `${match[1]}-${match[2]}`;
    }

    match = /^(\d{4})-(\d{2})-(\d{2})(?:(?:[Tt]|\s+)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(text);
    const hasTimestamp = /[Tt]\d{2}:|\s+\d{2}:/.test(text);
    const validTimestamp = !hasTimestamp || !Number.isNaN(Date.parse(text));
    if (match && validTimestamp && isValidDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }

    const monthYear = /^(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{4})$/i.exec(text);
    if (monthYear && isValidYear(Number(monthYear[2]))) {
      return `${monthYear[2]}-${MONTHS[monthYear[1].toLowerCase()]}`;
    }

    let namedDate = /^(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
    if (!namedDate) {
      namedDate = /^(\d{1,2})(?:st|nd|rd|th)?\s+(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?,?\s+(\d{4})$/i.exec(text);
      if (namedDate) {
        namedDate = [namedDate[0], namedDate[2], namedDate[1], namedDate[3]];
      }
    }
    if (namedDate) {
      const month = MONTHS[namedDate[1].toLowerCase()];
      const day = Number(namedDate[2]);
      const year = Number(namedDate[3]);
      if (isValidYear(year) && isValidDate(year, Number(month), day)) {
        return `${year}-${month}-${String(day).padStart(2, '0')}`;
      }
    }

    return '';
  }

  function normalizeLabeledValue(value) {
    const text = String(value || '').trim().replace(/^[\s:,-]+|[.,;]+$/g, '');
    const exact = normalizeValue(text);
    if (exact) {
      return exact;
    }

    const prefix = /^(?:published\s+(?:in|on)\s*)?(\d{4})(?![\d-]\d)(?:\b|$)/i.exec(text);
    if (prefix && isValidYear(Number(prefix[1]))) {
      return prefix[1];
    }

    const monthFirst = /^(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
    if (monthFirst) {
      return normalizeValue(monthFirst[0]);
    }

    const monthYear = /^(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{4})\b/i.exec(text);
    return monthYear ? normalizeValue(monthYear[0]) : '';
  }

  function firstValid(values) {
    for (const value of values) {
      const normalized = normalizeValue(value);
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }

  function getMetadataDate(documentRef) {
    const metas = Array.from(documentRef.querySelectorAll('meta'));
    const valuesByName = new Map();
    metas.forEach((meta) => {
      const name = (meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop') || '').trim().toLowerCase();
      if (!name) {
        return;
      }
      if (!valuesByName.has(name)) {
        valuesByName.set(name, []);
      }
      valuesByName.get(name).push(meta.getAttribute('content') || '');
    });

    const priorityNames = [
      'article:published_time', 'datepublished', 'datecreated',
      'citation_publication_date', 'citation_date', 'og:article:published_time',
      'og:published_time', 'publication_date', 'publicationdate', 'pubdate', 'publishdate',
      'parsely-pub-date', 'sailthru.date', 'dc.date.issued', 'dcterms.issued', 'dc.date', 'date'
    ];
    const prioritized = [];
    priorityNames.forEach((name) => prioritized.push(...(valuesByName.get(name) || [])));
    const prioritizedDate = firstValid(prioritized);
    if (prioritizedDate) {
      return prioritizedDate;
    }

    const jsonLdDates = [];
    documentRef.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        const visit = (value) => {
          if (Array.isArray(value)) {
            value.forEach(visit);
          } else if (value && typeof value === 'object') {
            if (value.datePublished) {
              jsonLdDates.push(value.datePublished);
            }
            if (value.dateCreated) {
              jsonLdDates.push(value.dateCreated);
            }
            Object.values(value).forEach((child) => {
              if (child && typeof child === 'object') {
                visit(child);
              }
            });
          }
        };
        visit(data);
      } catch (error) {
        // Ignore invalid JSON-LD blocks; other metadata sources may still be valid.
      }
    });
    const jsonLdDate = firstValid(jsonLdDates);
    if (jsonLdDate) {
      return jsonLdDate;
    }

    const otherMetaDates = [];
    valuesByName.forEach((values, name) => {
      if (/(?:^|[:._-])(?:published|publication|datepublished|datecreated|dateissued|pubdate|publishdate)(?:$|[:._-])/.test(name)) {
        otherMetaDates.push(...values);
      }
    });
    const otherMetaDate = firstValid(otherMetaDates);
    if (otherMetaDate) {
      return otherMetaDate;
    }

    const timeDates = Array.from(documentRef.querySelectorAll('time[datetime], [itemprop="datePublished"], [itemprop="dateCreated"]'))
      .map((element) => element.getAttribute('datetime') || element.getAttribute('content') || element.textContent || '');
    return firstValid(timeDates);
  }

  function getLabeledDate(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const labelPattern = /\b(publication\s+date|published(?:\s+(?:in|on))?)\s*[:\-]?\s*(.*)$/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labelPattern.exec(lines[index]);
      if (!match) {
        continue;
      }
      const labeledValue = match[2] || lines[index + 1] || '';
      const date = normalizeLabeledValue(labeledValue);
      if (date) {
        return date;
      }
    }
    return '';
  }

  function extract(documentRef, articleText = '') {
    if (documentRef) {
      const metadataDate = getMetadataDate(documentRef);
      if (metadataDate) {
        return metadataDate;
      }
      const visibleDate = getLabeledDate(documentRef.body ? documentRef.body.innerText || documentRef.body.textContent : '');
      if (visibleDate) {
        return visibleDate;
      }
    }
    return getLabeledDate(articleText);
  }

  globalThis.SourceTracePublicationDate = Object.freeze({
    normalizeValue,
    extract
  });
})();
