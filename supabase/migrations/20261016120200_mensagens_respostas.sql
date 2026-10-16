-- =====================================================================
-- Painel de Follow-up | 003 — Mensagens (com versões) e respostas
-- =====================================================================
-- Modelo
--   mensagens          1 linha por aluno por dia (data local de referência).
--                      Guarda o estado de ENVIO da mensagem do dia.
--   mensagem_versoes   cada geração/regeneração vira uma nova versão;
--                      as anteriores são preservadas. Só o servidor
--                      (Edge Function com service_role) grava aqui, para
--                      garantir que todo texto marcado como gerado pela IA
--                      veio de fato da API do Claude.
--   respostas          somente inserção: o histórico nunca é sobrescrito.
-- =====================================================================

create table public.mensagens (
  id                  uuid primary key default gen_random_uuid(),
  aluno_id            uuid not null references public.alunos (id) on delete cascade,
  data_referencia     date not null default privado.hoje(),
  dia_acompanhamento  integer check (dia_acompanhamento between 0 and 3650),
  estado_envio        text not null default 'nao_enviada' check (estado_envio in ('nao_enviada', 'enviada')),
  enviada_em          timestamptz,
  enviada_por         uuid references public.perfis (id) on delete set null,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  atualizado_por      uuid,
  unique (aluno_id, data_referencia),
  constraint envio_coerente check ((estado_envio = 'enviada') = (enviada_em is not null))
);
create index mensagens_aluno_data_idx on public.mensagens (aluno_id, data_referencia desc);
create index mensagens_data_idx       on public.mensagens (data_referencia);

create trigger mensagens_atualizacao before update on public.mensagens
  for each row execute function privado.carimbar_atualizacao();

-- Ao marcar/desmarcar como enviada, o banco preenche data e autor.

create table public.mensagem_versoes (
  id              uuid primary key default gen_random_uuid(),
  mensagem_id     uuid not null references public.mensagens (id) on delete cascade,
  versao          integer not null check (versao >= 1),
  tom             text not null check (tom in ('Acolhedor', 'Lembrete', 'Firme', 'Urgente')),
  instrucao       text check (char_length(instrucao) <= 1000),
  texto           text check (char_length(texto) <= 6000),
  estado_geracao  text not null default 'gerando' check (estado_geracao in ('gerando', 'concluida', 'falhou')),
  erro            text check (char_length(erro) <= 1000),
  modelo          text check (char_length(modelo) <= 80),
  -- preenchido quando ESTA versão foi a marcada como enviada
  enviada_em      timestamptz,
  gerada_por      uuid references public.perfis (id) on delete set null,
  criado_em       timestamptz not null default now(),
  concluido_em    timestamptz,
  unique (mensagem_id, versao),
  constraint texto_quando_concluida check (estado_geracao <> 'concluida' or coalesce(char_length(btrim(texto)), 0) > 0)
);
create index mensagem_versoes_msg_idx on public.mensagem_versoes (mensagem_id, versao desc);

create table public.respostas (
  id             uuid primary key default gen_random_uuid(),
  aluno_id       uuid not null references public.alunos (id) on delete cascade,
  mensagem_id    uuid references public.mensagens (id) on delete set null,
  texto          text not null check (char_length(texto) between 1 and 4000),
  respondida_em  timestamptz not null default now(),
  registrada_por uuid default auth.uid() references public.perfis (id) on delete set null,
  criado_em      timestamptz not null default now()
);
create index respostas_aluno_idx on public.respostas (aluno_id, respondida_em desc);

-- A mensagem referenciada precisa ser do mesmo aluno
create or replace function privado.validar_resposta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mensagem_id is not null and not exists (
       select 1 from public.mensagens m where m.id = new.mensagem_id and m.aluno_id = new.aluno_id) then
    raise exception 'A mensagem informada não pertence a este aluno.' using errcode = '23514';
  end if;
  new.registrada_por := auth.uid();
  new.criado_em := now();
  return new;
end $$;

create trigger respostas_validacao before insert on public.respostas
  for each row execute function privado.validar_resposta();

create or replace function privado.bloquear_alteracao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Registros de % não podem ser alterados; registre um novo.', tg_table_name using errcode = '42501';
end $$;

create trigger respostas_somente_insercao before update on public.respostas
  for each row execute function privado.bloquear_alteracao();

-- =====================================================================
-- Envio (prompt mestre 11.1): manual, persistente e reversível.
-- Marcar como enviada registra quando, quem e QUAL versão foi enviada.
-- =====================================================================
create or replace function privado.versao_vigente(p_mensagem uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.mensagem_versoes v
   where v.mensagem_id = p_mensagem and v.estado_geracao = 'concluida'
   order by v.versao desc limit 1
$$;

create or replace function privado.registrar_envio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_versao uuid;
begin
  if new.estado_envio = old.estado_envio then return new; end if;
  if new.estado_envio = 'enviada' then
    v_versao := privado.versao_vigente(new.id);
    if v_versao is null then
      raise exception 'Não há mensagem gerada para marcar como enviada.' using errcode = '23514';
    end if;
    new.enviada_em := now();
    new.enviada_por := auth.uid();
    update public.mensagem_versoes set enviada_em = new.enviada_em where id = v_versao;
  else
    new.enviada_em := null;
    new.enviada_por := null;
    -- "desfazer" só limpa a versão vigente; quando a volta para "não enviada"
    -- vem de uma nova versão gerada, a anterior continua registrada como enviada.
    update public.mensagem_versoes set enviada_em = null
     where id = privado.versao_vigente(new.id) and enviada_em = old.enviada_em;
  end if;
  return new;
end $$;

create trigger mensagens_envio before update of estado_envio on public.mensagens
  for each row execute function privado.registrar_envio();

-- Uma nova versão concluída passa a ser a vigente e ainda não foi enviada:
-- o estado do dia volta para "não enviada" (a versão anterior mantém o registro).
create or replace function privado.nova_versao_concluida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado_geracao = 'concluida' and (tg_op = 'INSERT' or old.estado_geracao <> 'concluida') then
    update public.mensagens
       set estado_envio = 'nao_enviada', enviada_em = null, enviada_por = null
     where id = new.mensagem_id and estado_envio = 'enviada';
  end if;
  return null;
end $$;

create trigger mensagem_versoes_concluida after insert or update of estado_geracao on public.mensagem_versoes
  for each row execute function privado.nova_versao_concluida();
