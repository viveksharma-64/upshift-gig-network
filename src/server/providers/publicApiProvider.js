/**
 * Public Remote Jobs API Discovery Provider
 * Integrates documented zero-cost public APIs (Remotive, Arbeitnow, Jobicy, Working Nomads, RemoteOK, Himalayas).
 *
 * Provider Terms of Use & Compliance:
 * 1. Remotive (remotive.com):
 *    - Free public API (no credentials required).
 *    - Terms require source attribution ("Remotive") and linking directly to the original listing URL.
 *    - Strictly prohibits using the API to harvest candidate email addresses or gatekeeping listings behind proprietary signups.
 * 2. Arbeitnow (arbeitnow.com):
 *    - Creative Commons / open job board API (no credentials required).
 *    - Requires preserving original listing URL and employer attribution.
 * 3. Jobicy (jobicy.com):
 *    - Free public JSON API. Permitted for job discovery; requires linking to Jobicy listing.
 * 4. Working Nomads (workingnomads.com):
 *    - Free exposed JSON API with direct application links where provided.
 * 5. RemoteOK (remoteok.com):
 *    - Free public API. Rate limit: 1 request/min recommended cache. Requires backlink attribution.
 * 6. Himalayas (himalayas.app):
 *    - Free public API. Requires direct links and company attribution.
 *
 * Implements FRD v1.0 Section 10 & 26:
 * - SRC-01: Approved zero-cost external data sources
 * - Genuine M1-M6 relevance filtering
 * - Strict T07 adherence: Missing posted date is never hallucinated or fabricated
 * - Authentic URL mapping: opportunity_url, application_url, source_url (never fabricated)
 */

import { BaseDiscoveryProvider } from './baseProvider.js';
import { SOURCE_TYPE } from '../../discovery/types.js';
import { defaultFetcher } from '../fetcher.js';
import { extractCleanText } from '../scraper.js';

// Keywords that indicate relevance to UpShift's M1-M6 tracks
const M1_M6_FILTER_REGEX = /\b(?:ai|artificial intelligence|machine learning|deep learning|llm|generative ai|prompt|video|reels|animation|animator|midjourney|flux|stable diffusion|figma|design|designer|graphics|visual|creative|illustrat|data|dataset|annotation|labeling|annotator|evaluator|evaluation|rlhf|transcription|trainer|python|javascript|typescript|react|nextjs|api|backend|frontend|fullstack|web\s*dev|developer|engineer|marketing|seo|growth|copywriting|newsletter|content|storyteller|automation|n8n|make|zapier|bot|agent|workflow)\b/i;

export class PublicApiDiscoveryProvider extends BaseDiscoveryProvider {
  constructor(options = {}) {
    super('public_api_provider', SOURCE_TYPE.PUBLIC_API);
    this.remotiveEndpoint = options.remotiveEndpoint || 'https://remotive.com/api/remote-jobs';
    this.arbeitnowEndpoint = options.arbeitnowEndpoint || 'https://www.arbeitnow.com/api/job-board-api';
    this.jobicyEndpoint = options.jobicyEndpoint || 'https://jobicy.com/api/v2/remote-jobs';
    this.workingNomadsEndpoint = options.workingNomadsEndpoint || 'https://www.workingnomads.com/api/exposed_jobs/';
    this.remoteOkEndpoint = options.remoteOkEndpoint || 'https://remoteok.com/api';
    this.himalayasEndpoint = options.himalayasEndpoint || 'https://himalayas.app/jobs/api';
  }

  /**
   * Fetches listings from Remotive API
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async fetchRemotive(limit = 10) {
    try {
      const endpoint = `${this.remotiveEndpoint}?limit=${Math.max(limit * 3, 20)}`;
      const res = await defaultFetcher.safeFetch(endpoint);
      if (!res.ok || !res.text) return [];

      const parsed = JSON.parse(res.text);
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];

      // Prioritize jobs relevant to M1-M6
      const relevant = jobs.filter(j => {
        const text = `${j.title || ''} ${j.category || ''} ${(j.tags || []).join(' ')} ${j.description || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      // Group by category to ensure tracks M1-M6 aren't crowded out by only 1 category
      const targetPool = [];
      const seenIds = new Set();
      const byCat = new Map();
      for (const j of relevant) {
        const cat = j.category || 'general';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(j);
      }

      // Round-robin pick from categories
      let added = true;
      let round = 0;
      while (targetPool.length < limit && added) {
        added = false;
        for (const [_, list] of byCat) {
          if (round < list.length && targetPool.length < limit) {
            const item = list[round];
            const id = String(item.id || item.url);
            if (!seenIds.has(id)) {
              seenIds.add(id);
              targetPool.push(item);
              added = true;
            }
          }
        }
        round++;
      }

      const pool = targetPool.length > 0 ? targetPool : (relevant.length > 0 ? relevant : jobs);

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        const rawDate = job.publication_date || job.publication_time;
        if (rawDate) {
          const parsedTime = Date.parse(rawDate);
          if (!isNaN(parsedTime)) {
            postedDate = new Date(parsedTime).toISOString().split('T')[0];
          }
        }

        return {
          source_name: 'remotive',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.id || job.url),
          original_url: job.url || '',
          canonical_url: job.url || '',
          application_url: job.url || '',
          title: job.title || '',
          organization: job.company_name || 'Remotive Partner',
          description: extractCleanText(job.description || ''),
          payment_amount: job.salary || 'Unspecified',
          location: job.candidate_required_location || 'Remote',
          work_arrangement: 'remote',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches listings from Arbeitnow API
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async fetchArbeitnow(limit = 10) {
    try {
      const res = await defaultFetcher.safeFetch(this.arbeitnowEndpoint);
      if (!res.ok || !res.text) return [];

      const parsed = JSON.parse(res.text);
      const jobs = Array.isArray(parsed.data) ? parsed.data : [];

      // Filter for remote and M1-M6 relevant jobs across all available records
      const relevant = jobs.filter(j => {
        const text = `${j.title || ''} ${(j.tags || []).join(' ')} ${j.description || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      const pool = relevant.length > 0 ? relevant : jobs;

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        if (job.created_at) {
          const epochMs = typeof job.created_at === 'number' && job.created_at < 1e11
            ? job.created_at * 1000
            : Number(job.created_at);
          if (!isNaN(epochMs) && epochMs > 0) {
            postedDate = new Date(epochMs).toISOString().split('T')[0];
          }
        }

        return {
          source_name: 'arbeitnow',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.slug || job.url),
          original_url: job.url || '',
          canonical_url: job.url || '',
          application_url: job.url || '',
          title: job.title || '',
          organization: job.company_name || 'Arbeitnow Partner',
          description: extractCleanText(job.description || ''),
          payment_amount: 'Unspecified',
          location: job.location || 'Remote',
          work_arrangement: job.remote ? 'remote' : 'hybrid',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches listings from Jobicy Public API
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async fetchJobicy(limit = 15) {
    try {
      const targetIndustries = ['design-multimedia', 'data-science', 'copywriting', 'marketing', 'engineering', 'supporting'];
      const perIndustry = Math.max(2, Math.ceil(limit / targetIndustries.length));

      const responses = await Promise.all(
        targetIndustries.map(ind =>
          defaultFetcher.safeFetch(`${this.jobicyEndpoint}?industry=${ind}&count=${perIndustry}`)
        )
      );

      const allJobs = [];
      const seenIds = new Set();

      for (const res of responses) {
        if (!res.ok || !res.text) continue;
        try {
          const parsed = JSON.parse(res.text);
          const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
          for (const j of jobs) {
            const key = String(j.id || j.url);
            if (key && !seenIds.has(key)) {
              seenIds.add(key);
              allJobs.push(j);
            }
          }
        } catch {}
      }

      const relevant = allJobs.filter(j => {
        const text = `${j.jobTitle || ''} ${(j.jobIndustry || []).join(' ')} ${j.jobDescription || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      const pool = relevant.length > 0 ? relevant : allJobs;

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        if (job.pubDate) {
          const parsedTime = Date.parse(job.pubDate);
          if (!isNaN(parsedTime)) {
            postedDate = new Date(parsedTime).toISOString().split('T')[0];
          }
        }

        return {
          source_name: 'jobicy',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.id || job.url),
          original_url: job.url || '',
          canonical_url: job.url || '',
          application_url: job.url || '',
          title: job.jobTitle || '',
          organization: job.companyName || 'Jobicy Partner',
          description: extractCleanText(job.jobDescription || ''),
          payment_amount: job.annualSalaryMin && job.annualSalaryMax
            ? `$${job.annualSalaryMin} - $${job.annualSalaryMax} / year`
            : 'Unspecified',
          min_amount: job.annualSalaryMin ? parseFloat(job.annualSalaryMin) : 0,
          max_amount: job.annualSalaryMax ? parseFloat(job.annualSalaryMax) : 0,
          currency: job.salaryCurrency || 'USD',
          compensation_type: job.annualSalaryMin ? 'annual' : 'hourly',
          location: job.jobGeo || 'Remote',
          work_arrangement: 'remote',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches listings from Working Nomads Public API
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async fetchWorkingNomads(limit = 15) {
    try {
      const res = await defaultFetcher.safeFetch(this.workingNomadsEndpoint);
      if (!res.ok || !res.text) return [];

      const parsed = JSON.parse(res.text);
      const jobs = Array.isArray(parsed) ? parsed : [];

      const relevant = jobs.filter(j => {
        const tagText = Array.isArray(j.tags) ? j.tags.join(' ') : String(j.tags || '');
        const text = `${j.title || ''} ${j.category_name || ''} ${tagText} ${j.description || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      const pool = relevant.length > 0 ? relevant : jobs;

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        const rawDate = job.pub_date || job.created_at;
        if (rawDate) {
          const parsedTime = Date.parse(rawDate);
          if (!isNaN(parsedTime)) {
            postedDate = new Date(parsedTime).toISOString().split('T')[0];
          }
        }

        return {
          source_name: 'working_nomads',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.id || job.url),
          original_url: job.url || '',
          canonical_url: job.url || '',
          application_url: job.apply_url || job.url || '',
          title: job.title || '',
          organization: job.company_name || 'Working Nomads Partner',
          description: extractCleanText(job.description || ''),
          payment_amount: job.salary || 'Unspecified',
          location: job.location || 'Remote',
          work_arrangement: 'remote',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches listings from RemoteOK Public API with multi-track tag coverage
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async fetchRemoteOk(limit = 15) {
    try {
      const tags = ['ai', 'video', 'design', 'writing', 'automation'];
      const responses = await Promise.all([
        defaultFetcher.safeFetch(this.remoteOkEndpoint),
        ...tags.map(tag => defaultFetcher.safeFetch(`${this.remoteOkEndpoint}?tag=${tag}`))
      ]);

      const allJobs = [];
      const seenIds = new Set();

      for (const res of responses) {
        if (!res.ok || !res.text) continue;
        try {
          const parsed = JSON.parse(res.text);
          const list = Array.isArray(parsed) ? parsed.slice(1) : [];
          for (const j of list) {
            const id = String(j.id || j.url);
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              allJobs.push(j);
            }
          }
        } catch {}
      }

      const relevant = allJobs.filter(j => {
        const tagText = Array.isArray(j.tags) ? j.tags.join(' ') : String(j.tags || '');
        const text = `${j.position || ''} ${tagText} ${j.description || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      const pool = relevant.length > 0 ? relevant : allJobs;

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        if (job.date) {
          const parsedTime = Date.parse(job.date);
          if (!isNaN(parsedTime)) {
            postedDate = new Date(parsedTime).toISOString().split('T')[0];
          }
        }

        let payment_amount = 'Unspecified';
        let min_amount = 0;
        let max_amount = 0;
        if (job.salary_min && job.salary_max) {
          payment_amount = `$${job.salary_min} - $${job.salary_max} / year`;
          min_amount = parseFloat(job.salary_min) || 0;
          max_amount = parseFloat(job.salary_max) || 0;
        }

        return {
          source_name: 'remoteok',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.id || job.url),
          original_url: job.url || '',
          canonical_url: job.url || '',
          application_url: job.apply_url || job.url || '',
          title: job.position || '',
          organization: job.company || 'RemoteOK Partner',
          description: extractCleanText(job.description || ''),
          payment_amount,
          min_amount,
          max_amount,
          currency: 'USD',
          compensation_type: min_amount >= 5000 ? 'annual' : 'hourly',
          location: job.location || 'Remote',
          work_arrangement: 'remote',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetches listings from Himalayas Remote Jobs Public API
   * @param {number|object} [limitOrFetcher=10]
   * @param {object|number} [optionalFetcher=null]
   * @returns {Promise<Array<object>>}
   */
  async fetchHimalayas(limitOrFetcher = 10, optionalFetcher = null) {
    let limit = 10;
    let fetcher = defaultFetcher;
    if (typeof limitOrFetcher === 'number') {
      limit = limitOrFetcher;
      if (optionalFetcher) fetcher = optionalFetcher;
    } else if (limitOrFetcher && typeof limitOrFetcher === 'object') {
      fetcher = limitOrFetcher;
      if (typeof optionalFetcher === 'number') limit = optionalFetcher;
    }

    try {
      const endpoint = `${this.himalayasEndpoint}?limit=${Math.max(limit * 3, 30)}`;
      const res = await fetcher.safeFetch(endpoint);
      if (!res.ok || (!res.text && !res.json)) return [];

      const parsed = res.json || (res.text ? JSON.parse(res.text) : {});
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];

      const relevant = jobs.filter(j => {
        const cats = Array.isArray(j.categories) ? j.categories.join(' ') : '';
        const text = `${j.title || ''} ${cats} ${j.excerpt || ''} ${j.description || ''}`;
        return M1_M6_FILTER_REGEX.test(text);
      });

      const pool = relevant.length > 0 ? relevant : jobs;

      return pool.slice(0, limit).map(job => {
        let postedDate = null;
        if (job.pubDate) {
          const epochMs = typeof job.pubDate === 'number' && job.pubDate < 1e11
            ? job.pubDate * 1000
            : Number(job.pubDate);
          if (!isNaN(epochMs) && epochMs > 0) {
            postedDate = new Date(epochMs).toISOString().split('T')[0];
          }
        }

        let payment_amount = 'Unspecified';
        let min_amount = 0;
        let max_amount = 0;
        if (job.minSalary && job.maxSalary) {
          const cur = job.currency || 'USD';
          payment_amount = `${job.minSalary} - ${job.maxSalary} ${cur}`;
          min_amount = parseFloat(job.minSalary) || 0;
          max_amount = parseFloat(job.maxSalary) || 0;
        }

        return {
          source_name: 'himalayas',
          source_type: SOURCE_TYPE.PUBLIC_API,
          source_listing_id: String(job.guid || job.applicationLink || job.title),
          original_url: job.applicationLink || '',
          canonical_url: job.applicationLink || '',
          application_url: job.applicationLink || '',
          title: job.title || '',
          organization: job.companyName || 'Himalayas Partner',
          description: extractCleanText(job.description || job.excerpt || ''),
          payment_amount,
          min_amount,
          max_amount,
          currency: job.currency || 'USD',
          compensation_type: min_amount >= 5000 ? 'annual' : 'hourly',
          location: Array.isArray(job.locationRestrictions) && job.locationRestrictions.length > 0
            ? job.locationRestrictions.join(', ')
            : 'Remote',
          work_arrangement: 'remote',
          posted_date: postedDate
        };
      });
    } catch {
      return [];
    }
  }

  async fetchCandidates(options = {}) {
    const limit = options.limit || 30;
    const perSource = Math.max(3, Math.ceil(limit / 6));

    const [remotiveJobs, arbeitnowJobs, jobicyJobs, workingNomadsJobs, remoteOkJobs, himalayasJobs] = await Promise.all([
      this.fetchRemotive(perSource),
      this.fetchArbeitnow(perSource),
      this.fetchJobicy(perSource),
      this.fetchWorkingNomads(perSource),
      this.fetchRemoteOk(perSource),
      this.fetchHimalayas(perSource)
    ]);

    return [...remotiveJobs, ...arbeitnowJobs, ...jobicyJobs, ...workingNomadsJobs, ...remoteOkJobs, ...himalayasJobs].slice(0, limit);
  }
}
