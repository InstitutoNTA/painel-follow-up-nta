// =====================================================================
// Ambiente LOCAL de teste ponta a ponta (não é usado em produção).
//  * :54321  imita o endereço único do Supabase, repassando para os
//            serviços reais rodando localmente:
//              /auth/v1/*       → Supabase Auth (GoTrue) :9999
//              /rest/v1/*       → PostgREST :3000
//              /functions/v1/*  → Edge Function no Deno :8000
//  * :8080   serve o site (index.html e assets) com config.js de teste
//  * :8787   dublê da API do Claude: devolve um texto fixo de TESTE, para
//            validar o fluxo sem gastar créditos nem usar dados reais.
// =====================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(new URL("../..", import.meta.url).pathname);
const ANON = process.env.E2E_ANON_KEY;
const destinos = [["/auth/v1", 9999], ["/rest/v1", 3000], ["/functions/v1/gerar-mensagem", 8000]];

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-total-count",
};

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const alvo = destinos.find(([pref]) => req.url.startsWith(pref));
  if (!alvo) { res.writeHead(404, cors); res.end("{}"); return; }
  const caminho = req.url.slice(alvo[0].length) || "/";
  const prox = http.request({ host: "127.0.0.1", port: alvo[1], path: caminho, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${alvo[1]}` } }, (r) => {
    const cab = { ...r.headers, ...cors };
    delete cab["access-control-allow-origin"]; Object.assign(cab, { "access-control-allow-origin": "*" });
    res.writeHead(r.statusCode, cab);
    r.pipe(res);
  });
  prox.on("error", () => { res.writeHead(502, cors); res.end('{"message":"serviço local indisponível"}'); });
  req.pipe(prox);
}).listen(54321);

const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json" };
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  if (url === "/assets/js/config.js") {
    res.writeHead(200, { "content-type": tipos[".js"] });
    res.end(`export const CONFIG = { supabaseUrl: "http://localhost:54321", supabaseAnonKey: "${ANON}" };`);
    return;
  }
  const arquivo = path.join(RAIZ, path.normalize(url));
  if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    res.writeHead(404); res.end("não encontrado"); return;
  }
  let corpo = fs.readFileSync(arquivo);
  if (url === "/index.html") {   // libera o endereço local na política de segurança (só no teste)
    corpo = corpo.toString().replace("connect-src 'self'", "connect-src 'self' http://localhost:54321");
  }
  res.writeHead(200, { "content-type": tipos[path.extname(arquivo)] || "application/octet-stream" });
  res.end(corpo);
}).listen(8080);

// Dublê da API do Claude (somente teste)
export const pedidosIA = [];
http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => { corpo += c; });
  req.on("end", () => {
    const pedido = JSON.parse(corpo || "{}");
    fs.appendFileSync(process.env.E2E_LOG_IA || "/dev/null", JSON.stringify({
      chave: req.headers["x-api-key"], modelo: pedido.model, usuario: pedido.messages?.[0]?.content }) + "\n");
    const tom = /TOM ESCOLHIDO: (\w+)/.exec(pedido.messages?.[0]?.content || "")?.[1] || "?";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ model: pedido.model, stop_reason: "end_turn",
      content: [{ type: "text", text: `Mensagem de TESTE (tom ${tom}). Oi! Passando para ajudar com a sua pendência.` }] }));
  });
}).listen(8787);

console.log("ambiente e2e no ar: site http://localhost:8080 · gateway http://localhost:54321");
