-- PHAR Links — banco completo (rodar no SQL Editor de um projeto Supabase novo para recriar tudo).
-- Atualizado em 21/10/2026.

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
