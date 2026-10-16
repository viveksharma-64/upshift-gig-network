/**
 * End-to-End Gig Discovery Pipeline
 * Orchestrates Discovery -> Fetching -> Extraction -> Deduplication ->
 * Activity Verification -> M1-M6 Classification -> Scoring -> Ingestion.
 */

import { createCandidate, CANDIDATE_STATUS, ACTIVITY_STATUS } from '../discovery/types.js';
import { normalizeCandidateTextFields } from '../discovery/textNormalizer.js';
import { extractGigFields } from './scraper.js';
import { findDuplicate, normalizeCanonicalUrl, mergeCandidateProvenance } from './deduplication.js';
import { verifyGigActivity } from './activityVerifier.js';
import { classifyListingModules } from './moduleClassifier.js';
import { calculateDataCompleteness, calculateSourceReliability, calculateReviewPriority } from './scoring.js';
import { defaultLlmService } from './llm/llmService.js';
import { defaultCandidateRepository, getServerSupabaseClient } from './candidateRepository.js';
import { evaluateGigRelevance } from './gigClassifier.js';
import { analyzeUrlStructure, LINK_TYPE, LINK_STATUS } from '../discovery/urlClassifier.js';

import { FixtureDiscoveryProvider } from './providers/fixtureProvider.js';
import { RssDiscoveryProvider } from './providers/rssProvider.js';
import { PublicApiDiscoveryProvider } from './providers/publicApiProvider.js';
import { WebPageDiscoveryProvider } from './providers/webPageProvider.js';
import { FreelancerDiscoveryProvider } from './providers/freelancerProvider.js';

export class DiscoveryPipeline {
  constructor(options = {}) {
    this.repository = options.repository || defaultCandidateRepository;
    this.llmService = options.llmService !== undefined ? options.llmService : defaultLlmService;

    // Configure enabled providers (production defaults: verified free public APIs and RSS feeds)
    const defaultProviders = [
      new PublicApiDiscoveryProvider(),
      new RssDiscoveryProvider(),
      new WebPageDiscoveryProvider()
    ];
    // Documented marketplace integration stub (only active if explicit OAuth token is configured)
    if (typeof process !== 'undefined' && process.env?.FREELANCER_OAUTH_TOKEN) {
      defaultProviders.push(new FreelancerDiscoveryProvider());
    }

    this.providers = options.providers || defaultProviders;
  }

  /**
   * Processes a single raw listing into a fully scored, normalized candidate
   * @param {object} rawListing
   * @param {Array<object>} existingCandidates
   * @returns {Promise<object>} normalized Candidate
   */
  async processListing(rawListing, existingCandidates = []) {
    // 1. Text extraction and field sanitization
    const extracted = rawListing.description && !rawListing.responsibilities
      ? extractGigFields(rawListing.description, rawListing.original_url)
      : {};

    const rawUrl = rawListing.original_url || rawListing.url || rawListing.link || rawListing.canonical_url || '';
    const canonicalUrl = normalizeCanonicalUrl(rawListing.canonical_url || rawUrl);
    const opportunityUrl = rawListing.opportunity_url || canonicalUrl || rawUrl;
    const sourceUrl = rawListing.source_url || rawListing.source_feed || rawListing.source_endpoint || rawUrl;

    // Direct application URL: only set if explicitly provided or cleanly extracted; never guess by appending /apply
    const applicationUrl = (rawListing.application_url && rawListing.application_url !== rawUrl && rawListing.application_url !== opportunityUrl)
      ? rawListing.application_url
      : (extracted.application_url && extracted.application_url !== rawUrl && extracted.application_url !== opportunityUrl ? extracted.application_url : '');

    // Analyze URL structure (detect homepages, search results, or task platforms)
    const oppStructure = analyzeUrlStructure(opportunityUrl);
    let initialLinkType = LINK_TYPE.OPPORTUNITY_PAGE;
    let initialLinkStatus = LINK_STATUS.VERIFIED;
    const linkEvidence = [];

    if (oppStructure.isHomepage) {
      initialLinkType = LINK_TYPE.UNVERIFIED;
      initialLinkStatus = LINK_STATUS.FAILED;
      linkEvidence.push(`URL points to root/homepage (${opportunityUrl}) rather than a specific listing.`);
    } else if (oppStructure.isSearchPage) {
      initialLinkType = LINK_TYPE.UNVERIFIED;
      initialLinkStatus = LINK_STATUS.FAILED;
      linkEvidence.push(`URL points to general job search or category directory (${opportunityUrl}) rather than a specific listing.`);
    } else if (oppStructure.isKnownTaskPlatform) {
      initialLinkType = LINK_TYPE.PLATFORM_LOGIN_REQUIRED;
      linkEvidence.push(`Host is a verified task/gig platform (${oppStructure.platformName}); authentication required before task acceptance.`);
    } else if (applicationUrl && applicationUrl !== opportunityUrl) {
      initialLinkType = LINK_TYPE.DIRECT_APPLY;
      linkEvidence.push(`Distinct application endpoint available: ${applicationUrl}`);
    } else {
      linkEvidence.push('Specific opportunity details page identified.');
    }

    const merged = normalizeCandidateTextFields({
      ...extracted,
      ...rawListing,
      title: rawListing.title || extracted.title || 'Untitled Opportunity',
      organization: rawListing.organization || extracted.organization || 'Undisclosed Organization',
      description: rawListing.description || extracted.description || '',
      canonical_url: canonicalUrl,
      opportunity_url: opportunityUrl,
      source_url: sourceUrl,
      application_url: applicationUrl,
      original_url: rawUrl,
      resolved_url: opportunityUrl,
      link_type: rawListing.link_type || initialLinkType,
      link_status: rawListing.link_status || initialLinkStatus,
      link_evidence: linkEvidence
    });

    // 2. Check for Duplicates
    const duplicateCheck = findDuplicate(merged, existingCandidates);

    // 3. Activity Verification (Rule-Based Baseline)
    const activity = verifyGigActivity({
      httpStatus: rawListing.http_status || 200,
      content: `${merged.title} ${merged.description} ${merged.responsibilities || ''}`,
      postedDate: merged.posted_date,
      deadline: merged.deadline,
      applicationUrl: merged.application_url
    });

    // 4. M1-M6 Classification (Deterministic Baseline)
    const classification = classifyListingModules({
      title: merged.title,
      description: merged.description,
      responsibilities: merged.responsibilities,
      requirements: merged.requirements
    });

    let finalActivity = activity;
    let finalClassification = classification;
    let llmMeta = null;

    // 5. LLM Evaluation (if API keys are configured)
    if (this.llmService?.hasConfiguredProvider?.()) {
      try {
        const llmResult = await this.llmService.evaluate(merged);
        if (llmResult.usedLlm && llmResult.evaluation) {
          const evalData = llmResult.evaluation;
          llmMeta = {
            provider: llmResult.provider,
            model: llmResult.model,
            evaluation: evalData
          };

          // Blend LLM findings with rule-based baseline
          finalActivity = {
            activity_status: evalData.activity_status,
            activity_confidence: Math.round((activity.activity_confidence + evalData.activity_confidence) / 2),
            activity_evidence: [
              ...activity.activity_evidence,
              `AI Analysis (${llmResult.provider}): ${evalData.activity_reason}`
            ],
            activity_reason: evalData.activity_reason
          };

          if (Array.isArray(evalData.matched_modules) && evalData.matched_modules.length > 0) {
            const primaryTrack = evalData.matched_modules[0];
            const primaryScore = evalData.module_fit_scores?.[primaryTrack] !== undefined
              ? evalData.module_fit_scores[primaryTrack]
              : classification.primary_fit_score;

            const isRelevant = primaryScore >= 20 && evalData.recommended_action !== 'reject_candidate';
            const secondTrack = evalData.matched_modules[1];
            const secondScore = secondTrack ? (evalData.module_fit_scores?.[secondTrack] || 0) : 0;
            const hasConflict = evalData.matched_modules.length >= 2 || (secondTrack && secondScore >= 25 && (primaryScore - secondScore) <= 20);

            finalClassification = {
              track_id: primaryTrack,
              matched_modules: evalData.matched_modules,
              module_fit_scores: {
                ...classification.module_fit_scores,
                ...evalData.module_fit_scores
              },
              module_evidence: evalData.module_evidence || classification.module_evidence,
              primary_fit_score: primaryScore,
              is_relevant: isRelevant,
              confidence_tier: !isRelevant ? 'none' : (hasConflict ? 'low' : (primaryScore >= 70 ? 'high' : (primaryScore >= 40 ? 'moderate' : 'low'))),
              has_conflict: hasConflict,
              conflicting_tracks: hasConflict ? [primaryTrack, secondTrack].filter(Boolean) : [],
              classification_reason: isRelevant
                ? `AI LLM verified match on track ${primaryTrack} (${primaryScore} pts).`
                : `AI LLM evaluated: Opportunity lacks sufficient alignment with UpShift tracks (${primaryScore} pts).`
            };
          } else {
            finalClassification = {
              ...classification,
              is_relevant: false,
              confidence_tier: 'none',
              classification_reason: 'AI LLM determined listing does not align with any UpShift tracks (M1-M6).'
            };
          }
        }
      } catch (err) {
        console.warn('[DiscoveryPipeline] LLM evaluation fallback notice:', err.message);
      }
    }

    // 6. Transparent Scoring Metrics (0 - 100)
    const completeness = calculateDataCompleteness(merged);
    const reliability = calculateSourceReliability(merged.source_type, merged.source_name);
    const priority = calculateReviewPriority({
      activity_confidence: finalActivity.activity_confidence,
      module_fit_score: finalClassification.primary_fit_score,
      source_reliability: reliability,
      data_completeness: completeness.score,
      activity_status: finalActivity.activity_status,
      prompt_injection_detected: Boolean(merged.prompt_injection_detected),
      has_application_url: Boolean(merged.application_url && merged.application_url.startsWith('http'))
    });

    // 7. Check if this is a re-check of an already known candidate or opportunity
    const existingMatch = duplicateCheck.duplicateOf;
    const isSameSourceRecheck = existingMatch && (
      (merged.source_name === existingMatch.source_name && merged.source_listing_id === existingMatch.source_listing_id) ||
      (merged.source_name === existingMatch.source_name && merged.canonical_url === existingMatch.canonical_url) ||
      Boolean(duplicateCheck.isSameSource)
    );

    let candidateId = merged.id;
    let lifecycleStatus = CANDIDATE_STATUS.PENDING_REVIEW;

    // 7. Evaluate Gig Relevance (Phase 2A)
    const gigAssessment = evaluateGigRelevance(merged);
    const isGig = gigAssessment.is_gig;
    const isConventionalJob = gigAssessment.is_conventional_job;
    const gigType = gigAssessment.gig_type;

    if (isSameSourceRecheck) {
      candidateId = existingMatch.id;
      // If candidate was previously approved but now appears inactive, flag for recheck
      if (existingMatch.status === CANDIDATE_STATUS.APPROVED && finalActivity.activity_status === 'inactive') {
        lifecycleStatus = CANDIDATE_STATUS.NEEDS_RECHECK;
      } else if (existingMatch.status === CANDIDATE_STATUS.STOPPED && finalActivity.activity_status === 'active') {
        // If a previously stopped gig becomes active again, route to human review
        lifecycleStatus = CANDIDATE_STATUS.NEEDS_RECHECK;
      } else {
        lifecycleStatus = existingMatch.status;
      }
    } else if (duplicateCheck.isDuplicate) {
      // Cross-source duplicate or duplicate candidate: flag for safe review / duplicate status
      lifecycleStatus = CANDIDATE_STATUS.DUPLICATE;
    } else if (isConventionalJob || gigType === 'conventional_job' || gigType === 'article_or_promo') {
      // Conventional corporate job vacancy or non-gig promotional content: rejected per UpShift criteria
      lifecycleStatus = CANDIDATE_STATUS.REJECTED;
      finalClassification = {
        ...finalClassification,
        classification_reason: gigAssessment.reason
      };
    } else if (!finalClassification.is_relevant) {
      lifecycleStatus = CANDIDATE_STATUS.REJECTED;
    }

    // 8. Construct Final Normalized Candidate
    return createCandidate({
      ...merged,
      id: candidateId,
      first_discovered_at: existingMatch ? existingMatch.first_discovered_at : undefined,
      track_id: existingMatch?.track_id || finalClassification.track_id,
      matched_modules: finalClassification.matched_modules,
      module_fit_scores: finalClassification.module_fit_scores,
      module_evidence: finalClassification.module_evidence,

      // Gig Qualification Fields (Phase 2A & 2B)
      is_gig: existingMatch?.is_gig !== undefined ? existingMatch.is_gig : isGig,
      gig_type: existingMatch?.gig_type || gigType,
      is_conventional_job: existingMatch?.is_conventional_job !== undefined ? existingMatch.is_conventional_job : isConventionalJob,

      // Granular URLs (Phase 2B & 2C)
      opportunity_url: merged.opportunity_url,
      source_url: merged.source_url,
      application_url: merged.application_url,
      resolved_url: merged.resolved_url,
      link_type: merged.link_type,
      link_status: merged.link_status,
      link_evidence: [
        ...(merged.link_evidence || []),
        ...(gigAssessment.evidence || [])
      ],

      activity_status: finalActivity.activity_status,
      activity_confidence: finalActivity.activity_confidence,
      activity_evidence: finalActivity.activity_evidence,
      activity_reason: finalActivity.activity_reason,

      module_fit_score: finalClassification.primary_fit_score,
      confidence_tier: finalClassification.confidence_tier,
      has_conflict: finalClassification.has_conflict,
      conflicting_tracks: finalClassification.conflicting_tracks,
      is_relevant: finalClassification.is_relevant,
      classification_reason: finalClassification.classification_reason,
      source_reliability: reliability,
      data_completeness: completeness.score,
      review_priority: priority.priorityScore,

      // 19-Column fields
      deliverables: merged.deliverables || '',
      requirements: merged.requirements || '',
      proof_spec: merged.proof_spec || '',
      short_description: merged.short_description || '',
      overview: merged.overview || '',
      is_local_business: Boolean(merged.is_local_business),
      is_featured: Boolean(merged.is_featured),
      priority: merged.priority || (priority.priorityScore >= 75 ? 'Featured' : 'Standard'),

      // Preserve referral details, reviewer decisions, and audit history from existingMatch
      referral_id: existingMatch?.referral_id || merged.referral_id || '',
      referral_url: existingMatch?.referral_url || merged.referral_url || '',
      referral_required: existingMatch?.referral_required !== undefined ? existingMatch.referral_required : Boolean(merged.referral_required),
      referral_history: (Array.isArray(existingMatch?.referral_history) && existingMatch.referral_history.length > 0)
        ? existingMatch.referral_history
        : (merged.referral_history || []),
      reviewed_by: existingMatch?.reviewed_by || null,
      reviewed_at: existingMatch?.reviewed_at || null,
      admin_notes: existingMatch?.admin_notes || merged.admin_notes || '',
      rejection_reason: existingMatch?.rejection_reason || (!finalClassification.is_relevant ? finalClassification.classification_reason : null),
      published_gig_id: existingMatch?.published_gig_id || null,

      // Same-source re-check is updating in place; only mark duplicate if it's a separate duplicate record
      is_duplicate: isSameSourceRecheck ? false : duplicateCheck.isDuplicate,
      duplicate_of: isSameSourceRecheck ? null : (duplicateCheck.duplicateOf?.id || null),
      source_history: existingMatch
        ? mergeCandidateProvenance(existingMatch, merged)
        : (Array.isArray(merged.source_history) ? merged.source_history : undefined),
      status: lifecycleStatus,

      llm_provider: llmMeta?.provider || null,
      llm_model: llmMeta?.model || null,
      llm_evaluation: llmMeta?.evaluation || null
    });
  }

  /**
   * Runs one full ingestion cycle across all enabled providers.
   * Deduplicates against existing candidates AND all already-published gigs.
   *
   * @param {object} [options]
   * @returns {Promise<{ discovered: number, inserted: number, updated: number, duplicates: number, total: number }>}
   */
  async runCycle(options = {}) {
    const existing = await this.repository.getAll();

    // Query published gigs from public.gigs if available to ensure cross-store deduplication
    let publishedGigsAsCandidates = [];
    try {
      const client = getServerSupabaseClient();
      if (client) {
        const { data } = await client.from('gigs').select('*');
        if (Array.isArray(data)) {
          publishedGigsAsCandidates = data.map(g => ({
            id: g.id,
            external_gig_id: g.external_gig_id,
            source_listing_id: g.external_gig_id,
            canonical_url: g.origin_url,
            original_url: g.origin_url,
            title: g.title,
            organization: g.organization || '',
            track_id: g.track_id,
            status: g.status === 'Active' ? CANDIDATE_STATUS.APPROVED : g.status,
            published_gig_id: g.id
          }));
        }
      }
    } catch {}

    const knownPool = [...existing, ...publishedGigsAsCandidates];
    const processedCandidates = [];
    let duplicatesCount = 0;
    let relevantCount = 0;
    let rejectedCount = 0;
    let uncertainCount = 0;

    const providerStats = {};
    console.log(`[DiscoveryPipeline] Starting ingestion cycle with ${this.providers.length} provider(s)...`);

    for (const provider of this.providers) {
      providerStats[provider.name] = {
        fetched: 0,
        accepted: 0,
        rejected: 0,
        uncertain: 0,
        duplicate: 0,
        saved: 0
      };

      try {
        console.log(`[DiscoveryPipeline] Querying provider: ${provider.name} (${provider.type})...`);
        const rawListings = await provider.fetchCandidates(options);
        providerStats[provider.name].fetched = rawListings.length;
        console.log(`[DiscoveryPipeline] Found ${rawListings.length} raw listings from ${provider.name}.`);

        for (const raw of rawListings) {
          const candidate = await this.processListing(raw, [...knownPool, ...processedCandidates]);
          candidate._providerName = provider.name;
          if (candidate.is_duplicate) {
            duplicatesCount++;
            providerStats[provider.name].duplicate++;
          } else if (candidate.is_relevant) {
            relevantCount++;
            providerStats[provider.name].accepted++;
          } else {
            rejectedCount++;
            providerStats[provider.name].rejected++;
          }

          if (candidate.activity_status === ACTIVITY_STATUS.NEEDS_REVIEW || candidate.has_conflict || candidate.status === CANDIDATE_STATUS.PENDING_REVIEW) {
            uncertainCount++;
            providerStats[provider.name].uncertain++;
          }

          processedCandidates.push(candidate);
        }
      } catch (err) {
        console.error(`[DiscoveryPipeline] Error in provider ${provider.name}:`, err.message);
        if (!this.lastErrors) this.lastErrors = [];
        this.lastErrors.push({ provider: provider.name, error: err.message });
      }
    }

    // Deduplicate candidates by ID before batch save to ensure unique records
    const uniqueCandidatesMap = new Map();
    for (const cand of processedCandidates) {
      if (!cand || !cand.id) continue;
      uniqueCandidatesMap.set(cand.id, cand);
    }
    const candidatesToSave = Array.from(uniqueCandidatesMap.values());

    for (const cand of candidatesToSave) {
      if (cand._providerName && providerStats[cand._providerName]) {
        providerStats[cand._providerName].saved++;
      }
    }
    // Clean up temporary internal field
    for (const cand of processedCandidates) {
      delete cand._providerName;
    }

    // Save batch to repository
    const saveStats = await this.repository.saveBatch(candidatesToSave);

    console.log(`[DiscoveryPipeline] Cycle complete! Processed: ${processedCandidates.length}, Duplicates: ${duplicatesCount}, Total in store: ${saveStats.total}`);

    return {
      discovered: processedCandidates.length,
      duplicates: duplicatesCount,
      relevant: relevantCount,
      rejected: rejectedCount,
      uncertain: uncertainCount,
      inserted: saveStats.inserted,
      updated: saveStats.updated,
      total: saveStats.total,
      candidates: processedCandidates,
      providerStats,
      errors: this.lastErrors || []
    };
  }
}

export const defaultPipeline = new DiscoveryPipeline();

/**
 * Convenience runner for programmatic execution of discovery cycles
 * @param {Array<object>} providers
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function runDiscoveryPipeline(providers, options = {}) {
  const repository = options.candidateStore || options.repository || defaultCandidateRepository;
  const pipeline = new DiscoveryPipeline({
    repository,
    providers,
    ...options
  });
  pipeline.lastErrors = [];
  const cycle = await pipeline.runCycle(options);
  return {
    processedCount: cycle.discovered,
    duplicatesCount: cycle.duplicates,
    insertedCount: cycle.inserted,
    updatedCount: cycle.updated,
    errors: cycle.errors || pipeline.lastErrors || [],
    ...cycle
  };
}
