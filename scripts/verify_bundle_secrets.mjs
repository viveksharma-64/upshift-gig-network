#!/usr/bin/env node
/**
 * Secret Scanning & Production Bundle Safety Verifier
 * Scans build artifacts to ensure no server secrets, API keys, or connection
 * strings are leaked into client-facing bundles.
 *
 * Exits with status 1 on detection. NEVER prints secret values.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_SECRET_RULES = [
  { name: 'Groq API Key', pattern: /gsk_[a-zA-Z0-9_-]{20,}/ },
  { name: 'Gemini API Key', pattern: /AQ\.[a-zA-Z0-9_-]{20,}/ },
  { name: 'Database Connection String (with credentials)', pattern: /postgres(ql)?:\/\/[^:]+:[^@]+@/i },
  { name: 'Test Sentinel', pattern: /SENTINEL_FORBIDDEN_LEAK_[A-Z0-9_]+/ }
];

/**
 * Scans a single file for secret patterns.
 * Returns only rule names without exposing secret values.
 * @param {string} filePath
 * @returns {Array<string>} list of violated rule names
 */
export function scanFileForSecrets(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  for (const rule of FORBIDDEN_SECRET_RULES) {
    if (rule.pattern.test(content)) {
      violations.push(rule.name);
    }
  }

  return violations;
}

/**
 * Recursively scans directory for bundle assets
 * @param {string} dirPath
 * @returns {Array<{ file: string, violations: Array<string> }>}
 */
export function scanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Target directory "${dirPath}" does not exist. Ensure build has run.`);
  }

  const entries = fs.readdirSync(dirPath, { recursive: true });
  const detected = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    if (fs.statSync(fullPath).isFile()) {
      // Check code and asset files
      if (entry.endsWith('.js') || entry.endsWith('.html') || entry.endsWith('.css') || entry.endsWith('.map')) {
        const violations = scanFileForSecrets(fullPath);
        if (violations.length > 0) {
          detected.push({
            file: entry,
            violations
          });
        }
      }
    }
  }

  return detected;
}

// Direct CLI execution
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const distDir = path.resolve(process.cwd(), 'dist');

  try {
    const leaks = scanDirectory(distDir);
    if (leaks.length > 0) {
      console.error(`\n❌ CRITICAL: Secret patterns detected in ${leaks.length} bundle file(s)!`);
      for (const leak of leaks) {
        console.error(`   - Leaked File: ${leak.file} (Violations: ${leak.violations.join(', ')})`);
      }
      console.error('Build verification failed. Secrets must NEVER be bundled into client code.\n');
      process.exit(1);
    } else {
      console.log('✅ PASS: Zero server secrets found in client production bundle.');
      process.exit(0);
    }
  } catch (err) {
    console.error(`❌ Verification failed: ${err.message}`);
    process.exit(1);
  }
}
