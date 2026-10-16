-- =====================================================================
-- Testes: mensagens por modelo automático (sem IA). Dados fictícios.
-- =====================================================================
set painel.agora_teste = '2026-10-21 10:00:00-03';   -- quarta-feira
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
create temp table m1 as select public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Um'), 'Lembrete', 'Texto de modelo fictício', 'diaria') as j;
select teste.afirmar((select j ->> 'status' from m1) = 'concluida', 'operadora gera mensagem por modelo');
select teste.afirmar((select modelo from public.mensagem_versoes where texto = 'Texto de modelo fictício') = 'modelo-automatico',
  'versão de modelo fica marcada como modelo automático (não IA)');
select teste.afirmar((public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Um'), 'Lembrete', 'Outro', 'diaria')) ->> 'status' = 'ja_existe',
  'modelo também respeita uma mensagem por dia');
select teste.afirmar((public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Um'), 'Firme', 'Nova versão manual', 'manual')) ->> 'status' = 'concluida',
  'nova versão manual por modelo');
select teste.afirmar((public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Um'), 'Firme', '   ', 'manual')) ->> 'status' = 'invalido',
  'texto vazio é recusado');
select teste.afirmar((public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Dois'), 'Firme', 'x', 'manual')) ->> 'status' = 'concluido',
  'aluno concluído não recebe mensagem por modelo');
reset role;
set painel.agora_teste = '2026-10-24 10:00:00-03';   -- sábado
set role authenticated;
select teste.afirmar((public.gerar_mensagem_modelo(
  (select id from public.alunos where nome = 'Aluno Teste Um'), 'Firme', 'x', 'manual')) ->> 'status' = 'fim_de_semana',
  'modelo não gera no fim de semana');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select teste.afirmar(teste.tentar($q$select public.gerar_mensagem_modelo(gen_random_uuid(), 'Firme', 'x', 'manual')$q$) = '42501',
  'usuário sem perfil ativo não gera por modelo');
reset role;
reset painel.agora_teste;
set role anon;
select teste.afirmar(teste.tentar($q$select public.gerar_mensagem_modelo(gen_random_uuid(), 'Firme', 'x', 'manual')$q$) = '42501',
  'anon não gera por modelo');
reset role;
