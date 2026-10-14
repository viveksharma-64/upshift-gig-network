import fs from 'node:fs';
import { classifyListingModules } from '../src/server/moduleClassifier.js';

const data = JSON.parse(fs.readFileSync('data/candidates.json', 'utf8'));

const byTrack = { M1: [], M2: [], M3: [], M4: [], M5: [], M6: [] };
for (const c of data) {
  if (byTrack[c.track_id]) {
    byTrack[c.track_id].push(c);
  }
}

for (const [track, list] of Object.entries(byTrack)) {
  console.log(`\n========================================`);
  console.log(`TRACK ${track} (Total stored: ${list.length})`);
  console.log(`========================================`);
  let issues = 0;
  for (const c of list) {
    const res = classifyListingModules(c);
    const isIrrel = !res.is_relevant;
    const isTrackMismatch = res.is_relevant && res.track_id !== track;
    if (isIrrel || isTrackMismatch) {
      issues++;
      console.log(`- [${c.status}] "${c.title}" @ ${c.organization} (ID: ${c.id})`);
      if (isIrrel) {
        console.log(`  Reason: IRRELEVANT — ${res.classification_reason}`);
      } else {
        console.log(`  Reason: TRACK MISMATCH — Classified as ${res.track_id} (Score: ${res.primary_fit_score})`);
      }
    }
  }
  console.log(`Track ${track} issues found: ${issues} / ${list.length}`);
}
