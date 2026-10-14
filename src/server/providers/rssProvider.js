/**
 * Public RSS/Atom Feed Discovery Provider
 * Discovers listings from public remote job and freelance RSS feeds.
 *
 * Implements FRD v1.0 Section 10 & 26:
 * - SRC-01: Approved external data sources
 * - Genuine M1-M6 relevance filtering
 * - Strict T07 adherence: Missing posted date is never hallucinated or fabricated
 * - Authentic employer extraction from title / tags
 */

import { BaseDiscoveryProvider } from './baseProvider.js';
import { SOURCE_TYPE } from '../../discovery/types.js';
import { defaultFetcher } from '../fetcher.js';
import { extractCleanText } from '../scraper.js';
import { normalizeHtmlToText } from '../../discovery/textNormalizer.js';

export const DEFAULT_PUBLIC_RSS_FEEDS = [
  {
    name: 'weworkremotely_programming',
    url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss'
  },
  {
    name: 'weworkremotely_design',
    url: 'https://weworkremotely.com/categories/remote-design-jobs.rss'
  },
  {
    name: 'weworkremotely_copywriting',
    url: 'https://weworkremotely.com/categories/remote-copywriting-jobs.rss'
  },
  {
    name: 'weworkremotely_marketing',
    url: 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss'
  },
  {
    name: 'weworkremotely_devops',
    url: 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss'
  },
  {
    name: 'weworkremotely_product',
    url: 'https://weworkremotely.com/categories/remote-product-jobs.rss'
  },
  {
    name: 'weworkremotely_support',
    url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss'
  },
  {
    name: 'nodesk_remote',
    url: 'https://nodesk.co/remote-jobs/index.xml'
  },
  {
    name: 'dribbble_jobs',
    url: 'https://dribbble.com/jobs.rss'
  },
  {
    name: 'jobicy_rss',
    url: 'https://jobicy.com/feed/newjobs'
  }
];

const M1_M6_FILTER_REGEX = /\b(?:ai|artificial intelligence|machine learning|deep learning|llm|generative ai|prompt|video|reels|animation|animator|midjourney|flux|stable diffusion|figma|design|designer|graphics|visual|creative|illustrat|data|dataset|annotation|labeling|annotator|evaluator|evaluation|rlhf|transcription|trainer|python|javascript|typescript|react|nextjs|api|backend|frontend|fullstack|web\s*dev|developer|engineer|marketing|seo|growth|copywriting|newsletter|content|storyteller|automation|n8n|make|zapier|bot|agent|workflow)\b/i;

export class RssDiscoveryProvider extends BaseDiscoveryProvider {
  /**
   * @param {Array<{ name: string, url: string }>} [feeds]
   */
  constructor(feeds = DEFAULT_PUBLIC_RSS_FEEDS) {
    super('rss_provider', SOURCE_TYPE.RSS_FEED);
    this.feeds = feeds;
  }

  /**
   * Parses XML item elements into listing objects
   * @param {string} xmlText
   * @param {string} sourceName
   * @returns {Array<object>}
   */
  parseRssXml(xmlText, sourceName) {
    const items = [];
    // Match either <item>...</item> (RSS 2.0) or <entry>...</entry> (Atom)
    const itemRegex = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
    const matches = xmlText.match(itemRegex) || [];

    for (const rawItem of matches.slice(0, 25)) {
      // 1. Title & Company
      const titleMatch = rawItem.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      let rawTitle = titleMatch ? normalizeHtmlToText(titleMatch[1]) : '';
      let title = rawTitle;
      let organization = 'RSS Feed Employer';

      // Check for common RSS title pattern: "Company Name: Job Title" or "Job Title at Company"
      if (rawTitle.includes(':')) {
        const parts = rawTitle.split(':');
        organization = parts[0].trim();
        title = parts.slice(1).join(':').trim();
      } else if (rawTitle.includes(' at ')) {
        const parts = rawTitle.split(' at ');
        title = parts[0].trim();
        organization = parts.slice(1).join(' at ').trim();
      }

      // Explicit author / creator tags
      const authorMatch = rawItem.match(/<(?:dc:creator|author|company)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:dc:creator|author|company)>/i);
      if (authorMatch && authorMatch[1]) {
        const cleanAuthor = normalizeHtmlToText(authorMatch[1]);
        if (cleanAuthor && cleanAuthor.length < 60) {
          organization = cleanAuthor;
        }
      }

      // 2. Link
      let link = '';
      const linkMatch = rawItem.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) ||
                        rawItem.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (linkMatch) {
        link = linkMatch[1].trim();
      }

      // 3. Description / Content
      const descMatch = rawItem.match(/<(?:description|content:encoded|content|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|content:encoded|content|summary)>/i);
      const description = descMatch ? normalizeHtmlToText(descMatch[1]) : '';

      // 4. PubDate: Strict T07 adherence - if missing or unparseable, set null. Never hallucinate today's date!
      const dateMatch = rawItem.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
      let postedDate = null;
      if (dateMatch) {
        const parsedTime = Date.parse(dateMatch[1].trim());
        if (!isNaN(parsedTime)) {
          postedDate = new Date(parsedTime).toISOString().split('T')[0];
        }
      }

      // 5. GUID / Id
      const guidMatch = rawItem.match(/<(?:guid|id)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:guid|id)>/i);
      const listingId = guidMatch ? guidMatch[1].trim() : link;

      if (title && link) {
        // Prioritize relevance
        const fullText = `${title} ${description} ${organization}`;
        const isRelevant = M1_M6_FILTER_REGEX.test(fullText);

        items.push({
          source_name: sourceName,
          source_type: SOURCE_TYPE.RSS_FEED,
          source_listing_id: listingId,
          original_url: link,
          canonical_url: link,
          application_url: link,
          title,
          organization,
          description: description.slice(0, 3000),
          posted_date: postedDate,
          is_relevant: isRelevant
        });
      }
    }

    // Sort relevant opportunities first
    return items.sort((a, b) => (b.is_relevant ? 1 : 0) - (a.is_relevant ? 1 : 0));
  }

  async fetchCandidates(options = {}) {
    const candidates = [];
    const limitPerFeed = options.limitPerFeed || 10;

    for (const feed of this.feeds) {
      try {
        const res = await defaultFetcher.safeFetch(feed.url);
        if (res.ok && res.text) {
          const parsed = this.parseRssXml(res.text, feed.name);
          candidates.push(...parsed.slice(0, limitPerFeed));
        }
      } catch (err) {
        console.warn(`[RssProvider] Warning fetching ${feed.name}:`, err.message);
      }
    }

    return candidates;
  }
}
