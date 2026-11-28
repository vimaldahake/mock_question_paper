// run.mjs me TEST_MODULE: browser ke "https://api.github.com/**" ko nakli server par bhejo
export async function setup(ctx, cfg) {
  await ctx.route("https://api.github.com/**", async (route) => {
    const r = route.request(); const u = new URL(r.url());
    const resp = await fetch(process.env.GH_API + u.pathname + u.search, { method: r.method(), headers: r.headers(), body: ["GET", "HEAD"].includes(r.method()) ? undefined : r.postData() });
    const body = Buffer.from(await resp.arrayBuffer());
    await route.fulfill({ status: resp.status, headers: { "access-control-allow-origin": "*", "content-type": resp.headers.get("content-type") || "application/json" }, body });
  });
}
