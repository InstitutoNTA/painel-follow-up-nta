-- =====================================================================
-- Painel de Follow-up | 006 — Geração de mensagens (controle no banco)
--                            e importação de backup
-- =====================================================================
-- As funções srv_* são chamadas SOMENTE pela Edge Function (service_role).
-- Elas concentram as regras que precisam ser atômicas:
--   * só de segunda a sexta (fuso America/Sao_Paulo);
--   * nada para alunos com acompanhamento concluído;
--   * no máximo uma mensagem por aluno por dia, sem duplicar em
--     recarregamentos, abas simultâneas ou cliques repetidos;
--   * limite de frequência de chamadas à IA;
--   * cada geração vira uma nova versão (as anteriores são preservadas).
-- =====================================================================

-- Durante a importação de backup, os gatilhos preservam datas e autores
-- originais em vez de recalculá-los.
create or replace function privado.importando()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('painel.importando', true), '') = '1' $$;

-- Ajusta gatilhos para respeitar a importação ------------------------------
create or replace function privado.pendencia_antes_atualizar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.aluno_id <> old.aluno_id or new.tipo <> old.tipo then
    raise exception 'Não é permitido mudar o aluno ou o tipo de uma pendência.' using errcode = '42501';
  end if;
  if privado.importando() then return new; end if;
  if (new.marcada and not old.marcada)
     or new.dias_informados is distinct from old.dias_informados then
    new.data_referencia := privado.hoje();
  end if;
  if new.marcada and not old.marcada then
    new.estado := 'pendente';
    new.resolvida_em := null;
  end if;
  if new.estado = 'resolvida' and new.resolvida_em is null then
    new.resolvida_em := privado.hoje();
  elsif new.estado = 'pendente' then
    new.resolvida_em := null;
  end if;
  return new;
end $$;

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
  if not privado.importando() then
    new.registrada_por := auth.uid();
    new.criado_em := now();
  end if;
  return new;
end $$;

create or replace function privado.nova_versao_concluida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if privado.importando() then return null; end if;
  if new.estado_geracao = 'concluida' and (tg_op = 'INSERT' or old.estado_geracao <> 'concluida') then
    update public.mensagens
       set estado_envio = 'nao_enviada', enviada_em = null, enviada_por = null
     where id = new.mensagem_id and estado_envio = 'enviada';
  end if;
  return null;
end $$;

-- =====================================================================
-- 1) Reservar uma geração
-- =====================================================================
create or replace function public.srv_reservar_geracao(
  p_aluno     uuid,
  p_usuario   uuid,
  p_tom       text,
  p_instrucao text,
  p_modo      text      -- 'diaria' (lote do dia) ou 'manual' (botão/1ª mensagem)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora_local timestamp := privado.agora() at time zone 'America/Sao_Paulo';
  v_hoje        date := v_agora_local::date;
  v_aluno       public.alunos%rowtype;
  v_msg         public.mensagens%rowtype;
  v_dia         integer;
  v_versao      integer;
  v_id          uuid;
  c_lim_usuario constant integer := 40;   -- gerações por usuário a cada 10 minutos
  c_lim_aluno   constant integer := 10;   -- gerações por aluno por dia
begin
  if p_modo not in ('diaria', 'manual') then
    return jsonb_build_object('status', 'invalido', 'motivo', 'modo');
  end if;
  if p_tom not in ('Acolhedor', 'Lembrete', 'Firme', 'Urgente') then
    return jsonb_build_object('status', 'invalido', 'motivo', 'tom');
  end if;
  if char_length(coalesce(p_instrucao, '')) > 1000 then
    return jsonb_build_object('status', 'invalido', 'motivo', 'instrucao');
  end if;
  if not exists (select 1 from public.perfis where id = p_usuario and ativo) then
    return jsonb_build_object('status', 'sem_permissao');
  end if;
  if extract(isodow from v_agora_local) in (6, 7) then
    return jsonb_build_object('status', 'fim_de_semana');
  end if;

  -- Trava o aluno: chamadas simultâneas para o mesmo aluno esperam a vez.
  select * into v_aluno from public.alunos where id = p_aluno for update;
  if not found then
    return jsonb_build_object('status', 'nao_encontrado');
  end if;
  if v_aluno.estado_acompanhamento = 'concluido' then
    return jsonb_build_object('status', 'concluido');
  end if;
  if not exists (select 1 from public.pendencias
                  where aluno_id = p_aluno and marcada and estado = 'pendente') then
    return jsonb_build_object('status', 'sem_pendencias');
  end if;

  -- Controle de frequência
  if (select count(*) from public.mensagem_versoes
       where gerada_por = p_usuario and criado_em > now() - interval '10 minutes') >= c_lim_usuario then
    return jsonb_build_object('status', 'limite', 'motivo', 'usuario');
  end if;

  -- Mensagem do dia (cria se não existir)
  select count(distinct m.data_referencia) + 1 into v_dia
    from public.mensagens m
   where m.aluno_id = p_aluno and m.data_referencia < v_hoje
     and exists (select 1 from public.mensagem_versoes v
                  where v.mensagem_id = m.id and v.estado_geracao = 'concluida');

  insert into public.mensagens (aluno_id, data_referencia, dia_acompanhamento)
  values (p_aluno, v_hoje, v_dia)
  on conflict (aluno_id, data_referencia) do nothing;
  select * into v_msg from public.mensagens where aluno_id = p_aluno and data_referencia = v_hoje;

  if (select count(*) from public.mensagem_versoes where mensagem_id = v_msg.id) >= c_lim_aluno then
    return jsonb_build_object('status', 'limite', 'motivo', 'aluno');
  end if;

  -- Geração travada há mais de 3 minutos é considerada perdida
  update public.mensagem_versoes
     set estado_geracao = 'falhou', erro = 'Tempo esgotado sem resposta do servidor.', concluido_em = now()
   where mensagem_id = v_msg.id and estado_geracao = 'gerando' and criado_em < now() - interval '3 minutes';

  if exists (select 1 from public.mensagem_versoes where mensagem_id = v_msg.id and estado_geracao = 'gerando') then
    return jsonb_build_object('status', 'em_andamento', 'mensagem_id', v_msg.id);
  end if;
  if p_modo = 'diaria' and exists (select 1 from public.mensagem_versoes
                                    where mensagem_id = v_msg.id and estado_geracao = 'concluida') then
    return jsonb_build_object('status', 'ja_existe', 'mensagem_id', v_msg.id);
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from public.mensagem_versoes where mensagem_id = v_msg.id;
  insert into public.mensagem_versoes (mensagem_id, versao, tom, instrucao, estado_geracao, gerada_por)
  values (v_msg.id, v_versao, p_tom, nullif(btrim(p_instrucao), ''), 'gerando', p_usuario)
  returning id into v_id;

  return jsonb_build_object('status', 'reservada', 'versao_id', v_id, 'mensagem_id', v_msg.id,
                            'versao', v_versao, 'dia_acompanhamento', v_msg.dia_acompanhamento,
                            'data_referencia', v_hoje);
end $$;

-- =====================================================================
-- 2) Contexto para o agente (dados do aluno + histórico recente)
-- =====================================================================
create or replace function public.srv_contexto_geracao(p_aluno uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hoje', privado.hoje(),
    'aluno', (select to_jsonb(a) - 'criado_por' - 'atualizado_por' from public.alunos a where a.id = p_aluno),
    'curso', (select c.nome from public.alunos a join public.cursos c on c.id = a.curso_id where a.id = p_aluno),
    'pendencias', coalesce((select jsonb_agg(to_jsonb(p) - 'atualizado_por' order by p.tipo)
                              from public.pendencias p where p.aluno_id = p_aluno), '[]'::jsonb),
    'configuracoes', (select to_jsonb(c) - 'atualizado_por' from public.configuracoes c where c.id = 1),
    -- mensagens de DIAS ANTERIORES com versão concluída (0 = primeiro contato)
    'qtd_mensagens_anteriores', (select count(*) from public.mensagens m
                                  where m.aluno_id = p_aluno and m.data_referencia < privado.hoje()
                                    and privado.versao_vigente(m.id) is not null),
    'qtd_enviadas', (select count(*) from public.mensagens m
                      where m.aluno_id = p_aluno and m.data_referencia < privado.hoje()
                        and m.estado_envio = 'enviada'),
    'ultimas_mensagens', coalesce((
      select jsonb_agg(x order by x.criado_em) from (
        select v.texto, v.tom, v.criado_em, m.data_referencia, (v.enviada_em is not null) as enviada
          from public.mensagem_versoes v join public.mensagens m on m.id = v.mensagem_id
         where m.aluno_id = p_aluno and v.estado_geracao = 'concluida'
         order by v.criado_em desc limit 2) x), '[]'::jsonb),
    'ultimas_respostas', coalesce((
      select jsonb_agg(x order by x.respondida_em) from (
        select r.texto, r.respondida_em from public.respostas r
         where r.aluno_id = p_aluno order by r.respondida_em desc limit 2) x), '[]'::jsonb)
  )
$$;

-- =====================================================================
-- 3) Concluir ou registrar falha
-- =====================================================================
create or replace function public.srv_concluir_geracao(p_versao uuid, p_texto text, p_modelo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(char_length(btrim(p_texto)), 0) = 0 then
    return public.srv_falhar_geracao(p_versao, 'A IA devolveu uma resposta vazia.');
  end if;
  update public.mensagem_versoes
     set texto = left(btrim(p_texto), 6000), modelo = left(p_modelo, 80),
         estado_geracao = 'concluida', erro = null, concluido_em = now()
   where id = p_versao and estado_geracao = 'gerando';
  if not found then
    return jsonb_build_object('status', 'expirada');
  end if;
  return jsonb_build_object('status', 'concluida');
end $$;

create or replace function public.srv_falhar_geracao(p_versao uuid, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mensagem_versoes
     set estado_geracao = 'falhou', erro = left(coalesce(p_erro, 'Falha sem detalhes.'), 1000), concluido_em = now()
   where id = p_versao and estado_geracao = 'gerando';
  return jsonb_build_object('status', 'falhou');
end $$;

revoke all on function public.srv_reservar_geracao(uuid, uuid, text, text, text),
                       public.srv_contexto_geracao(uuid),
                       public.srv_concluir_geracao(uuid, text, text),
                       public.srv_falhar_geracao(uuid, text)
  from public, anon, authenticated;
grant execute on function public.srv_reservar_geracao(uuid, uuid, text, text, text),
                          public.srv_contexto_geracao(uuid),
                          public.srv_concluir_geracao(uuid, text, text),
                          public.srv_falhar_geracao(uuid, text)
  to service_role;
grant execute on function privado.importando() to service_role, authenticated;
revoke execute on function privado.importando() from public;

-- =====================================================================
-- 4) Importação de backup (somente admin)
-- =====================================================================
-- * Valida o formato antes de qualquer gravação.
-- * Nunca sobrescreve: registros cujo id já existe são ignorados.
-- * Configurações só são substituídas se p_substituir_config = true.
-- * p_simular = true apenas conta o que seria importado (nada é gravado).
create or replace function public.importar_backup(
  p_dados jsonb,
  p_simular boolean default true,
  p_substituir_config boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := jsonb_build_object('alunos_novos', 0, 'alunos_ignorados', 0, 'mensagens_novas', 0,
                                'versoes_novas', 0, 'respostas_novas', 0, 'configuracoes', false);
  n integer;
  v_novos uuid[];
begin
  if not privado.eh_admin() then
    raise exception 'Somente administradores podem importar backup.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_dados) <> 'object' or p_dados ->> 'formato' <> 'painel-follow-up-nta'
     or (p_dados ->> 'versao') is distinct from '1' then
    raise exception 'Arquivo inválido: não é um backup do Painel de Follow-up (versão 1).' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_dados -> 'alunos', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_dados -> 'pendencias', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_dados -> 'mensagens', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_dados -> 'mensagem_versoes', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_dados -> 'respostas', '[]')) <> 'array' then
    raise exception 'Arquivo inválido: listas de dados com formato incorreto.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_dados -> 'alunos', '[]')) > 20000 then
    raise exception 'Arquivo grande demais para importar de uma vez.' using errcode = '22023';
  end if;

  begin
    perform set_config('painel.importando', '1', true);

    -- Alunos (ids existentes são ignorados)
    with novos as (
      insert into public.alunos (id, nome, email, telefone, data_compra, curso_id, momento_profissional,
                                 dor_principal, observacoes, data_cadastro, criado_em)
      select x.id, x.nome, x.email, x.telefone, x.data_compra, x.curso_id, x.momento_profissional,
             x.dor_principal, x.observacoes, coalesce(x.data_cadastro, privado.hoje()), coalesce(x.criado_em, now())
        from jsonb_to_recordset(coalesce(p_dados -> 'alunos', '[]')) as x(
               id uuid, nome text, email text, telefone text, data_compra date, curso_id smallint,
               momento_profissional text, dor_principal text, observacoes text, data_cadastro date, criado_em timestamptz)
       where x.id is not null
      on conflict (id) do nothing
      returning id)
    select array_agg(id) into v_novos from novos;
    v_novos := coalesce(v_novos, '{}');
    r := r || jsonb_build_object('alunos_novos', cardinality(v_novos),
                                 'alunos_ignorados', jsonb_array_length(coalesce(p_dados -> 'alunos', '[]')) - cardinality(v_novos));

    -- Pendências: só para os alunos criados nesta importação
    update public.pendencias p
       set marcada = x.marcada, estado = x.estado, data_referencia = x.data_referencia,
           dias_informados = x.dias_informados, resolvida_em = x.resolvida_em
      from jsonb_to_recordset(coalesce(p_dados -> 'pendencias', '[]')) as x(
             aluno_id uuid, tipo text, marcada boolean, estado text, data_referencia date,
             dias_informados integer, resolvida_em date)
     where p.aluno_id = x.aluno_id and p.tipo = x.tipo and x.aluno_id = any (v_novos);

    -- Mensagens e versões (só de alunos novos)
    insert into public.mensagens (id, aluno_id, data_referencia, dia_acompanhamento, estado_envio, enviada_em, criado_em)
    select x.id, x.aluno_id, x.data_referencia, x.dia_acompanhamento,
           coalesce(x.estado_envio, 'nao_enviada'), x.enviada_em, coalesce(x.criado_em, now())
      from jsonb_to_recordset(coalesce(p_dados -> 'mensagens', '[]')) as x(
             id uuid, aluno_id uuid, data_referencia date, dia_acompanhamento integer,
             estado_envio text, enviada_em timestamptz, criado_em timestamptz)
     where x.aluno_id = any (v_novos)
    on conflict do nothing;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('mensagens_novas', n);

    insert into public.mensagem_versoes (id, mensagem_id, versao, tom, instrucao, texto, estado_geracao,
                                         erro, modelo, enviada_em, criado_em, concluido_em)
    select x.id, x.mensagem_id, x.versao, x.tom, x.instrucao, x.texto,
           case when x.estado_geracao = 'gerando' then 'falhou' else x.estado_geracao end,
           x.erro, x.modelo, x.enviada_em, coalesce(x.criado_em, now()), x.concluido_em
      from jsonb_to_recordset(coalesce(p_dados -> 'mensagem_versoes', '[]')) as x(
             id uuid, mensagem_id uuid, versao integer, tom text, instrucao text, texto text,
             estado_geracao text, erro text, modelo text, enviada_em timestamptz,
             criado_em timestamptz, concluido_em timestamptz)
     where exists (select 1 from public.mensagens m where m.id = x.mensagem_id and m.aluno_id = any (v_novos))
    on conflict do nothing;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('versoes_novas', n);

    insert into public.respostas (id, aluno_id, mensagem_id, texto, respondida_em, criado_em)
    select x.id, x.aluno_id,
           case when exists (select 1 from public.mensagens m where m.id = x.mensagem_id and m.aluno_id = x.aluno_id)
                then x.mensagem_id end,
           x.texto, coalesce(x.respondida_em, now()), coalesce(x.criado_em, now())
      from jsonb_to_recordset(coalesce(p_dados -> 'respostas', '[]')) as x(
             id uuid, aluno_id uuid, mensagem_id uuid, texto text, respondida_em timestamptz, criado_em timestamptz)
     where x.aluno_id = any (v_novos)
    on conflict do nothing;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('respostas_novas', n);

    if p_substituir_config and jsonb_typeof(p_dados -> 'configuracoes') = 'object' then
      update public.configuracoes c
         set assinante         = coalesce(p_dados -> 'configuracoes' ->> 'assinante', c.assinante),
             prazo_padrao      = coalesce((p_dados -> 'configuracoes' ->> 'prazo_padrao')::integer, c.prazo_padrao),
             link_acesso       = coalesce(p_dados -> 'configuracoes' ->> 'link_acesso', c.link_acesso),
             link_contrato     = coalesce(p_dados -> 'configuracoes' ->> 'link_contrato', c.link_contrato),
             link_documentacao = coalesce(p_dados -> 'configuracoes' ->> 'link_documentacao', c.link_documentacao)
       where c.id = 1;
      r := r || jsonb_build_object('configuracoes', true);
    end if;

    -- recalcula o estado de acompanhamento dos alunos importados
    perform privado.recalcular_estado_aluno(a) from unnest(v_novos) a;
    perform set_config('painel.importando', '', true);

    if p_simular then
      raise exception using errcode = 'P0001', message = 'simulacao', detail = r::text;
    end if;
  exception
    when raise_exception then
      perform set_config('painel.importando', '', true);
      if sqlerrm = 'simulacao' then
        return r || jsonb_build_object('simulacao', true);
      end if;
      raise;
  end;
  return r || jsonb_build_object('simulacao', false);
end $$;

revoke all on function public.importar_backup(jsonb, boolean, boolean) from public, anon;
grant execute on function public.importar_backup(jsonb, boolean, boolean) to authenticated;
