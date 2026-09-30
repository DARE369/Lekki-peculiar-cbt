// Minimal stand-in for the Supabase API gateway: /rest/v1 → PostgREST, /auth/v1 → GoTrue.
import http from "node:http";

const routes = [
  ["/rest/v1", Number(process.env.PGRST_PORT ?? 54331)],
  ["/auth/v1", Number(process.env.GOTRUE_PORT ?? 54332)],
];
const port = Number(process.env.PROXY_PORT ?? 54321);

http
  .createServer((req, res) => {
    const hit = routes.find(([p]) => req.url.startsWith(p));
    if (!hit) {
      res.writeHead(404).end("not found");
      return;
    }
    const [prefix, target] = hit;
    const headers = { ...req.headers, host: `127.0.0.1:${target}` };
    const up = http.request({ host: "127.0.0.1", port: target, path: req.url.slice(prefix.length) || "/", method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => res.writeHead(502).end(String(e)));
    req.pipe(up);
  })
  .listen(port, "127.0.0.1", () => console.log(`supabase proxy on http://127.0.0.1:${port}`));
