// SSC PYQ automation — aapki app (app.html) ko headless Chrome me chalakar PDF -> JSON -> GitHub ka kaam apne aap karta hai.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E = process.env;
const cfg = {
  token: E.GH_TOKEN || "",
  repo: (E.GH_REPO || E.GITHUB_REPOSITORY || "").trim(),
  branch: E.GH_BRANCH || "main",
  imgDir: E.IMG_DIR || "CGL",                       // images: <repo>/<imgDir>/<paper>/Q#/...
  jsonDir: E.JSON_DIR || "mock/cgl",                // index.json + sets/
  aiBase: (E.AI_BASE || "https://coarena.ai/api/v1").replace(/\/+$/, ""),
  aiKeys: (E.AI_KEYS || "").split(/[\s,;]+/).filter(Boolean),
  aiModels: (E.AI_MODELS || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean),   // khali = app ki tarah khud chunega (model list + image test)
  resumeHour: parseFloat(E.RESUME_HOUR_IST || "8"),     // sab key khatam hone par agle din is baje (IST) dobara
  aiPar: parseInt(E.AI_PAR || "4", 10),
  maxPdfs: parseInt(E.MAX_PDFS || "0", 10),              // 0 = list ke saare (jab tak key ki limit chale)
  list: E.PDF_LIST || path.join(HERE, "pdf_list.json"),
  catImage: E.CAT_IMAGE || "",
  catImages: Object.assign({ 2023: "https://vimaldahake.github.io/demohscproject1/hsclogo/twentythree.png", 2022: "https://vimaldahake.github.io/demohscproject1/hsclogo/twentytwo.png", 2021: "https://vimaldahake.github.io/demohscproject1/hsclogo/twentyone.png", 2020: "https://vimaldahake.github.io/demohscproject1/hsclogo/twenty.png" }, Object.fromEntries((E.CAT_IMAGES || "").split(/[\s,;]+/).filter(Boolean).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]))),   // "2023=https://..png,2022=https://..png"
  time: E.SET_TIME || "60", marks: E.SET_MARKS || "2", neg: E.SET_NEG || "0.5",
  showAns: /^(1|true|yes)$/i.test(E.SET_SHOW || ""),
  strict: !/^(0|false|no)$/i.test(E.STRICT || "1"),
  api: (E.GH_API || "https://api.github.com").replace(/\/+$/, ""),
  budgetMin: parseInt(E.TIME_BUDGET_MIN || "320", 10),
  paperMin: parseInt(E.PAPER_TIMEOUT_MIN || "50", 10),
  dry: /^(1|true|yes)$/i.test(E.DRY_RUN || ""),
  only: (E.ONLY || "").split(/[\s,]+/).filter(Boolean),   // jaise "2023-1,2023-2"
  maxAttempts: parseInt(E.MAX_ATTEMPTS || "2", 10),
  headed: /^(1|true|yes)$/i.test(E.HEADED || ""),
};
const OUT = path.join(HERE, "out"); fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = [];

/* ---------------- GitHub (Node side: sirf index.json padhna + state.json) ---------------- */
async function gh(url, opt = {}) {
  const r = await fetch(cfg.api + url, { ...opt, headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opt.headers || {}) } });
  return r;
}
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
async function ghRead(p) {
  const r = await gh(`/repos/${cfg.repo}/contents/${enc(p)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: { Accept: "application/vnd.github.raw+json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${p}: ${r.status} ${await r.text()}`);
  return await r.text();
}
async function ghWrite(p, text, msg) {
  const m = await gh(`/repos/${cfg.repo}/contents/${enc(p)}?ref=${encodeURIComponent(cfg.branch)}`);
  const sha = m.ok ? (await m.json()).sha : undefined;
  const r = await gh(`/repos/${cfg.repo}/contents/${enc(p)}`, { method: "PUT", body: JSON.stringify({ message: msg, content: Buffer.from(text, "utf8").toString("base64"), branch: cfg.branch, sha }) });
  if (!r.ok) throw new Error(`GitHub write ${p}: ${r.status} ${await r.text()}`);
}
const STATE_PATH = "automation/state.json";
const emptyState = () => ({ failed: {}, exhausted: {}, pauseUntil: null });
async function loadState() { try { const t = await ghRead(STATE_PATH); return { ...emptyState(), ...(t ? JSON.parse(t) : {}) }; } catch (e) { log("state.json nahi padhi:", e.message); return emptyState(); } }
async function saveState(st) { try { await ghWrite(STATE_PATH, JSON.stringify(st, null, 2) + "\n", "automation: state update"); } catch (e) { log("state.json save nahi hui:", e.message); } }
const IST = 5.5 * 3600e3;
// agla "subah <resumeHour> baje (IST)" — kam se kam 2 ghante baad ka
function nextResume(now = Date.now()) {
  const t = now + 2 * 3600e3, ist = new Date(t + IST);
  let d = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0) + cfg.resumeHour * 3600e3 - IST;
  while (d <= t) d += 86400e3;
  return new Date(d).toISOString();
}
function setOutput(k, v) { if (E.GITHUB_OUTPUT) try { fs.appendFileSync(E.GITHUB_OUTPUT, `${k}=${v}\n`); } catch (e) {} log(`[output] ${k}=${v}`); }
class KeyExhausted extends Error {}
const QUOTA_RE = /insufficient|balance|credit|quota|exhaust|billing|out of (?:funds|tokens)|no remaining|exceed|per\s*day|daily|limit\s*(?:reached|exceeded)|top.?up|recharge|payment/i;

/* ---------------- Kaam ki list ---------------- */
function buildTasks() {
  const list = JSON.parse(fs.readFileSync(cfg.list, "utf8")), tasks = [];
  for (const [key, arr] of Object.entries(list)) {
    const m = /^(\d{4})Hindi$/.exec(key); if (!m || !Array.isArray(arr)) continue;     // sirf <year>Hindi
    const year = m[1]; let pos = 0; const seen = new Set();
    for (const it of arr) {
      if (!it || !it.pdfUrl) continue; pos++;
      const n = (/\/(\d+)\.pdf(?:$|\?)/i.exec(it.pdfUrl) || [])[1] || String(pos);   // paper number link se (naam galat ho sakta hai)
      let name = String(it.name || "").replace(/\s+/g, " ").trim() || `${year} Question Paper ${n} Hindi`;   // set ka naam: aapki list ka naam jaisa ka taisa
      name = name.replace(/(Paper\s+)(\d+)/i, (all, p, num) => (num === n ? all : p + n));   // naam ka number link ke number se alag ho (typo) to link wala
      if (seen.has(name)) name = `${name} (${n})`;                                                // phir bhi same ho to hi number jodo
      seen.add(name);
      const folder = name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");         // images ka folder: app ka apna tarika (PDF naam jaisa)
      tasks.push({ id: `${year}-${n}`, year, n, url: it.pdfUrl, cat: `SSC CGL ${year}`, setName: name, fileName: folder + ".pdf" });
    }
  }
  return tasks;
}
function doneSet(index) {
  const s = new Set();
  for (const c of Object.values((index && index.categories) || {})) for (const nm of Object.values((c && c.setName) || {})) s.add(`${c.categoryName}|${nm}`);
  return s;
}

/* ---------------- Ek paper: app ko chalao ---------------- */
// K = { browser, key, keyNo, model: {model, models, pool} | null }
async function processPaper(K, task, tmpPdf) {
  const ctx = await K.browser.newContext({ acceptDownloads: false, viewport: { width: 1280, height: 900 } });
  const seed = {
    gh: { on: true, repo: cfg.repo, branch: cfg.branch, dir: cfg.imgDir, rem: true, tok: cfg.token },
    ai: { base: cfg.aiBase, rem: true, key: K.key, par: String(cfg.aiPar), ...(K.model ? { model: K.model.model, models: K.model.models, pool: K.model.pool } : {}) },
  };
  await ctx.addInitScript((s) => { try { localStorage.setItem("qshot_gh", JSON.stringify(s.gh)); localStorage.setItem("qshot_ai", JSON.stringify(s.ai)); } catch (e) {} }, seed);
  if (E.TEST_MODULE) await (await import(pathToFileURL(path.resolve(E.TEST_MODULE)).href)).setup(ctx, cfg);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const dialogs = []; let checkerBlock = "", exhausted = "", quotaRun = 0;
  // AI ke har jawab par nazar: balance/limit khatam hui to turant ruko aur agli key par jao
  page.on("response", async (r) => {
    try {
      if (exhausted || !r.url().startsWith(cfg.aiBase)) return;
      const st = r.status();
      if (st === 200) { quotaRun = 0; return; }
      if (st < 400) return;
      let body = ""; try { body = (await r.text()).slice(0, 400); } catch (e) {}
      if (exhausted) return;
      const why = `HTTP ${st} ${body.replace(/\s+/g, " ").slice(0, 160)}`;
      if (st === 402 || st === 401) exhausted = why;
      else if ((st === 429 || st === 403 || st === 400) && QUOTA_RE.test(body) && ++quotaRun >= 6) exhausted = why;
      if (exhausted) { log(`   🔑 key #${K.keyNo} ki limit/balance khatam lagti hai (${exhausted})`); ctx.close().catch(() => {}); }
    } catch (e) {}
  });
  page.on("dialog", async (d) => {
    const msg = d.message(); dialogs.push(msg.split("\n")[0]);
    let ok = false;
    if (/^⚠ Checker ko/.test(msg)) { ok = !cfg.strict; if (!ok) checkerBlock = msg; }
    else if (/GitHub par.*ye hoga:/s.test(msg)) ok = true;                // final "Save karun?"
    else ok = false;                                                       // overwrite / links missing / baaki — roko
    log("   dialog:", ok ? "OK" : "CANCEL", "—", msg.split("\n")[0].slice(0, 90));
    if (ok) await d.accept(); else await d.dismiss();
  });
  page.on("pageerror", (e) => log("   page error:", e.message.slice(0, 160)));
  try {
    await page.goto(pathToFileURL(path.join(HERE, "app.html")).href);
    await page.waitForSelector("#file", { state: "attached" });
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));   // AI / GitHub boxes khol do

    // --- 0) Model: app ki tarah — "Model list laao" -> "image padh sakte hain test karo" -> pool
    if (!K.model) {
      log("   model chun raha hoon (list + image test)…");
      await page.click("#aiFetch");
      await page.waitForFunction(() => /model mile|Koi model nahi|❌/.test(document.getElementById("aiRes").innerText), null, { timeout: 120000 });
      const lr = await page.locator("#aiRes").innerText();
      if (/❌/.test(lr)) throw new Error("Model list nahi mili: " + lr.slice(0, 200));
      await page.click("#aiProbe");
      await page.waitForFunction(() => { const b = document.getElementById("aiProbe"); return !b.disabled && /(image padh sakte hain|Koi model image nahi|❌)/.test(document.getElementById("aiRes").innerText); }, null, { timeout: 15 * 60000 });
      const pr = await page.locator("#aiRes").innerText();
      if (!/image padh sakte hain/.test(pr) || /Koi model image nahi/.test(pr)) throw new Error("Koi model image nahi padh paya: " + pr.slice(0, 300));
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("qshot_ai") || "{}"));
      if (!saved.pool || !saved.pool.length) throw new Error("Pool khali raha");
      K.model = { model: saved.model || saved.pool[0], models: saved.models, pool: saved.pool };
      log("   model pool:", K.model.pool.join(", "));
    }

    await page.locator("#file").setInputFiles(tmpPdf);
    await page.waitForFunction(() => /questions/.test(document.getElementById("fileinfo").textContent) && !document.getElementById("go").disabled, null, { timeout: 8 * 60000 });
    const info = await page.locator("#fileinfo").innerText(); log("   PDF khuli:", info.replace(/\s+/g, " "));
    await page.fill("#ghName", task.fileName.replace(/\.pdf$/i, ""));
    await page.fill("#occ", "1");
    await page.click("#listbtn");
    await page.waitForSelector("#saveall", { timeout: 60000 });
    const total = parseInt(/(\d+)\s+questions/.exec(await page.locator("#listwrap > .sub").first().innerText())[1], 10);
    log("   questions:", total);
    if (total < 20) throw new Error("Bahut kam questions mile (" + total + ") — PDF ya index theek nahi");

    // --- 1) Text/Image pehchan + AI se text convert (Final Tab me)
    let stats = { text: 0, img: 0, fail: 1 }, round = 0;
    while (stats.fail > 0 && round < 3) {
      round++;
      await page.click("#aiConv");
      await page.waitForFunction(() => { const b = document.getElementById("aiConv"), r = document.getElementById("aiRes").innerText; return !b.disabled && /(Ho gaya|Roka gaya|❌|Pehle PDF)/.test(r); }, null, { timeout: cfg.paperMin * 60000 });
      const txt = await page.locator("#aiRes").innerText();
      const m = /text:\s*(\d+)\D+image:\s*(\d+)\D+fail:\s*(\d+)/.exec(txt);
      if (!m) throw new Error("AI convert ka result samajh nahi aaya: " + txt.slice(0, 200));
      stats = { text: +m[1], img: +m[2], fail: +m[3] };
      log(`   AI round ${round}: text ${stats.text}, image ${stats.img}, fail ${stats.fail}`);
      if (stats.fail > 0) await sleep(5000);
    }
    if (stats.fail > 0) throw new Error(`AI convert me ${stats.fail} question fail rahe`);
    const ftn = parseInt(/\((\d+)\)/.exec(await page.locator("#tbFinal").innerText())[1], 10);
    if (ftn !== total) throw new Error(`Final Tab me ${ftn} question hain, PDF me ${total}`);

    // --- 2) Image wale questions GitHub par upload
    await page.click("#tbFinal");
    await page.waitForSelector("#tabFinal:not([hidden])");
    const retry = await page.locator("#tabFinal button", { hasText: "Retry" }).count();
    if (retry > 0) throw new Error(`${retry} question abhi bhi text me nahi badle`);
    const upBtn = () => page.locator("#tabFinal button", { hasText: "Is question ko GitHub par bhejo" });
    const nUp = await upBtn().count(); log("   image questions upload:", nUp);
    for (let i = 0; i < nUp; i++) {
      const b = upBtn().nth(i);                           // click ke waqt text abhi badla nahi hota
      await b.scrollIntoViewIfNeeded();
      await b.click();
      const msg = await page.waitForFunction((idx) => {
        const bs = [...document.querySelectorAll("#tabFinal button")].filter((x) => /GitHub par bhejo|Bhej raha/.test(x.textContent));
        const x = bs[idx]; if (!x || x.disabled) return false;
        const sp = x.nextElementSibling; return sp ? sp.textContent || "done" : "done";
      }, i, { timeout: 5 * 60000 }).then((h) => h.jsonValue());
      if (/❌/.test(msg)) throw new Error("Image upload fail: " + msg.slice(0, 200));
    }

    // --- 3) JSON tab: set jodo + GitHub par save
    await page.click("#tbJson");
    await page.waitForSelector("#jgPath");
    await page.fill("#jgPath", cfg.jsonDir);
    await page.click("#jgRead");
    await page.waitForFunction(() => !document.getElementById("jgForm").hidden || /❌/.test(document.getElementById("jgStatus").innerText));
    if (/❌/.test(await page.locator("#jgStatus").innerText())) throw new Error("index.json: " + await page.locator("#jgStatus").innerText());
    const opts = await page.$$eval("#jgCat option", (os) => os.map((o) => [o.value, o.textContent]));
    const hit = opts.find(([v, t]) => t === task.cat && v !== "__new");
    if (hit) await page.selectOption("#jgCat", hit[0]);
    else { await page.selectOption("#jgCat", "__new"); await page.fill("#jgNewName", task.cat); await page.fill("#jgNewImg", cfg.catImages[task.year] || cfg.catImage); }
    await page.selectOption("#jgMode", "new");
    await page.fill("#jgName", task.setName);
    await page.fill("#jgTime", cfg.time); await page.fill("#jgMarks", cfg.marks); await page.fill("#jgNeg", cfg.neg);
    await page.setChecked("#jgShow", cfg.showAns);
    if (cfg.dry) { log("   DRY_RUN — save nahi kiya"); return { dry: true, total, stats }; }
    await page.click("#jgSave");
    await page.waitForFunction(() => /(✅ GitHub par save ho gaya|❌|Roka gaya)/.test(document.getElementById("jgStatus").innerText), null, { timeout: 5 * 60000 });
    const st = await page.locator("#jgStatus").innerText();
    if (!/✅ GitHub par save ho gaya/.test(st)) throw new Error((checkerBlock ? "Checker ne roka:\n" + checkerBlock : "JSON save nahi hua: " + st).slice(0, 900));
    return { total, stats, note: st.split("\n")[0] };
  } catch (e) {
    if (exhausted) throw Object.assign(new KeyExhausted(exhausted), { keyNo: K.keyNo });
    try { await page.screenshot({ path: path.join(OUT, `fail_${task.id}.png`), fullPage: false }); } catch (x) {}
    if (/Pool ke saare model band|Koi model image nahi/.test(String(e.message))) K.model = null;   // agle paper par model dobara chuno
    e.dialogs = dialogs; throw e;
  } finally { await ctx.close().catch(() => {}); }
}

/* ---------------- pending kaam nikalo (gate aur main dono) ---------------- */
async function computePending(state) {
  const tasks = buildTasks();
  const idxText = await ghRead(`${cfg.jsonDir}/index.json`);
  const done = doneSet(idxText ? JSON.parse(idxText) : { categories: {} });
  let pending = tasks.filter((t) => !done.has(`${t.cat}|${t.setName}`));
  const stuck = pending.filter((t) => ((state.failed[t.id] || {}).attempts || 0) >= cfg.maxAttempts);
  pending = pending.filter((t) => !stuck.includes(t));
  if (cfg.only.length) pending = pending.filter((t) => cfg.only.includes(t.id));
  return { tasks, pending, stuck, doneN: tasks.length - pending.length - stuck.length };
}
const needEnv = () => {
  if (!cfg.token) throw new Error("GH_TOKEN nahi mila (GitHub Secret GH_PAT).");
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) throw new Error("GH_REPO galat: " + cfg.repo);
};

/* ---------------- gate: workflow ke shuru me — chalna chahiye ya nahi ---------------- */
async function gate() {
  needEnv();
  const state = await loadState();
  if (state.pauseUntil && Date.now() < Date.parse(state.pauseUntil) && !/^(1|true)$/i.test(E.FORCE || "")) {
    log(`⏸ Sab key ki limit khatam thi — ${state.pauseUntil} (UTC) tak ruka hua hoon.`); setOutput("go", "false"); return;
  }
  const { pending, stuck } = await computePending(state);
  log(`Baaki papers: ${pending.length} (atke: ${stuck.length})`);
  setOutput("go", pending.length ? "true" : "false");
}

/* ---------------- main ---------------- */
async function main() {
  needEnv();
  if (!cfg.aiKeys.length) throw new Error("AI_KEYS nahi mile (GitHub Secret AI_KEYS).");
  const state = await loadState();
  const forced = /^(1|true)$/i.test(E.FORCE || "");
  if (state.pauseUntil && Date.now() < Date.parse(state.pauseUntil) && !forced) { log("Pause chal raha hai:", state.pauseUntil); summary.push("⏸ Pause: " + state.pauseUntil); setOutput("next", "pause"); return; }
  // pichli exhaustion ki list: pauseUntil guzar chuka hai to saaf (nayi limit)
  if (state.pauseUntil && Date.now() >= Date.parse(state.pauseUntil)) { state.exhausted = {}; state.pauseUntil = null; }
  if (forced) { state.exhausted = {}; state.pauseUntil = null; }

  const { tasks, pending, stuck, doneN } = await computePending(state);
  log(`Kul ${tasks.length} paper | ho chuke ${doneN} | atke (review chahiye) ${stuck.length} | baaki ${pending.length}`);
  if (!pending.length) { log("Kuch karna baaki nahi. 🎉"); summary.push("Kuch karna baaki nahi."); setOutput("next", "done"); return; }
  const batch = cfg.maxPdfs > 0 ? pending.slice(0, cfg.maxPdfs) : pending;
  log("Is run me (max):", batch.map((t) => t.id).join(", "));

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !cfg.headed, executablePath: E.CHROME_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-"));
  const K = { browser, key: "", keyNo: 0, model: cfg.aiModels.length ? { model: cfg.aiModels[0], models: cfg.aiModels, pool: cfg.aiModels } : null };
  const dead = new Set(Object.keys(state.exhausted || {}).map(Number));          // exhausted key numbers (1-based)
  let cur = 0, ok = 0, bad = 0, budgetHit = false, allDead = false;
  const nextKey = () => { for (let k = 0; k < cfg.aiKeys.length; k++) { const i = (cur + k) % cfg.aiKeys.length; if (!dead.has(i + 1)) { cur = i; K.key = cfg.aiKeys[i]; K.keyNo = i + 1; return true; } } return false; };
  try {
    paperLoop: for (const t of batch) {
      if ((Date.now() - T0) / 60000 > cfg.budgetMin) { budgetHit = true; log("Time budget khatam — baaki agle run me."); break; }
      log(`▶ ${t.id}  ${t.setName}`);
      let err = null, res = null;
      try {
        const r = await fetch(t.url); if (!r.ok) throw new Error(`PDF download ${r.status}: ${t.url}`);
        const tmpPdf = path.join(tmpDir, t.fileName); fs.writeFileSync(tmpPdf, Buffer.from(await r.arrayBuffer()));
        for (;;) {                                                                 // ek key khatam ho to usi paper ko agli key se
          if (!nextKey()) { allDead = true; break paperLoop; }
          log(`   key #${K.keyNo} (${cfg.aiKeys.length} me se, ${dead.size} khatam)`);
          try { res = await processPaper(K, t, tmpPdf); err = null; break; }
          catch (e) {
            if (e instanceof KeyExhausted) { dead.add(K.keyNo); state.exhausted[K.keyNo] = new Date().toISOString(); if (!cfg.dry) await saveState(state); summary.push(`🔑 key #${K.keyNo} ki limit khatam (${String(e.message).slice(0, 80)})`); continue; }
            err = e; break;
          }
        }
      } catch (e) { err = e; }
      if (!err) { ok++; log(`✅ ${t.id} ho gaya`, res.note || ""); summary.push(`✅ ${t.setName} — ${res.total} questions (text ${res.stats.text}, image ${res.stats.img})`); delete state.failed[t.id]; }
      else { bad++; const f = state.failed[t.id] || { attempts: 0 }; f.attempts++; f.error = String(err.message).slice(0, 600); f.at = new Date().toISOString(); state.failed[t.id] = f; summary.push(`❌ ${t.setName} — ${String(err.message).split("\n")[0]}`); log(`❌ ${t.id} fail: ${String(err.message).split("\n")[0]}`); }
      if (!cfg.dry) await saveState(state);
    }
  } finally { await browser.close(); }

  log(`Khatam: ${ok} ho gaye, ${bad} fail, ${dead.size}/${cfg.aiKeys.length} key khatam.`);
  if (allDead || dead.size >= cfg.aiKeys.length) {
    state.pauseUntil = nextResume(); if (!cfg.dry) await saveState(state);
    log(`🔑 Sab key ki limit khatam. Agla run: ${state.pauseUntil} (UTC) — subah ${cfg.resumeHour} baje IST.`);
    summary.push(`⏸ Sab key khatam — agla run ${state.pauseUntil} (UTC), subah ${cfg.resumeHour} baje IST`); setOutput("next", "pause"); return;
  }
  const left = (await computePending(state)).pending.length;
  if (left > 0 && ok > 0) setOutput("next", "continue"); else setOutput("next", left ? "stop" : "done");
  if (bad && !ok) process.exitCode = 1;
}
const MODE = process.argv[2];
(MODE === "--gate" ? gate() : main()).catch((e) => { console.error(e); summary.push("❌ " + e.message); process.exitCode = 1; }).finally(() => {
  if (MODE === "--gate") return;
  const md = "## SSC PYQ automation\n\n" + summary.map((s) => "- " + s).join("\n") + "\n";
  fs.writeFileSync(path.join(OUT, "summary.md"), md);
  if (E.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md); } catch (e) {}
});
