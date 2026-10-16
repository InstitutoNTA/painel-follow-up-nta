-- =====================================================================
-- Testes: geração diária (regras do servidor), envio por versão,
-- exclusão com retenção e importação de backup. Dados fictícios.
-- Incluído por 10_testes_rls.sql (depende dos dados criados lá).
-- =====================================================================
create function teste.status(j jsonb) returns text language sql as $$ select j ->> 'status' $$;
grant execute on function teste.status(jsonb) to service_role;

-- Prepara um aluno ativo com pendência aberta
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.alunos (nome, curso_id) values ('Aluno Teste Dois', 4);
update public.pendencias p set marcada = true
  from public.alunos a where a.id = p.aluno_id and a.nome = 'Aluno Teste Dois' and p.tipo = 'acesso';
reset role;

create temp table ids as
  select (select id from public.alunos where nome = 'Aluno Teste Dois') as dois,
         (select id from public.alunos where nome is null) as vazio;
grant select on ids to service_role, authenticated, anon;

set role service_role;

-- ---------- Dias e horários (fuso America/Sao_Paulo) ----------------------
-- Sábado, 17/10/2026 10h em Brasília
set painel.agora_teste = '2026-10-17 10:00:00-03';
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria')) = 'fim_de_semana', 'não gera no sábado');
-- Sexta 23h30 em Brasília = sábado 02h30 em UTC: ainda é sexta no Brasil
set painel.agora_teste = '2026-10-17 02:30:00+00';
select teste.afirmar(privado.hoje() = date '2026-10-16', 'data local usa o fuso de Brasília, não UTC');

-- Segunda-feira, 19/10/2026 09h05
set painel.agora_teste = '2026-10-19 09:05:00-03';
select teste.afirmar(teste.status(public.srv_reservar_geracao((select vazio from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria')) = 'sem_pendencias', 'não gera para aluno sem pendência aberta');
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  gen_random_uuid(), 'Acolhedor', '', 'diaria')) = 'sem_permissao', 'usuário desconhecido não gera');
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Bravo', '', 'diaria')) = 'invalido', 'rejeita tom inválido');

create temp table r1 as select public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria') as j;
select teste.afirmar(teste.status((select j from r1)) = 'reservada', 'primeira geração do dia é reservada');
select teste.afirmar((public.srv_contexto_geracao((select dois from ids)) ->> 'qtd_mensagens_anteriores')::int = 0,
  'primeiro contato identificado');
select teste.afirmar(((select j from r1) ->> 'dia_acompanhamento')::int = 1, 'primeira mensagem é o dia 1');

-- Outra aba / recarregamento enquanto a primeira ainda está gerando
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria')) = 'em_andamento', 'segunda chamada simultânea não duplica');

select teste.afirmar(teste.status(public.srv_concluir_geracao(((select j from r1) ->> 'versao_id')::uuid, '   ', 'm')) = 'falhou',
  'resposta vazia da IA vira falha, não mensagem');
-- Após falha, nova tentativa só para este aluno
create temp table r2 as select public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria') as j;
select teste.afirmar(teste.status((select j from r2)) = 'reservada', 'falha permite nova tentativa');
select teste.afirmar(teste.status(public.srv_concluir_geracao(((select j from r2) ->> 'versao_id')::uuid, 'Texto fictício 1', 'modelo-teste')) = 'concluida',
  'geração concluída');
select teste.afirmar(teste.status(public.srv_concluir_geracao(((select j from r2) ->> 'versao_id')::uuid, 'Outro', 'modelo-teste')) = 'expirada',
  'versão concluída não é sobrescrita');

-- Lote diário repetido (recarregar a página) não gera de novo
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Acolhedor', '', 'diaria')) = 'ja_existe', 'lote do dia não duplica mensagem');
select teste.afirmar((select count(*) from public.mensagens where aluno_id = (select dois from ids)) = 1,
  'uma mensagem por aluno por dia');

reset role;
-- ---------- Envio e nova versão --------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.mensagens set estado_envio = 'enviada' where aluno_id = (select dois from ids);
reset role;
set role service_role;
create temp table r3 as select public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Firme', 'Mais curta', 'manual') as j;
select teste.afirmar(teste.status((select j from r3)) = 'reservada' and ((select j from r3) ->> 'versao')::int = 3,
  '"Gerar nova mensagem" cria nova versão');
select public.srv_concluir_geracao(((select j from r3) ->> 'versao_id')::uuid, 'Texto fictício 2', 'modelo-teste');
select teste.afirmar((select estado_envio from public.mensagens where aluno_id = (select dois from ids)) = 'nao_enviada',
  'nova versão vigente começa como não enviada');
select teste.afirmar((select enviada_em is not null from public.mensagem_versoes where texto = 'Texto fictício 1'),
  'versão anterior continua registrada como enviada');
select teste.afirmar((select instrucao from public.mensagem_versoes where texto = 'Texto fictício 2') = 'Mais curta',
  'instrução fica no histórico');

-- Contexto para o agente
select teste.afirmar((public.srv_contexto_geracao((select dois from ids)) -> 'ultimas_mensagens' -> 1 ->> 'texto') = 'Texto fictício 2',
  'contexto traz as duas últimas mensagens');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.respostas (aluno_id, texto) values ((select dois from ids), 'Resposta fictícia do aluno');
update public.mensagens set estado_envio = 'enviada' where aluno_id = (select dois from ids);
update public.mensagens set estado_envio = 'nao_enviada' where aluno_id = (select dois from ids);
select teste.afirmar((select enviada_em is null from public.mensagem_versoes where texto = 'Texto fictício 2')
                 and (select enviada_em is not null from public.mensagem_versoes where texto = 'Texto fictício 1'),
  'desfazer envio afeta só a versão vigente');
reset role;

set role service_role;
select teste.afirmar((public.srv_contexto_geracao((select dois from ids)) -> 'ultimas_respostas' -> 0 ->> 'texto') = 'Resposta fictícia do aluno',
  'respostas entram no contexto da IA');

-- Dia seguinte: dia de acompanhamento avança
set painel.agora_teste = '2026-10-20 09:30:00-03';
create temp table r4 as select public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Lembrete', '', 'diaria') as j;
select teste.afirmar(((select j from r4) ->> 'dia_acompanhamento')::int = 2, 'dia seguinte é o dia 2 de acompanhamento');
select teste.afirmar((public.srv_contexto_geracao((select dois from ids)) ->> 'qtd_mensagens_anteriores')::int = 1,
  'mensagens de dias anteriores são contadas (não é mais o primeiro contato)');
select public.srv_falhar_geracao(((select j from r4) ->> 'versao_id')::uuid, 'Falha simulada no teste');

-- Aluno concluído não recebe mensagem
reset role;
update public.pendencias set estado = 'resolvida' where aluno_id = (select dois from ids) and marcada;
set role service_role;
select teste.afirmar(teste.status(public.srv_reservar_geracao((select dois from ids),
  '00000000-0000-0000-0000-00000000000b', 'Lembrete', '', 'manual')) = 'concluido', 'aluno concluído não recebe mensagens');
reset role;
reset painel.agora_teste;

-- ---------- Backup: exporta (como o navegador faz) e reimporta -------------
create temp table backup as
select jsonb_build_object(
  'formato', 'painel-follow-up-nta', 'versao', 1,
  'alunos',           (select jsonb_agg(to_jsonb(a)) from public.alunos a where a.id = (select dois from ids)),
  'pendencias',       (select jsonb_agg(to_jsonb(p)) from public.pendencias p where p.aluno_id = (select dois from ids)),
  'mensagens',        (select jsonb_agg(to_jsonb(m)) from public.mensagens m where m.aluno_id = (select dois from ids)),
  'mensagem_versoes', (select jsonb_agg(to_jsonb(v)) from public.mensagem_versoes v
                        join public.mensagens m on m.id = v.mensagem_id where m.aluno_id = (select dois from ids)),
  'respostas',        (select jsonb_agg(to_jsonb(r)) from public.respostas r where r.aluno_id = (select dois from ids)),
  'configuracoes',    (select to_jsonb(c) from public.configuracoes c)) as j;
grant select on backup to authenticated;

-- ---------- Exclusão com retenção ------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
delete from public.alunos where id = (select dois from ids);
select teste.afirmar(teste.contar($q$select * from public.alunos where nome = 'Aluno Teste Dois'$q$) = 0, 'operadora exclui aluno');
reset role;
select teste.afirmar((select count(*) from public.mensagens where aluno_id = (select dois from ids)) = 0
                 and (select count(*) from public.respostas where aluno_id = (select dois from ids)) = 0,
  'exclusão remove mensagens e respostas do aluno');
select teste.afirmar((select count(*) from public.auditoria where tabela = 'alunos' and operacao = 'DELETE'
                       and registro_id = (select dois from ids)::text) = 1, 'exclusão fica registrada na auditoria');
select teste.afirmar(not exists (select 1 from public.auditoria where antes::text like '%Teste Dois%' or depois::text like '%Teste Dois%'
                                   or antes::text like '%Resposta fictícia%' or depois::text like '%Resposta fictícia%'),
  'auditoria não guarda dados pessoais do aluno excluído');

-- ---------- Importação ------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select teste.afirmar(teste.tentar($q$select public.importar_backup('{"formato":"outro"}'::jsonb)$q$) = '22023',
  'importação rejeita arquivo de outro formato');
select teste.afirmar((public.importar_backup((select j from backup), true) ->> 'alunos_novos')::int = 1
                 and teste.contar($q$select * from public.alunos where nome = 'Aluno Teste Dois'$q$) = 0,
  'prévia da importação não grava nada');
select teste.afirmar((public.importar_backup((select j from backup), false) ->> 'versoes_novas')::int = 4,
  'importação restaura mensagens e todas as versões');
select teste.afirmar(teste.contar($q$select * from public.respostas where texto = 'Resposta fictícia do aluno'$q$) = 1
                 and (select estado_acompanhamento from public.alunos where nome = 'Aluno Teste Dois') = 'concluido'
                 and (select dia_acompanhamento from public.mensagens m join public.alunos a on a.id = m.aluno_id
                       where a.nome = 'Aluno Teste Dois' and m.data_referencia = date '2026-10-20') = 2,
  'importação restaura respostas, estados e dias');
select teste.afirmar((public.importar_backup((select j from backup), false) ->> 'alunos_novos')::int = 0
                 and teste.contar($q$select * from public.alunos where nome = 'Aluno Teste Dois'$q$) = 1,
  'importar de novo não duplica nem sobrescreve');
reset role;

-- ---------- anon não acessa funções do servidor ----------------------------
set role anon;
select teste.afirmar(teste.tentar($q$select public.srv_contexto_geracao(gen_random_uuid())$q$) = '42501',
  'anon não chama funções do servidor');
select teste.afirmar(teste.tentar($q$select public.importar_backup('{}'::jsonb)$q$) = '42501',
  'anon não importa backup');
reset role;
