/**
 * Eval-harness runner: runs the real image pipeline pieces (no database) over eval/manifest.json.
 *
 *   npm run eval -- [--cases all|id,id|tag:jewellery|category:clothing] [--shots 3]
 *                   [--tier standard] [--provider-mode mock|free|live] [--out eval/runs/<ts>]
 *                   [--planner off|v1]   off = legacy single reference (default); v1 = per-shot specs, views, prompts
 *                   [--mock-judge]   force a fixed passing fidelity verdict (implied by mock mode)
 *                   [--live-llm]     in mock mode, still use the real prompt LLM + fidelity judge (spends quota)
 *
 * Pieces used, as src/lib/generation/service.ts does: buildPromptPlan + sampleDirections/sampleCastings,
 * generateWithFallback, finalizeOutput, judgeFidelity, estimateImageCostMicros. See eval/README.md.
 * NOTE: photo cleaning (prepareProduct) is NOT run yet - the raw normalised upload is the reference.
 */
import sharp from "sharp";
import { config } from "dotenv";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

config({ path: [".env.local", ".env"], quiet: true });

interface Case {
  id: string;
  category: "jewellery" | "clothing";
  tags: string[];
  input: string;
  rights: string;
  expectedShots?: number;
}

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k] = "true";
    else {
      a[k] = next;
      i++;
    }
  }
  return a;
}

/** Crude cut-out for plain-background eval photos: near-white pixels become transparent (real runs use BiRefNet masks). */
async function whiteKeyCutout(img: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = min >= 246 ? 0 : min >= 232 ? Math.round(((246 - min) / 14) * 255) : 255;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shots = Math.max(1, Number(args.shots ?? 3) || 3);
  const tier = (args.tier ?? "standard") as "economy" | "standard" | "premium";
  const mode = args["provider-mode"] ?? "mock";
  process.env.IMAGE_PROVIDER_MODE = mode;
  // Never touch a real database: provider-call bookkeeping (best-effort) then fails fast and is ignored.
  process.env.DATABASE_URL = "postgres://eval:eval@127.0.0.1:1/none";
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith("[calls]")) return;
    warn(...a);
  };
  // Offline by default: mock mode must not spend real LLM quota, so use template prompts and a fixed judge verdict.
  const offline = mode === "mock" && !args["live-llm"];
  if (mode === "mock") {
    process.env.MOCK_IMAGE_DELAY_MS ??= "0";
    if (offline) process.env.PROMPT_LLM = "template";
  }
  if (args["mock-judge"] || offline) {
    process.env.MOCK_FIDELITY = JSON.stringify({
      reference_features: ["body"],
      checks: [{ feature: "body", status: "match" }],
      product_prominence: "hero",
      same_product: true,
      score: 0.9,
      differences: [],
    });
  }
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const out = args.out ?? path.join("eval", "runs", runId);

  const { aspectRatio, resolveOptions, CATEGORIES } = await import("../../src/lib/catalog/options");
  const { finalizeOutput, llmPreview, normalizeUpload } = await import("../../src/lib/image/process");
  const { judgeFidelity } = await import("../../src/lib/image/fidelity");
  const { passes } = await import("../../src/lib/image/quality");
  const { buildPromptPlan } = await import("../../src/lib/prompt/builder");
  const { sampleCastings, sampleDirections } = await import("../../src/lib/prompt/shared");
  const { generateWithFallback } = await import("../../src/lib/image/router");
  const { estimateImageCostMicros } = await import("../../src/lib/image/costs");
  const { env } = await import("../../src/lib/env");
  const plannerMode = args.planner === "v1" ? "v1" : "off";
  const { planShots } = await import("../../src/lib/shots/planner");
  const { renderShotPrompt } = await import("../../src/lib/shots/prompt");
  const { getPreset } = await import("../../src/lib/shots/presets");
  const { computeProductProfile } = await import("../../src/lib/image/profile");
  const { buildShotReference } = await import("../../src/lib/image/views");
  const { dHash, maskedColourDistance, setDiversity, summarise } = await import("../../src/lib/eval/metrics");
  type RunRecord = import("../../src/lib/eval/metrics").RunRecord;

  const manifest = JSON.parse(readFileSync("eval/manifest.json", "utf8")) as { version: number; cases: Case[] };
  const sel = args.cases ?? "all";
  const cases = manifest.cases.filter((c) => {
    if (sel === "all") return true;
    return sel.split(",").some((t) => (t.startsWith("tag:") ? c.tags.includes(t.slice(4)) : t.startsWith("category:") ? c.category === t.slice(9) : c.id === t));
  });
  if (cases.length === 0) throw new Error(`No cases match --cases ${sel}`);

  const threshold = env().FIDELITY_THRESHOLD;
  const ar = aspectRatio("4:5");
  mkdirSync(path.join(out, "images"), { recursive: true });
  mkdirSync(path.join(out, "inputs"), { recursive: true });
  console.log(`eval run ${runId}: ${cases.length} case(s) x ${shots} shot(s), tier=${tier}, mode=${mode} -> ${out}`);

  const allRuns: RunRecord[] = [];
  const reportCases: unknown[] = [];

  for (const c of cases) {
    const inputName = `${c.id}${path.extname(c.input)}`;
    copyFileSync(c.input, path.join(out, "inputs", inputName));
    const upload = await normalizeUpload(readFileSync(c.input));
    const product = upload.data;
    mkdirSync(path.join(out, "images", c.id), { recursive: true });

    const preset = CATEGORIES[c.category].presets[0];
    const values = resolveOptions(c.category, preset.values, null);
    const castingInput = { category: c.category, values, count: shots, productType: null, recentPrompts: [] as string[] };
    const plan = await buildPromptPlan({
      ...castingInput,
      aspectRatio: ar,
      preview: await llmPreview(product),
      directions: sampleDirections(c.category, shots),
      castings: sampleCastings(castingInput),
    });

    // planner v1: structured specs, one product view per shot, deterministic prompts (no LLM).
    let specs: import("../../src/lib/shots/types").ShotSpec[] = [];
    let refs: { data: Buffer; small?: Buffer }[] = [];
    let skipped: unknown[] = [];
    if (plannerMode === "v1") {
      const cutout = await whiteKeyCutout(product);
      const profile = await computeProductProfile({ cutoutPng: cutout, fallbackImage: product, classification: { category: c.category } as never });
      const family = (["on_model_full", "on_model_half", "on_model_detail", "on_model_closeup", "on_model_portrait", "hand_model"] as string[]).includes(values.presentation ?? "")
        ? "on_model"
        : "product_only";
      const planned = planShots({
        presetId: getPreset(c.category, family).id,
        family,
        count: shots,
        profile,
        availableAngles: new Set(["front"]),
        seed: hashSeed(c.id),
        locks: { background: values.setting === "studio_white" ? "white_studio" : (values.setting ?? values.backdrop) },
      });
      specs = planned.specs;
      skipped = planned.skipped;
      plan.prompts = specs.map((sp) => renderShotPrompt(sp, { profile, productSummary: profile.description ?? undefined }));
      refs = await Promise.all(
        specs.map(async (sp) => {
          const r = await buildShotReference({ cutout, view: sp.view, tiltDeg: sp.tiltDeg, aspect: { width: ar.width, height: ar.height } });
          return { data: r.data, small: r.small };
        }),
      );
    }

    const outputs: Buffer[] = [];
    const caseRuns: RunRecord[] = [];
    const shotReports: unknown[] = [];
    for (let i = 0; i < shots; i++) {
      const prompt = plan.prompts[i] ?? plan.prompts[0];
      const t0 = Date.now();
      const shot: Record<string, unknown> = { variant: i, prompt, image: null, spec: specs[i] ?? null };
      let rec: RunRecord = { ok: false, retried: false, accepted: false, costMicros: 0, latencyMs: 0 };
      try {
        const r = await generateWithFallback(tier, { prompt, image: { data: refs[i]?.data ?? product, mime: "image/jpeg", small: refs[i]?.small }, aspectRatio: ar, variant: i });
        const latencyMs = Date.now() - t0;
        const processed = await finalizeOutput(r.data, ar);
        const rel = `images/${c.id}/shot-${i + 1}.jpg`;
        writeFileSync(path.join(out, rel), processed.data);
        outputs.push(processed.data);
        // Cost: every provider tried in the chain is assumed to have billed (failed attempts conservatively counted), plus the winner.
        const costMicros = estimateImageCostMicros(r.provider) + r.attempts.reduce((s, a) => s + estimateImageCostMicros(a.provider), 0);
        const verdict = await judgeFidelity(product, processed.data, plan.productSummary || undefined);
        const accepted = !!verdict && passes(verdict, threshold, specs[i]?.minProminence ?? "clear");
        rec = { ok: true, retried: r.attempts.length > 0, accepted, costMicros, latencyMs };
        Object.assign(shot, {
          image: rel,
          provider: r.provider,
          model: r.model,
          fallbackAttempts: r.attempts,
          verdict,
          gate: verdict ? (accepted ? "pass" : "fail") : "unverified",
          hash: await dHash(processed.data),
          colourDeltaE: await maskedColourDistance(product, processed.data),
        });
      } catch (err) {
        rec.latencyMs = Date.now() - t0;
        const attempts = (err as { attempts?: { provider: string; error: string }[] }).attempts ?? [];
        rec.retried = attempts.length > 1;
        rec.costMicros = attempts.reduce((s, a) => s + estimateImageCostMicros(a.provider), 0);
        Object.assign(shot, { error: (err as Error).message, gate: "error", fallbackAttempts: attempts });
      }
      Object.assign(shot, { ok: rec.ok, accepted: rec.accepted, retried: rec.retried, latencyMs: rec.latencyMs, costMicros: rec.costMicros });
      caseRuns.push(rec);
      allRuns.push(rec);
      shotReports.push(shot);
      console.log(`  ${c.id} shot ${i + 1}: ${shot.gate}${shot.provider ? ` via ${shot.provider}` : ""} ${rec.latencyMs}ms`);
    }
    reportCases.push({
      id: c.id, category: c.category, tags: c.tags, input: `inputs/${inputName}`, rights: c.rights,
      promptSource: plannerMode === "v1" ? "planner-v1" : plan.source, productSummary: plan.productSummary, skippedShots: skipped,
      shots: shotReports, diversity: await setDiversity(outputs), summary: summarise(caseRuns),
    });
  }

  const report = {
    schema: 1, runId, startedAt: startedAt.toISOString(), manifestVersion: manifest.version,
    args: { shots, tier, planner: plannerMode, providerMode: mode, cases: sel, mockJudge: !!(args["mock-judge"] || offline), fidelityThreshold: threshold },
    summary: summarise(allRuns), cases: reportCases,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(out, "report.md"), renderMarkdown(report as never));
  writeFileSync(path.join(out, "viewer.html"), renderViewer(report as never));
  console.log(`\nWrote ${out}/report.json, report.md, viewer.html`);
}

interface ReportShape {
  runId: string;
  args: Record<string, unknown>;
  summary: Record<string, number | null>;
  cases: { id: string; category: string; diversity: { pairwiseMin: number; pairwiseMean: number } | null; summary: Record<string, number | null>; shots: { gate: string; colourDeltaE?: number | null }[] }[];
}

function renderMarkdown(r: ReportShape): string {
  const f = (n: number | null | undefined, d = 2) => (n == null ? "-" : n.toFixed(d));
  const s = r.summary;
  const lines = [
    `# Eval run ${r.runId}`,
    "",
    `Args: \`${JSON.stringify(r.args)}\``,
    "",
    "Proxy metrics only (see eval/README.md). 'unverified' = no judge answered (counts as not accepted).",
    "",
    `**Overall**: ${s.runs} shots, failure ${f((s.failureRate ?? 0) * 100, 0)}%, retry ${f((s.retryRate ?? 0) * 100, 0)}%, accepted ${s.accepted}, cost/accepted ${s.costPerAcceptedUsd == null ? "-" : "$" + f(s.costPerAcceptedUsd, 3)}, total $${f(s.totalCostUsd, 3)}, p50 ${f(s.latencyP50Ms, 0)}ms, p95 ${f(s.latencyP95Ms, 0)}ms`,
    "",
    "| case | category | shots | pass | fail | unverified | error | diversity min/mean | mean dE76 | p50 ms |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const c of r.cases) {
    const n = (g: string) => c.shots.filter((x) => x.gate === g).length;
    const dEs = c.shots.map((x) => x.colourDeltaE).filter((x): x is number => typeof x === "number");
    const dE = dEs.length ? dEs.reduce((a, b) => a + b, 0) / dEs.length : null;
    lines.push(`| ${c.id} | ${c.category} | ${c.shots.length} | ${n("pass")} | ${n("fail")} | ${n("unverified")} | ${n("error")} | ${c.diversity ? `${f(c.diversity.pairwiseMin)}/${f(c.diversity.pairwiseMean)}` : "-"} | ${f(dE, 1)} | ${f(c.summary.latencyP50Ms, 0)} |`);
  }
  return lines.join("\n") + "\n";
}

function renderViewer(report: ReportShape): string {
  const data = JSON.stringify(report).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval ${esc(report.runId)}</title>
<style>
:root{--bg:#fafaf7;--fg:#1c1b19;--card:#fff;--line:#e4e1d8;--acc:#b4531f;--ok:#1f7a45;--bad:#b3261e;--warn:#946200}
@media(prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece9e2;--card:#201f1c;--line:#38352f;--acc:#e08a54;--ok:#5fc48a;--bad:#f2766d;--warn:#e0b04a}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 4px}.sub{color:#888;margin-bottom:16px}
.case{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:16px}
.row{display:flex;gap:10px;overflow-x:auto;align-items:flex-start}
.shot{flex:0 0 220px;border:1px solid var(--line);border-radius:6px;padding:6px}
.shot img{width:100%;display:block;border-radius:4px;cursor:zoom-in;background:#ddd}
.badge{display:inline-block;border-radius:10px;padding:1px 7px;font-size:11px;margin:2px 2px 0 0;border:1px solid var(--line)}
.pass{color:var(--ok)}.fail,.error{color:var(--bad)}.unverified{color:var(--warn)}
.stars button{background:none;border:0;font-size:20px;cursor:pointer;color:#999;padding:0 1px}.stars button.on{color:#e0a100}
.tags button{font-size:11px;border:1px solid var(--line);background:none;color:var(--fg);border-radius:10px;padding:2px 7px;margin:2px 2px 0 0;cursor:pointer}
.tags button.on{background:var(--bad);color:#fff;border-color:var(--bad)}
.toolbar{position:sticky;top:0;background:var(--bg);padding:8px 0;margin-bottom:8px;z-index:2}
.toolbar button{padding:6px 12px;border-radius:6px;border:1px solid var(--acc);background:var(--acc);color:#fff;cursor:pointer}
#zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9;align-items:center;justify-content:center;cursor:zoom-out}
#zoom img{max-width:96vw;max-height:96vh}
details{margin-top:4px;color:#888;font-size:12px}
</style></head><body>
<h1>Eval run ${esc(report.runId)}</h1>
<div class="sub">Automated metrics are cheap proxies; your ratings are the ground truth. Ratings autosave in this browser.</div>
<div class="toolbar"><button id="export">Export ratings JSON</button> <span id="count"></span></div>
<div id="root"></div><div id="zoom"><img alt=""></div>
<script>
const REPORT=${data};
const KEY="eval-ratings:"+REPORT.runId;
const REASONS=["wrong colour","wrong stones/pattern","garbled text","bad hands/anatomy","too similar","other"];
let ratings={};try{ratings=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(ratings))}catch(e){}document.getElementById("count").textContent=Object.keys(ratings).length+" rated"}
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function zoom(src){const z=document.getElementById("zoom");z.firstElementChild.src=src;z.style.display="flex"}
document.getElementById("zoom").onclick=function(){this.style.display="none"};
const root=document.getElementById("root");
for(const c of REPORT.cases){
  const box=el("div","case");
  const dv=c.diversity?" · diversity min "+c.diversity.pairwiseMin.toFixed(2)+" / mean "+c.diversity.pairwiseMean.toFixed(2):"";
  box.appendChild(el("b",null,c.id+" ("+c.category+")"));box.appendChild(el("span","sub"," "+c.tags.join(", ")+dv));
  const row=el("div","row");
  const inp=el("div","shot");const im=el("img");im.src=c.input;im.onclick=()=>zoom(c.input);inp.appendChild(im);inp.appendChild(el("div",null,"INPUT"));row.appendChild(inp);
  c.shots.forEach((s,i)=>{
    const key=c.id+"#"+s.variant;const r=ratings[key]||(ratings[key]={stars:0,tags:[]});delete ratings[key];if(r.stars||r.tags.length)ratings[key]=r;
    const d=el("div","shot");
    if(s.image){const o=el("img");o.src=s.image;o.onclick=()=>zoom(s.image);d.appendChild(o)}else d.appendChild(el("div","error",s.error||"no image"));
    d.appendChild(el("span","badge "+s.gate,"gate: "+s.gate));
    if(s.provider)d.appendChild(el("span","badge",s.provider));
    if(s.verdict)d.appendChild(el("span","badge","score "+s.verdict.score+" · "+s.verdict.prominence));
    if(typeof s.colourDeltaE==="number")d.appendChild(el("span","badge","dE76 "+s.colourDeltaE.toFixed(1)));
    d.appendChild(el("span","badge",s.latencyMs+"ms"));
    const det=el("details");det.appendChild(el("summary",null,"prompt / differences"));det.appendChild(el("div",null,s.prompt+(s.verdict&&s.verdict.differences.length?" | differences: "+s.verdict.differences.join("; "):"")));d.appendChild(det);
    const st=el("div","stars"),tg=el("div","tags");
    function cur(){return ratings[key]||(ratings[key]={stars:0,tags:[]})}
    function paint(){const v=ratings[key]||{stars:0,tags:[]};[...st.children].forEach((b,n)=>b.className=n<v.stars?"on":"");[...tg.children].forEach(b=>b.className=v.tags.includes(b.textContent)?"on":"")}
    for(let n=1;n<=5;n++){const b=el("button",null,"\\u2605");b.title=n+" star";b.onclick=()=>{const v=cur();v.stars=v.stars===n?0:n;save();paint()};st.appendChild(b)}
    for(const t of REASONS){const b=el("button",null,t);b.onclick=()=>{const v=cur();v.tags=v.tags.includes(t)?v.tags.filter(x=>x!==t):[...v.tags,t];save();paint()};tg.appendChild(b)}
    d.appendChild(st);d.appendChild(el("div",null,"bad result:"));d.appendChild(tg);paint();row.appendChild(d);
  });
  box.appendChild(row);root.appendChild(box);
}
save();
document.getElementById("export").onclick=()=>{
  const body=JSON.stringify({runId:REPORT.runId,exportedAt:new Date().toISOString(),ratings},null,2);
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([body],{type:"application/json"}));a.download="ratings-"+REPORT.runId+".json";a.click();
};
</script></body></html>
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
