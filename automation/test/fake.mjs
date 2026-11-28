// Test ke liye: nakli GitHub API + nakli AI (OpenAI jaisa) + PDF file server.
import http from "node:http";
import fs from "node:fs";
export const store = new Map();   // path -> {content:Buffer, sha}
let shaN = 1; const mkSha = () => "sha" + shaN++;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
export function seed(p, text) { store.set(p, { content: Buffer.from(text), sha: mkSha() }); }
export const stats = { puts: 0, ai: 0 };
export function startGH(port) {
  const srv = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, "http://x"); const m = /^\/repos\/([^/]+\/[^/]+)(\/contents\/(.*))?$/.exec(u.pathname);
    const send = (code, obj, raw) => { res.writeHead(code, { ...cors, "Content-Type": raw ? "text/plain" : "application/json" }); res.end(raw ? obj : JSON.stringify(obj)); };
    if (!m) return send(404, { message: "no" });
    if (!m[2]) return send(200, { full_name: m[1], permissions: { push: true } });
    const p = decodeURIComponent(m[3]);
    if (req.method === "GET") {
      const f = store.get(p); if (!f) return send(404, { message: "Not Found" });
      if (/raw/.test(req.headers.accept || "")) return send(200, f.content.toString("utf8"), true);
      return send(200, { sha: f.sha, name: p.split("/").pop(), path: p, type: "file" });
    }
    if (req.method === "PUT") {
      let b = ""; for await (const c of req) b += c; const j = JSON.parse(b); const f = store.get(p);
      if (f && j.sha !== f.sha) return send(422, { message: "sha wasn't supplied" });
      store.set(p, { content: Buffer.from(j.content, "base64"), sha: mkSha() }); stats.puts++;
      return send(f ? 200 : 201, { content: { sha: store.get(p).sha, path: p } });
    }
    send(405, {});
  }); srv.listen(port, "127.0.0.1"); return srv;
}
let q = 0; const calls = {};
export function startAI(port) {
  const modes = JSON.parse(process.env.KEYMODES || "{}");
  const srv = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let b = ""; for await (const c of req) b += c;
    const key = (req.headers.authorization || "").replace(/^Bearer /, ""); const mode = modes[key] || "ok";
    const j = (code, o) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url.endsWith("/models")) return j(200, { data: [{ id: "m-good" }, { id: "m-embed-x" }, { id: "m-vision2" }] });
    calls[key] = (calls[key] || 0) + 1; stats.ai++;
    const m = /^die(\d+)$/.exec(mode);
    if (mode === "402" || (m && calls[key] > +m[1])) return j(402, { error: { message: "insufficient balance, please recharge" } });
    if (mode === "quota429") return j(429, { error: { message: "daily quota exceeded for this key" } });
    if (/Image me jo text likha hai/.test(b)) return j(200, { choices: [{ message: { content: "K7 Q9" } }] });
    q++; const letter = "ABCD"[q % 4];
    const text = `Question: टेस्ट प्रश्न ${q} — सही उत्तर चुनिए।\n[A] पहला विकल्प ${q}\n[B] दूसरा विकल्प ${q}\n[C] तीसरा विकल्प ${q}\n[D] चौथा विकल्प ${q}\nSahi Answer: ${letter}\nExplanation: यह नकली व्याख्या है (${q}).`;
    j(200, { id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: {} });
  }); srv.listen(port, "127.0.0.1"); return srv;
}
