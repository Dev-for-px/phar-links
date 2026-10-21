(async () => {
  const { db, $, msg, erroBR, dominio } = PL;
  const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  let links = [], editando = null;

  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = '/entrar'; return; }
  $('#email-usuario').textContent = session.user.email;
  $('#sair').addEventListener('click', async () => { await db.auth.signOut(); location.href = '/entrar'; });

  function mostrar(id) {
    ['carregando', 'sem-empresa', 'pendente', 'bloqueada', 'links'].forEach(t => $('#tela-' + t).classList.toggle('oculto', t !== id));
  }

  async function iniciar() {
    const { data: perfil, error } = await db.from('perfis').select('empresa_id, admin').eq('user_id', session.user.id).single();
    if (error) { $('#tela-carregando').textContent = erroBR(error); return; }
    $('#link-admin').classList.toggle('oculto', !perfil.admin);
    if (!perfil.empresa_id) {
      try { $('#nova-empresa').value = localStorage.getItem('pl_empresa') || ''; } catch (e) {}
      return mostrar('sem-empresa');
    }
    const { data: emp } = await db.from('empresas').select('nome, situacao').eq('id', perfil.empresa_id).single();
    $('#nome-empresa').textContent = emp.nome;
    $('#nome-empresa').classList.remove('oculto');
    if (emp.situacao === 'pendente') return mostrar('pendente');
    if (emp.situacao === 'bloqueada') return mostrar('bloqueada');
    mostrar('links');
    await carregar();
  }

  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await db.rpc('empresa_criar', { p_nome: $('#nova-empresa').value.trim() });
    if (error) return msg($('#msg-empresa'), erroBR(error), 'erro');
    try { localStorage.removeItem('pl_empresa'); } catch (e) {}
    iniciar();
  });

  async function carregar() {
    const { data, error } = await db.from('links').select('*').order('criado_em', { ascending: false });
    if (error) { $('#lista').textContent = erroBR(error); return; }
    links = data;
    desenhar();
  }

  function urlFinal(l) {
    try {
      const u = new URL(l.destino);
      UTMS.forEach(k => { if (l[k]) u.searchParams.set(k, l[k]); });
      return u.toString();
    } catch (e) { return l.destino || ''; }
  }

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function desenhar() {
    const q = $('#busca').value.trim().toLowerCase();
    const lista = $('#lista');
    lista.replaceChildren();
    const filtrados = links.filter(l => !q || [l.nome, l.slug, l.destino].some(v => v.toLowerCase().includes(q)));
    if (!filtrados.length) {
      lista.append(el('div', 'vazio', links.length ? 'Nenhum link encontrado.' : 'Você ainda não tem links. Clique em "+ Novo link" para criar o primeiro.'));
      return;
    }
    for (const l of filtrados) {
      const item = el('div', 'item');
      const info = el('div', 'info');
      const nome = el('div', 'nome', l.nome);
      if (!l.ativo) nome.append(el('span', 'selo', 'desativado'));
      info.append(nome, el('div', 'curto', `${dominio}/${l.slug}`), el('div', 'destino', urlFinal(l)));
      const num = el('div', 'num');
      num.append(el('b', '', l.cliques.toLocaleString('pt-BR')), el('span', '', 'cliques'));
      const acoes = el('div', 'acoes');
      const copiar = el('button', '', 'Copiar');
      copiar.type = 'button';
      copiar.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`https://${dominio}/${l.slug}`); copiar.textContent = 'Copiado!'; }
        catch (e) { copiar.textContent = 'Erro'; }
        setTimeout(() => (copiar.textContent = 'Copiar'), 1500);
      });
      const editar = el('button', '', 'Editar');
      editar.type = 'button';
      editar.addEventListener('click', () => abrir(l));
      acoes.append(copiar, editar);
      item.append(info, num, acoes);
      lista.append(item);
    }
  }
  $('#busca').addEventListener('input', desenhar);

  // ---------- janela de criar/editar ----------
  $('#f-prefixo').textContent = dominio + '/';
  const campos = ['nome', 'slug', 'destino', ...UTMS];

  function lerForm() {
    const l = {};
    campos.forEach(c => { const v = $('#f-' + c).value.trim(); l[c] = v || null; });
    if (l.slug) l.slug = l.slug.toLowerCase();
    l.ativo = $('#f-ativo').checked;
    return l;
  }
  function atualizarPrevia() { const l = lerForm(); $('#f-previa').textContent = l.destino ? urlFinal(l) : '—'; }
  $('#form-link').addEventListener('input', atualizarPrevia);

  function slugSugerido(texto) {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }
  $('#f-nome').addEventListener('input', () => {
    if (!editando && !$('#f-slug').dataset.mexido) $('#f-slug').value = slugSugerido($('#f-nome').value);
    atualizarPrevia();
  });
  $('#f-slug').addEventListener('input', () => { $('#f-slug').dataset.mexido = '1'; });

  async function abrir(l) {
    editando = l || null;
    $('#janela-titulo').textContent = l ? 'Editar link' : 'Novo link';
    campos.forEach(c => { $('#f-' + c).value = (l && l[c]) || ''; });
    $('#f-ativo').checked = l ? l.ativo : true;
    delete $('#f-slug').dataset.mexido;
    $('#excluir').classList.toggle('oculto', !l);
    $('#bloco-cliques').classList.toggle('oculto', !l);
    msg($('#msg-link'));
    atualizarPrevia();
    $('#janela').showModal();
    if (l) await grafico(l.id);
  }

  async function grafico(id) {
    const g = $('#grafico');
    g.replaceChildren();
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 29);
    const ini = inicio.toISOString().slice(0, 10);
    const { data } = await db.from('cliques_dia').select('dia,total').eq('link_id', id).gte('dia', ini);
    const mapa = Object.fromEntries((data || []).map(d => [d.dia, d.total]));
    const dias = [];
    for (let i = 0; i < 30; i++) { const d = new Date(inicio); d.setDate(inicio.getDate() + i); dias.push(d.toISOString().slice(0, 10)); }
    const max = Math.max(1, ...dias.map(d => mapa[d] || 0));
    let total = 0;
    for (const d of dias) {
      const v = mapa[d] || 0; total += v;
      const barra = el('i');
      barra.style.height = Math.round((v / max) * 100) + '%';
      barra.title = `${d.split('-').reverse().join('/')}: ${v} clique(s)`;
      g.append(barra);
    }
    $('#total-30').textContent = total.toLocaleString('pt-BR');
  }

  $('#novo').addEventListener('click', () => abrir(null));
  $('#cancelar').addEventListener('click', () => $('#janela').close());

  $('#form-link').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const l = lerForm();
    let r;
    if (editando) {
      r = await db.from('links').update(l).eq('id', editando.id);
    } else {
      const { data: perfil } = await db.from('perfis').select('empresa_id').eq('user_id', session.user.id).single();
      r = await db.from('links').insert({ ...l, empresa_id: perfil.empresa_id });
    }
    if (r.error) return msg($('#msg-link'), erroBR(r.error), 'erro');
    $('#janela').close();
    carregar();
  });

  $('#excluir').addEventListener('click', async () => {
    if (!editando) return;
    if (!confirm(`Excluir o link "${editando.nome}"? Quem clicar em ${dominio}/${editando.slug} vai ver "link não encontrado". Para só pausar, desmarque "Link ativo".`)) return;
    const { error } = await db.from('links').delete().eq('id', editando.id);
    if (error) return msg($('#msg-link'), erroBR(error), 'erro');
    $('#janela').close();
    carregar();
  });

  iniciar();
})();
