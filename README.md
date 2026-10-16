# Painel de Follow-up — Sucesso do Aluno da Pós-graduação

Aplicação web para o time de Sucesso do Aluno acompanhar alunos com pendências de matrícula
(nunca acessou a plataforma, não assinou o contrato, não subiu a documentação), gerar mensagens
personalizadas para WhatsApp com a API do Claude e registrar envios e respostas.

Funciona no navegador do computador, tablet ou celular, com login individual. Quem usa o painel
**não precisa** de assinatura do Claude nem de conta no GitHub.

---

## 1. Arquitetura

```
Navegador (HTML, CSS e JavaScript puro)          GitHub Pages
        │  login e dados (chave pública "anon" + RLS)
        ▼
Supabase ── Auth (login individual)
        ├─ PostgreSQL (dados, regras de acesso RLS, histórico, auditoria)
        └─ Edge Function "gerar-mensagem" ──► API do Claude
                (chave da API só aqui, nos segredos do Supabase)
```

| Parte | Onde está | O que faz |
|---|---|---|
| `index.html`, `assets/` | GitHub Pages | Interface. Não guarda segredos. |
| `assets/vendor/supabase-js.esm.js` | GitHub Pages | Biblioteca oficial do Supabase (v2.117.3), copiada para o repositório: o site não depende de CDN e a política de segurança só permite scripts do próprio site. |
| `supabase/migrations/` | Supabase (PostgreSQL) | Tabelas, índices, regras de acesso (RLS), gatilhos de histórico e auditoria, funções de geração e backup. |
| `supabase/functions/gerar-mensagem/` | Supabase Edge Functions | Confere o usuário, reserva a geração no banco (sem duplicar), chama a API do Claude e grava a nova versão. |
| `supabase/functions/_shared/regras.js` | Navegador **e** servidor | Regras de dias, prazos e tons — um único arquivo para os dois lados calcularem igual. |
| `supabase/functions/_shared/prompt.js` | Servidor | Instruções do agente (seção 14 do prompt mestre). |

### Decisões de arquitetura

- **Hospedagem: GitHub Pages + Supabase**, em vez da Vercel. O plano gratuito da Vercel não permite
  uso comercial; o GitHub Pages é gratuito e as funções de servidor rodam no próprio Supabase.
  Repositório público é seguro: nenhum dado nem segredo fica no código; tudo depende de login e RLS.
- **Regras críticas no banco**, não só na tela: uma mensagem por aluno por dia, bloqueio no fim de
  semana, nada para aluno concluído, limite de frequência, histórico imutável de respostas. Assim,
  nem chamadas diretas à API conseguem burlar.
- **Texto "da IA" só pelo servidor**: usuários não conseguem gravar mensagens geradas; só a Edge
  Function (com a chave de serviço) grava, depois de receber a resposta da API do Claude.
- **Estrutura de arquivos** segue a seção 16, com acréscimos: `ui.js` (utilidades de tela),
  `regras.js` (reexporta as regras compartilhadas) e `config.js` (endereço público do Supabase).

### Modelo de dados (resumo)

`perfis` (usuários e papéis) · `cursos` (5 fixos) · `alunos` · `pendencias` (3 por aluno) ·
`pendencias_historico` · `mensagens` (1 por aluno por dia, com estado de envio) ·
`mensagem_versoes` (cada geração, preservada) · `respostas` (somente inserção) ·
`configuracoes` (linha única) · `auditoria`.

---

## 2. Pré-requisitos

- Conta no **Supabase** (plano gratuito atende) — https://supabase.com
- Conta no **Console da Anthropic** com créditos para a API — https://console.anthropic.com
  (a API é cobrada por uso, separada de qualquer assinatura do Claude)
- Repositório no GitHub do Instituto NTA com GitHub Pages
- Para desenvolver e testar localmente: Node 20+, PostgreSQL 16, Deno 2 e (opcional) Supabase CLI

## 3. Configuração local

```bash
git clone https://github.com/InstitutoNTA/painel-follow-up-nta.git
cd painel-follow-up-nta
npm test            # banco + regras + verificação da função (não precisa de internet)
```

Para abrir o site localmente, sirva a pasta com qualquer servidor estático
(ex.: `npx serve .`) depois de preencher `assets/js/config.js`.

## 4. Configuração do Supabase

1. Crie o projeto em **supabase.com → New project** (região: South America – São Paulo).
2. Anote a **senha do banco** em local seguro (gerenciador de senhas). Ela não vai para o chat nem para o GitHub.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable** para
   `assets/js/config.js`. Essas duas são públicas por natureza. **Nunca** coloque a `service_role` ali.

## 5. Aplicação das migrations

Opção A — Supabase CLI no seu computador:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Opção B — GitHub Actions: cadastre os segredos `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` e
`SUPABASE_DB_PASSWORD` em **Settings → Secrets and variables → Actions** e rode o fluxo
**Actions → Supabase → Run workflow**.

Para conferir: no Supabase, **Table Editor** deve listar as tabelas acima, e
**Authentication → Policies** deve mostrar RLS ativo em todas.

## 6. Configuração da API do Claude

1. No Console da Anthropic, crie uma chave em **API Keys → Create Key**.
2. No Supabase, **Edge Functions → Secrets → Add new secret**: nome `ANTHROPIC_API_KEY`, valor = a chave.
3. Publique a função: `npx supabase functions deploy gerar-mensagem` (ou pelo fluxo do GitHub Actions).
4. Opcional: `ALLOWED_ORIGINS` = `https://institutonta.github.io` para aceitar chamadas só do site.

Sem a chave, o painel funciona normalmente e mostra “A geração de mensagens ainda não foi configurada”.

## 7. Variáveis de ambiente

| Nome | Onde | Obrigatória | Para quê |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Segredos do Supabase | Sim | Chamar a API do Claude |
| `ANTHROPIC_MODEL` | Segredos do Supabase | Não | Trocar o modelo (padrão `claude-haiku-5-5`, mais econômico; use `claude-sonnet-5-5` para textos mais elaborados) |
| `ALLOWED_ORIGINS` | Segredos do Supabase | Recomendada | Endereços que podem chamar a função |
| `ANTHROPIC_BASE_URL` | — | Não | Só para testes locais |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Automáticas | — | Fornecidas pelo Supabase à função |

`.env.example` lista os nomes. Valores reais nunca vão para o repositório (`.gitignore` bloqueia `.env*`).

## 8. Configuração da autenticação

1. **Authentication → Sign In / Providers → Email**: deixe ativo e **desligue “Allow new users to sign up”**
   (só entra quem for convidado).
2. **Authentication → URL Configuration**: *Site URL* = endereço do site no GitHub Pages; inclua o mesmo
   em *Redirect URLs*.
3. **Primeiro administrador**: convide-se em **Authentication → Users → Invite user**, defina a senha pelo
   e-mail e rode uma vez no **SQL Editor**:
   ```sql
   update public.perfis set papel = 'admin', ativo = true, nome = 'Seu nome'
   where email = 'seu-email@dominio';
   ```
4. **Cadastrar a Clara**: *Invite user* com o e-mail dela → ela define a senha pelo link → você a ativa em
   **Configurações → Usuários** dentro do painel (ou com o mesmo SQL, sem `papel = 'admin'`).

Usuário novo entra **inativo** e não vê nenhum dado até ser ativado.

## 9. Testes

| Comando | O que testa |
|---|---|
| `npm run test:db` | Migrations e regras do banco num PostgreSQL local descartável (RLS, validações, histórico, geração diária, envio por versão, retenção, backup). |
| `npm run test:unit` | Cálculo de dias, prazos e tons; instruções do agente; fluxo da função com dublês. |
| `npm run check:function` | Tipos da Edge Function (Deno). |
| `npm run test:e2e` | Ponta a ponta num navegador real: Auth + PostgREST + função + site locais, com dublê da API do Claude. |

Todos usam somente dados fictícios. Resultados da última execução: ver `docs/TESTES.md`.

## 10. Publicação

1. Envie o código para a branch `main`.
2. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
3. O fluxo **Testes** roda a cada envio; se passar, **Publicar site** publica no GitHub Pages
   (somente `index.html`, `assets/` e as regras compartilhadas).
4. Valide o endereço publicado: login, cadastro de um aluno de teste, geração e exclusão do aluno de teste.

## 11. Backup e restauração

- **Exportar**: Configurações → *Exportar backup* (qualquer usuário ativo). Gera um JSON com alunos,
  pendências, mensagens (todas as versões), respostas e configurações. Contém dados pessoais:
  guarde em local protegido.
- **Importar**: Configurações → *Importar backup* (somente administrador). O arquivo é validado, uma
  prévia mostra o que será incluído e só então você confirma. Registros já existentes são ignorados
  (nada é sobrescrito); configurações só mudam se você marcar a opção.
- O Supabase também faz backups automáticos do banco (conforme o plano).

## 12. Atualização e manutenção

- Mudanças de banco: crie um **novo** arquivo em `supabase/migrations/` (não edite os já aplicados),
  rode `npm run test:db` e aplique com `supabase db push`.
- Toda tabela nova precisa de `enable row level security`, `revoke` dos privilégios padrão e políticas.
- Atualizar a biblioteca do Supabase: `scripts/atualizar-supabase-js.sh 2.x.y`.
- Retenção: rode `select privado.aplicar_retencao();` mensalmente (ou agende com `pg_cron`). Ver `SECURITY.md`.

## 13. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| “O painel ainda não foi conectado ao banco” | `config.js` vazio | Preencha URL e chave anon. |
| “Acesso aguardando liberação” | Usuário inativo | Admin ativa em Configurações → Usuários. |
| “A geração de mensagens ainda não foi configurada” | Falta `ANTHROPIC_API_KEY` ou a função não foi publicada | Veja a seção 6. |
| “Muitas mensagens geradas em pouco tempo” | Limite de 40 gerações a cada 10 min por usuário ou 10 por aluno por dia | Aguarde alguns minutos. |
| “As mensagens são geradas somente de segunda a sexta” | Fim de semana (horário de Brasília) | Comportamento esperado. |
| Link do e-mail de convite não abre o painel | *Site URL* ou *Redirect URLs* errados | Seção 8, passo 2. |
| Geração travada em “Gerando…” | Falha de rede durante a geração | Após 3 minutos o banco libera nova tentativa automaticamente. |
