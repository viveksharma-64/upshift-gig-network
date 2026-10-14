/**
 * Reusable HTML-to-Text Normalizer & Sanitizer
 *
 * Provides safe, robust HTML stripping, structural formatting,
 * entity decoding, and candidate text fields normalization across
 * the UpShift ingestion pipeline, review queue, and published gigs.
 */

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&bull;': '•',
  '&hellip;': '...',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥',
  '&cent;': '¢',
  '&#x2F;': '/',
  '&#47;': '/'
};

/**
 * Decodes named and numeric HTML entities
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';

  // 1. Replace known named entities
  let decoded = str.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|ndash|mdash|lsquo|rsquo|ldquo|rdquo|bull|hellip|copy|reg|trade|euro|pound|yen|cent|#39|#x2F|#47);/gi,
    match => HTML_ENTITIES[match.toLowerCase()] || match
  );

  // 2. Numeric decimal entities: &#123;
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
    try {
      const code = parseInt(dec, 10);
      return code > 0 && code < 65536 ? String.fromCharCode(code) : '';
    } catch {
      return '';
    }
  });

  // 3. Numeric hex entities: &#x1f;
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try {
      const code = parseInt(hex, 16);
      return code > 0 && code < 65536 ? String.fromCharCode(code) : '';
    } catch {
      return '';
    }
  });

  return decoded;
}

/**
 * Converts raw or entity-encoded HTML into clean, human-readable plain text.
 * Strips script, style, comments, and media elements, preserves line & paragraph
 * boundaries, removes tags, decodes entities, and normalizes whitespace.
 *
 * @param {string|any} input
 * @returns {string} Clean plain text
 */
export function normalizeHtmlToText(input) {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') return String(input);
  if (!input.trim()) return '';

  let text = input;

  // 1. Remove dangerous script, style, noscript, and comment blocks
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // 1b. Also strip entity-encoded script/style/comment blocks
  text = text.replace(/&lt;script[\s\S]*?&lt;\/script&gt;/gi, ' ');
  text = text.replace(/&lt;style[\s\S]*?&lt;\/style&gt;/gi, ' ');
  text = text.replace(/&lt;!--[\s\S]*?--&gt;/g, ' ');

  // 2. Detect and decode entity-encoded tags (e.g. &lt;p&gt;, &lt;div class="..."&gt;)
  // so that structural elements encoded inside RSS feeds are properly handled
  text = text.replace(/&lt;(\/?(?:[a-zA-Z][a-zA-Z0-9]*|!--)[\s\S]*?)&gt;/gi, '<$1>');

  // 3. Strip embedded images and media tags completely (including any alt/attributes)
  text = text.replace(/<(?:img|picture|video|audio|svg|iframe|embed|object)\b[^>]*\/?>[\s\S]*?(?:<\/(?:picture|video|audio|svg|iframe|embed|object)>)?/gi, ' ');

  // 4. Convert structural block elements to natural line/paragraph breaks
  // Headings
  text = text.replace(/<\/?h[1-6]\b[^>]*>/gi, '\n\n');

  // Paragraphs
  text = text.replace(/<p\b[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '\n\n');

  // List items
  text = text.replace(/<li\b[^>]*>/gi, '\n• ');
  text = text.replace(/<\/li>/gi, '');

  // List wrappers, blockquotes, divisions, sections, and table rows
  text = text.replace(/<\/?(?:ul|ol|blockquote|div|section|article|header|footer|aside|table|tr|th|td)\b[^>]*>/gi, '\n');

  // Line breaks and horizontal rules
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // 5. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // 6. Clean malformed or truncated tags (e.g. from string slices: "<div class=\"foo" at end)
  text = text.replace(/<[a-zA-Z/][^>]*$/g, '');
  text = text.replace(/^[^<]*>/g, '');

  // 7. Decode HTML entities (pass 1)
  text = decodeHtmlEntities(text);

  // 8. If entity decoding unveiled further encoded entities or tags, run a second pass
  if (text.includes('&') || text.includes('<')) {
    text = decodeHtmlEntities(text);
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/<[a-zA-Z/][^>]*$/g, '');
  }

  // 9. Clean zero-width and control characters (preserve newlines and tabs)
  text = text.replace(/[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  // 10. Normalize whitespace while preserving paragraphs and bulleted lists
  const rawLines = text.split('\n');
  const cleanLines = [];
  let prevLineEmpty = false;

  for (const line of rawLines) {
    const collapsed = line.replace(/[^\S\r\n]+/g, ' ').trim();
    if (collapsed.length > 0) {
      cleanLines.push(collapsed);
      prevLineEmpty = false;
    } else if (!prevLineEmpty && cleanLines.length > 0) {
      // Allow single blank line to separate paragraphs
      cleanLines.push('');
      prevLineEmpty = true;
    }
  }

  return cleanLines.join('\n').trim();
}

/**
 * Normalizes all human-facing text fields of a candidate or gig object
 * while strictly preserving identifiers, URLs, tracks, compensation, and review state.
 *
 * @param {object} candidate
 * @returns {object} Clean candidate object
 */
export function normalizeCandidateTextFields(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;

  const desc = normalizeHtmlToText(candidate.description);
  const rawShortDesc = candidate.short_description || (desc ? desc.slice(0, 200) : '');
  const rawOverview = candidate.overview || desc;

  return {
    ...candidate,
    title: normalizeHtmlToText(candidate.title || ''),
    organization: normalizeHtmlToText(candidate.organization || ''),
    description: desc,
    short_description: normalizeHtmlToText(rawShortDesc),
    overview: normalizeHtmlToText(rawOverview),
    responsibilities: normalizeHtmlToText(candidate.responsibilities || ''),
    deliverables: normalizeHtmlToText(candidate.deliverables || ''),
    requirements: normalizeHtmlToText(candidate.requirements || ''),
    proof_spec: normalizeHtmlToText(candidate.proof_spec || ''),
    location: normalizeHtmlToText(candidate.location || '')
  };
}
