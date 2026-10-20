// Tiny HTML page shell for the two pages a parent sees in their browser
// (the Paystack return page and the mock checkout). Not used by the agent.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1a1a; --muted:#666; --bg:#f6f5f2; --card:#fff; --line:#e3e0d9; --accent:#0b6b3a; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eee; --muted:#aaa; --bg:#151514; --card:#1f1f1d; --line:#33322f; --accent:#4cc38a; --bad:#f97066; } }
  body { margin:0; font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width:420px; margin:48px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:24px; }
  h1 { font-size:20px; margin:0 0 8px; } p { margin:8px 0; color:var(--muted); }
  .amt { font-size:28px; font-weight:700; color:var(--ink); margin:16px 0; }
  .ok { color:var(--accent); } .bad { color:var(--bad); }
  .btns { display:flex; gap:8px; margin-top:20px; flex-wrap:wrap; }
  a.btn { flex:1; text-align:center; padding:12px; border-radius:8px; text-decoration:none; font-weight:600; border:1px solid var(--line); color:var(--ink); }
  a.btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  small { color:var(--muted); display:block; margin-top:16px; }
</style></head>
<body><main><div class="card">${bodyHtml}</div></main></body></html>`;
}

export { esc };
