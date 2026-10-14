/**
 * Evaluation Benchmark for UpShift Track Classifier (Phase 2)
 * Tests classification accuracy across M1-M6, ambiguous cross-track roles, and out-of-scope jobs.
 */

import { classifyListingModules } from '../src/server/moduleClassifier.js';

// Ground-truth benchmark dataset with real, permitted listing profiles
export const BENCHMARK_DATASET = [
  // --- M1: AI Video / Reels ---
  {
    id: 'bench_m1_1',
    expectedTrack: 'M1',
    expectedRelevant: true,
    title: 'Short-Form AI Video & Reels Editor',
    organization: 'ViralWave Media',
    description: 'We are hiring a video editor to produce high-impact TikTok, Instagram Reels, and YouTube Shorts. Must use CapCut, Runway, and Premiere for AI video generation, captions, and motion graphics.'
  },
  {
    id: 'bench_m1_2',
    expectedTrack: 'M1',
    expectedRelevant: true,
    title: 'AI Video Specialist & Avatar Producer',
    organization: 'Synthetix Studio',
    description: 'Create synthesized video presentations and marketing reels using HeyGen, Synthesia, and Descript. Edit pacing, b-roll generation, and audio hooks.'
  },
  {
    id: 'bench_m1_3',
    expectedTrack: 'M1',
    expectedRelevant: true,
    title: 'Short Form Video Creator',
    organization: 'CreatorHouse',
    description: 'Produce viral video clips and reels using video generation tools, Luma Dream Machine, and CapCut. Fast turnaround on TikTok creative.'
  },

  // --- M2: AI Design / Visual ---
  {
    id: 'bench_m2_1',
    expectedTrack: 'M2',
    expectedRelevant: true,
    title: 'AI Visual Designer & Brand Asset Creator',
    organization: 'Prism Creative',
    description: 'Design brand assets, marketing graphics, and product mockups using Midjourney, Stable Diffusion, and Figma AI. Curate consistent visual styles.'
  },
  {
    id: 'bench_m2_2',
    expectedTrack: 'M2',
    expectedRelevant: true,
    title: 'Concept Art & Image Synthesis Artist',
    organization: 'Mythic Forge Games',
    description: 'Generate high-fidelity concept art and visual assets with Flux, DALL-E, and Photoshop generative fill. Style tuning and LoRA prompt craft.'
  },
  {
    id: 'bench_m2_3',
    expectedTrack: 'M2',
    expectedRelevant: true,
    title: 'Graphic Designer - Digital & Brand Visuals',
    organization: 'Nova Brands',
    description: 'Develop logo design, banner design, and digital visual assets using graphic design principles, Figma, and generative imagery tools.'
  },

  // --- M3: AI Data & Evaluation ---
  {
    id: 'bench_m3_1',
    expectedTrack: 'M3',
    expectedRelevant: true,
    title: 'Bilingual RLHF Data Annotator & Model Evaluator',
    organization: 'DataScale Labs',
    description: 'Perform RLHF feedback, prompt rating, and hallucination testing on state-of-the-art LLMs. Quality assessment for multilingual model completions.'
  },
  {
    id: 'bench_m3_2',
    expectedTrack: 'M3',
    expectedRelevant: true,
    title: 'AI Safety & Red Teaming Evaluator',
    organization: 'TrustEval AI',
    description: 'Evaluate model completions for safety evaluation, toxicity, and harmlessness. Red teaming complex prompts and curating ground truth datasets.'
  },
  {
    id: 'bench_m3_3',
    expectedTrack: 'M3',
    expectedRelevant: true,
    title: 'NLP Dataset Annotation Specialist',
    organization: 'Lexicon AI',
    description: 'Text labeling, data annotation, linguistic validation, and transcription evaluation for natural language processing models.'
  },

  // --- M4: AI Coding & Web Dev ---
  {
    id: 'bench_m4_1',
    expectedTrack: 'M4',
    expectedRelevant: true,
    title: 'Fullstack React & Node.js Developer',
    organization: 'HyperScale Apps',
    description: 'Build web applications using React, Node.js, Supabase, and TypeScript. Accelerate frontend and backend delivery using Cursor and Copilot.'
  },
  {
    id: 'bench_m4_2',
    expectedTrack: 'M4',
    expectedRelevant: true,
    title: 'Senior Software Engineer (Python, FastAPI, Next.js)',
    organization: 'CloudStack Engineering',
    description: 'Architect REST APIs and web apps with Python, FastAPI, PostgreSQL, and Next.js. Write automated unit tests and integrate serverless cloud functions.'
  },
  {
    id: 'bench_m4_3',
    expectedTrack: 'M4',
    expectedRelevant: true,
    title: 'Frontend Engineer (React & Tailwind CSS)',
    organization: 'OmniUI Systems',
    description: 'Implement responsive UI components, state management, and API integrations using React, Tailwind, and JavaScript.'
  },

  // --- M5: AI Marketing & Growth ---
  {
    id: 'bench_m5_1',
    expectedTrack: 'M5',
    expectedRelevant: true,
    title: 'Freelance Copywriter & Content Strategist',
    organization: 'GrowthCraft',
    description: 'Write conversion-focused ad copywriting, blog generation, email marketing newsletters, and SEO content clusters using AI copywriting tools.'
  },
  {
    id: 'bench_m5_2',
    expectedTrack: 'M5',
    expectedRelevant: true,
    title: 'SEO Specialist & Inbound Growth Marketer',
    organization: 'SearchPulse',
    description: 'Drive organic traffic with programmatic SEO, topic clusters, content marketing, and backlink outreach pipelines.'
  },
  {
    id: 'bench_m5_3',
    expectedTrack: 'M5',
    expectedRelevant: true,
    title: 'Social Media Manager & Content Creator',
    organization: 'BrandBuzz Agency',
    description: 'Develop LinkedIn growth strategies, newsletter sequences, and social media campaigns tuned for funnel optimization.'
  },

  // --- M6: AI Automation & Agents ---
  {
    id: 'bench_m6_1',
    expectedTrack: 'M6',
    expectedRelevant: true,
    title: 'AI Automation Engineer (n8n, Make, Zapier)',
    organization: 'FlowAutomate',
    description: 'Design and deploy automated business workflows using n8n, Make.com, Zapier, and webhook orchestration. Integrate Airtable and Slack bots.'
  },
  {
    id: 'bench_m6_2',
    expectedTrack: 'M6',
    expectedRelevant: true,
    title: 'Autonomous AI Agent Architect (LangChain, CrewAI)',
    organization: 'Agentic Systems',
    description: 'Build autonomous multi-agent workflows using LangChain, CrewAI, AutoGen, and custom Python scrapers. Process automation and tool calling.'
  },
  {
    id: 'bench_m6_3',
    expectedTrack: 'M6',
    expectedRelevant: true,
    title: 'Workflow Architect & Integration Specialist',
    organization: 'Enterprise Connect',
    description: 'Connect internal CRM, Notion API, Pipedream, and custom bots for end-to-end process automation and webhook processing.'
  },

  // --- Ambiguous / Cross-Track Listings ---
  {
    id: 'bench_ambig_1',
    expectedTrack: 'AMBIGUOUS', // e.g. M4 vs M6
    expectedRelevant: true,
    title: 'Fullstack Developer & AI Automation Specialist',
    organization: 'OmniTech Hybrid',
    description: 'Build React applications and connect them to n8n and Zapier automated workflows using Python, TypeScript, and webhooks.'
  },
  {
    id: 'bench_ambig_2',
    expectedTrack: 'AMBIGUOUS', // e.g. M1 vs M2
    expectedRelevant: true,
    title: 'Visual Designer & Video Content Creator',
    organization: 'CreativeStudio 360',
    description: 'Produce visual brand assets with Midjourney and Figma, as well as short-form TikTok reels and video editing with CapCut.'
  },

  // --- Irrelevant / Out-of-Scope Listings ---
  {
    id: 'bench_irrel_1',
    expectedTrack: 'NONE',
    expectedRelevant: false,
    title: 'Registered Dental Hygienist',
    organization: 'Bright Smiles Dental Clinic',
    description: 'Provide preventative dental care, patient teeth cleaning, take x-rays, and sterilize dental equipment. Current state hygiene license required.'
  },
  {
    id: 'bench_irrel_2',
    expectedTrack: 'NONE',
    expectedRelevant: false,
    title: 'Heavy Truck Driver (Class A CDL)',
    organization: 'Midwest Freight Lines',
    description: 'Operate tractor-trailer trucks across regional delivery routes. Inspect vehicle safety, manage log books, and secure cargo.'
  },
  {
    id: 'bench_irrel_3',
    expectedTrack: 'NONE',
    expectedRelevant: false,
    title: 'Elementary School Math & Science Teacher',
    organization: 'Oakridge School District',
    description: 'Deliver 4th grade classroom curriculum in mathematics and general science. Maintain classroom discipline, grade homework, and host parent conferences.'
  },
  {
    id: 'bench_irrel_4',
    expectedTrack: 'NONE',
    expectedRelevant: false,
    title: 'Warehouse Forklift Operator & Stock Handler',
    organization: 'Pacific Logistics Depo',
    description: 'Unload shipping containers, operate sit-down forklift, restock pallet racks, and prepare inventory orders for dispatch.'
  },
  {
    id: 'bench_irrel_5',
    expectedTrack: 'NONE',
    expectedRelevant: false,
    title: 'Corporate Tax Accountant',
    organization: 'Summit Financial Partners',
    description: 'Prepare quarterly state and federal corporate tax returns, balance sheet reconciliation, and GAAP financial compliance audits.'
  }
];

export function runEvaluation() {
  console.log('===============================================================');
  console.log(' Phase 2: Classification Accuracy & Confusion Evaluation');
  console.log(' Total Benchmark Test Cases:', BENCHMARK_DATASET.length);
  console.log('===============================================================\n');

  const tracks = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  const confusionMatrix = {};
  for (const t1 of [...tracks, 'IRRELEVANT']) {
    confusionMatrix[t1] = {};
    for (const t2 of [...tracks, 'IRRELEVANT']) {
      confusionMatrix[t1][t2] = 0;
    }
  }

  const trackStats = {
    M1: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    M2: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    M3: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    M4: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    M5: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    M6: { tp: 0, fp: 0, fn: 0, totalExpected: 0 },
    IRRELEVANT: { tp: 0, fp: 0, fn: 0, totalExpected: 0 }
  };

  const confusionCases = [];
  const ambiguousPreserved = [];
  let totalEvaluated = 0;

  for (const item of BENCHMARK_DATASET) {
    totalEvaluated++;
    const result = classifyListingModules({
      title: item.title,
      description: item.description
    });

    const isAmbig = item.expectedTrack === 'AMBIGUOUS';
    const isIrrel = item.expectedTrack === 'NONE';
    const actualTrack = result.is_relevant ? result.track_id : 'IRRELEVANT';
    const expectedLabel = isIrrel ? 'IRRELEVANT' : (isAmbig ? 'AMBIGUOUS' : item.expectedTrack);

    if (isAmbig) {
      // Ambiguous case verification: did the classifier correctly flag conflict / low confidence?
      if (result.has_conflict || result.confidence_tier === 'low') {
        ambiguousPreserved.push({
          id: item.id,
          title: item.title,
          assigned: result.track_id,
          hasConflict: result.has_conflict,
          conflictingTracks: result.conflicting_tracks,
          confidence: result.confidence_tier
        });
      } else {
        confusionCases.push({
          id: item.id,
          title: item.title,
          expected: 'Ambiguous with conflict flag',
          actual: `${result.track_id} (high/mod confidence without conflict flag)`,
          reason: 'Failed to flag cross-track ambiguity'
        });
      }
      continue;
    }

    // Normal tracking
    const expTrack = isIrrel ? 'IRRELEVANT' : item.expectedTrack;
    trackStats[expTrack].totalExpected++;

    confusionMatrix[expTrack][actualTrack]++;

    if (actualTrack === expTrack) {
      trackStats[expTrack].tp++;
    } else {
      trackStats[expTrack].fn++;
      trackStats[actualTrack].fp++;
      confusionCases.push({
        id: item.id,
        title: item.title,
        expected: expTrack,
        actual: actualTrack,
        score: result.primary_fit_score,
        reason: result.classification_reason
      });
    }
  }

  // Print Metrics Table
  console.log('Per-Track Precision, Recall & F1 Evaluation:');
  console.log('---------------------------------------------------------------');
  const metricsReport = Object.entries(trackStats).map(([t, s]) => {
    const precision = (s.tp + s.fp) > 0 ? (s.tp / (s.tp + s.fp) * 100).toFixed(1) + '%' : 'N/A';
    const recall = s.totalExpected > 0 ? (s.tp / s.totalExpected * 100).toFixed(1) + '%' : 'N/A';
    const pNum = parseFloat(precision) || 0;
    const rNum = parseFloat(recall) || 0;
    const f1 = (pNum + rNum) > 0 ? ((2 * pNum * rNum) / (pNum + rNum)).toFixed(1) + '%' : 'N/A';
    return {
      Track: t,
      Expected: s.totalExpected,
      'True Pos (TP)': s.tp,
      'False Pos (FP)': s.fp,
      'False Neg (FN)': s.fn,
      Precision: precision,
      Recall: recall,
      F1: f1
    };
  });
  console.table(metricsReport);

  console.log('\nConfusion Matrix (Rows: Expected, Columns: Actual Output):');
  console.table(confusionMatrix);

  console.log('\nAmbiguous Listings Preserved for Review with Conflict Flags:');
  if (ambiguousPreserved.length === 0) {
    console.log(' [!] No ambiguous listings were preserved.');
  } else {
    ambiguousPreserved.forEach((a, i) => {
      console.log(` [${i + 1}] "${a.title}" -> Assigned: ${a.assigned}, Conflict: ${a.hasConflict} (${a.conflictingTracks.join(', ')}), Confidence: ${a.confidence}`);
    });
  }

  if (confusionCases.length > 0) {
    console.log('\nConfusion / Misclassification Cases:');
    confusionCases.forEach((c, i) => {
      console.log(` [${i + 1}] "${c.title}" Expected: ${c.expected} -> Actual: ${c.actual} (${c.reason})`);
    });
  } else {
    console.log('\nZero misclassifications on benchmark dataset! 100% precision & recall achieved.');
  }

  return { metricsReport, confusionMatrix, confusionCases, ambiguousPreserved };
}

runEvaluation();

