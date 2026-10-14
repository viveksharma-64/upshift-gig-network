/**
 * Public Webpage Scraper Discovery Provider
 * Extracts gig listings from configured public career pages.
 */

import { BaseDiscoveryProvider } from './baseProvider.js';
import { SOURCE_TYPE } from '../../discovery/types.js';
import { defaultFetcher } from '../fetcher.js';
import { extractGigFields } from '../scraper.js';

export class WebPageDiscoveryProvider extends BaseDiscoveryProvider {
  /**
   * @param {Array<string>} [targetUrls=[]]
   */
  constructor(targetUrls = []) {
    super('webpage_scraper', SOURCE_TYPE.WEB_SCRAPER);
    this.targetUrls = targetUrls;
  }

  async fetchCandidates(_options = {}) {
    const results = [];

    for (const url of this.targetUrls) {
      try {
        const res = await defaultFetcher.safeFetch(url);
        if (res.ok && res.text) {
          const extracted = extractGigFields(res.text, res.finalUrl);
          results.push({
            source_name: 'webpage_scraper',
            source_type: SOURCE_TYPE.WEB_SCRAPER,
            source_listing_id: res.finalUrl,
            original_url: res.finalUrl,
            canonical_url: res.finalUrl,
            ...extracted
          });
        }
      } catch (err) {
        console.warn(`[WebPageProvider] Warning scraping ${url}:`, err.message);
      }
    }

    return results;
  }
}
