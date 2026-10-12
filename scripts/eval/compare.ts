/**
 * Agreement between the automated gate and human ratings.
 *
 *   npx tsx scripts/eval/compare.ts <ratings.json> <report.json>
 *
 * Human "bad" = 1-2 stars OR any bad-result reason tag. Automated "reject" = gate is not "pass"
 * (fail, unverified or error). Unrated shots are ignored.
 */
import { readFileSync } from "node:fs";

const [ratingsPath, reportPath] = process.argv.slice(2);
if (!ratingsPath || !reportPath) {
  console.error("usage: tsx scripts/eval/compare.ts <ratings.json> <report.json>");
  process.exit(1);
}
const ratings = (JSON.parse(readFileSync(ratingsPath, "utf8")).ratings ?? {}) as Record<string, { stars: number; tags: string[] }>;
const report = JSON.parse(readFileSync(reportPath, "utf8")) as { cases: { id: string; shots: { variant: number; gate: string }[] }[] };

let tp = 0, fp = 0, fn = 0, tn = 0, rated = 0;
const missed: string[] = [];
for (const c of report.cases)
  for (const s of c.shots) {
    const r = ratings[`${c.id}#${s.variant}`];
    if (!r || (!r.stars && r.tags.length === 0)) continue;
    rated++;
    const bad = (r.stars > 0 && r.stars <= 2) || r.tags.length > 0;
    const reject = s.gate !== "pass";
    if (reject && bad) tp++;
    else if (reject && !bad) fp++;
    else if (!reject && bad) {
      fn++;
      missed.push(`${c.id}#${s.variant} (${r.stars}* ${r.tags.join(", ")})`);
    } else tn++;
  }
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "n/a");
console.log(`Rated shots matched to report: ${rated}`);
console.log(`Gate rejects bad:   TP=${tp}  gate rejected good: FP=${fp}  gate passed bad: FN=${fn}  gate passed good: TN=${tn}`);
console.log(`Precision (rejected that were really bad): ${pct(tp, tp + fp)}`);
console.log(`Recall    (bad that the gate rejected):    ${pct(tp, tp + fn)}`);
if (missed.length) console.log(`Bad results the gate let through:\n  ${missed.join("\n  ")}`);
if (rated < 30) console.log("Warning: fewer than 30 rated shots - treat these numbers as anecdotal.");
