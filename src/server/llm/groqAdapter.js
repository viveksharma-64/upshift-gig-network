/**
 * Groq REST API Adapter
 * Strictly server-side; accesses Groq using GROQ_API_KEY.
 */

import { BaseLlmAdapter } from './baseAdapter.js';

export class GroqAdapter extends BaseLlmAdapter {
  constructor(options = {}) {
    super('groq');
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GROQ_API_KEY || '');
    this.model = options.model || process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    this.timeoutMs = options.timeoutMs || 15000;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 8);
  }

  /**
   * Calls Groq to evaluate a gig listing
   * @param {object} listing
   * @returns {Promise<{ success: boolean, data?: object, rawText?: string, error?: string }>}
   */
  async evaluateListing(listing) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Groq API key is not configured.' };
    }

    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const userPrompt = this.formatUserPrompt(listing);
    const systemPrompt = this.getSystemInstruction();

    const requestBody = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1024
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Groq API returned status ${response.status}: ${errorText.slice(0, 200)}`
        };
      }

      const resJson = await response.json();
      const content = resJson?.choices?.[0]?.message?.content || '';
      const parsedJson = this.extractJson(content);

      if (!parsedJson) {
        return {
          success: false,
          rawText: content,
          error: 'Failed to extract valid JSON from Groq output'
        };
      }

      const validated = this.validateSchema(parsedJson);
      if (!validated.valid) {
        return {
          success: false,
          rawText: content,
          error: `Groq schema validation failed: ${validated.error}`
        };
      }

      return {
        success: true,
        data: validated.data,
        rawText: content
      };

    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError' || controller.signal.aborted;
      return {
        success: false,
        error: isAbort ? `Groq request timed out after ${this.timeoutMs}ms` : err.message
      };
    }
  }
}
