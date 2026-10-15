import { deduplicateGigList } from '../server/deduplication.js';
import { normalizeHtmlToText } from './textNormalizer.js';

/**
 * RFC 4180 Compliant 19-Column CSV Exporter
 *
 * Implements the baseline 19-column CSV data contract defined in
 * FRD v1.0 Section 18 for publishing and exporting approved opportunities.
 */

export const FRD_19_CSV_HEADERS = [
  'external_gig_id',
  'title',
  'track_id',
  'payment_amount',
  'compensation_type',
  'min_amount',
  'max_amount',
  'currency',
  'priority',
  'is_featured',
  'is_local_business',
  'posted_at',
  'origin_url',
  'short_description',
  'overview',
  'responsibilities',
  'deliverables',
  'requirements',
  'proof_spec'
];

/**
 * Neutralizes spreadsheet formula injection (CSV Injection / Formula Injection)
 * in untrusted fields for export to spreadsheet applications (Excel, LibreOffice, Google Sheets).
 *
 * Dangerous triggers include leading '=', '+', '-', '@', '|', '%', as well as
 * control characters (\t, \r) or whitespace preceding these triggers.
 *
 * Ordinary negative or positive numbers (e.g. -5, -12.50, +42, -0.99) are safely preserved
 * without prepending single quotes to maintain numeric column semantics.
 *
 * Mitigation: Prepend single-quote (') prefix per OWASP CSV Injection guidelines.
 *
 * Supported Spreadsheet Applications:
 * - Microsoft Excel: Treats leading single-quote as a text prefix character.
 * - Google Sheets: Treats leading single-quote as plain text indicator.
 * - LibreOffice / OpenOffice Calc: Interprets leading single-quote as text formatting.
 *
 * Documented Limitation:
 * Programmatic CSV consumers (e.g. raw Node.js or Python csv readers) will read the leading
 * single-quote (') as the first character of the parsed string unless stripped downstream.
 *
 * @param {any} value - Raw field value
 * @returns {string} Sanitized string safe for CSV export
 */
export function neutralizeFormulaInjection(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);
  if (!str) return '';

  // If already neutralized with a leading single quote, do not double-prefix
  if (str.startsWith("'")) {
    return str;
  }

  // Check for leading control characters that spreadsheet engines interpret
  const hasLeadingControl = /^[\t\r\v\f]/.test(str);

  // Check trimmed content for formula trigger characters: =, @, |, %, +, -
  const trimmed = str.trimStart();
  if (trimmed.length === 0) {
    return str;
  }

  const firstChar = trimmed[0];

  // Pure numeric check for + or - prefixed values (e.g. -5, +42, -3.14159, -1e4, -10.5)
  // These are legitimate numbers and do NOT trigger formula execution in spreadsheet software.
  const isOrdinaryNumber = (firstChar === '+' || firstChar === '-') &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed.trimEnd());

  // Formula trigger characters: =, @, |, % are always neutralized, even if followed by numbers (=1+1)
  if (hasLeadingControl || firstChar === '=' || firstChar === '@' || firstChar === '|' || firstChar === '%') {
    return `'${str}`;
  }

  // For + and -, neutralize only if NOT an ordinary pure number
  if ((firstChar === '+' || firstChar === '-') && !isOrdinaryNumber) {
    return `'${str}`;
  }

  return str;
}

/**
 * Escapes a single field according to RFC 4180 specification and neutralizes spreadsheet formula injection:
 * - Neutralizes spreadsheet formula injection prefixes (=, +, -, @, |, %, control chars).
 * - Preserves ordinary negative and positive numbers without prepending quotes.
 * - If value contains a comma, double-quote, carriage return, or newline,
 *   encloses the entire field in double quotes and escapes internal double quotes by doubling them ("").
 * - Returns string representation for primitives, empty string for null/undefined.
 *
 * @param {any} value
 * @returns {string} RFC 4180 escaped field string
 */
export function escapeRFC4180Field(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const neutralized = neutralizeFormulaInjection(value);

  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return neutralized;
}

/**
 * Determines whether a gig or candidate record is approved/published.
 * Filters out pending, rejected, duplicate, or inactive records.
 *
 * @param {object} record
 * @returns {boolean}
 */
export function isApprovedOrPublished(record) {
  if (!record || typeof record !== 'object') return false;

  // Explicit duplicate flag
  if (record.is_duplicate) return false;

  // Status check: if status is provided, must be an approved/active status
  const status = (record.status || '').toLowerCase().trim();
  if (status) {
    const unapproved = ['pending_review', 'rejected', 'duplicate', 'needs_recheck', 'inactive', 'stopped'];
    if (unapproved.includes(status)) {
      return false;
    }
  }

  return true;
}

/**
 * Maps a single gig or candidate entity into the exact 19-column row array
 * in the strict column order required by the FRD data contract.
 *
 * @param {object} g - Gig or Candidate object
 * @returns {Array<string>} 19 mapped field values
 */
export function mapGigTo19ColRow(g) {
  if (!g || typeof g !== 'object') return Array(19).fill('');

  const externalId = g.external_gig_id || g.source_listing_id || (g.id ? String(g.id) : '');
  const title = normalizeHtmlToText(g.title || '');
  const trackId = g.track_id || 'M3';
  const isUnknownPay = !g.payment_amount || g.payment_amount.trim().toLowerCase() === 'unspecified' || g.payment_amount.trim() === '';
  const paymentAmount = isUnknownPay ? 'Unspecified' : g.payment_amount;
  const compensationType = g.compensation_type || (isUnknownPay ? 'unspecified' : 'hourly');
  const hasNumericPay = !isUnknownPay && (
    (g.min_amount !== undefined && g.min_amount !== null && Number(g.min_amount) > 0) ||
    (g.max_amount !== undefined && g.max_amount !== null && Number(g.max_amount) > 0)
  );
  const minAmount = hasNumericPay ? String(g.min_amount) : '';
  const maxAmount = hasNumericPay ? String(g.max_amount) : '';
  const currency = hasNumericPay ? (g.currency || 'USD') : '';
  const priority = g.priority || (g.review_priority >= 75 ? 'Featured' : 'Standard');
  const isFeatured = g.is_featured !== undefined ? String(Boolean(g.is_featured)) : (g.review_priority >= 75 ? 'true' : 'false');
  const isLocalBusiness = g.is_local_business !== undefined ? String(Boolean(g.is_local_business)) : 'false';
  const postedAt = g.posted_at || g.posted_date || '';
  const originUrl = g.origin_url || g.application_url || g.original_url || '';
  const shortDescription = normalizeHtmlToText(g.short_description || (g.description ? g.description.slice(0, 200) : ''));
  const overview = normalizeHtmlToText(g.overview || g.description || '');
  const responsibilities = normalizeHtmlToText(g.responsibilities || '');
  const deliverables = normalizeHtmlToText(g.deliverables || '');
  const requirements = normalizeHtmlToText(g.requirements || '');
  const proofSpec = normalizeHtmlToText(g.proof_spec || '');

  return [
    externalId,
    title,
    trackId,
    paymentAmount,
    compensationType,
    minAmount,
    maxAmount,
    currency,
    priority,
    isFeatured,
    isLocalBusiness,
    postedAt,
    originUrl,
    shortDescription,
    overview,
    responsibilities,
    deliverables,
    requirements,
    proofSpec
  ];
}

/**
 * Converts an array of gig or candidate records into the baseline 19-column CSV string.
 * Strictly adheres to RFC 4180 newline (\r\n) and escaping conventions.
 *
 * @param {Array<object>} gigs - Array of opportunity or candidate records
 * @param {object} [options]
 * @param {boolean} [options.filterApproved=true] - If true, only exports approved/published records
 * @returns {string} RFC 4180 CSV string
 */
export function exportGigsTo19ColCSV(gigs = [], options = {}) {
  const { filterApproved = true } = options;

  const records = Array.isArray(gigs) ? gigs : [];
  const exportable = filterApproved
    ? records.filter(isApprovedOrPublished)
    : records;

  // Enforce zero duplicates in CSV export (FRD deduplication guarantee)
  const uniqueRecords = deduplicateGigList(exportable);

  const headerLine = FRD_19_CSV_HEADERS.map(escapeRFC4180Field).join(',');
  const lines = [headerLine];

  for (const record of uniqueRecords) {
    const rowValues = mapGigTo19ColRow(record);
    const escapedRow = rowValues.map(escapeRFC4180Field).join(',');
    lines.push(escapedRow);
  }

  // RFC 4180 specifies CRLF line endings with trailing CRLF
  return lines.join('\r\n') + '\r\n';
}

/**
 * Client-side browser download trigger for CSV content.
 * Safe no-op in server / Node.js environments.
 *
 * @param {string} csvContent - Generated CSV string
 * @param {string} [filename='upshift_approved_gigs.csv']
 */
export function downloadCSV(csvContent, filename = 'upshift_approved_gigs.csv') {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
}

/**
 * RFC 4180 Compliant CSV Parser
 * Handles commas inside quotes, escaped quotes (""), multiline fields, and CRLF/LF.
 *
 * @param {string} text - Raw CSV content
 * @returns {Array<Array<string>>} Parsed rows and column values
 */
export function parseRFC4180CSV(text) {
  if (!text || typeof text !== 'string') return [];

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some(col => col.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some(col => col.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(col => col.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}
