-- =====================================================================
-- Testes do banco: regras de acesso (RLS), integridade e gatilhos.
-- Usa apenas usuários e alunos de TESTE criados aqui (sem dados reais).
-- Cada falha interrompe a execução com a mensagem "FALHOU: ...".
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema teste;
grant usage on schema teste to anon, authenticated, service_role;

-- Executa um comando e devolve 'ok' ou o código de erro (SQLSTATE)
create function teste.tentar(cmd text) returns text language plpgsql as $$
begin execute cmd; return 'ok';
exception when others then return sqlstate; end $$;

-- Conta linhas visíveis de uma consulta
create function teste.contar(cmd text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from (' || cmd || ') x' into n; return n; end $$;

create function teste.afirmar(cond boolean, descricao text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', descricao; end if;
  raise notice 'ok - %', descricao;
end $$;
grant execute on all functions in schema teste to anon, authenticated, service_role;

-- Usuários de teste --------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin.teste@exemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'operadora.teste@exemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'inativo.teste@exemplo.invalid');

select teste.afirmar((select count(*) from public.perfis) = 3, 'perfil criado automaticamente para cada usuário');
select teste.afirmar((select bool_and(not ativo) from public.perfis), 'usuário novo entra inativo');

-- Ativação inicial feita pelo responsável no SQL Editor (sem JWT)
update public.perfis set papel = 'admin', ativo = true where id = '00000000-0000-0000-0000-00000000000a';
update public.perfis set ativo = true                  where id = '00000000-0000-0000-0000-00000000000b';

-- ========== 1. Visitante sem login (anon) =================================
set role anon;
select teste.afirmar(teste.tentar('select 1 from public.alunos') = '42501',        'anon não lê alunos');
select teste.afirmar(teste.tentar('select 1 from public.configuracoes') = '42501', 'anon não lê configurações');
select teste.afirmar(teste.tentar('insert into public.alunos (nome) values (''x'')') = '42501', 'anon não cadastra aluno');
select teste.afirmar(teste.tentar('select privado.eh_admin()') = '42501',          'anon não chama funções internas');
reset role;

-- ========== 2. Operadora ativa ===========================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';

select teste.afirmar(teste.contar('select * from public.cursos') = 5, 'operadora vê os 5 cursos');
select teste.afirmar(teste.contar('select * from public.alunos') = 0, 'base começa sem alunos');

-- Cadastro com todos os campos vazios é permitido
select teste.afirmar(teste.tentar('insert into public.alunos default values') = 'ok', 'cadastro com campos vazios');
-- Cadastro completo de teste
insert into public.alunos (nome, email, telefone, data_compra, curso_id, momento_profissional, dor_principal)
values ('Aluno Teste Um', 'aluno.um@exemplo.invalid', '(11) 90000-0000', date '2026-10-01', 2, 'transicao', 'Teste');

select teste.afirmar(teste.contar('select * from public.alunos') = 2, 'operadora vê os alunos cadastrados');
select teste.afirmar(teste.contar('select * from public.pendencias') = 6, 'cada aluno recebe exatamente 3 pendências');
select teste.afirmar(teste.contar('select * from public.pendencias_historico') = 0, 'pendências desmarcadas não poluem o histórico');

-- Campos controlados pelo banco não podem ser forjados
select teste.afirmar(teste.tentar($q$insert into public.alunos (nome, estado_acompanhamento) values ('x','concluido')$q$) = '42501',
  'operadora não define estado de acompanhamento');
select teste.afirmar(teste.tentar($q$update public.alunos set estado_acompanhamento = 'concluido'$q$) = '42501',
  'operadora não altera estado de acompanhamento diretamente');

-- Validações de entrada
select teste.afirmar(teste.tentar($q$insert into public.alunos (email) values ('sem-arroba')$q$) = '23514', 'rejeita e-mail inválido');
select teste.afirmar(teste.tentar($q$insert into public.alunos (telefone) values ('abc')$q$) = '23514', 'rejeita telefone com letras');
select teste.afirmar(teste.tentar($q$insert into public.alunos (curso_id) values (99)$q$) = '23503', 'rejeita curso inexistente');
select teste.afirmar(teste.tentar($q$insert into public.alunos (momento_profissional) values ('outro')$q$) = '23514', 'rejeita momento profissional inválido');

-- Marca duas pendências do aluno de teste
update public.pendencias p set marcada = true, dias_informados = 3
  from public.alunos a where a.id = p.aluno_id and a.nome = 'Aluno Teste Um' and p.tipo in ('contrato', 'documentacao');

select teste.afirmar(teste.contar($q$select * from public.pendencias_historico where acao = 'marcada'$q$) = 2,
  'histórico registra pendências marcadas');
select teste.afirmar((select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Um') = 'em_acompanhamento',
  'aluno com pendência aberta está em acompanhamento');

-- Resposta não resolve pendência
insert into public.respostas (aluno_id, texto)
  select id, 'Resposta de teste' from public.alunos where nome = 'Aluno Teste Um';
select teste.afirmar((select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Um') = 'em_acompanhamento',
  'responder não tira o aluno do acompanhamento');
select teste.afirmar(teste.tentar($q$update public.respostas set texto = 'alterado'$q$) in ('42501'),
  'respostas não podem ser sobrescritas');
select teste.afirmar(teste.tentar($q$delete from public.respostas$q$) = 'ok'
  and teste.contar('select * from public.respostas') = 1, 'operadora não exclui respostas (exclusão filtrada)');

-- Resolve uma: continua em acompanhamento; resolve a outra: concluído
update public.pendencias p set estado = 'resolvida', resolvida_em = date '2026-10-10'
  from public.alunos a where a.id = p.aluno_id and a.nome = 'Aluno Teste Um' and p.tipo = 'contrato';
select teste.afirmar((select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Um') = 'em_acompanhamento',
  'uma pendência aberta mantém o acompanhamento');
update public.pendencias p set estado = 'resolvida', resolvida_em = date '2026-10-11'
  from public.alunos a where a.id = p.aluno_id and a.nome = 'Aluno Teste Um' and p.tipo = 'documentacao';
select teste.afirmar((select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Um') = 'concluido',
  'todas as pendências resolvidas concluem o acompanhamento');
-- Reabrir volta ao acompanhamento
update public.pendencias p set estado = 'pendente', resolvida_em = null
  from public.alunos a where a.id = p.aluno_id and a.nome = 'Aluno Teste Um' and p.tipo = 'documentacao';
select teste.afirmar((select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Um') = 'em_acompanhamento',
  'reabrir pendência volta ao acompanhamento');
select teste.afirmar(teste.contar($q$select * from public.pendencias_historico where acao in ('resolvida','reaberta')$q$) = 3,
  'histórico registra resoluções e reaberturas');

select teste.afirmar(teste.tentar($q$update public.pendencias set estado = 'resolvida' where tipo = 'acesso'$q$) = '23514',
  'resolver exige data de resolução');
select teste.afirmar(teste.tentar($q$update public.pendencias set tipo = 'acesso'$q$) = '42501',
  'tipo da pendência não pode mudar');
select teste.afirmar(teste.tentar($q$insert into public.pendencias (aluno_id, tipo) select id, 'acesso' from public.alunos limit 1$q$) = '42501',
  'operadora não cria pendências avulsas');

-- Mensagens: operadora não grava texto "da IA"
select teste.afirmar(teste.tentar($q$insert into public.mensagens (aluno_id) select id from public.alunos limit 1$q$) = '42501',
  'operadora não cria mensagem diretamente');
select teste.afirmar(teste.tentar($q$insert into public.mensagem_versoes (mensagem_id, versao, tom, texto) values (gen_random_uuid(), 1, 'Firme', 'falso')$q$) = '42501',
  'operadora não grava texto de mensagem como se fosse da IA');

-- Configurações
select teste.afirmar(teste.tentar($q$update public.configuracoes set assinante = 'Operadora Teste', prazo_padrao = 10$q$) = 'ok',
  'operadora atualiza configurações');
select teste.afirmar(teste.tentar($q$update public.configuracoes set link_acesso = 'javascript:alert(1)'$q$) = '23514',
  'rejeita link que não começa com http(s)');
select teste.afirmar(teste.tentar($q$update public.configuracoes set prazo_padrao = 0$q$) = '23514', 'rejeita prazo zero');

-- Usuários e auditoria
select teste.afirmar(teste.contar('select * from public.perfis') = 1, 'operadora vê só o próprio perfil');
select teste.afirmar(teste.tentar($q$update public.perfis set papel = 'admin' where id = auth.uid()$q$) = '42501',
  'operadora não se promove a admin');
select teste.afirmar(teste.contar('select * from public.auditoria') = 0, 'operadora não lê a auditoria');
select teste.afirmar(teste.tentar($q$delete from public.alunos$q$) = 'ok' and teste.contar('select * from public.alunos') = 2,
  'operadora não exclui alunos');
reset role;

-- ========== 3. Servidor (Edge Function com service_role) ==================
set role service_role;
reset request.jwt.claim.sub;
insert into public.mensagens (aluno_id, dia_acompanhamento)
  select id, 3 from public.alunos where nome = 'Aluno Teste Um';
insert into public.mensagem_versoes (mensagem_id, versao, tom, texto, estado_geracao, modelo)
  select id, 1, 'Acolhedor', 'Texto de teste v1', 'concluida', 'modelo-teste' from public.mensagens;
insert into public.mensagem_versoes (mensagem_id, versao, tom, texto, estado_geracao, modelo)
  select id, 2, 'Lembrete', 'Texto de teste v2', 'concluida', 'modelo-teste' from public.mensagens;
select teste.afirmar(teste.tentar($q$insert into public.mensagens (aluno_id) select aluno_id from public.mensagens$q$) = '23505',
  'no máximo uma mensagem por aluno por dia');
select teste.afirmar(teste.tentar($q$insert into public.mensagem_versoes (mensagem_id, versao, tom, estado_geracao) select id, 3, 'Firme', 'concluida' from public.mensagens$q$) = '23514',
  'versão concluída exige texto');
reset role;

-- ========== 4. Operadora marca envio e registra resposta ligada ===========
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select teste.afirmar(teste.contar('select * from public.mensagem_versoes') = 2, 'versões anteriores preservadas');
update public.mensagens set estado_envio = 'enviada';
select teste.afirmar((select enviada_em is not null and enviada_por = auth.uid() from public.mensagens),
  'banco registra quando e quem marcou como enviada');
select teste.afirmar(teste.tentar($q$update public.mensagens set dia_acompanhamento = 99$q$) = '42501',
  'operadora não altera dados de geração da mensagem');
insert into public.respostas (aluno_id, mensagem_id, texto)
  select aluno_id, id, 'Resposta ligada à mensagem' from public.mensagens;
select teste.afirmar(teste.tentar($q$insert into public.respostas (aluno_id, mensagem_id, texto) select a.id, m.id, 'x' from public.alunos a, public.mensagens m where a.id <> m.aluno_id$q$) = '23514',
  'resposta não pode apontar para mensagem de outro aluno');
reset role;

-- ========== 5. Usuário logado porém INATIVO ===============================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select teste.afirmar(teste.contar('select * from public.alunos') = 0,        'inativo não vê alunos');
select teste.afirmar(teste.contar('select * from public.configuracoes') = 0, 'inativo não vê configurações');
select teste.afirmar(teste.tentar('insert into public.alunos (nome) values (''x'')') = '42501', 'inativo não cadastra');
select teste.afirmar(teste.tentar($q$update public.perfis set ativo = true where id = auth.uid()$q$) = '42501',
  'inativo não se ativa sozinho');
reset role;

-- ========== 6. Admin ======================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select teste.afirmar(teste.contar('select * from public.perfis') = 3, 'admin vê todos os perfis');
select teste.afirmar(teste.contar('select * from public.auditoria') > 0, 'admin lê a auditoria');
select teste.afirmar(teste.tentar($q$update public.perfis set ativo = false where id = auth.uid()$q$) = '23514',
  'último admin não pode se desativar');
update public.perfis set ativo = true where id = '00000000-0000-0000-0000-00000000000c';
select teste.afirmar((select ativo from public.perfis where id = '00000000-0000-0000-0000-00000000000c'),
  'admin ativa usuário');
delete from public.alunos where nome is null;
select teste.afirmar(teste.contar('select * from public.alunos') = 1, 'admin exclui aluno');
select teste.afirmar(teste.contar($q$select * from public.auditoria where tabela = 'alunos' and operacao = 'DELETE'$q$) = 1,
  'exclusão fica registrada na auditoria');
reset role;
