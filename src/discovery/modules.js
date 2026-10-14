/**
 * UpShift Opportunity Modules (M1–M6)
 * Real definitions, keyword taxonomies, and matching rules extracted from
 * the UpShift platform codebase (Landing.jsx, Dashboard.jsx, schema.sql).
 */

export const MODULE_DEFINITIONS = {
  M1: {
    id: 'M1',
    codeName: 'ReelRush',
    title: 'AI Video / Reels',
    description: 'Short-form video, reels generation, AI editing, viral production, and video synthesis.',
    primarySkills: [
      'ai video', 'reels', 'shorts', 'tiktok', 'video generation', 'sora', 'runway',
      'pika', 'kling', 'luma dream machine', 'capcut', 'descript', 'video editing',
      'ai avatar', 'heygen', 'synthesia', 'b-roll generation', 'motion graphics',
      'premiere', 'premiere pro', 'after effects', 'video production', 'short-form', 'video synthesis'
    ],
    roleKeywords: [
      'video editor', 'video creator', 'video producer', 'reels producer', 'reels creator',
      'short form editor', 'ai video specialist', 'content creator', 'motion designer',
      'animator', 'video specialist', 'multimedia creator', 'youtube editor', 'video production',
      'reels editor', 'shorts creator', 'video animat'
    ],
    responsibilities: [
      'generate short-form reels and viral social clips using generative AI tools',
      'edit and polish automated video drafts with captions, audio, and visual hooks',
      'synthesize realistic AI avatars and voiceovers for marketing campaigns',
      'produce high-converting video creative across TikTok, Instagram, and YouTube Shorts'
    ]
  },
  M2: {
    id: 'M2',
    codeName: 'VisualForge',
    title: 'AI Design / Visual',
    description: 'Brand assets, image synthesis, visual campaigns, graphics, and digital illustration.',
    primarySkills: [
      'midjourney', 'stable diffusion', 'flux', 'dall-e', 'image synthesis',
      'brand design', 'graphic design', 'visual assets', 'figma ai', 'canva ai',
      'photoshop generative fill', 'logo design', 'banner design', 'product mockup',
      'concept art', 'style tuning', 'lora training', 'figma', 'canva', 'photoshop',
      'illustrator', 'ui/ux', 'brand identity', 'vector'
    ],
    roleKeywords: [
      'visual designer', 'graphic designer', 'ai artist', 'brand designer',
      'ui designer', 'ux designer', 'product designer', 'illustrator', 'creative technologist',
      'prompt artist', '3d designer', 'creative designer', 'visual artist', 'digital designer',
      'asset designer', 'ui/ux designer'
    ],
    responsibilities: [
      'craft consistent visual brand identities and campaign assets using image models',
      'create high-fidelity concept art, packaging concepts, and product mockups',
      'refine raw AI imagery with typography, vector adjustments, and composition polish',
      'train and calibrate specialized style models (LoRAs) for brand guidelines'
    ]
  },
  M3: {
    id: 'M3',
    codeName: 'DeepAnnotator',
    title: 'AI Data & Evaluation',
    description: 'RLHF feedback, data annotation, AI quality testing, transcription, and model evaluation.',
    primarySkills: [
      'rlhf', 'data annotation', 'model evaluation', 'prompt rating', 'prompt evaluation',
      'text labeling', 'audio transcription', 'video annotation', 'image labeling', 'bounding box',
      'quality assessment', 'safety evaluation', 'red teaming', 'multilingual evaluation',
      'linguistic validation', 'hallucination testing', 'ground truth', 'ground truth curation',
      'prompt engineering', 'prompt optimization', 'data labeling', 'ai training',
      'model testing', 'ai response rating', 'model benchmarking', 'content evaluation', 'search quality'
    ],
    roleKeywords: [
      'data annotator', 'rlhf specialist', 'model evaluator', 'ai evaluator', 'ai trainer',
      'language expert', 'language specialist', 'transcriptionist', 'content evaluator',
      'content reviewer', 'data contributor', 'prompt engineer', 'prompt specialist',
      'prompt evaluator', 'prompt optimization specialist', 'prompt optimizer', 'ai rater', 'annotation specialist', 'ai reviewer',
      'evaluation analyst', 'data collector', 'ai quality analyst', 'search quality rater', 'ai tutor',
      'video data annotator', 'image annotator', 'quality associate', 'bilingual rater', 'language quality analyst'
    ],
    responsibilities: [
      'rate and compare model completions for helpfulness, accuracy, and harmlessness',
      'label complex text, image, and audio datasets for machine learning training',
      'conduct linguistic and dialect evaluations for regional NLP models',
      'identify and flag hallucinations, toxicity, or inconsistencies in model responses'
    ]
  },
  M4: {
    id: 'M4',
    codeName: 'VibeCoder',
    title: 'AI Coding & Web Dev',
    description: 'AI-assisted fullstack software, agents, web apps, scripting, and developer tooling.',
    primarySkills: [
      'fullstack', 'full-stack', 'full stack', 'react', 'javascript', 'typescript',
      'python', 'node.js', 'nodejs', 'web app', 'api development', 'cursor',
      'github copilot', 'claude dev', 'fastapi', 'next.js', 'nextjs', 'supabase',
      'postgresql', 'tailwind', 'code generation', 'software engineer', 'bug fixing',
      'backend', 'frontend', 'developer', 'rest api', 'graphql', 'git', 'docker'
    ],
    roleKeywords: [
      'fullstack developer', 'full-stack developer', 'full stack developer',
      'fullstack engineer', 'full-stack engineer', 'full stack engineer',
      'frontend engineer', 'frontend developer', 'backend engineer', 'backend developer',
      'software developer', 'software engineer', 'ai developer', 'web developer',
      'python engineer', 'python developer', 'prototype builder', 'platform engineer'
    ],
    responsibilities: [
      'build responsive modern web applications with React, Node, and Supabase',
      'leverage AI coding assistants (Cursor, Copilot) to accelerate feature delivery',
      'integrate third-party APIs, webhooks, and authenticated database models',
      'write clean unit tests, fix regressions, and deploy serverless endpoints'
    ]
  },
  M5: {
    id: 'M5',
    codeName: 'BrandBuzz',
    title: 'AI Marketing & Growth',
    description: 'Social content engines, SEO automation, copywriting, email sequences, and growth systems.',
    primarySkills: [
      'copywriting', 'seo', 'content marketing', 'email marketing', 'social media',
      'growth marketing', 'blog generation', 'ad copywriting', 'content strategy',
      'ai copywriting', 'jasper', 'copy.ai', 'newsletter', 'linkedin growth',
      'funnel optimization', 'marketing automation', 'content writing', 'storyteller',
      'ad creative', 'social ads'
    ],
    roleKeywords: [
      'growth marketer', 'copywriter', 'content strategist', 'seo specialist',
      'social media manager', 'digital marketer', 'inbound marketer', 'content writer',
      'marketing manager', 'brand strategist', 'content lead', 'storyteller', 'newsletter writer'
    ],
    responsibilities: [
      'generate compelling long-form and short-form marketing copy tuned for conversion',
      'build programmatic SEO topic clusters and automated content pipelines',
      'design personalized email drip sequences and nurture funnels',
      'run high-velocity creative testing across social ad channels'
    ]
  },
  M6: {
    id: 'M6',
    codeName: 'AgentHandlers',
    title: 'AI Automation & Agents',
    description: 'n8n, Make, Zapier, custom bots, webhook orchestration, and autonomous agent workflows.',
    primarySkills: [
      'n8n', 'make.com', 'zapier', 'workflow automation', 'autonomous workflows',
      'agentic workflows', 'langchain', 'crewai', 'autogen', 'llamaindex',
      'ai agent', 'ai agents', 'autonomous agents', 'webhook automation',
      'slack bot', 'telegram bot', 'discord bot', 'custom bot', 'bot builder',
      'airtable automation', 'notion api automation', 'pipedream', 'custom scraper',
      'process automation', 'workflow orchestration', 'agentic systems', 'agentic automation', 'rag workflow',
      'tool use', 'tool calling', 'agent engineer', 'agentic reasoning'
    ],
    roleKeywords: [
      'automation engineer', 'automation developer', 'agent builder', 'agent developer',
      'ai agent developer', 'nocode specialist', 'workflow architect',
      'ai operations specialist', 'bot developer', 'process automation specialist',
      'nocode automation specialist', 'zapier specialist', 'workflow engineer',
      'agent engineer', 'agentic developer', 'ai workflow engineer', 'agentic engineer'
    ],
    responsibilities: [
      'architect multi-step autonomous workflows linking webhooks, LLMs, and SaaS tools',
      'build self-healing n8n, Make, or Zapier integrations for business operations',
      'deploy custom conversational bots with retrieval (RAG) and tool-use capabilities',
      'automate manual data entry, lead qualification, and customer support triage'
    ]
  }
};

/**
 * Returns formatted module display label
 * @param {string} moduleId
 * @returns {string}
 */
export function getModuleLabel(moduleId) {
  const mod = MODULE_DEFINITIONS[moduleId];
  if (!mod) return moduleId || 'Unknown Module';
  return `${mod.id} · ${mod.codeName} (${mod.title})`;
}
