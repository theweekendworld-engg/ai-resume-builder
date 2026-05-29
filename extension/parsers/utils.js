(function registerParserUtils(globalScope) {
  const parser = globalScope.PatronusParser = globalScope.PatronusParser || {};

  const POSITIVE_JD_KEYWORDS = [
    'responsibilities',
    'requirements',
    'qualifications',
    'experience',
    'skills',
    'preferred',
    'must have',
    'nice to have',
    'what you will do',
    'what you ll do',
    'about the job',
    'job description',
    'about the role',
    'you will',
  ];

  const NEGATIVE_JD_KEYWORDS = [
    'recommended jobs',
    'people also viewed',
    'share this job',
    'follow company',
    'sign in',
    'cookie',
    'privacy',
    'terms',
    'chat with us',
    'save job',
  ];

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeToken(value) {
    return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function readText(node) {
    if (!node) return '';
    return normalizeWhitespace(node.innerText || node.textContent || '');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function confidenceBand(score) {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const output = [];

    for (const value of values) {
      const trimmed = normalizeWhitespace(value);
      const normalized = normalizeToken(trimmed);
      if (!trimmed || !normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(trimmed);
    }

    return output;
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) return false;
    const htmlElement = element instanceof HTMLElement ? element : null;
    if (!htmlElement) return false;

    if (htmlElement.hidden) return false;
    if (htmlElement.getAttribute('aria-hidden') === 'true') return false;

    const style = globalScope.getComputedStyle(htmlElement);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }

    const rect = htmlElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;

    return Array.from(htmlElement.children).some((child) => isElementVisible(child));
  }

  function isInteractive(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!isElementVisible(element)) return false;
    if (element.matches('input, textarea, select, button')) return true;
    if (element.getAttribute('role') === 'button') return true;
    if (element.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function getElementPath(element) {
    if (!(element instanceof Element)) return '';
    if (element === document.body) return 'body';
    if (element === document.documentElement) return 'html';

    const parts = [];
    let current = element;
    let depth = 0;

    while (current && depth < 6 && current !== document.body && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id.slice(0, 40)}`;
        parts.unshift(part);
        break;
      }

      const className = typeof current.className === 'string'
        ? current.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      if (className) {
        part += `.${className.slice(0, 60)}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(' > ');
  }

  function getViewportBias(element) {
    if (!(element instanceof HTMLElement)) return 0;
    const rect = element.getBoundingClientRect();
    const viewportHeight = globalScope.innerHeight || 1;
    if (rect.bottom < -200 || rect.top > viewportHeight + 600) return 0;
    if (rect.top >= 0 && rect.top <= viewportHeight) return 1;
    return 0.6;
  }

  function getNearestHeadingText(element) {
    if (!(element instanceof HTMLElement)) return '';

    const directHeading = element.querySelector('h1, h2, h3, h4, legend');
    if (directHeading && isElementVisible(directHeading)) {
      const text = readText(directHeading);
      if (text) return text;
    }

    let current = element;
    while (current && current !== document.body) {
      const siblings = Array.from(current.parentElement?.children || []);
      const currentIndex = siblings.indexOf(current);
      for (let index = currentIndex - 1; index >= 0; index -= 1) {
        const sibling = siblings[index];
        if (!(sibling instanceof HTMLElement) || !isElementVisible(sibling)) continue;
        if (sibling.matches('h1, h2, h3, h4, legend')) {
          const text = readText(sibling);
          if (text) return text;
        }
        const nestedHeading = sibling.querySelector?.('h1, h2, h3, h4, legend');
        if (nestedHeading && isElementVisible(nestedHeading)) {
          const text = readText(nestedHeading);
          if (text) return text;
        }
      }
      current = current.parentElement;
    }

    return '';
  }

  function getTextSample(element, maxLength) {
    const text = readText(element);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}...`;
  }

  function getKeywordHits(text, keywords) {
    const normalized = normalizeToken(text);
    return keywords.filter((keyword) => normalized.includes(keyword)).length;
  }

  function dedupeLines(text) {
    const output = [];
    const seen = new Set();

    for (const rawLine of String(text || '').split(/\n+/)) {
      const line = normalizeWhitespace(rawLine);
      const normalized = normalizeToken(line);
      if (!line || !normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(line);
    }

    return output.join('\n');
  }

  function collectJsonLdObjects() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const values = [];

    for (const script of scripts) {
      const text = script.textContent?.trim();
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          values.push(...parsed);
        } else {
          values.push(parsed);
        }
      } catch {
        // Ignore invalid JSON-LD blocks.
      }
    }

    return values.filter((entry) => entry && typeof entry === 'object');
  }

  parser.utils = {
    POSITIVE_JD_KEYWORDS,
    NEGATIVE_JD_KEYWORDS,
    clamp,
    confidenceBand,
    normalizeWhitespace,
    normalizeToken,
    readText,
    uniqueStrings,
    isElementVisible,
    isInteractive,
    getElementPath,
    getViewportBias,
    getNearestHeadingText,
    getTextSample,
    getKeywordHits,
    dedupeLines,
    collectJsonLdObjects,
  };
})(globalThis);
