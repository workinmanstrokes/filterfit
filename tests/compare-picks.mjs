#!/usr/bin/env node
// Compare 3-person blind picks against the app's baseline picks.
//
// Usage:
//   node tests/compare-picks.mjs picks-person1.json picks-person2.json [picks-person3.json]
//
// Reads tests/baseline-results.json (written by run-recommendations.mjs) and
// one picks file per tester (downloaded from tests/blind-pick.html). Writes
// tests/blind-comparison.md and prints the headline numbers.
//
// Agreement = the tester's pick equals the app's top pick for that photo.
// "Human majority" = the filter at least 2 of 3 testers picked (or the
// single pick when only one file is given). Disagreements between the app
// and the human majority are the input to the rule rewrite in step 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tests/compare-picks.mjs picks-person1.json [picks-person2.json ...]');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(path.join(HERE, 'baseline-results.json'), 'utf8'));
const byId = Object.fromEntries(baseline.photos.map((p) => [p.id, p]));
const people = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));

const rows = [];
for (const photo of baseline.photos) {
  const humanPicks = people.map((p) => {
    const pick = (p.picks || []).find((x) => x.photoId === photo.id);
    return pick ? pick.filterId : null;
  });
  const agree = humanPicks.map((h) => h === photo.topPick);
  // Majority: the filter picked by at least 2 testers; with 1 tester it is their pick.
  const counts = {};
  for (const h of humanPicks) if (h) counts[h] = (counts[h] || 0) + 1;
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const majorityPick = majority && majority[1] >= 2 ? majority[0] : (people.length === 1 ? humanPicks[0] : null);
  rows.push({ photo, humanPicks, agree, majorityPick, majorityCount: majority ? majority[1] : 0 });
}

const total = rows.length;
const perPerson = people.map((p, i) => {
  const hits = rows.filter((r) => r.agree[i]).length;
  return { person: p.person || `tester ${i + 1}`, hits, rate: hits / total };
});
const overallHits = perPerson.reduce((s, p) => s + p.hits, 0);
const overallRate = overallHits / (total * people.length);
const majorityRows = rows.filter((r) => r.majorityPick);
const majorityAgree = majorityRows.filter((r) => r.majorityPick === r.photo.topPick).length;

const byCategory = {};
for (const r of rows) {
  const c = r.photo.category;
  byCategory[c] = byCategory[c] || { total: 0, hits: 0 };
  byCategory[c].total += 1;
  byCategory[c].hits += r.agree.filter(Boolean).length;
}

let md = `# FilterFit blind-pick comparison\n\n`;
md += `Generated ${new Date().toISOString()} by \`node tests/compare-picks.mjs\`.\n\n`;
md += `Testers: ${people.map((p) => p.person || 'unnamed').join(', ')} (${people.length} ${people.length === 1 ? 'person' : 'people'}). `;
md += `App baseline: \`tests/baseline-results.json\` (generated ${baseline.generatedAt}).\n\n`;
md += `## Headline\n\n`;
md += `- Overall agreement (tester pick = app top pick): **${overallHits}/${total * people.length} (${(overallRate * 100).toFixed(1)}%)**\n`;
for (const p of perPerson) md += `- ${p.person}: ${p.hits}/${total} (${(p.rate * 100).toFixed(1)}%)\n`;
if (people.length > 1) {
  md += `- Human majority vs app: **${majorityAgree}/${majorityRows.length} (${(majorityAgree / majorityRows.length * 100).toFixed(1)}%)** of photos where at least 2 testers agreed with each other\n`;
}
md += `\n## Agreement by category\n\n`;
md += `| Category | Tester picks agreeing with app |\n|---|---|\n`;
for (const [cat, v] of Object.entries(byCategory)) {
  md += `| ${cat} | ${v.hits}/${v.total * people.length} (${(v.hits / (v.total * people.length) * 100).toFixed(1)}%) |\n`;
}
md += `\n## Disagreements (app vs human majority)\n\n`;
md += `These are the photos where the rule rewrite starts. "Majority" means at least 2 of ${people.length} testers picked the same filter.\n\n`;
md += `| Photo | Category | App top pick | Human majority | All tester picks |\n|---|---|---|---|---|\n`;
for (const r of rows) {
  if (!r.majorityPick || r.majorityPick === r.photo.topPick) continue;
  md += `| ${r.photo.id} | ${r.photo.category} | ${r.photo.topPick} (${r.photo.topScore}%) | ${r.majorityPick} (${r.majorityCount}/${people.length}) | ${r.humanPicks.join(', ')} |\n`;
}
md += `\n## Full table\n\n`;
md += `| Photo | Category | App top pick | ${people.map((p) => p.person || 'tester').join(' | ')} |\n|---|---|---|${people.map(() => '---').join('|')}|\n`;
for (const r of rows) {
  md += `| ${r.photo.id} | ${r.photo.category} | ${r.photo.topPick} | ${r.humanPicks.map((h) => h || '—').join(' | ')} |\n`;
}
md += `\n## What this means for the rule rewrite\n\n`;
md += `Rewrite a rule only where the human majority disagrees with the app on the SAME photo more than once in a category — one disagreement is a taste difference, a pattern is a rule error. `;
md += `Do not rewrite a rule from a single tester's pick, and do not invent human picks: if a picks file is missing or a photo has no pick, it is excluded, not guessed.\n`;

writeFileSync(path.join(HERE, 'blind-comparison.md'), md);
console.log(`overall agreement: ${overallHits}/${total * people.length} (${(overallRate * 100).toFixed(1)}%)`);
for (const p of perPerson) console.log(`  ${p.person}: ${p.hits}/${total} (${(p.rate * 100).toFixed(1)}%)`);
if (people.length > 1) console.log(`  human majority vs app: ${majorityAgree}/${majorityRows.length}`);
console.log(`comparison written to tests/blind-comparison.md`);
