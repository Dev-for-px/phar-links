# PHAR Links — documentação

Atualizado em 21/10/2026.

Encurtador de links com UTM e destino editável, para várias empresas clientes. O link curto (`links.pharconsultoria.com/promo`) fica fixo; o destino e as UTMs podem ser trocados a qualquer hora no painel.

## Endereços
- Sistema e links curtos: https://links.pharconsultoria.com
  - `/` página inicial · `/entrar` login, cadastro e recuperação de senha · `/app` painel de links · `/admin` administração · `/<slug>` redireciona
- Código: GitHub `Dev-for-px/phar-links` (privado), branch `main`. Cada push publica na Vercel.
- Banco e login: Supabase, projeto `phar-links` (id `uqmjjrrpdgtjgzzjyxtn`, região São Paulo, plano gratuito), organização pedrodadila.
- Domínio: Cloudflare, registro CNAME `links` → `cname.vercel-dns.com`, só DNS (nuvem cinza).
- Administrador: pedrodadila@gmail.com (vira admin automaticamente ao se cadastrar).

## Como funciona
1. A pessoa cria conta em `/entrar` informando o nome da empresa. A empresa nasce **pendente**.
2. O admin libera em `/admin` (Pendente → Liberada). Também pode **suspender**: a empresa perde o acesso e os links dela param de redirecionar.
3. Com a empresa liberada, o painel `/app` permite criar, buscar, copiar, editar, pausar (desmarcar "Link ativo") e excluir links.
4. Cada link tem: nome interno, endereço curto (slug), destino e as 5 UTMs. A tela mostra a URL final antes de salvar.
5. Clique em `/<slug>`: a função `api/go.js` chama `resolver_link` no banco, que soma o clique e devolve destino + UTMs. A função monta a URL (mantendo parâmetros que o destino já tinha) e redireciona com 302, sem cache, para a troca de destino valer na hora.

## Equipe e permissões
- Mesmo modelo do PHAR Prospector. Na aba Equipe, o responsável autoriza o e-mail de um colaborador e marca as permissões. A pessoa cria a conta em `/entrar` com esse e-mail (sem precisar informar empresa) e entra direto na equipe. O sistema não envia convite por e-mail; há o botão "Copiar o link de cadastro".
- Permissões (caixinhas): ver links de toda a equipe (desmarcado = só os que criou), ver a equipe, criar, editar, excluir. Começam marcadas todas menos excluir. Valem no banco (`private.pode`), não só na tela. O responsável pode tudo.
- O responsável muda permissões, cancela autorizações e remove pessoas (os links criados por ela continuam na empresa). Limite de 20 pessoas por empresa.
- Convites ficam em `private.convites` com situação pendente/aceito/cancelado (não são apagados).

## UTMs
- Cada campo de UTM tem uma lista de opções prontas (instagram, facebook, google, whatsapp, cpc, social, bio etc.) e também os valores já usados nos links da empresa. Dá para escolher da lista ou digitar outro.
- A URL final ("Vai abrir") tem botão Copiar, para usar o link completo com UTM sem o encurtador.

## Visual
- Mesma base visual do PHAR Prospector (Design System da PHAR Consultoria): `public/css/estilo.css` copiado de lá, com um bloco "PHAR Links" no fim; `public/js/grade.js` (grade de pontos) e `public/favicon.svg` também vêm de lá.
- Telas: página inicial (`index.html`), entrar com abas Entrar/Criar conta e recuperação de senha, sistema com faixa azul (resumo: ativos, pausados, cliques hoje, total), lista de links, janela de edição com gráfico de 30 dias, e painel admin com Liberar/Suspender/Reativar.

## Banco
- `empresas` (nome, situação: pendente/ativa/bloqueada)
- `perfis` (um por usuário: e-mail, empresa, papel dono/membro, admin, permissões)
- `links` (criado_por, slug único no sistema todo, destino, UTMs, ativo, total de cliques)
- `cliques_dia` (um registro por link por dia, com o total)
- Funções: `minhas_permissoes`, `equipe_listar`, `equipe_autorizar`, `equipe_permissoes`, `equipe_cancelar_convite`, `equipe_remover`, `empresa_criar` (cadastro da empresa), `resolver_link` (redirecionamento), `private.eu_admin`, `private.minha_empresa_ativa`.
- Arquivo para recriar tudo: `supabase/schema-completo.sql`.

## Segurança
- Regras do banco (RLS): cada empresa só vê e altera os próprios links; só o admin muda a situação das empresas; ninguém altera o próprio perfil (não dá para se fazer admin).
- O contador de cliques e a empresa do link são protegidos por gatilho: o usuário não consegue alterá-los.
- Endereços reservados que não podem virar slug: app, entrar, admin, api, assets.
- UTMs aceitam só letras sem acento, números, espaço, ponto, hífen, + e _.
- O site bloqueia `<script>` solto e `style=` no HTML (Content-Security-Policy em `vercel.json`). Usar classes de CSS e arquivos .js.
- A chave publicável do Supabase fica no código de propósito (é pública); nunca colocar a chave secreta nem a senha do banco no repositório.

## Economia no Supabase
- Não grava um registro por clique, só o total por link e por dia. Estimativa: 1.000 links clicados todos os dias por um ano ≈ 365 mil linhas ≈ 30 MB (o limite gratuito é 500 MB).
- Não guarda IP, aparelho, país ou qualquer dado de quem clicou.
- Sem tempo real, sem armazenamento de arquivos, sem funções pagas.

## Reconstruir do zero
1. Criar projeto no Supabase e rodar `supabase/schema-completo.sql` no SQL Editor.
2. Trocar URL e chave publicável em `public/js/config.js`, `api/go.js` e no `connect-src` do `vercel.json`.
3. Importar o repositório na Vercel e adicionar o domínio; criar o CNAME no Cloudflare.
4. No Supabase (Authentication → URL Configuration): Site URL `https://links.pharconsultoria.com` e Redirect URL `https://links.pharconsultoria.com/**`.

## Pendências
- Site URL e Redirect URLs do login no Supabase (passo 4 acima) — conferir.
- E-mail próprio (SMTP) antes de abrir para muitos clientes: o e-mail embutido do Supabase manda poucas mensagens por hora.
- Limpeza: a função antiga `public.resolver(text)` ficou no banco sem permissão de uso. Para remover, rodar no SQL Editor: `drop function public.resolver(text);`
- Cobrança e assinatura; QR Code por link (ideias futuras).

## Histórico
- 21/10/2026 — Equipe com permissões (como no Prospector), opções prontas de UTM e botão para copiar a URL final.
- 21/10/2026 — telas no padrão do PHAR Prospector, página inicial e recuperação de senha.
- 21/10/2026 — primeira versão: cadastro com aprovação, links com UTM e destino editável, contador total e por dia, administração de empresas.
