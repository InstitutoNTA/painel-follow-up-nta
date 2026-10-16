-- =====================================================================
-- Painel de Follow-up | 002 — Alunos, pendências e histórico
-- =====================================================================

create table public.alunos (
  id                    uuid primary key default gen_random_uuid(),
  -- Todos os campos do formulário podem ficar vazios (prompt mestre 7.1)
  nome                  text check (char_length(nome) <= 160),
  email                 text check (char_length(email) <= 254
                                    and (email is null or email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  telefone              text check (char_length(telefone) <= 40
                                    and (telefone is null or telefone ~ '^[0-9+()\s.-]*$')),
  data_compra           date check (data_compra between date '2015-01-01' and date '2100-12-31'),
  curso_id              smallint references public.cursos (id),          -- nulo = "Não sei"
  momento_profissional  text check (momento_profissional in ('transicao', 'especializacao', 'nao_sei')),
  dor_principal         text check (char_length(dor_principal) <= 2000),
  observacoes           text check (char_length(observacoes) <= 4000),
  estado_acompanhamento text not null default 'em_acompanhamento'
                        check (estado_acompanhamento in ('em_acompanhamento', 'concluido')),
  data_cadastro         date not null default privado.hoje(),
  criado_em             timestamptz not null default now(),
  criado_por            uuid default auth.uid() references public.perfis (id) on delete set null,
  atualizado_em         timestamptz not null default now(),
  atualizado_por        uuid
);
comment on column public.alunos.estado_acompanhamento is
  'Calculado pelo banco: concluido quando todas as pendências marcadas estão resolvidas.';

create index alunos_curso_idx  on public.alunos (curso_id);
create index alunos_estado_idx on public.alunos (estado_acompanhamento);
create index alunos_busca_idx  on public.alunos
  using gin ((coalesce(nome, '') || ' ' || coalesce(email, '') || ' ' || coalesce(telefone, '')) extensions.gin_trgm_ops);

create trigger alunos_atualizacao before update on public.alunos
  for each row execute function privado.carimbar_atualizacao();

-- =====================================================================
-- Pendências: até três por aluno, uma de cada tipo
-- =====================================================================
create table public.pendencias (
  id               uuid primary key default gen_random_uuid(),
  aluno_id         uuid not null references public.alunos (id) on delete cascade,
  tipo             text not null check (tipo in ('acesso', 'contrato', 'documentacao')),
  -- marcada = a caixa está marcada no cadastro (a pendência se aplica ao aluno)
  marcada          boolean not null default true,
  estado           text not null default 'pendente' check (estado in ('pendente', 'resolvida')),
  -- data em que a pendência foi marcada ou em que "Pendente há N dias" foi
  -- informado; é a base do cálculo quando dias_informados está preenchido
  data_referencia  date not null default privado.hoje(),
  -- "Pendente há N dias" informado no cadastro (opcional)
  dias_informados  integer check (dias_informados between 0 and 3650),
  resolvida_em     date,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid,
  unique (aluno_id, tipo),
  constraint resolucao_coerente check (
    (estado = 'resolvida' and resolvida_em is not null) or (estado = 'pendente' and resolvida_em is null)
  )
);
create index pendencias_aluno_idx on public.pendencias (aluno_id);

create trigger pendencias_atualizacao before update on public.pendencias
  for each row execute function privado.carimbar_atualizacao();

-- Histórico de alterações das pendências (somente inserção, via gatilho)
create table public.pendencias_historico (
  id            bigint generated always as identity primary key,
  pendencia_id  uuid not null,
  aluno_id      uuid not null references public.alunos (id) on delete cascade,
  tipo          text not null,
  acao          text not null check (acao in ('marcada', 'desmarcada', 'resolvida', 'reaberta', 'alterada')),
  antes         jsonb,
  depois        jsonb,
  usuario_id    uuid,
  criado_em     timestamptz not null default now()
);
create index pendencias_historico_aluno_idx on public.pendencias_historico (aluno_id, criado_em desc);

create or replace function privado.registrar_historico_pendencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acao text;
begin
  if tg_op = 'INSERT' then
    if not new.marcada then return new; end if;   -- linha-base desmarcada: sem ruído no histórico
    v_acao := 'marcada';
  elsif new.marcada is distinct from old.marcada then
    v_acao := case when new.marcada then 'marcada' else 'desmarcada' end;
  elsif new.estado is distinct from old.estado then
    v_acao := case when new.estado = 'resolvida' then 'resolvida' else 'reaberta' end;
  elsif (new.data_referencia, new.dias_informados, new.resolvida_em)
        is distinct from (old.data_referencia, old.dias_informados, old.resolvida_em) then
    v_acao := 'alterada';
  else
    return new;   -- nada relevante mudou
  end if;

  insert into public.pendencias_historico (pendencia_id, aluno_id, tipo, acao, antes, depois, usuario_id)
  values (new.id, new.aluno_id, new.tipo, v_acao,
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'atualizado_em' - 'atualizado_por' end,
          to_jsonb(new) - 'atualizado_em' - 'atualizado_por',
          auth.uid());
  return new;
end $$;

create trigger pendencias_historico_gatilho after insert or update on public.pendencias
  for each row execute function privado.registrar_historico_pendencia();

-- Recalcula o estado de acompanhamento do aluno ------------------------
-- Regra (prompt mestre 7.2 e 8.4): o aluno sai do acompanhamento somente
-- quando TODAS as pendências marcadas estão resolvidas. Responder não resolve.
create or replace function privado.recalcular_estado_aluno(p_aluno uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.alunos a
     set estado_acompanhamento = case
           when exists (select 1 from public.pendencias p where p.aluno_id = a.id and p.marcada)
            and not exists (select 1 from public.pendencias p
                             where p.aluno_id = a.id and p.marcada and p.estado = 'pendente')
           then 'concluido' else 'em_acompanhamento' end
   where a.id = p_aluno
$$;

create or replace function privado.pendencia_mudou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.recalcular_estado_aluno(coalesce(new.aluno_id, old.aluno_id));
  return null;
end $$;

create trigger pendencias_estado_aluno after insert or update or delete on public.pendencias
  for each row execute function privado.pendencia_mudou();

-- Cria as três pendências (desmarcadas) para todo aluno novo, garantindo
-- que cada aluno sempre tenha exatamente uma linha de cada tipo.
create or replace function privado.criar_pendencias_aluno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pendencias (aluno_id, tipo, marcada, data_referencia)
  select new.id, t, false, privado.hoje()
    from unnest(array['acesso', 'contrato', 'documentacao']) as t
  on conflict (aluno_id, tipo) do nothing;
  return null;
end $$;

create trigger alunos_criar_pendencias after insert on public.alunos
  for each row execute function privado.criar_pendencias_aluno();

-- Regras aplicadas a toda atualização de pendência (prompt mestre 10.1):
--   * aluno e tipo não mudam;
--   * a data de referência só muda quando a pendência é marcada de novo ou
--     quando o número "Pendente há N dias" muda — editar outros dados do
--     aluno NÃO reinicia a contagem;
--   * resolver registra a data (hoje, se não informada); reabrir limpa a data.
create or replace function privado.pendencia_antes_atualizar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.aluno_id <> old.aluno_id or new.tipo <> old.tipo then
    raise exception 'Não é permitido mudar o aluno ou o tipo de uma pendência.' using errcode = '42501';
  end if;
  if (new.marcada and not old.marcada)
     or new.dias_informados is distinct from old.dias_informados then
    new.data_referencia := privado.hoje();
  end if;
  if new.marcada and not old.marcada then
    new.estado := 'pendente';             -- remarcar volta a pendente
    new.resolvida_em := null;
  end if;
  if new.estado = 'resolvida' and new.resolvida_em is null then
    new.resolvida_em := privado.hoje();
  elsif new.estado = 'pendente' then
    new.resolvida_em := null;
  end if;
  return new;
end $$;

create trigger pendencias_antes_atualizar before update on public.pendencias
  for each row execute function privado.pendencia_antes_atualizar();
