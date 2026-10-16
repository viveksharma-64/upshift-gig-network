/**
 * Freelancer.com Discovery Provider (Documented Integration Stub)
 *
 * Capabilities & Integration Status:
 * - Endpoint: https://www.freelancer.com/api/projects/0.1/projects/active/
 * - Official Auth Requirement: Requires an OAuth2 Access Token passed via a custom header:
 *     'freelancer-oauth-v1': '<access_token>'
 *   (Standard HTTP Bearer headers return 401 Unauthorized per Freelancer API specification).
 * - Public Unauthenticated Search: NOT supported by Freelancer API.
 * - Integration Policy: In accordance with project instructions, this provider is maintained
 *   as an optional, compliant integration stub. It activates ONLY when process.env.FREELANCER_OAUTH_TOKEN
 *   is configured and is NOT registered in the default public provider list.
 */

import { BaseDiscoveryProvider } from './baseProvider.js';
import { SOURCE_TYPE } from '../../discovery/types.js';
import { defaultFetcher } from '../fetcher.js';
import { extractCleanText } from '../scraper.js';
import { normalizeCanonicalUrl } from '../deduplication.js';
import { LINK_TYPE, LINK_STATUS } from '../../discovery/urlClassifier.js';

export class FreelancerDiscoveryProvider extends BaseDiscoveryProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.oauthToken]
   * @param {string} [options.endpoint]
   */
  constructor(options = {}) {
    super('freelancer', SOURCE_TYPE.PUBLIC_API);
    this.oauthToken = options.oauthToken || (typeof process !== 'undefined' ? process.env?.FREELANCER_OAUTH_TOKEN : '') || '';
    this.endpoint = options.endpoint || 'https://www.freelancer.com/api/projects/0.1/projects/active/';
    this.timeoutMs = options.timeoutMs || 8000;
  }

  isConfigured() {
    return Boolean(this.oauthToken && typeof this.oauthToken === 'string' && this.oauthToken.trim().length > 0);
  }

  /**
   * Normalizes a Freelancer project into UpShift candidate schema
   * @param {object} project
   * @returns {object}
   */
  normalizeProject(project) {
    const title = (project.title || '').trim();
    const description = extractCleanText(project.preview_description || project.description || '');
    const seoUrl = project.seo_url || `projects/${project.id}`;
    const opportunityUrl = `https://www.freelancer.com/projects/${seoUrl}`;
    const canonicalUrl = normalizeCanonicalUrl(opportunityUrl);

    let paymentAmount = 'Unspecified';
    let minAmount = 0;
    let maxAmount = 0;
    let currency = 'USD';

    if (project.budget) {
      minAmount = project.budget.minimum || 0;
      maxAmount = project.budget.maximum || 0;
      currency = project.currency?.code || 'USD';
      paymentAmount = `${minAmount} - ${maxAmount} ${currency}`;
    }

    let postedDate = null;
    if (project.submitdate) {
      const epochMs = project.submitdate * 1000;
      postedDate = new Date(epochMs).toISOString().split('T')[0];
    }

    const isHourly = project.type === 'hourly';

    return {
      source_name: 'freelancer',
      source_type: SOURCE_TYPE.PUBLIC_API,
      source_listing_id: String(project.id),
      original_url: opportunityUrl,
      canonical_url: canonicalUrl,
      opportunity_url: opportunityUrl,
      application_url: opportunityUrl, // Bidding requires Freelancer authentication
      source_url: 'https://www.freelancer.com',
      resolved_url: opportunityUrl,
      title,
      organization: 'Freelancer Client',
      description,
      location: 'Remote',
      work_arrangement: 'remote',
      posted_date: postedDate,
      payment_amount: paymentAmount,
      min_amount: minAmount,
      max_amount: maxAmount,
      currency,
      compensation_type: isHourly ? 'hourly' : 'project',
      link_type: LINK_TYPE.PLATFORM_LOGIN_REQUIRED,
      link_status: LINK_STATUS.VERIFIED,
      is_gig: true,
      gig_type: isHourly ? 'contract' : 'freelance'
    };
  }

  /**
   * Discovers candidate listings from Freelancer.com
   * @param {object} [options]
   * @returns {Promise<Array<object>>}
   */
  async fetchCandidates(options = {}) {
    if (!this.isConfigured()) {
      console.log('[FreelancerDiscoveryProvider] FREELANCER_OAUTH_TOKEN not configured. Skipping Freelancer discovery.');
      return [];
    }

    const limit = options.limit || 15;
    const url = new URL(this.endpoint);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('compact', 'false');
    url.searchParams.set('project_types[]', 'fixed');
    url.searchParams.set('project_types[]', 'hourly');

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      // Freelancer official specification requires custom 'freelancer-oauth-v1' header
      const res = await defaultFetcher.safeFetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'freelancer-oauth-v1': this.oauthToken
        }
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[FreelancerDiscoveryProvider] API responded with HTTP ${res.status}`);
        return [];
      }

      const data = typeof res.json === 'object' && res.json !== null
        ? res.json
        : (res.text ? JSON.parse(res.text) : {});

      const projects = data?.result?.projects || [];
      return projects.map(p => this.normalizeProject(p));
    } catch (err) {
      console.warn(`[FreelancerDiscoveryProvider] Error querying projects: ${err.message}`);
      return [];
    }
  }
}
