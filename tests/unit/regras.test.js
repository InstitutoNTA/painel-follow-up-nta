// Testes das regras de dias, prazos e tons (prompt mestre, seção 10).
// Dados 100% fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hojeLocal, horaLocal, diaUtil, diferencaDias, diasPendencia, diasEmAberto,
  tomSugerido, situacaoPrazo, vencendoOuVencido, concluido, nomeDoTime, formatarDiaMes,
} from "../../supabase/functions/_shared/regras.js";

const pend = (tipo, extra = {}) => ({ tipo, marcada: true, estado: "pendente", data_referencia: "2026-10-16",
  dias_informados: null, resolvida_em: null, ...extra });

test("fuso de Brasília: 02h30 UTC de sábado ainda é sexta-feira", () => {
  const agora = new Date("2026-10-17T02:30:00Z");
  assert.equal(hojeLocal(agora), "2026-10-16");
  assert.equal(horaLocal(agora), 23);
  assert.equal(diaUtil(agora), true);
});

test("fim de semana e antes das 9h", () => {
  assert.equal(diaUtil(new Date("2026-10-17T13:00:00Z")), false); // sábado 10h
  assert.equal(diaUtil(new Date("2026-10-18T13:00:00Z")), false); // domingo
  assert.equal(horaLocal(new Date("2026-10-19T11:59:00Z")), 8);   // segunda 08h59
  assert.equal(horaLocal(new Date("2026-10-19T12:00:00Z")), 9);   // segunda 09h00
});

test("diferença de dias atravessa meses e anos sem erro de UTC", () => {
  assert.equal(diferencaDias("2026-12-30", "2027-01-02"), 3);
  assert.equal(diferencaDias("2026-02-27", "2026-03-01"), 2);
});

test("dias por pendência: N informado + dias desde o registro", () => {
  const aluno = { data_compra: "2026-09-01", data_cadastro: "2026-10-10" };
  const p = pend("contrato", { dias_informados: 5, data_referencia: "2026-10-12" });
  assert.equal(diasPendencia(aluno, p, "2026-10-16"), 9);
});

test("dias por pendência: sem N conta da compra; sem compra conta do cadastro", () => {
  assert.equal(diasPendencia({ data_compra: "2026-10-06", data_cadastro: "2026-10-15" }, pend("acesso"), "2026-10-16"), 10);
  assert.equal(diasPendencia({ data_compra: null, data_cadastro: "2026-10-15" }, pend("acesso"), "2026-10-16"), 1);
  assert.equal(diasPendencia({}, pend("acesso"), "2026-10-16"), 0);
});

test("pendência resolvida para de contar e sai dos dias em aberto", () => {
  const aluno = { data_compra: "2026-10-01", pendencias: [
    pend("acesso", { estado: "resolvida", resolvida_em: "2026-10-05" }),
    pend("contrato", { dias_informados: 2, data_referencia: "2026-10-15" }),
    { ...pend("documentacao"), marcada: false },
  ] };
  assert.equal(diasPendencia(aluno, aluno.pendencias[0], "2026-10-16"), 4);
  assert.equal(diasEmAberto(aluno, "2026-10-16"), 3, "maior entre as abertas (só contrato)");
});

test("dias em aberto é o MAIOR entre as pendências abertas", () => {
  const aluno = { data_compra: "2026-10-01", pendencias: [
    pend("acesso", { dias_informados: 3, data_referencia: "2026-10-16" }),
    pend("contrato"),  // desde a compra: 15
  ] };
  assert.equal(diasEmAberto(aluno, "2026-10-16"), 15);
});

test("tom sugerido segue as faixas do prazo", () => {
  const P = 7;
  assert.equal(tomSugerido({ primeiroContato: true, dias: 40, prazo: P }), "Acolhedor", "1ª mensagem sempre acolhedora");
  assert.equal(tomSugerido({ primeiroContato: false, dias: 3, prazo: P }), "Acolhedor");   // < 3,5
  assert.equal(tomSugerido({ primeiroContato: false, dias: 4, prazo: P }), "Lembrete");
  assert.equal(tomSugerido({ primeiroContato: false, dias: 6, prazo: P }), "Lembrete");
  assert.equal(tomSugerido({ primeiroContato: false, dias: 7, prazo: P }), "Firme");
  assert.equal(tomSugerido({ primeiroContato: false, dias: 14, prazo: P }), "Firme");      // até P + 7
  assert.equal(tomSugerido({ primeiroContato: false, dias: 15, prazo: P }), "Urgente");
});

test("situação do prazo", () => {
  assert.equal(situacaoPrazo(8, 7).texto, "prazo vencido");
  assert.equal(situacaoPrazo(7, 7).texto, "vence hoje");
  assert.equal(situacaoPrazo(6, 7).texto, "falta 1 dia");
  assert.equal(situacaoPrazo(2, 7).texto, "faltam 5 dias");
});

test("vencendo ou vencido: ativo, com pendência e dias ≥ P − 1", () => {
  const base = { data_compra: "2026-10-10", pendencias: [pend("acesso")] };
  assert.equal(vencendoOuVencido(base, "2026-10-16", 7), true);   // 6 dias
  assert.equal(vencendoOuVencido(base, "2026-10-15", 7), false);  // 5 dias
  const resolvido = { ...base, pendencias: [pend("acesso", { estado: "resolvida", resolvida_em: "2026-10-16" })] };
  assert.equal(concluido(resolvido), true);
  assert.equal(vencendoOuVencido(resolvido, "2026-10-30", 7), false);
});

test("aluno sem pendência marcada não é considerado concluído", () => {
  assert.equal(concluido({ pendencias: [{ ...pend("acesso"), marcada: false }] }), false);
});

test("apresentação institucional", () => {
  assert.equal(nomeDoTime(""), "Sucesso do Aluno da Pós-graduação");
  assert.equal(nomeDoTime("MBA aplicado ao Direito"), "Sucesso do Aluno do MBA aplicado ao Direito");
  assert.equal(nomeDoTime("Defesa Cibernética"), "Sucesso do Aluno da Pós-graduação em Defesa Cibernética");
  assert.equal(formatarDiaMes("2026-10-16T12:00:00Z"), "16/10");
});
