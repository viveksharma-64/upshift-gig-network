/**
 * LLM Service Orchestrator
 * Manages provider selection, automatic fallback, error logging, and cross-checking.
 */

import '../config.js';
import { GeminiAdapter } from './geminiAdapter.js';
import { GroqAdapter } from './groqAdapter.js';

export class LlmService {
  constructor(options = {}) {
    this.primaryName = (options.primaryProvider || process.env.LLM_PRIMARY_PROVIDER || 'gemini').toLowerCase();
    this.fallbackName = (options.fallbackProvider || process.env.LLM_FALLBACK_PROVIDER || 'groq').toLowerCase();
    this.enableSecondPass = options.enableSecondPass !== undefined ? options.enableSecondPass : true;

    this.gemini = new GeminiAdapter(options.geminiOptions || {});
    this.groq = new GroqAdapter(options.groqOptions || {});
  }

  getAdapter(name) {
    if (name === 'gemini') return this.gemini;
    if (name === 'groq') return this.groq;
    return null;
  }

  hasConfiguredProvider() {
    return this.gemini.isConfigured() || this.groq.isConfigured();
  }

  /**
   * Evaluates a listing candidate using configured primary and fallback LLMs
   * @param {object} listing
   * @returns {Promise<{ usedLlm: boolean, provider?: string, model?: string, evaluation?: object, error?: string }>}
   */
  async evaluate(listing) {
    let primaryAdapter = this.getAdapter(this.primaryName);
    let fallbackAdapter = this.getAdapter(this.fallbackName);

    // If primary is not configured but fallback is, swap them
    if (primaryAdapter && !primaryAdapter.isConfigured() && fallbackAdapter && fallbackAdapter.isConfigured()) {
      primaryAdapter = fallbackAdapter;
      fallbackAdapter = null;
    }

    // 1. If neither is configured, signal fallback to deterministic baseline
    if (!primaryAdapter || !primaryAdapter.isConfigured()) {
      return {
        usedLlm: false,
        error: 'No LLM API keys configured. Running deterministic baseline evaluation.'
      };
    }

    // 2. Try Primary Provider
    const primaryResult = await primaryAdapter.evaluateListing(listing);
    if (primaryResult.success) {
      let finalData = primaryResult.data;

      // 3. Optional Second-Pass Cross-Check if primary is uncertain and fallback is available
      if (this.enableSecondPass &&
          fallbackAdapter &&
          fallbackAdapter.isConfigured() &&
          (finalData.overall_uncertainty === 'high' || finalData.activity_status === 'uncertain')) {
        try {
          const secondResult = await fallbackAdapter.evaluateListing(listing);
          if (secondResult.success && secondResult.data.overall_uncertainty !== 'high') {
            finalData = {
              ...finalData,
              ...secondResult.data,
              activity_evidence: [
                ...finalData.activity_evidence,
                `Second-provider (${fallbackAdapter.name}) resolution: ${secondResult.data.activity_reason}`
              ]
            };
            return {
              usedLlm: true,
              provider: `${primaryAdapter.name}+${fallbackAdapter.name}`,
              model: `${primaryAdapter.model}+${fallbackAdapter.model}`,
              evaluation: finalData
            };
          }
        } catch {
          // Keep primary if second pass encounters an issue
        }
      }

      return {
        usedLlm: true,
        provider: primaryAdapter.name,
        model: primaryAdapter.model,
        evaluation: finalData
      };
    }

    // 4. Primary Failed: Try Fallback Provider
    if (fallbackAdapter && fallbackAdapter.isConfigured()) {
      const fallbackResult = await fallbackAdapter.evaluateListing(listing);
      if (fallbackResult.success) {
        return {
          usedLlm: true,
          provider: fallbackAdapter.name,
          model: fallbackAdapter.model,
          evaluation: fallbackResult.data,
          note: `Primary provider (${primaryAdapter.name}) failed: ${primaryResult.error}`
        };
      }
    }

    // 5. Both providers failed or unavailable
    return {
      usedLlm: false,
      error: `All configured LLM providers failed. Primary (${primaryAdapter.name}): ${primaryResult.error}`
    };
  }
}

export const defaultLlmService = new LlmService();
