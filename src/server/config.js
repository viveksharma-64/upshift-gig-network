/**
 * Server-Side Configuration and .env Loader
 * Safely parses .env for worker CLI and server-side components.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const ENV_FILE = path.join(ROOT_DIR, '.env');

/**
 * Loads key-value pairs from .env into process.env if not already set
 */
export function loadEnv(envPath = ENV_FILE) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Config] Notice reading .env:', err.message);
  }
}

// Automatically load on import
loadEnv();

export const config = {
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  primaryProvider: process.env.LLM_PRIMARY_PROVIDER || 'groq',
  fallbackProvider: process.env.LLM_FALLBACK_PROVIDER || 'gemini',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
};
