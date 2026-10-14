/**
 * Google Gemini REST API Adapter
 * Strictly server-side; accesses Gemini using GEMINI_API_KEY.
 */

import { BaseLlmAdapter } from './baseAdapter.js';

export class GeminiAdapter extends BaseLlmAdapter {
  constructor(options = {}) {
    super('gemini');
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GEMINI_API_KEY || '');
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
    this.timeoutMs = options.timeoutMs || 15000;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 8);
  }

  /**
   * Calls Gemini to evaluate a gig listing
   * @param {object} listing
   * @returns {Promise<{ success: boolean, data?: object, rawText?: string, error?: string }>}
   */
  async evaluateListing(listing) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Gemini API key is not configured.' };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const userPrompt = this.formatUserPrompt(listing);
    const systemPrompt = this.getSystemInstruction();

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 1024
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Gemini API returned status ${response.status}: ${errorText.slice(0, 200)}`
        };
      }

      const resJson = await response.json();
      const candidateText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsedJson = this.extractJson(candidateText);

      if (!parsedJson) {
        return {
          success: false,
          rawText: candidateText,
          error: 'Failed to extract valid JSON from Gemini output'
        };
      }

      const validated = this.validateSchema(parsedJson);
      if (!validated.valid) {
        return {
          success: false,
          rawText: candidateText,
          error: `Gemini schema validation failed: ${validated.error}`
        };
      }

      return {
        success: true,
        data: validated.data,
        rawText: candidateText
      };

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError' || controller.signal.aborted;
      return {
        success: false,
        error: isAbort ? `Gemini request timed out after ${this.timeoutMs}ms` : err.message
      };
    }
  }
}
