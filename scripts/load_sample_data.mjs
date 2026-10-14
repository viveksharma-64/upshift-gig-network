/**
 * Loader & Batch Verifier for Sample Records
 *
 * Implements FRD Section 23, 27, 34: Loads and exercises 100-200 record batches.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGigsTo19ColCSV, parseRFC4180CSV, FRD_19_CSV_HEADERS } from '../src/discovery/csvExport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_FILE = path.resolve(__dirname, '../data/sample_gigs_150.json');
const TARGET_CANDIDATES_FILE = path.resolve(__dirname, '../data/candidates.json');
const EXPORT_CSV_FILE = path.resolve(__dirname, '../data/sample_export_150.csv');

async function runBatchVerification() {
  console.info('[BatchLoader] Reading 150 sample candidate listings...');
  const raw = await fs.readFile(SAMPLE_FILE, 'utf8');
  const records = JSON.parse(raw);

  if (!Array.isArray(records) || records.length < 100) {
    throw new Error(`Expected at least 100 records, got ${records?.length}`);
  }

  console.info(`[BatchLoader] Successfully loaded ${records.length} sample records.`);

  // 1. Verify module distribution
  const distribution = {};
  for (const r of records) {
    distribution[r.track_id] = (distribution[r.track_id] || 0) + 1;
  }
  console.info('[BatchLoader] Track Distribution:', distribution);

  // 2. Exercise 19-column CSV export on approved records
  const approved = records.filter(r => r.status === 'approved');
  console.info(`[BatchLoader] Exporting ${approved.length} approved records to 19-col CSV...`);

  const t0 = performance.now();
  const csvContent = exportGigsTo19ColCSV(approved, { filterApproved: true });
  const duration = performance.now() - t0;

  console.info(`[BatchLoader] CSV Generated in ${duration.toFixed(2)}ms (${csvContent.length} bytes).`);

  // 3. Parse and validate RFC 4180 structure
  const parsedRows = parseRFC4180CSV(csvContent);
  const headerRow = parsedRows[0];

  console.info(`[BatchLoader] Parsed ${parsedRows.length} total CSV rows (1 header + ${parsedRows.length - 1} data rows).`);

  // Check headers
  for (let c = 0; c < FRD_19_CSV_HEADERS.length; c++) {
    if (headerRow[c] !== FRD_19_CSV_HEADERS[c]) {
      throw new Error(`Header mismatch at col ${c}: expected ${FRD_19_CSV_HEADERS[c]}, got ${headerRow[c]}`);
    }
  }

  // Check each data row has exactly 19 columns
  for (let i = 1; i < parsedRows.length; i++) {
    if (parsedRows[i].length !== 19) {
      throw new Error(`Row ${i} column count error: expected 19, got ${parsedRows[i].length}`);
    }
  }

  await fs.writeFile(EXPORT_CSV_FILE, csvContent, 'utf8');
  console.info(`[BatchLoader] Verified CSV written to ${EXPORT_CSV_FILE}`);
  console.info('✅ 150-record batch verification PASSED.');
}

runBatchVerification().catch(err => {
  console.error('Batch verification failed:', err);
  process.exit(1);
});
