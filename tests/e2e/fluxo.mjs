// =====================================================================
// Roteiro ponta a ponta no navegador (Chromium) — prompt mestre, seção 17.
// Executado por tests/e2e/rodar.sh. Somente dados fictícios.
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
const API = "http://localhost:54321";
const AGORA = new Date(process.env.E2E_AGORA);
const SAIDA = process.env.E2E_SAIDA;
fs.mkdirSync(SAIDA, { recursive: true });
const sql = (q) => execFileSync("psql", ["-X", "-qAt", "-d", process.env.E2E_DB, "-c", q]).toString().trim();
const logIA = () => (fs.existsSync(process.env.E2E_LOG_IA) ? fs.readFileSync(process.env.E2E_LOG_IA, "utf8") : "")
  .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

let passou = 0;
async function etapa(nome, fn) {
  try { await fn(); passou++; console.log(`ok - ${nome}`); }
  catch (e) { console.log(`FALHOU - ${nome}\n  ${e.message.split("\n").slice(0, 6).join("\n  ")}`); await fotos("falha"); throw e; }
}

const navegador = await playwright.chromium.launch();
const errosConsole = [];
async function novaPagina(largura = 1280) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: 900 }, acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.clock.setFixedTime(AGORA);
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errosConsole.push(m.text()); });
  p.on("pageerror", (e) => errosConsole.push(String(e)));
  return p;
}
let pagina;
async function fotos(nome) { try { await pagina?.screenshot({ path: `${SAIDA}/${nome}.png`, fullPage: true }); } catch { /* ignora */ } }
async function entrar(p, email, senha) {
  await p.goto(SITE);
  await p.getByLabel("E-mail").fill(email);
  await p.getByLabel("Senha").fill(senha);
  await p.getByRole("button", { name: "Entrar" }).click();
}
const toastTem = async (p, texto) => p.locator("#toast").filter({ hasText: texto }).waitFor({ timeout: 15000 });

try {
  // ------------------------------------------------------------------ acesso
  await etapa("API recusa leitura sem login (chave pública sozinha)", async () => {
    const r = await fetch(`${API}/rest/v1/alunos?select=*`, { headers: { apikey: process.env.E2E_ANON_KEY } });
    assert.notEqual(r.status, 200, `status ${r.status}`);
    const f = await fetch(`${API}/functions/v1/gerar-mensagem`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ aluno_id: "11111111-2222-4333-8444-555555555555", modo: "manual" }) });
    assert.equal(f.status, 401);
  });

  await etapa("site sem login mostra a tela de entrada", async () => {
    pagina = await novaPagina();
    await pagina.goto(SITE);
    await pagina.getByRole("heading", { name: "Painel de Follow-up" }).waitFor();
  });

  await etapa("usuário logado mas não liberado não vê dados", async () => {
    await entrar(pagina, "visitante.teste@exemplo.invalid", "senha-visitante-teste-123");
    await pagina.getByRole("heading", { name: "Acesso aguardando liberação" }).waitFor();
    await pagina.getByRole("button", { name: "Sair" }).click();
    await pagina.getByRole("button", { name: "Entrar" }).waitFor();
  });

  await etapa("senha errada é recusada", async () => {
    await entrar(pagina, "operadora.teste@exemplo.invalid", "senha-errada");
    await toastTem(pagina, "E-mail ou senha incorretos");
  });

  await etapa("operadora entra e vê o estado inicial vazio", async () => {
    await entrar(pagina, "operadora.teste@exemplo.invalid", "senha-operadora-teste-123");
    await pagina.getByText("Nenhum aluno cadastrado ainda").waitFor();
    await pagina.getByText("O nome de quem assina as mensagens ainda não foi configurado").waitFor();
    await pagina.getByText("mensagens prontas às 9h, de segunda a sexta").waitFor();
    await fotos("01-painel-vazio");
  });

  // ------------------------------------------------------------ configurações
  await etapa("configurações persistem", async () => {
    await pagina.getByRole("link", { name: "Configurações" }).first().click();
    await pagina.getByLabel("Nome de quem assina as mensagens").fill("Clara Teste");
    await pagina.getByLabel("Link do passo a passo para acessar a plataforma").fill("ftp://errado");
    await pagina.getByRole("button", { name: "Salvar configurações" }).click();
    await toastTem(pagina, "devem começar com https");
    await pagina.getByLabel("Link do passo a passo para acessar a plataforma").fill("https://exemplo.invalid/acesso");
    await pagina.getByRole("button", { name: "Salvar configurações" }).click();
    await toastTem(pagina, "Configurações salvas");
    await pagina.reload();
    await pagina.getByLabel("Nome de quem assina as mensagens").waitFor();
    assert.equal(await pagina.getByLabel("Nome de quem assina as mensagens").inputValue(), "Clara Teste");
    assert.equal(sql("select assinante || '|' || link_acesso from configuracoes"), "Clara Teste|https://exemplo.invalid/acesso");
  });

  // ------------------------------------------------------------------ cadastro
  await etapa("cadastro com todos os campos vazios", async () => {
    await pagina.goto(SITE + "#/novo");
    await pagina.getByRole("button", { name: "Só salvar" }).click();
    await pagina.getByRole("heading", { name: "Aluno sem nome" }).waitFor();
    assert.equal(sql("select count(*) from alunos"), "1");
  });

  const compra = new Date(AGORA.getTime() - 10 * 864e5).toISOString().slice(0, 10);
  await etapa("cadastro completo + “Salvar e gerar 1ª mensagem”", async () => {
    await pagina.goto(SITE + "#/novo");
    await pagina.getByLabel("Nome").fill("Aluno Fictício A");
    await pagina.getByLabel("E-mail").fill("aluno.a@exemplo.invalid");
    await pagina.getByLabel("Telefone/WhatsApp").fill("(11) 90000-1111");
    await pagina.getByLabel("Data da compra").fill(compra);
    await pagina.getByLabel("Nunca acessou a plataforma").check();
    await pagina.getByLabel("Não assinou o contrato").check();
    await pagina.locator("#d_contrato").fill("3");
    await pagina.getByText("Transição de carreira").click();
    await pagina.getByLabel("Dor principal").fill("Quer migrar para a área de dados");
    await pagina.getByLabel("Curso").selectOption({ label: "Inteligência Artificial aplicada a Negócios" });
    await pagina.getByLabel("Observações").fill("Prefere contato à tarde");
    // resumo lateral dinâmico: 10 dias, prazo 7 → vencido; 1ª mensagem → Acolhedor
    await pagina.locator("#resumo-lateral").getByText("prazo vencido").waitFor();
    await pagina.locator("#resumo-lateral").getByText("Acolhedor").waitFor();
    await fotos("02-cadastro");
    await pagina.getByRole("button", { name: "Salvar e gerar 1ª mensagem" }).click();
    await pagina.getByRole("heading", { name: "Aluno Fictício A" }).waitFor();
    await pagina.locator("#texto-msg").filter({ hasText: "Mensagem de TESTE (tom Acolhedor)" }).waitFor({ timeout: 20000 });
    await pagina.getByText("Mensagem de hoje · dia 1").waitFor();
    await fotos("03-acompanhamento");
  });

  await etapa("a IA recebeu os dados certos (servidor, chave só no servidor)", async () => {
    const ultimo = logIA().at(-1);
    assert.equal(ultimo.chave, "chave-falsa-de-teste");
    for (const t of ["Aluno Fictício A", "apresente-se como Clara Teste", "pendente há 10 dias", "pendente há 3 dias",
      "Transição de carreira", "Quer migrar", "Prefere contato à tarde", "https://exemplo.invalid/acesso",
      "Sem link configurado", "Sucesso do Aluno da Pós-graduação em Inteligência Artificial aplicada a Negócios"]) {
      assert.ok(ultimo.usuario.includes(t), `prompt sem: ${t}`);
    }
  });

  await etapa("copiar não marca como enviada; marcar e desfazer funcionam", async () => {
    await pagina.getByRole("button", { name: "Copiar mensagem" }).click();
    await toastTem(pagina, "Mensagem copiada");
    assert.equal(sql("select estado_envio from mensagens"), "nao_enviada");
    await pagina.getByRole("button", { name: "Marcar como enviada" }).click();
    await pagina.getByText("Enviada ✓").waitFor();
    assert.equal(sql("select estado_envio from mensagens"), "enviada");
    await pagina.getByRole("button", { name: "desfazer" }).click();
    await pagina.getByRole("button", { name: "Marcar como enviada" }).waitFor();
    assert.equal(sql("select estado_envio from mensagens"), "nao_enviada");
    await pagina.getByRole("button", { name: "Marcar como enviada" }).click();
    await pagina.getByText("Enviada ✓").waitFor();
  });

  await etapa("resposta do aluno é registrada e usada na próxima geração", async () => {
    await pagina.getByLabel("Resposta do aluno").fill("Oi! Vou tentar acessar hoje à noite.");
    await pagina.getByRole("button", { name: "Salvar resposta" }).click();
    await toastTem(pagina, "Resposta salva");
    await pagina.locator(".lista-hist").getByText("Vou tentar acessar hoje à noite").waitFor();
  });

  await etapa("“Gerar nova mensagem” com outro tom e instrução preserva o histórico", async () => {
    await pagina.getByRole("button", { name: "Firme" }).click();
    await pagina.getByText("O que mudar na mensagem (opcional)").click();
    await pagina.getByLabel("O que mudar na mensagem").fill("Mais curta");
    await pagina.getByRole("button", { name: "Gerar nova mensagem" }).click();
    await pagina.locator("#texto-msg").filter({ hasText: "tom Firme" }).waitFor({ timeout: 20000 });
    assert.equal(await pagina.getByLabel("O que mudar na mensagem").inputValue(), "", "instrução limpa após sucesso");
    const ultimo = logIA().at(-1);
    assert.ok(ultimo.usuario.includes("Vou tentar acessar hoje à noite"), "resposta no contexto da IA");
    assert.ok(ultimo.usuario.includes("INSTRUÇÃO DA EQUIPE PARA ESTA MENSAGEM: Mais curta"));
    assert.equal(sql("select count(*) from mensagem_versoes"), "2");
    assert.equal(sql("select count(*) from mensagens"), "1", "continua uma mensagem por dia");
    await pagina.getByText("Instrução usada: Mais curta").waitFor();
    assert.equal(await pagina.locator(".lista-hist .tag", { hasText: /^Enviada$/ }).count(), 1, "versão 1 continua enviada");
    assert.equal(sql("select estado_envio from mensagens"), "nao_enviada", "nova versão começa não enviada");
  });

  await etapa("edição de dados não reinicia a contagem de dias", async () => {
    const antes = sql("select string_agg(tipo||':'||data_referencia, ',' order by tipo) from pendencias p join alunos a on a.id=p.aluno_id where a.nome='Aluno Fictício A'");
    await pagina.getByRole("link", { name: "Editar dados" }).click();
    await pagina.getByLabel("Dor principal").fill("Quer migrar para dados até o fim do ano");
    await pagina.getByRole("button", { name: "Salvar alterações" }).click();
    await toastTem(pagina, "Dados salvos");
    await pagina.getByText("Quer migrar para dados até o fim do ano").waitFor();
    const depois = sql("select string_agg(tipo||':'||data_referencia, ',' order by tipo) from pendencias p join alunos a on a.id=p.aluno_id where a.nome='Aluno Fictício A'");
    assert.equal(depois, antes);
  });

  // ---------------------------------------------------------------- painel
  await etapa("painel: quadros, filtros por curso, situação e busca", async () => {
    await pagina.goto(SITE + "#/");
    await pagina.locator(".card-resumo").first().waitFor();
    const num = async (rot) => (await pagina.locator(".card-resumo", { hasText: rot }).locator(".num").textContent()).trim();
    assert.equal(await num("Em acompanhamento"), "2");
    assert.equal(await num("Não assinou contrato"), "1");
    assert.equal(await num("Nunca acessou"), "1");
    assert.equal(await num("Sem documentação"), "0");
    assert.equal(await num("Vencendo ou vencido"), "1");
    assert.equal(await num("Mensagens pendentes hoje"), "1");
    assert.equal(await num("Pendências resolvidas"), "0");
    const linhas = () => pagina.locator("tbody tr").count();
    assert.equal(await linhas(), 2);
    assert.equal(await pagina.locator("tbody tr").first().locator("td").first().locator("strong").textContent(), "Aluno Fictício A",
      "ordenado por mais dias em aberto");
    await pagina.locator(".chip", { hasText: "IA aplicada a Negócios" }).click();
    assert.equal(await linhas(), 1);
    await pagina.locator(".chip", { hasText: "Todas as pós" }).click();
    await pagina.getByPlaceholder("Buscar por nome, e-mail ou telefone").fill("90000-1111");
    assert.equal(await linhas(), 1);
    await pagina.getByPlaceholder("Buscar por nome, e-mail ou telefone").fill("inexistente");
    await pagina.getByText("Nenhum aluno encontrado com estes filtros.").waitFor();
    await pagina.getByPlaceholder("Buscar por nome, e-mail ou telefone").fill("");
    await pagina.locator("#f-situacao").selectOption("contrato");
    assert.equal(await linhas(), 1);
    await pagina.locator("#f-situacao").selectOption("");
    await pagina.locator("#f-msg").selectOption("pronta");
    assert.equal(await linhas(), 1);
    await pagina.locator("#f-msg").selectOption("");
    await pagina.locator(".card-resumo", { hasText: "Vencendo ou vencido" }).click();
    assert.equal(await linhas(), 1);
    await pagina.locator(".card-resumo", { hasText: "Vencendo ou vencido" }).click();
    await pagina.locator("#area-tabela").getByText("Pronta para enviar").waitFor();
    await fotos("04-painel");
  });

  await etapa("resolver todas as pendências conclui; reabrir volta ao acompanhamento", async () => {
    await pagina.locator("tbody tr", { hasText: "Aluno Fictício A" }).click();
    await pagina.getByLabel("Nunca acessou a plataforma").check();
    await toastTem(pagina, "");
    await pagina.getByText(/Resolvida em/).first().waitFor();
    await pagina.getByLabel("Não assinou o contrato").check();
    await pagina.getByText("Acompanhamento concluído.", { exact: true }).waitFor();
    assert.equal(await pagina.getByRole("button", { name: /Gerar/ }).count(), 0, "sem geração para concluído");
    await pagina.goto(SITE + "#/");
    assert.equal((await pagina.locator(".card-resumo", { hasText: "Pendências resolvidas" }).locator(".num").textContent()).trim(), "1");
    await pagina.locator(".card-resumo", { hasText: "Pendências resolvidas" }).click();
    await pagina.locator("tbody tr", { hasText: "Aluno Fictício A" }).click();
    await pagina.getByLabel("Não assinou o contrato").uncheck();
    await pagina.getByText("Mensagem de hoje · dia 1").waitFor();
    assert.equal(sql("select estado_acompanhamento from alunos where nome='Aluno Fictício A'"), "em_acompanhamento");
  });

  await etapa("lote diário às 10h gera para quem falta, sem duplicar ao recarregar", async () => {
    await pagina.goto(SITE + "#/novo");
    await pagina.getByLabel("Nome").fill("Aluno Fictício B");
    await pagina.getByLabel("Não subiu a documentação").check();
    await pagina.getByRole("button", { name: "Só salvar" }).click();
    await pagina.getByRole("heading", { name: "Aluno Fictício B" }).waitFor();
    // nova aba = "primeiro acesso" → geração automática a partir das 9h
    const outra = await novaPagina();
    await entrar(outra, "operadora.teste@exemplo.invalid", "senha-operadora-teste-123");
    await outra.getByText("Mensagens de hoje prontas.").waitFor({ timeout: 30000 });
    await outra.reload();
    await outra.locator(".card-resumo").first().waitFor();
    await outra.waitForTimeout(1500);
    assert.equal(sql("select count(*) from mensagens m join alunos a on a.id=m.aluno_id where a.nome='Aluno Fictício B'"), "1");
    assert.equal(sql("select count(*) from mensagem_versoes v join mensagens m on m.id=v.mensagem_id join alunos a on a.id=m.aluno_id where a.nome='Aluno Fictício B'"), "1");
    await outra.context().close();
  });

  await etapa("persistência após recarregar e acesso por outro navegador autorizado", async () => {
    await pagina.reload();
    const admin = await novaPagina();
    await entrar(admin, "admin.teste@exemplo.invalid", "senha-admin-teste-123");
    await admin.locator("tbody tr", { hasText: "Aluno Fictício A" }).waitFor();
    await admin.locator("tbody tr", { hasText: "Aluno Fictício B" }).waitFor();
    await admin.context().close();
  });

  // --------------------------------------------------- exclusão e backup
  let arquivoBackup;
  await etapa("exportar backup", async () => {
    await pagina.goto(SITE + "#/configuracoes");
    const [download] = await Promise.all([pagina.waitForEvent("download"),
      pagina.getByRole("button", { name: "Exportar backup" }).click()]);
    arquivoBackup = `${SAIDA}/backup-teste.json`;
    await download.saveAs(arquivoBackup);
    const b = JSON.parse(fs.readFileSync(arquivoBackup, "utf8"));
    assert.equal(b.formato, "painel-follow-up-nta");
    assert.equal(b.alunos.length, 3);
    assert.equal(b.mensagem_versoes.length, 3);
    assert.equal(b.respostas.length, 1);
    assert.ok(b.configuracoes.assinante === "Clara Teste");
    assert.equal(await pagina.getByText("Importar backup: somente administradores.").count(), 1);
  });

  await etapa("exclusão exige dois cliques", async () => {
    await pagina.goto(SITE + "#/");
    await pagina.locator("tbody tr", { hasText: "Aluno Fictício A" }).click();
    await pagina.getByRole("button", { name: "Excluir aluno" }).click();
    await pagina.getByRole("button", { name: "Confirmar exclusão definitiva" }).waitFor();
    assert.equal(sql("select count(*) from alunos where nome='Aluno Fictício A'"), "1", "1º clique não exclui");
    await fotos("05-confirmar-exclusao");
    await pagina.getByRole("button", { name: "Confirmar exclusão definitiva" }).click();
    await toastTem(pagina, "Aluno excluído");
    assert.equal(sql("select count(*) from alunos where nome='Aluno Fictício A'"), "0");
    assert.equal(sql("select count(*) from respostas"), "0");
  });

  await etapa("importar backup (admin): prévia, confirmação e sem duplicar", async () => {
    const admin = await novaPagina();
    await entrar(admin, "admin.teste@exemplo.invalid", "senha-admin-teste-123");
    await admin.locator(".card-resumo").first().waitFor();
    await admin.goto(SITE + "#/configuracoes");
    fs.writeFileSync(`${SAIDA}/invalido.json`, '{"qualquer":1}');
    await admin.locator("#arquivo-backup").setInputFiles(`${SAIDA}/invalido.json`);
    await admin.getByText("não é um backup do Painel de Follow-up").waitFor();
    await admin.locator("#arquivo-backup").setInputFiles(arquivoBackup);
    await admin.getByText("Prévia da importação").waitFor();
    await admin.getByText("1 aluno(s) novo(s) · 2 já existente(s) serão ignorados").waitFor();
    assert.equal(sql("select count(*) from alunos where nome='Aluno Fictício A'"), "0", "prévia não grava");
    await admin.getByRole("button", { name: "Confirmar importação" }).click();
    await admin.getByText("Importação concluída: 1 aluno(s) novo(s).").waitFor();
    assert.equal(sql("select count(*) from alunos where nome='Aluno Fictício A'"), "1");
    assert.equal(sql("select count(*) from respostas"), "1");
    assert.equal(sql("select count(*) from mensagem_versoes v join mensagens m on m.id=v.mensagem_id join alunos a on a.id=m.aluno_id where a.nome='Aluno Fictício A'"), "2");
    await admin.locator("#arquivo-backup").setInputFiles(arquivoBackup);
    await admin.getByText("0 aluno(s) novo(s) · 3 já existente(s) serão ignorados").waitFor();
    assert.ok(await admin.getByRole("button", { name: "Confirmar importação" }).isDisabled());
    await admin.locator("#usuarios").getByText("visitante.teste@exemplo.invalid").waitFor();
    await admin.context().close();
  });

  // ---------------------------------------------------- horários e telas
  await etapa("antes das 9h: mensagem “ficam prontas a partir das 9h” e “Gerar agora”", async () => {
    sql("update pendencias set estado='pendente' where tipo='acesso'");
    const cedo = await novaPagina();
    await cedo.context().clock.setFixedTime(new Date(AGORA.getTime() - 2 * 3600e3));   // 8h
    await entrar(cedo, "operadora.teste@exemplo.invalid", "senha-operadora-teste-123");
    await cedo.locator(".card-resumo").first().waitFor();
    // todos já têm mensagem hoje → sem banner; cria aluno novo para aparecer o aviso
    sql("insert into alunos (nome) values ('Aluno Fictício C'); update pendencias set marcada=true where tipo='acesso' and aluno_id=(select id from alunos where nome='Aluno Fictício C')");
    await cedo.reload();
    await cedo.getByText("As mensagens de hoje ficam prontas a partir das 9h").waitFor();
    await cedo.getByRole("button", { name: "Gerar agora" }).waitFor();
    await cedo.context().close();
  });

  await etapa("fim de semana: sem geração", async () => {
    const sabado = new Date(AGORA);
    while (sabado.getUTCDay() !== 6) sabado.setTime(sabado.getTime() + 864e5);
    const fds = await novaPagina();
    await fds.context().clock.setFixedTime(sabado);
    await entrar(fds, "operadora.teste@exemplo.invalid", "senha-operadora-teste-123");
    await fds.getByText("Hoje não há geração de mensagens").waitFor();
    await fds.context().close();
  });

  await etapa("celular (375 px): tabela com rolagem horizontal e layout responsivo", async () => {
    const cel = await novaPagina(375);
    await entrar(cel, "operadora.teste@exemplo.invalid", "senha-operadora-teste-123");
    await cel.locator(".tabela-rolagem").waitFor();
    await cel.getByText("Preparando as mensagens de hoje").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    const { rola, pagina: larguraPagina } = await cel.evaluate(() => ({
      rola: document.querySelector(".tabela-rolagem").scrollWidth > document.querySelector(".tabela-rolagem").clientWidth,
      pagina: document.documentElement.scrollWidth }));
    assert.ok(rola, "tabela rola na horizontal");
    assert.ok(larguraPagina <= 375, `página não rola na horizontal (${larguraPagina}px)`);
    const altura = await cel.getByRole("link", { name: "+ Cadastrar aluno" }).evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(altura >= 44, "botões com pelo menos 44 px");
    pagina = cel; await fotos("06-celular");
    await cel.locator("tbody tr").first().click();
    await cel.getByRole("heading", { name: /Mensagem de hoje · dia/ }).waitFor();
    await fotos("07-celular-acompanhamento");
    await cel.context().close();
  });

  await etapa("nenhuma chave secreta nos arquivos do site", async () => {
    const arquivos = ["index.html", ...fs.readdirSync("assets", { recursive: true }).map((f) => `assets/${f}`)]
      .filter((f) => fs.statSync(f).isFile());
    for (const a of arquivos) {
      const t = fs.readFileSync(a, "utf8");
      assert.ok(!/sk-ant-[A-Za-z0-9_-]{8,}/.test(t), `chave da Anthropic em ${a}`);
      for (const jwt of t.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []) {
        const carga = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
        assert.notEqual(carga.role, "service_role", `chave de serviço do Supabase em ${a}`);
      }
    }
  });

  await etapa("sem erros de JavaScript no console", async () => {
    const relevantes = errosConsole.filter((e) => !/fonts\.g|Failed to load resource|ERR_|net::/.test(e));
    assert.deepEqual(relevantes, []);
  });

  console.log(`\n✓ navegador: ${passou} etapas aprovadas`);
} finally {
  await navegador.close();
}
