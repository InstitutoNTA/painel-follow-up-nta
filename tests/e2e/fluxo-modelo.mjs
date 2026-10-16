// =====================================================================
// Roteiro ponta a ponta do MODO SEM IA (modelos automáticos).
// Executado por: E2E_MODO=modelo E2E_FLUXO=fluxo-modelo.mjs tests/e2e/rodar.sh
// Confere que a mensagem é escrita pelo modelo, gravada pelo banco com as
// mesmas regras e que a função de IA NÃO é chamada. Somente dados fictícios.
// =====================================================================
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright"); }

const SITE = "http://localhost:8080/";
const AGORA = new Date(process.env.E2E_AGORA);
const SAIDA = process.env.E2E_SAIDA;
fs.mkdirSync(SAIDA, { recursive: true });
const sql = (q) => execFileSync("psql", ["-X", "-qAt", "-d", process.env.E2E_DB, "-c", q]).toString().trim();
const chamadasIA = () => (fs.existsSync(process.env.E2E_LOG_IA) ? fs.readFileSync(process.env.E2E_LOG_IA, "utf8") : "")
  .trim().split("\n").filter(Boolean).length;

let passou = 0, pagina;
const errosConsole = [];
async function fotos(nome) { try { await pagina?.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: true }); } catch { /* ignora */ } }
async function etapa(nome, fn) {
  try { await fn(); passou++; console.log(`ok - ${nome}`); }
  catch (e) { console.log(`FALHOU - ${nome}\n  ${e.message.split("\n").slice(0, 6).join("\n  ")}`); await fotos("modelo-falha"); throw e; }
}
const toastTem = async (p, texto) => p.locator("#toast").filter({ hasText: texto }).waitFor({ timeout: 15000 });

const navegador = await playwright.chromium.launch();
try {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.clock.setFixedTime(AGORA);
  pagina = await ctx.newPage();
  pagina.on("console", (m) => { if (m.type() === "error") errosConsole.push(m.text()); });
  pagina.on("pageerror", (e) => errosConsole.push(String(e)));

  await etapa("operadora entra e configura assinante e link", async () => {
    await pagina.goto(SITE);
    await pagina.getByLabel("E-mail").fill("operadora.teste@exemplo.invalid");
    await pagina.getByLabel("Senha").fill("senha-operadora-teste-123");
    await pagina.getByRole("button", { name: "Entrar" }).click();
    await pagina.getByText("Nenhum aluno cadastrado ainda").waitFor();
    await pagina.getByRole("link", { name: "Configurações" }).first().click();
    await pagina.getByLabel("Nome de quem assina as mensagens").fill("Clara Teste");
    await pagina.getByLabel("Link do passo a passo para acessar a plataforma").fill("https://exemplo.invalid/acesso");
    await pagina.getByRole("button", { name: "Salvar configurações" }).click();
    await toastTem(pagina, "Configurações salvas");
  });

  const compra = new Date(AGORA.getTime() - 10 * 864e5).toISOString().slice(0, 10);
  await etapa("cadastro + 1ª mensagem por modelo automático", async () => {
    await pagina.goto(SITE + "#/novo");
    await pagina.getByLabel("Nome").fill("Aluno Fictício Modelo");
    await pagina.getByLabel("Data da compra").fill(compra);
    await pagina.getByLabel("Nunca acessou a plataforma").check();
    await pagina.getByLabel("Não assinou o contrato").check();
    await pagina.getByLabel("Curso").selectOption({ label: "Inteligência Artificial aplicada a Negócios" });
    await pagina.getByRole("button", { name: "Salvar e gerar 1ª mensagem" }).click();
    await pagina.getByRole("heading", { name: "Aluno Fictício Modelo" }).waitFor();
    const caixa = pagina.locator("#texto-msg");
    await caixa.filter({ hasText: "Oi, Aluno!" }).waitFor({ timeout: 20000 });
    const texto = await caixa.textContent();
    for (const t of ["Aqui é Clara Teste", "acessar a plataforma pela primeira vez (há 10 dias)",
      "https://exemplo.invalid/acesso", "contrato, vou te enviar o passo a passo em seguida"]) {
      assert.ok(texto.includes(t), `mensagem sem: ${t}`);
    }
    await pagina.getByText("modelo automático").first().waitFor();
    assert.equal(sql("select modelo || '|' || tom || '|' || estado_geracao from mensagem_versoes"), "modelo-automatico|Acolhedor|concluida");
    assert.equal(chamadasIA(), 0, "a API de IA não foi chamada");
    await fotos("modelo-01-mensagem");
  });

  await etapa("nova versão com outro tom e frase extra; histórico preservado", async () => {
    await pagina.getByRole("button", { name: "Copiar mensagem" }).click();
    await toastTem(pagina, "Mensagem copiada");
    await pagina.getByRole("button", { name: "Marcar como enviada" }).click();
    await pagina.getByText("Enviada ✓").waitFor();
    await pagina.getByRole("button", { name: "Firme" }).click();
    await pagina.getByText("Frase extra para incluir (opcional)").click();
    await pagina.getByLabel("Frase extra para incluir na mensagem").fill("A aula de boas-vindas é na quinta.");
    await pagina.getByRole("button", { name: "Gerar nova mensagem" }).click();
    await pagina.locator("#texto-msg").filter({ hasText: "A aula de boas-vindas é na quinta." }).waitFor({ timeout: 20000 });
    assert.equal(sql("select count(*) from mensagem_versoes"), "2");
    assert.equal(sql("select count(*) from mensagens"), "1", "continua uma mensagem por dia");
    assert.equal(sql("select tom from mensagem_versoes where versao = 2"), "Firme");
    assert.equal(sql("select estado_envio from mensagens"), "nao_enviada", "nova versão começa não enviada");
    assert.equal(chamadasIA(), 0);
  });

  await etapa("lote do dia não duplica mensagem de quem já tem", async () => {
    await pagina.goto(SITE + "#/");
    await pagina.locator(".card-resumo").first().waitFor();
    assert.equal(sql("select count(*) from mensagens"), "1");
  });

  await etapa("sem erros de JavaScript no console", async () => {
    const relevantes = errosConsole.filter((e) => !/fonts\.g|Failed to load resource|ERR_|net::/.test(e));
    assert.deepEqual(relevantes, []);
  });

  console.log(`\n✓ navegador (modo modelo): ${passou} etapas aprovadas`);
} finally {
  await navegador.close();
}
