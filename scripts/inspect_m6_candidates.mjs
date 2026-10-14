import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('data/candidates.json', 'utf8'));
const m6 = data.filter(c => c.track_id === 'M6');
console.log('Total M6 candidates in store:', m6.length);

for (const [i, c] of m6.entries()) {
  console.log(`\n===============================================================`);
  console.log(`[${i + 1}] Title: ${c.title}`);
  console.log(`Organization: ${c.organization}`);
  console.log(`ID: ${c.id}`);
  console.log(`Status: ${c.status}`);
  console.log(`Track ID: ${c.track_id}`);
  console.log(`Is Relevant: ${c.is_relevant}`);
  console.log(`Primary Fit Score: ${c.primary_fit_score || c.fit_score}`);
  console.log(`Confidence Tier: ${c.confidence_tier}`);
  console.log(`Classification Reason: ${c.classification_reason}`);
  console.log(`Module Evidence:`, JSON.stringify(c.module_evidence || c.evidence || {}));
  console.log(`Original URL: ${c.origin_url || c.application_url}`);
  console.log(`Short Description: ${(c.short_description || '').slice(0, 200)}`);
  console.log(`Full Description: ${(c.description || '').slice(0, 400)}`);
  console.log(`Responsibilities: ${(c.responsibilities || '').slice(0, 300)}`);
  console.log(`Requirements: ${(c.requirements || '').slice(0, 300)}`);
}
