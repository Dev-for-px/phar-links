(async () => {
  const { db, $, el, msg, toast, erroBR, dominio, sair } = PL;
  const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const CAMPOS = ['nome', 'slug', 'destino', ...UTMS];
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let links = [], editando = null, empresaId = null;

  document.querySelectorAll('[data-sair]').forEach(b => b.addEventListener('click', sair));

  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('/entrar'); return; }

  function tela(id) {
    ['tela-carregando', 'tela-estado', 'tela-sem-empresa', 'tela-app'].forEach(t => { $('#' + t).hidden = t !== id; });
  }
  function estado(titulo, texto) {
    $('#estado-titulo').textContent = titulo;
    $('#estado-texto').textContent = texto;
    tela('tela-estado');
  }
  $('#estado-atualizar').addEventListener('click', () => location.reload());

  async function iniciar() {
    const { data: perfil, error } = await db.from('perfis').select('empresa_id, admin').eq('user_id', session.user.id).single();
    if (error) return estado('Não foi possível abrir o sistema', erroBR(error));
    $('#link-admin').hidden = !perfil.admin;
    $('#topo-email').textContent = session.user.email;
    if (!perfil.empresa_id) {
      try { $('#nova-empresa').value = localStorage.getItem('pl_empresa') || ''; } catch (e) {}
      // cadastro feito em /entrar: envia o nome da empresa sozinho
      if ($('#nova-empresa').value.trim().length >= 2) return criarEmpresa();
      return tela('tela-sem-empresa');
    }
    empresaId = perfil.empresa_id;
    const { data: emp } = await db.from('empresas').select('nome, situacao').eq('id', empresaId).single();
    if (emp.situacao === 'pendente') return estado('Cadastro em análise', `A empresa ${emp.nome} foi cadastrada e está aguardando liberação. Assim que for liberada, clique em "Verificar de novo".`);
    if (emp.situacao === 'bloqueada') return estado('Acesso suspenso', `O acesso de ${emp.nome} está suspenso e os links não redirecionam. Fale com o suporte da PHAR Consultoria.`);
    $('#topo-empresa').textContent = emp.nome;
    tela('tela-app');
    await carregar();
  }

  async function criarEmpresa() {
    msg($('#erro-empresa'));
    const { error } = await db.rpc('empresa_criar', { p_nome: $('#nova-empresa').value.trim() });
    if (error) { tela('tela-sem-empresa'); return msg($('#erro-empresa'), erroBR(error)); }
    try { localStorage.removeItem('pl_empresa'); } catch (e) {}
    iniciar();
  }
  $('#form-empresa').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if ($('#nova-empresa').value.trim().length < 2) return msg($('#erro-empresa'), 'Informe o nome da empresa.');
    criarEmpresa();
  });

  // ---------- lista ----------
  async function carregar() {
    msg($('#aviso-erro'));
    const [r, h] = await Promise.all([
      db.from('links').select('*').order('criado_em', { ascending: false }),
      db.from('cliques_dia').select('total').eq('dia', diaISO(new Date()))
    ]);
    if (r.error) return msg($('#aviso-erro'), erroBR(r.error));
    links = r.data;
    $('#n-ativos').textContent = num(links.filter(l => l.ativo).length);
    $('#n-pausados').textContent = num(links.filter(l => !l.ativo).length);
    $('#n-total').textContent = num(links.reduce((s, l) => s + Number(l.cliques), 0));
    $('#n-hoje').textContent = num((h.data || []).reduce((s, d) => s + d.total, 0));
    desenhar();
  }

  function urlFinal(l) {
    try {
      const u = new URL(l.destino);
      UTMS.forEach(k => { if (l[k]) u.searchParams.set(k, l[k]); });
      return u.toString();
    } catch (e) { return l.destino || ''; }
  }

  function desenhar() {
    const q = $('#busca').value.trim().toLowerCase(), f = $('#filtro').value;
    const lista = $('#lista');
    lista.replaceChildren();
    const vis = links.filter(l =>
      (!f || (f === 'ativos' ? l.ativo : !l.ativo)) &&
      (!q || [l.nome, l.slug, l.destino].some(v => v.toLowerCase().includes(q))));
    $('#resumo').textContent = links.length ? `${num(vis.length)} de ${num(links.length)} links` : '';
    $('.lista-head').hidden = !vis.length;

    if (!vis.length) {
      const v = el('div', 'vazio');
      if (links.length) {
        v.append(el('h2', '', 'Nenhum link encontrado'), el('p', '', 'Tente outra busca ou mude o filtro de situação.'));
      } else {
        const b = el('button', 'btn btn-primary', 'Criar o primeiro link');
        b.type = 'button'; b.addEventListener('click', () => abrir(null));
        v.append(el('h2', '', 'Crie seu primeiro link curto'), el('p', '', 'Escolha um endereço, cole o destino e coloque as UTMs da campanha. Você pode trocar o destino depois.'), b);
      }
      return lista.append(v);
    }

    for (const l of vis) {
      const linha = el('div', 'linha');
      const cNome = el('div', 'c-nome');
      const nome = el('button', 'nome', l.nome); nome.type = 'button';
      nome.addEventListener('click', () => abrir(l));
      cNome.append(nome, el('div', 'lk-curto', `${dominio}/${l.slug}`));
      const cDest = el('div', 'c-local');
      const d = el('div', 'lk-destino', urlFinal(l)); d.title = urlFinal(l);
      cDest.append(d);
      const cSit = el('div', 'c-status');
      cSit.append(el('span', 'tag ' + (l.ativo ? 'c-ativa' : 'c-pendente'), l.ativo ? 'Ativo' : 'Pausado'));
      const cNum = el('div', 'c-prox lk-num', num(l.cliques));
      cNum.append(el('small', '', 'cliques'));
      const cAcao = el('div', 'c-acao lk-acoes');
      const copiar = el('button', 'btn btn-sec btn-sm', 'Copiar'); copiar.type = 'button';
      copiar.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`https://${dominio}/${l.slug}`); toast('Link copiado.'); }
        catch (e) { toast('Não foi possível copiar. Selecione o link e copie manualmente.'); }
      });
      const editar = el('button', 'btn btn-primary btn-sm', 'Editar'); editar.type = 'button';
      editar.addEventListener('click', () => abrir(l));
      cAcao.append(copiar, editar);
      linha.append(cNome, cDest, cSit, cNum, cAcao);
      lista.append(linha);
    }
  }
  $('#busca').addEventListener('input', desenhar);
  $('#filtro').addEventListener('change', desenhar);

  // ---------- janela de criar/editar ----------
  $('#f-prefixo').textContent = dominio + '/';

  function lerForm() {
    const l = {};
    CAMPOS.forEach(c => { const v = $('#f-' + c).value.trim(); l[c] = v || null; });
    if (l.slug) l.slug = l.slug.toLowerCase();
    if (l.destino && !/^https?:\/\//i.test(l.destino)) l.destino = 'https://' + l.destino;
    l.ativo = $('#f-ativo').checked;
    return l;
  }
  function previa() { const l = lerForm(); $('#f-previa').textContent = l.destino ? urlFinal(l) : '—'; }
  $('#form-link').addEventListener('input', previa);

  const sugerido = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  $('#f-nome').addEventListener('input', () => {
    if (!editando && !$('#f-slug').dataset.mexido) $('#f-slug').value = sugerido($('#f-nome').value);
    previa();
  });
  $('#f-slug').addEventListener('input', () => { $('#f-slug').dataset.mexido = '1'; });

  async function abrir(l) {
    editando = l || null;
    $('#dlg-titulo').textContent = l ? l.nome : 'Novo link';
    CAMPOS.forEach(c => { $('#f-' + c).value = (l && l[c]) || ''; });
    $('#f-ativo').checked = l ? l.ativo : true;
    delete $('#f-slug').dataset.mexido;
    $('#btn-excluir').hidden = !l;
    $('#secao-cliques').hidden = !l;
    msg($('#erro-link'));
    previa();
    $('#dlg-link').showModal();
    if (l) await grafico(l.id);
  }
  const fechar = () => $('#dlg-link').close();
  $('#dlg-fechar').addEventListener('click', fechar);
  $('#btn-cancelar').addEventListener('click', fechar);
  $('#btn-novo').addEventListener('click', () => abrir(null));

  async function grafico(id) {
    const g = $('#barras');
    g.replaceChildren();
    const ini = new Date(); ini.setDate(ini.getDate() - 29);
    $('#eixo-ini').textContent = ini.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
    const { data } = await db.from('cliques_dia').select('dia,total').eq('link_id', id).gte('dia', diaISO(ini));
    const mapa = Object.fromEntries((data || []).map(d => [d.dia, d.total]));
    const dias = [];
    for (let i = 0; i < 30; i++) { const d = new Date(ini); d.setDate(ini.getDate() + i); dias.push(diaISO(d)); }
    const max = Math.max(1, ...dias.map(d => mapa[d] || 0));
    let total = 0;
    for (const d of dias) {
      const v = mapa[d] || 0; total += v;
      const b = el('i');
      b.style.height = Math.round((v / max) * 100) + '%';
      b.title = `${d.split('-').reverse().join('/')}: ${num(v)} clique(s)`;
      g.append(b);
    }
    $('#total-30').textContent = `${num(total)} no total`;
  }

  $('#form-link').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg($('#erro-link'));
    const l = lerForm();
    if (!l.nome) return msg($('#erro-link'), 'Dê um nome ao link.');
    if (!l.slug) return msg($('#erro-link'), 'Escolha o endereço curto.');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(l.slug)) return msg($('#erro-link'), 'Endereço curto: use só letras minúsculas, números e hífen, sem acento ou espaço.');
    if (!l.destino) return msg($('#erro-link'), 'Informe o destino.');
    try { new URL(l.destino); } catch (e) { return msg($('#erro-link'), 'O destino não parece um endereço válido.'); }
    $('#btn-salvar').disabled = true;
    const r = editando
      ? await db.from('links').update(l).eq('id', editando.id)
      : await db.from('links').insert({ ...l, empresa_id: empresaId });
    $('#btn-salvar').disabled = false;
    if (r.error) return msg($('#erro-link'), erroBR(r.error));
    fechar();
    toast(editando ? 'Link atualizado.' : 'Link criado.');
    carregar();
  });

  $('#btn-excluir').addEventListener('click', async () => {
    if (!editando) return;
    if (!confirm(`Excluir o link "${editando.nome}"? Quem clicar em ${dominio}/${editando.slug} vai ver "link não encontrado". Para só pausar, desmarque "Link ativo".`)) return;
    const { error } = await db.from('links').delete().eq('id', editando.id);
    if (error) return msg($('#erro-link'), erroBR(error));
    fechar();
    toast('Link excluído.');
    carregar();
  });

  iniciar();
})();
