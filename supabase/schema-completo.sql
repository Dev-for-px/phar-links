-- PHAR Links — banco completo (rodar no SQL Editor de um projeto Supabase novo para recriar tudo).
-- Atualizado em 21/10/2026 (com equipe e permissões).

create schema if not exists private;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 120),
  situacao text not null default 'pendente' check (situacao in ('pendente','ativa','bloqueada')),
  criado_em timestamptz not null default now()
);

create table public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  empresa_id uuid references public.empresas(id) on delete set null,
  papel text not null default 'dono' check (papel in ('dono','membro')),
  admin boolean not null default false,
  criado_em timestamptz not null default now()
);

create table public.links (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,49}$' and slug not in ('app','entrar','admin','api','assets','favicon.ico','robots.txt')),
  nome text not null check (length(trim(nome)) between 1 and 120),
  destino text not null check (destino ~* '^https?://'),
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  ativo boolean not null default true,
  cliques bigint not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint utm_seguro check (
    coalesce(utm_source,'') ~ '^[A-Za-z0-9_.+ -]{0,100}$' and coalesce(utm_medium,'') ~ '^[A-Za-z0-9_.+ -]{0,100}$'
    and coalesce(utm_campaign,'') ~ '^[A-Za-z0-9_.+ -]{0,100}$' and coalesce(utm_term,'') ~ '^[A-Za-z0-9_.+ -]{0,100}$'
    and coalesce(utm_content,'') ~ '^[A-Za-z0-9_.+ -]{0,100}$')
);
create index on public.links(empresa_id);

-- Um registro por link por dia (não por clique), para economizar espaço.
create table public.cliques_dia (
  link_id uuid not null references public.links(id) on delete cascade,
  dia date not null,
  total integer not null default 0,
  primary key (link_id, dia)
);

create or replace function private.eu_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select admin from public.perfis where user_id = auth.uid()), false) $$;

create or replace function private.minha_empresa_ativa() returns uuid
language sql stable security definer set search_path = '' as
$$ select p.empresa_id from public.perfis p join public.empresas e on e.id = p.empresa_id
   where p.user_id = auth.uid() and e.situacao = 'ativa' $$;

grant usage on schema private to authenticated, anon;
grant execute on function private.eu_admin(), private.minha_empresa_ativa() to authenticated;

-- Perfil criado no cadastro; o e-mail abaixo vira administrador do sistema.
create or replace function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  insert into public.perfis(user_id, email, admin)
  values (new.id, new.email, lower(new.email) = 'pedrodadila@gmail.com');
  return new; end $$;
create trigger ao_criar_usuario after insert on auth.users
for each row execute function private.novo_usuario();

alter table public.empresas enable row level security;
alter table public.perfis enable row level security;
alter table public.links enable row level security;
alter table public.cliques_dia enable row level security;

create policy ver_empresa on public.empresas for select to authenticated
  using (private.eu_admin() or id = (select empresa_id from public.perfis where user_id = auth.uid()));
create policy admin_altera_empresa on public.empresas for update to authenticated
  using (private.eu_admin()) with check (private.eu_admin());

create policy ver_perfil on public.perfis for select to authenticated
  using (user_id = auth.uid() or private.eu_admin());

create policy links_ler on public.links for select to authenticated
  using (empresa_id = private.minha_empresa_ativa() or private.eu_admin());
create policy links_criar on public.links for insert to authenticated
  with check (empresa_id = private.minha_empresa_ativa());
create policy links_editar on public.links for update to authenticated
  using (empresa_id = private.minha_empresa_ativa()) with check (empresa_id = private.minha_empresa_ativa());
create policy links_excluir on public.links for delete to authenticated
  using (empresa_id = private.minha_empresa_ativa());

create policy cliques_ler on public.cliques_dia for select to authenticated
  using (exists (select 1 from public.links l where l.id = link_id
    and (l.empresa_id = private.minha_empresa_ativa() or private.eu_admin())));

-- Usuário não mexe no contador nem troca o link de empresa; o sistema (redirecionamento) pode.
create or replace function private.antes_salvar_link() returns trigger
language plpgsql set search_path = '' as
$$ begin
  new.slug := lower(trim(new.slug));
  if current_user in ('authenticated','anon') then
    new.atualizado_em := now();
    if tg_op = 'INSERT' then new.cliques := 0;
    else new.cliques := old.cliques; new.empresa_id := old.empresa_id; end if;
  end if;
  return new; end $$;
create trigger antes_salvar_link before insert or update on public.links
for each row execute function private.antes_salvar_link();

revoke all on public.cliques_dia from anon, authenticated;
grant select on public.cliques_dia to authenticated;
revoke all on public.links, public.empresas, public.perfis from anon;

create or replace function public.empresa_criar(p_nome text) returns uuid
language plpgsql security definer set search_path = '' as
$$ declare v uuid; begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if (select empresa_id from public.perfis where user_id = auth.uid()) is not null then
    raise exception 'Você já tem uma empresa'; end if;
  insert into public.empresas(nome) values (trim(p_nome)) returning id into v;
  update public.perfis set empresa_id = v, papel = 'dono' where user_id = auth.uid();
  return v; end $$;
revoke execute on function public.empresa_criar(text) from public, anon;
grant execute on function public.empresa_criar(text) to authenticated;

-- Usado pelo redirecionamento (api/go.js): devolve destino e UTMs e soma o clique.
create or replace function public.resolver_link(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as
$$ declare l public.links; begin
  select k.* into l from public.links k join public.empresas e on e.id = k.empresa_id
   where k.slug = lower(p_slug) and k.ativo and e.situacao = 'ativa';
  if not found then return null; end if;
  update public.links set cliques = cliques + 1 where id = l.id;
  insert into public.cliques_dia(link_id, dia, total)
    values (l.id, (now() at time zone 'America/Sao_Paulo')::date, 1)
    on conflict (link_id, dia) do update set total = public.cliques_dia.total + 1;
  return jsonb_build_object('destino', l.destino, 'utm_source', l.utm_source, 'utm_medium', l.utm_medium,
    'utm_campaign', l.utm_campaign, 'utm_term', l.utm_term, 'utm_content', l.utm_content);
end $$;
revoke execute on function public.resolver_link(text) from public, authenticated;
grant execute on function public.resolver_link(text) to anon;

-- =====================================================================
-- Equipe e permissões (mesmo modelo do PHAR Prospector)
-- =====================================================================
alter table public.perfis add column permissoes jsonb not null default '{}'::jsonb;
alter table public.links add column criado_por uuid references auth.users(id) on delete set null default auth.uid();

create table private.convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 120),
  permissoes jsonb not null default '{}'::jsonb,
  estado text not null default 'pendente' check (estado in ('pendente','aceito','cancelado')),
  criado_em timestamptz not null default now()
);
create unique index convites_um_pendente on private.convites(email) where estado = 'pendente';

--   ver_todos  ver os links de toda a equipe (desmarcado: só os que a pessoa criou)
--   criar / editar / excluir links · ver_equipe ver quem faz parte da equipe
create function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as
$$ select '{"ver_todos":true,"criar":true,"editar":true,"excluir":false,"ver_equipe":true}'::jsonb $$;

create function private.permissoes_limpas(p jsonb) returns jsonb
language sql immutable set search_path = '' as
$$ select jsonb_object_agg(d.key,
     case when jsonb_typeof(coalesce(p,'{}'::jsonb) -> d.key) = 'boolean' then coalesce(p,'{}'::jsonb) -> d.key else d.value end)
   from jsonb_each(private.permissoes_padrao()) d $$;

create function private.sou_dono() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select papel = 'dono' from public.perfis where user_id = auth.uid()), false) $$;

create function private.pode(p_chave text) returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select case when p.papel = 'dono' then true
     else (private.permissoes_limpas(p.permissoes) ->> p_chave)::boolean end
   from public.perfis p where p.user_id = auth.uid()), false) $$;

grant execute on function private.pode(text), private.sou_dono() to authenticated;

-- cadastro com e-mail autorizado entra na equipe como colaborador
create or replace function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as
$$ declare c private.convites; begin
  select * into c from private.convites where email = lower(new.email) and estado = 'pendente';
  if found then
    insert into public.perfis(user_id, email, empresa_id, papel, permissoes)
    values (new.id, new.email, c.empresa_id, 'membro', private.permissoes_limpas(c.permissoes));
    update private.convites set estado = 'aceito' where id = c.id;
  else
    insert into public.perfis(user_id, email, admin)
    values (new.id, new.email, lower(new.email) = 'pedrodadila@gmail.com');
  end if;
  return new; end $$;

create or replace function private.antes_salvar_link() returns trigger
language plpgsql set search_path = '' as
$$ begin
  new.slug := lower(trim(new.slug));
  if current_user in ('authenticated','anon') then
    new.atualizado_em := now();
    if tg_op = 'INSERT' then new.cliques := 0; new.criado_por := auth.uid();
    else new.cliques := old.cliques; new.empresa_id := old.empresa_id; new.criado_por := old.criado_por; end if;
  end if;
  return new; end $$;

alter policy links_ler on public.links using (
  private.eu_admin() or (empresa_id = private.minha_empresa_ativa()
    and (private.pode('ver_todos') or criado_por = auth.uid())));
alter policy links_criar on public.links with check (
  empresa_id = private.minha_empresa_ativa() and private.pode('criar'));
alter policy links_editar on public.links using (
  empresa_id = private.minha_empresa_ativa() and private.pode('editar')
  and (private.pode('ver_todos') or criado_por = auth.uid()))
  with check (empresa_id = private.minha_empresa_ativa());
alter policy links_excluir on public.links using (
  empresa_id = private.minha_empresa_ativa() and private.pode('excluir')
  and (private.pode('ver_todos') or criado_por = auth.uid()));

create function public.minhas_permissoes() returns jsonb
language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('papel', p.papel, 'permissoes',
     case when p.papel = 'dono' then (select jsonb_object_agg(k, true) from jsonb_object_keys(private.permissoes_padrao()) k)
     else private.permissoes_limpas(p.permissoes) end)
   from public.perfis p where p.user_id = auth.uid() $$;

create function public.equipe_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); v_dono boolean := private.sou_dono(); begin
  if v_emp is null then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return jsonb_build_object(
    'membros', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.user_id, 'email', p.email, 'papel', p.papel, 'ultimo_acesso', u.last_sign_in_at,
        'permissoes', case when v_dono and p.papel <> 'dono' then private.permissoes_limpas(p.permissoes) end)
        order by (p.papel = 'dono') desc, p.email), '[]'::jsonb)
      from public.perfis p join auth.users u on u.id = p.user_id
      where p.empresa_id = v_emp and (private.pode('ver_equipe') or p.user_id = auth.uid())),
    'convites', case when v_dono then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'email', c.email, 'criado_em', c.criado_em, 'permissoes', private.permissoes_limpas(c.permissoes))
        order by c.criado_em), '[]'::jsonb) from private.convites c where c.empresa_id = v_emp and c.estado = 'pendente') else '[]'::jsonb end,
    'pode_gerenciar', v_dono,
    'padrao', private.permissoes_padrao());
end $$;

create function public.equipe_autorizar(p_email text, p_permissoes jsonb) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); v_email text := lower(btrim(p_email)); begin
  if v_emp is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalido' using errcode = 'P0001'; end if;
  if exists (select 1 from public.perfis where lower(email) = v_email and empresa_id = v_emp) then
    raise exception 'ja_membro' using errcode = 'P0001'; end if;
  if exists (select 1 from public.perfis where lower(email) = v_email) then
    raise exception 'ja_cadastrado' using errcode = 'P0001'; end if;
  if exists (select 1 from private.convites where email = v_email and estado = 'pendente') then
    raise exception 'ja_autorizado' using errcode = 'P0001'; end if;
  if (select count(*) from public.perfis where empresa_id = v_emp)
     + (select count(*) from private.convites where empresa_id = v_emp and estado = 'pendente') >= 20 then
    raise exception 'limite_equipe' using errcode = 'P0001'; end if;
  insert into private.convites(empresa_id, email, permissoes) values (v_emp, v_email, private.permissoes_limpas(p_permissoes));
end $$;

create function public.equipe_permissoes(p_permissoes jsonb, p_usuario uuid default null, p_convite uuid default null) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); begin
  if v_emp is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if p_usuario is not null then
    update public.perfis set permissoes = private.permissoes_limpas(p_permissoes)
     where user_id = p_usuario and empresa_id = v_emp and papel <> 'dono';
  else
    update private.convites set permissoes = private.permissoes_limpas(p_permissoes)
     where id = p_convite and empresa_id = v_emp and estado = 'pendente';
  end if;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
end $$;

create function public.equipe_cancelar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if private.minha_empresa_ativa() is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update private.convites set estado = 'cancelado' where id = p_id and empresa_id = private.minha_empresa_ativa() and estado = 'pendente';
end $$;

-- tira a pessoa da equipe; os links que ela criou continuam na empresa
create function public.equipe_remover(p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if private.minha_empresa_ativa() is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  update public.perfis set empresa_id = null, papel = 'dono', permissoes = '{}'::jsonb
   where user_id = p_usuario and empresa_id = private.minha_empresa_ativa() and papel <> 'dono';
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.minhas_permissoes(), public.equipe_listar(), public.equipe_autorizar(text, jsonb),
  public.equipe_permissoes(jsonb, uuid, uuid), public.equipe_cancelar_convite(uuid), public.equipe_remover(uuid) from public, anon;
grant execute on function public.minhas_permissoes(), public.equipe_listar(), public.equipe_autorizar(text, jsonb),
  public.equipe_permissoes(jsonb, uuid, uuid), public.equipe_cancelar_convite(uuid), public.equipe_remover(uuid) to authenticated;

-- =====================================================================
-- Cadastro da empresa e permissões ver_painel / ver_empresa
-- =====================================================================
alter table public.empresas
  add column razao_social text not null default '' check (char_length(razao_social) <= 160),
  add column documento text not null default '' check (documento ~ '^(\d{11}|[A-Z0-9]{12}\d{2})?$'),
  add column segmento text not null default '' check (char_length(segmento) <= 80),
  add column telefone text not null default '' check (char_length(telefone) <= 30),
  add column email text not null default '' check (char_length(email) <= 120),
  add column site text not null default '' check (char_length(site) <= 200),
  add column instagram text not null default '' check (char_length(instagram) <= 80),
  add column cep text not null default '' check (cep ~ '^(\d{8})?$'),
  add column logradouro text not null default '' check (char_length(logradouro) <= 160),
  add column numero text not null default '' check (char_length(numero) <= 20),
  add column complemento text not null default '' check (char_length(complemento) <= 80),
  add column bairro text not null default '' check (char_length(bairro) <= 80),
  add column cidade text not null default '' check (char_length(cidade) <= 80),
  add column uf text not null default '' check (uf ~ '^([A-Z]{2})?$'),
  add column descricao text not null default '' check (char_length(descricao) <= 500),
  add column dados_em timestamptz;

-- ver_painel e ver_empresa: só escondem a aba
create or replace function private.permissoes_padrao() returns jsonb
language sql immutable set search_path = '' as
$$ select '{"ver_painel":true,"ver_todos":true,"ver_equipe":true,"ver_empresa":true,"criar":true,"editar":true,"excluir":false}'::jsonb $$;

create function public.empresa_salvar(p jsonb) returns void
language plpgsql security definer set search_path = '' as
$$ declare
  v_emp uuid := private.minha_empresa_ativa();
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_doc text := upper(regexp_replace(coalesce(p->>'documento', ''), '[^0-9A-Za-z]', '', 'g'));
  v_cep text := regexp_replace(coalesce(p->>'cep', ''), '\D', '', 'g');
  v_uf text := upper(btrim(coalesce(p->>'uf', '')));
  v_email text := lower(btrim(coalesce(p->>'email', '')));
begin
  if v_emp is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 120 then raise exception 'nome_invalido' using errcode = 'P0001'; end if;
  if v_doc <> '' and v_doc !~ '^(\d{11}|[A-Z0-9]{12}\d{2})$' then raise exception 'documento_invalido' using errcode = 'P0001'; end if;
  if v_cep <> '' and v_cep !~ '^\d{8}$' then raise exception 'cep_invalido' using errcode = 'P0001'; end if;
  if v_uf <> '' and v_uf !~ '^[A-Z]{2}$' then raise exception 'uf_invalida' using errcode = 'P0001'; end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120) then
    raise exception 'email_invalido' using errcode = 'P0001'; end if;
  update public.empresas set
    nome = v_nome,
    razao_social = left(btrim(coalesce(p->>'razao_social', '')), 160),
    documento = v_doc,
    segmento = left(btrim(coalesce(p->>'segmento', '')), 80),
    telefone = left(btrim(coalesce(p->>'telefone', '')), 30),
    email = v_email,
    site = left(btrim(coalesce(p->>'site', '')), 200),
    instagram = left(btrim(coalesce(p->>'instagram', '')), 80),
    cep = v_cep,
    logradouro = left(btrim(coalesce(p->>'logradouro', '')), 160),
    numero = left(btrim(coalesce(p->>'numero', '')), 20),
    complemento = left(btrim(coalesce(p->>'complemento', '')), 80),
    bairro = left(btrim(coalesce(p->>'bairro', '')), 80),
    cidade = left(btrim(coalesce(p->>'cidade', '')), 80),
    uf = v_uf,
    descricao = left(btrim(coalesce(p->>'descricao', '')), 500),
    dados_em = now()
  where id = v_emp;
end $$;
revoke execute on function public.empresa_salvar(jsonb) from public, anon;
grant execute on function public.empresa_salvar(jsonb) to authenticated;

-- =====================================================================
-- Nomes dos usuários e observação dos links (22/10/2026)
-- =====================================================================
alter table public.perfis add column nome text not null default '' check (char_length(nome) <= 120);
alter table private.convites add column nome text not null default '' check (char_length(nome) <= 120);
alter table public.links add column observacao text not null default '' check (char_length(observacao) <= 1000);

create or replace function private.novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as
$$ declare c private.convites; v_nome text := left(btrim(coalesce(new.raw_user_meta_data->>'nome', '')), 120); begin
  select * into c from private.convites where email = lower(new.email) and estado = 'pendente';
  if found then
    insert into public.perfis(user_id, email, nome, empresa_id, papel, permissoes)
    values (new.id, new.email, coalesce(nullif(v_nome, ''), c.nome), c.empresa_id, 'membro', private.permissoes_limpas(c.permissoes));
    update private.convites set estado = 'aceito' where id = c.id;
  else
    insert into public.perfis(user_id, email, nome, admin)
    values (new.id, new.email, v_nome, lower(new.email) = 'pedrodadila@gmail.com');
  end if;
  return new; end $$;

create function public.perfil_nome(p_nome text, p_usuario uuid default null) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_alvo uuid := coalesce(p_usuario, auth.uid()); v_nome text := left(btrim(coalesce(p_nome, '')), 120); begin
  if auth.uid() is null then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if char_length(v_nome) < 2 then raise exception 'nome_invalido' using errcode = 'P0001'; end if;
  if v_alvo <> auth.uid() and not (private.sou_dono() and exists (
      select 1 from public.perfis where user_id = v_alvo and empresa_id = private.minha_empresa_ativa())) then
    raise exception 'sem_permissao' using errcode = '42501'; end if;
  update public.perfis set nome = v_nome where user_id = v_alvo;
end $$;

create function public.equipe_nomes() returns jsonb
language sql stable security definer set search_path = '' as
$$ select coalesce(jsonb_object_agg(p.user_id, coalesce(nullif(p.nome, ''), p.email)), '{}'::jsonb)
   from public.perfis p where p.empresa_id = private.minha_empresa_ativa() $$;

create or replace function public.equipe_listar() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); v_dono boolean := private.sou_dono(); begin
  if v_emp is null then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return jsonb_build_object(
    'membros', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.user_id, 'nome', p.nome, 'email', p.email, 'papel', p.papel, 'ultimo_acesso', u.last_sign_in_at,
        'permissoes', case when v_dono and p.papel <> 'dono' then private.permissoes_limpas(p.permissoes) end)
        order by (p.papel = 'dono') desc, lower(coalesce(nullif(p.nome, ''), p.email))), '[]'::jsonb)
      from public.perfis p join auth.users u on u.id = p.user_id
      where p.empresa_id = v_emp and (private.pode('ver_equipe') or p.user_id = auth.uid())),
    'convites', case when v_dono then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'email', c.email, 'criado_em', c.criado_em, 'permissoes', private.permissoes_limpas(c.permissoes))
        order by c.criado_em), '[]'::jsonb) from private.convites c where c.empresa_id = v_emp and c.estado = 'pendente') else '[]'::jsonb end,
    'pode_gerenciar', v_dono,
    'padrao', private.permissoes_padrao());
end $$;

-- substitui a versão de 2 parâmetros (ao recriar do zero, pular a criação dela acima ou remover depois)
create or replace function public.equipe_autorizar(p_email text, p_permissoes jsonb, p_nome text default '') returns void
language plpgsql security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); v_email text := lower(btrim(p_email)); begin
  if v_emp is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalido' using errcode = 'P0001'; end if;
  if exists (select 1 from public.perfis where lower(email) = v_email and empresa_id = v_emp) then
    raise exception 'ja_membro' using errcode = 'P0001'; end if;
  if exists (select 1 from public.perfis where lower(email) = v_email) then
    raise exception 'ja_cadastrado' using errcode = 'P0001'; end if;
  if exists (select 1 from private.convites where email = v_email and estado = 'pendente') then
    raise exception 'ja_autorizado' using errcode = 'P0001'; end if;
  if (select count(*) from public.perfis where empresa_id = v_emp)
     + (select count(*) from private.convites where empresa_id = v_emp and estado = 'pendente') >= 20 then
    raise exception 'limite_equipe' using errcode = 'P0001'; end if;
  insert into private.convites(empresa_id, email, nome, permissoes)
  values (v_emp, v_email, left(btrim(coalesce(p_nome, '')), 120), private.permissoes_limpas(p_permissoes));
end $$;

revoke execute on function public.perfil_nome(text, uuid), public.equipe_nomes(), public.equipe_autorizar(text, jsonb, text) from public, anon;
grant execute on function public.perfil_nome(text, uuid), public.equipe_nomes(), public.equipe_autorizar(text, jsonb, text) to authenticated;
revoke execute on function public.equipe_autorizar(text, jsonb) from authenticated;

-- =====================================================================
-- Painel admin completo e modo simular (22/10/2026)
-- =====================================================================
alter table public.perfis add column simulando uuid references public.empresas(id) on delete set null;

create table private.auditoria (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  acao text not null,
  empresa_id uuid references public.empresas(id) on delete set null,
  detalhe text not null default '',
  criado_em timestamptz not null default now()
);

create or replace function private.minha_empresa_ativa() returns uuid
language sql stable security definer set search_path = '' as
$$ select case when p.admin and p.simulando is not null then p.simulando
     else (select e.id from public.empresas e where e.id = p.empresa_id and e.situacao = 'ativa') end
   from public.perfis p where p.user_id = auth.uid() $$;

create or replace function private.em_simulacao() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select admin and simulando is not null from public.perfis where user_id = auth.uid()), false) $$;
grant execute on function private.em_simulacao() to authenticated;

create or replace function private.sou_dono() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select papel = 'dono' or (admin and simulando is not null) from public.perfis where user_id = auth.uid()), false) $$;

create or replace function private.pode(p_chave text) returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select case when p.papel = 'dono' or (p.admin and p.simulando is not null) then true
     else (private.permissoes_limpas(p.permissoes) ->> p_chave)::boolean end
   from public.perfis p where p.user_id = auth.uid()), false) $$;

create or replace function public.minhas_permissoes() returns jsonb
language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('papel', case when p.admin and p.simulando is not null then 'dono' else p.papel end, 'permissoes',
     case when p.papel = 'dono' or (p.admin and p.simulando is not null)
       then (select jsonb_object_agg(k, true) from jsonb_object_keys(private.permissoes_padrao()) k)
       else private.permissoes_limpas(p.permissoes) end)
   from public.perfis p where p.user_id = auth.uid() $$;

create function public.minha_sessao() returns jsonb
language sql stable security definer set search_path = '' as
$$ select jsonb_build_object(
     'nome', p.nome, 'email', p.email, 'admin', p.admin,
     'simulando', p.admin and p.simulando is not null,
     'empresa_id', case when p.admin and p.simulando is not null then p.simulando else p.empresa_id end)
   from public.perfis p where p.user_id = auth.uid() $$;

-- a tela do sistema não mistura empresas para o admin
alter policy links_ler on public.links using (
  empresa_id = private.minha_empresa_ativa() and (private.pode('ver_todos') or criado_por = auth.uid()));
alter policy cliques_ler on public.cliques_dia using (exists (select 1 from public.links l where l.id = link_id
  and l.empresa_id = private.minha_empresa_ativa()));

create function private.empresa_gravar(v_emp uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as
$$ declare
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_doc text := upper(regexp_replace(coalesce(p->>'documento', ''), '[^0-9A-Za-z]', '', 'g'));
  v_cep text := regexp_replace(coalesce(p->>'cep', ''), '\D', '', 'g');
  v_uf text := upper(btrim(coalesce(p->>'uf', '')));
  v_email text := lower(btrim(coalesce(p->>'email', '')));
begin
  if char_length(v_nome) < 2 or char_length(v_nome) > 120 then raise exception 'nome_invalido' using errcode = 'P0001'; end if;
  if v_doc <> '' and v_doc !~ '^(\d{11}|[A-Z0-9]{12}\d{2})$' then raise exception 'documento_invalido' using errcode = 'P0001'; end if;
  if v_cep <> '' and v_cep !~ '^\d{8}$' then raise exception 'cep_invalido' using errcode = 'P0001'; end if;
  if v_uf <> '' and v_uf !~ '^[A-Z]{2}$' then raise exception 'uf_invalida' using errcode = 'P0001'; end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120) then
    raise exception 'email_invalido' using errcode = 'P0001'; end if;
  update public.empresas set
    nome = v_nome, razao_social = left(btrim(coalesce(p->>'razao_social', '')), 160), documento = v_doc,
    segmento = left(btrim(coalesce(p->>'segmento', '')), 80), telefone = left(btrim(coalesce(p->>'telefone', '')), 30),
    email = v_email, site = left(btrim(coalesce(p->>'site', '')), 200), instagram = left(btrim(coalesce(p->>'instagram', '')), 80),
    cep = v_cep, logradouro = left(btrim(coalesce(p->>'logradouro', '')), 160), numero = left(btrim(coalesce(p->>'numero', '')), 20),
    complemento = left(btrim(coalesce(p->>'complemento', '')), 80), bairro = left(btrim(coalesce(p->>'bairro', '')), 80),
    cidade = left(btrim(coalesce(p->>'cidade', '')), 80), uf = v_uf, descricao = left(btrim(coalesce(p->>'descricao', '')), 500),
    dados_em = now()
  where id = v_emp;
end $$;
revoke execute on function private.empresa_gravar(uuid, jsonb) from public, anon, authenticated;

create or replace function public.empresa_salvar(p jsonb) returns void
language plpgsql security definer set search_path = '' as
$$ declare v_emp uuid := private.minha_empresa_ativa(); begin
  if v_emp is null or not private.sou_dono() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  perform private.empresa_gravar(v_emp, p);
end $$;

create function public.admin_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$ declare v_minha uuid; begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  select empresa_id into v_minha from public.perfis where user_id = auth.uid();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'situacao', e.situacao, 'criado_em', e.criado_em, 'propria', e.id = v_minha,
      'completo', (e.documento <> '' and e.telefone <> '' and e.cidade <> '' and e.uf <> ''),
      'razao_social', e.razao_social, 'documento', e.documento, 'segmento', e.segmento, 'telefone', e.telefone,
      'email', e.email, 'site', e.site, 'instagram', e.instagram, 'descricao', e.descricao,
      'cep', e.cep, 'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento,
      'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf,
      'links', (select count(*) from public.links l where l.empresa_id = e.id),
      'cliques', (select coalesce(sum(l.cliques), 0) from public.links l where l.empresa_id = e.id),
      'convites', (select count(*) from private.convites c where c.empresa_id = e.id and c.estado = 'pendente'),
      'ultimo_acesso', (select max(u.last_sign_in_at) from public.perfis p join auth.users u on u.id = p.user_id where p.empresa_id = e.id),
      'membros', (select coalesce(jsonb_agg(jsonb_build_object('nome', p.nome, 'email', p.email, 'papel', p.papel,
          'email_confirmado', u.email_confirmed_at is not null) order by (p.papel = 'dono') desc, lower(p.nome)), '[]'::jsonb)
        from public.perfis p join auth.users u on u.id = p.user_id where p.empresa_id = e.id)
    ) order by e.criado_em desc), '[]'::jsonb) from public.empresas e);
end $$;

create function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$ begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return jsonb_build_object(
    'usuarios', (select count(*) from public.perfis where empresa_id is not null),
    'cliques_dias', (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia), '[]'::jsonb)
      from (select dia, sum(total) as n from public.cliques_dia where dia >= current_date - 29 group by dia) d),
    'por_empresa', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) order by x.n desc), '[]'::jsonb)
      from (select e.nome, sum(l.cliques) as n from public.links l join public.empresas e on e.id = l.empresa_id
            group by e.nome having sum(l.cliques) > 0) x));
end $$;

create function public.admin_empresa_status(alvo uuid, novo text) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if novo not in ('pendente','ativa','bloqueada') then raise exception 'situacao_invalida' using errcode = 'P0001'; end if;
  update public.empresas set situacao = novo where id = alvo;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  insert into private.auditoria(admin_id, acao, empresa_id, detalhe) values (auth.uid(), 'situacao', alvo, novo);
end $$;

create function public.admin_empresa_salvar(alvo uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if not exists (select 1 from public.empresas where id = alvo) then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  perform private.empresa_gravar(alvo, p);
  insert into private.auditoria(admin_id, acao, empresa_id) values (auth.uid(), 'editar_empresa', alvo);
end $$;

create function public.admin_simular(alvo uuid default null) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if alvo is not null and not exists (select 1 from public.empresas where id = alvo) then
    raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  update public.perfis set simulando = alvo where user_id = auth.uid();
  insert into private.auditoria(admin_id, acao, empresa_id) values (auth.uid(), case when alvo is null then 'sair_simulacao' else 'simular' end, alvo);
end $$;

create function public.admin_exportar() returns jsonb
language plpgsql security definer set search_path = '' as
$$ begin
  if not private.eu_admin() then raise exception 'sem_permissao' using errcode = '42501'; end if;
  insert into private.auditoria(admin_id, acao) values (auth.uid(), 'exportar');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'empresa', e.nome, 'documento', e.documento, 'nome', l.nome, 'slug', l.slug, 'destino', l.destino,
      'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
      'utm_term', l.utm_term, 'utm_content', l.utm_content, 'ativo', l.ativo, 'cliques', l.cliques,
      'observacao', l.observacao, 'criado_por', (select coalesce(nullif(p.nome, ''), p.email) from public.perfis p where p.user_id = l.criado_por),
      'criado_em', l.criado_em) order by lower(e.nome), l.criado_em), '[]'::jsonb)
    from public.links l join public.empresas e on e.id = l.empresa_id);
end $$;

revoke execute on function public.minha_sessao(), public.admin_empresas(), public.admin_painel(), public.admin_empresa_status(uuid, text),
  public.admin_empresa_salvar(uuid, jsonb), public.admin_simular(uuid), public.admin_exportar() from public, anon;
grant execute on function public.minha_sessao(), public.admin_empresas(), public.admin_painel(), public.admin_empresa_status(uuid, text),
  public.admin_empresa_salvar(uuid, jsonb), public.admin_simular(uuid), public.admin_exportar() to authenticated;
