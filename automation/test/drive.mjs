import { startGH, startAI, seed, store, stats } from "./fake.mjs";
import fs from "node:fs"; import http from "node:http"; import { spawnSync, spawn } from "node:child_process";
const idx = fs.readFileSync("/home/claude/vimaldahake/mock_question_paper/mock/cgl/index.json", "utf8");
seed("mock/cgl/index.json", idx); if (process.env.T_STATE) seed("automation/state.json", process.env.T_STATE);
startGH(8801); startAI(8802);
const pdfSrv = http.createServer((q, r) => { try { const b = fs.readFileSync("/home/claude/work/pdfrepo" + decodeURIComponent(q.url.split("?")[0])); r.writeHead(200); r.end(b); } catch (e) { r.writeHead(404); r.end(); } }).listen(8803, "127.0.0.1");
fs.writeFileSync("/tmp/list_test.json", JSON.stringify({ "2023Hindi": [null, { name: "2023 Question Paper 1 Hindi", pdfUrl: "http://127.0.0.1:8803/Hindi/1.pdf" }, { name: "2023 Question Paper 2 Hindi", pdfUrl: "http://127.0.0.1:8803/Hindi/2.pdf" }] }));
const env = { ...process.env, GH_TOKEN: "tok", GH_REPO: "vimaldahake/mock_question_paper", GH_API: "http://127.0.0.1:8801", AI_BASE: "http://127.0.0.1:8802/v1", AI_KEYS: process.env.T_KEYS || "k1,k2", PDF_LIST: "/tmp/list_test.json", TEST_MODULE: "/home/claude/work/automation/test/hook.mjs", CAT_IMAGE: "https://example.com/c.png", ...(process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {}) };
const p = spawn("node", ["run.mjs", ...(process.env.T_ARGS ? [process.env.T_ARGS] : [])], { cwd: "/home/claude/work/automation", env, stdio: "inherit" });
p.on("exit", (code) => {
  if (store.has("automation/state.json")) console.log("STATE", store.get("automation/state.json").content.toString());
  console.log("exit", code, "puts", stats.puts, "ai", stats.ai);
  console.log([...store.keys()].filter((k) => !k.startsWith("CGL/")).join("\n"));
  console.log("image files:", [...store.keys()].filter((k) => k.startsWith("CGL/")).length);
  for (const [k,v] of store) if (/Q(4|1)\/.*png$/.test(k)) { fs.mkdirSync("/tmp/imgs",{recursive:true}); fs.writeFileSync("/tmp/imgs/"+k.replace(/\//g,"_"), v.content); }
  fs.writeFileSync("/tmp/test_store.json", JSON.stringify(Object.fromEntries([...store].filter(([k]) => /json$/.test(k)).map(([k, v]) => [k, v.content.toString("utf8")]))));
  process.exit(0);
});
