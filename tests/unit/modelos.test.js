// Testes dos modelos automáticos de mensagem (modo sem IA). Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarMensagemModelo, MARCA_MODELO } from "../../assets/js/modelos.js";
import { TONS } from "../../supabase/functions/_shared/regras.js";

const HOJE = "2026-10-16";
const pend = (tipo, marcada = true, estado = "pendente", dias = null) =>
  ({ tipo, marcada, estado, dias_informados: dias, data_referencia: HOJE, resolvida_em: null });
const aluno = (extra = {}) => ({
  nome: "Aluno Fictício da Silva", data_compra: "2026-10-06", data_cadastro: "2026-10-06",
  momento_profissional: "transicao", dor_principal: "", observacoes: "",
  pendencias: [pend("acesso"), pend("contrato", true, "pendente", 3), pend("documentacao", false)],
  ...extra,
});
const CFG = { assinante: "Clara Teste", link_acesso: "https://exemplo.invalid/acesso", link_contrato: "", link_documentacao: "" };
const CURSO = "Inteligência Artificial aplicada a Negócios";
const gerar = (o = {}) => montarMensagemModelo({ aluno: aluno(), curso: CURSO, config: CFG, tom: "Acolhedor",
  primeiroContato: true, dia: 1, hoje: HOJE, ...o });

test("primeiro contato: primeiro nome, apresentação com assinante e nome do time", () => {
  const t = gerar();
  assert.match(t, /^Oi, Aluno!/);
  assert.ok(t.includes("Aqui é Clara Teste, do Sucesso do Aluno da Pós-graduação em Inteligência Artificial aplicada a Negócios"));
  assert.ok(!/NTA/.test(t), "não cita o nome da empresa");
});

test("sem assinante não inventa nome", () => {
  const t = gerar({ config: { ...CFG, assinante: "" } });
  assert.ok(t.includes("Sou do Sucesso do Aluno"));
  assert.ok(!t.includes("Aqui é"));
});

test("depois do primeiro contato não se apresenta de novo", () => {
  const t = gerar({ primeiroContato: false, dia: 2 });
  assert.ok(!t.includes("Clara Teste"));
  assert.ok(!t.includes("Sou do"));
});

test("cita só pendências marcadas e em aberto, com os dias", () => {
  const t = gerar();
  assert.ok(t.includes("acessar a plataforma pela primeira vez (há 10 dias)"));
  assert.ok(t.includes("assinar o contrato (há 3 dias)"));
  assert.ok(!t.includes("documentação"), "pendência não marcada fica de fora");
});

test("uma pendência só: frase no singular e 'há 1 dia'", () => {
  const t = gerar({ aluno: aluno({ data_compra: "2026-10-15", pendencias: [pend("acesso")] }) });
  assert.ok(t.includes("Vi que ainda falta acessar a plataforma pela primeira vez (há 1 dia)."));
});

test("links configurados entram; sem link avisa que o passo a passo vem em seguida", () => {
  const t = gerar();
  assert.ok(t.includes("• Acesso à plataforma: https://exemplo.invalid/acesso") || t.includes("O passo a passo está aqui: https://exemplo.invalid/acesso"));
  assert.ok(t.includes("contrato, vou te enviar o passo a passo em seguida"));
  const sem = gerar({ config: { assinante: "Clara Teste" } });
  assert.ok(sem.includes("Vou te enviar o passo a passo em seguida."));
  assert.ok(!/https?:/.test(sem), "não inventa links");
});

test("dor principal e momento profissional conectam a mensagem", () => {
  assert.ok(gerar({ aluno: aluno({ dor_principal: "Migrar para a área de dados." }) })
    .includes("Sei que você quer migrar para a área de dados, e esse passo"));
  assert.ok(gerar().includes("transição de carreira"));
});

test("frase extra entra antes do fechamento", () => {
  const t = gerar({ extra: "  A aula de boas-vindas é na quinta.  " });
  const partes = t.split("\n\n");
  assert.equal(partes.at(-2), "A aula de boas-vindas é na quinta.");
});

test("todos os tons geram texto curto, sem campos vazios e com no máximo um emoji", () => {
  for (const tom of TONS) for (let dia = 1; dia <= 4; dia++) {
    const t = gerar({ tom, dia, primeiroContato: dia === 1 });
    const paragrafos = t.split("\n\n");
    assert.ok(paragrafos.length >= 3 && paragrafos.length <= 5, `${tom}/${dia}: ${paragrafos.length} parágrafos`);
    assert.ok(!/undefined|null|NaN|\{n\}/.test(t), `${tom}/${dia}`);
    assert.ok((t.match(/\p{Extended_Pictographic}/gu) || []).length <= 1);
    assert.ok(t.length < 1200);
  }
});

test("o texto varia de um dia para o outro", () => {
  const a = gerar({ tom: "Lembrete", primeiroContato: false, dia: 2 });
  const b = gerar({ tom: "Lembrete", primeiroContato: false, dia: 3 });
  assert.notEqual(a, b);
});

test("aluno sem nome recebe saudação neutra", () => {
  const t = gerar({ aluno: aluno({ nome: "" }) });
  assert.match(t, /^Oi! Tudo bem\?/);
});

test("marca usada no banco", () => assert.equal(MARCA_MODELO, "modelo-automatico"));
