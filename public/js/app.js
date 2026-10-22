(async () => {
  const { db, $, el, h, msg, toast, erroBR, dominio, sair } = PL;
  const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const CAMPOS = ['nome', 'slug', 'destino', ...UTMS];
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let links = [], editando = null, empresaId = null, perm = {}, papel = 'dono', empresa = null, porDia = [], visaoAtual = 'painel', carregado = false, nomes = {}, meuNome = '';
  const eq = { dados: null, editando: '', removendo: '' };

  // opções prontas de UTM (a pessoa também pode digitar outra)
  const PRESETS = {
    utm_source: ['instagram', 'facebook', 'google', 'whatsapp', 'tiktok', 'youtube', 'linkedin', 'email', 'site', 'qrcode', 'panfleto', 'outdoor'],
    utm_medium: ['social', 'cpc', 'pago', 'organico', 'email', 'bio', 'stories', 'direct', 'referral', 'qrcode', 'impresso'],
    utm_campaign: ['black-friday', 'lancamento', 'promocao', 'institucional', 'remarketing', 'natal', 'dia-das-maes'],
    utm_content: ['bio', 'stories', 'feed', 'reels', 'banner', 'botao', 'video', 'imagem', 'texto'],
    utm_term: []
  };

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
    const { data: perfil, error } = await db.from('perfis').select('empresa_id, admin, nome').eq('user_id', session.user.id).single();
    if (error) return estado('Não foi possível abrir o sistema', erroBR(error));
    $('#link-admin').hidden = !perfil.admin;
    $('#topo-email').textContent = perfil.nome || session.user.email;
    if (!perfil.empresa_id) {
      try { $('#nova-empresa').value = localStorage.getItem('pl_empresa') || ''; } catch (e) {}
      // cadastro feito em /entrar: envia o nome da empresa sozinho
      if ($('#nova-empresa').value.trim().length >= 2) return criarEmpresa();
      return tela('tela-sem-empresa');
    }
    empresaId = perfil.empresa_id;
    meuNome = perfil.nome || '';
    const mp = await db.rpc('minhas_permissoes');
    if (mp.data) { perm = mp.data.permissoes || {}; papel = mp.data.papel; }
    $('#aba-painel').hidden = !perm.ver_painel;
    $('#aba-equipe').hidden = !perm.ver_equipe;
    $('#aba-empresa').hidden = !perm.ver_empresa;
    const { data: emp } = await db.from('empresas').select('*').eq('id', empresaId).single();
    empresa = emp;
    if (emp.situacao === 'pendente') return estado('Cadastro em análise', `A empresa ${emp.nome} foi cadastrada e está aguardando liberação. Assim que for liberada, clique em "Verificar de novo".`);
    if (emp.situacao === 'bloqueada') return estado('Acesso suspenso', `O acesso de ${emp.nome} está suspenso e os links não redirecionam. Fale com o suporte da PHAR Consultoria.`);
    $('#topo-empresa').textContent = emp.nome;
    tela('tela-app');
    $('#aviso-cadastro').hidden = !(papel === 'dono' && !cadastroCompleto(emp));
    $('#aviso-nome').hidden = !!meuNome;
    preencherEmpresa();
    visao(perm.ver_painel ? 'painel' : 'links');
    await carregar();
  }

  async function criarEmpresa() {
    msg($('#erro-empresa'));
    const { error } = await db.rpc('empresa_criar', { p_nome: $('#nova-empresa').value.trim() });
    if (error) { tela('tela-sem-empresa'); return msg($('#erro-empresa'), erroBR(error)); }
    try { localStorage.removeItem('pl_empresa'); } catch (e) {}
    iniciar();
  }
  $('#form-nova-empresa').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if ($('#nova-empresa').value.trim().length < 2) return msg($('#erro-empresa'), 'Informe o nome da empresa.');
    criarEmpresa();
  });

  // ---------- lista ----------
  async function carregar() {
    msg($('#aviso-erro'));
    const ini = new Date(); ini.setDate(ini.getDate() - 29);
    const [r, rd, rn] = await Promise.all([
      db.from('links').select('*').order('criado_em', { ascending: false }),
      db.from('cliques_dia').select('link_id, dia, total').gte('dia', diaISO(ini)),
      db.rpc('equipe_nomes')
    ]);
    nomes = rn.data || {};
    if (r.error) return msg($('#aviso-erro'), erroBR(r.error));
    links = r.data;
    $('#n-ativos').textContent = num(links.filter(l => l.ativo).length);
    $('#n-pausados').textContent = num(links.filter(l => !l.ativo).length);
    $('#n-total').textContent = num(links.reduce((s, l) => s + Number(l.cliques), 0));
    porDia = rd.data || [];
    carregado = true;
    const hoje = diaISO(new Date());
    $('#n-hoje').textContent = num(porDia.filter(d => d.dia === hoje).reduce((s, d) => s + d.total, 0));
    opcoesUtm();
    desenhar();
    desenharPainel();
  }

  // lista de cada UTM: valores já usados nos links da empresa primeiro, depois as opções prontas
  function opcoesUtm() {
    for (const k of UTMS) {
      const usados = links.map(l => l[k]).filter(Boolean);
      const valores = [...new Set([...usados, ...PRESETS[k]])];
      $('#op-' + k).replaceChildren(...valores.map(v => h('option', { value: v })));
    }
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
      (!q || [l.nome, l.slug, l.destino, l.observacao || '', autor(l)].some(v => v.toLowerCase().includes(q))));
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

    for (const l of vis) lista.append(linhaLink(l));
  }

  function linhaLink(l) {
    {
      const linha = el('div', 'linha');
      const cNome = el('div', 'c-nome');
      const nome = el('button', 'nome', l.nome); nome.type = 'button';
      nome.addEventListener('click', () => abrir(l));
      cNome.append(nome, el('div', 'lk-curto', `${dominio}/${l.slug}`), el('div', 'lk-autor', 'Criado por ' + autor(l)));
      const cDest = el('div', 'c-local');
      const d = el('div', 'lk-destino', urlFinal(l)); d.title = urlFinal(l);
      cDest.append(d);
      if (l.observacao) { const o = el('div', 'lk-obs', l.observacao); o.title = l.observacao; cDest.append(o); }
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
      const editar = el('button', 'btn btn-primary btn-sm', perm.editar ? 'Editar' : 'Ver'); editar.type = 'button';
      editar.addEventListener('click', () => abrir(l));
      cAcao.append(copiar, editar);
      if (perm.excluir) {
        const exc = el('button', 'btn btn-danger btn-sm', 'Excluir'); exc.type = 'button';
        exc.addEventListener('click', () => pedirExclusao(l));
        cAcao.append(exc);
      }
      linha.append(cNome, cDest, cSit, cNum, cAcao);
      return linha;
    }
  }
  function autor(l) {
    if (!l.criado_por) return '—';
    if (l.criado_por === session.user.id) return meuNome ? meuNome + ' (você)' : 'você';
    return nomes[l.criado_por] || 'alguém que saiu da equipe';
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
    l.observacao = $('#f-observacao').value.trim();
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
    $('#f-observacao').value = (l && l.observacao) || '';
    $('#f-autor').hidden = !l;
    if (l) $('#f-autor').textContent = 'Criado por ' + autor(l) + ' em ' + new Date(l.criado_em).toLocaleDateString('pt-BR') + '.';
    delete $('#f-slug').dataset.mexido;
    $('#btn-excluir').hidden = !l || !perm.excluir;
    $('#btn-salvar').hidden = !!l && !perm.editar;
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

  // ---------- excluir (com confirmação) ----------
  let excluindo = null;
  function pedirExclusao(l) {
    excluindo = l;
    $('#exc-texto').textContent = `Você vai excluir "${l.nome}" (${dominio}/${l.slug}), que já teve ${num(l.cliques)} clique(s).`;
    $('#exc-certeza').checked = false;
    $('#exc-confirmar').disabled = true;
    if ($('#dlg-link').open) fechar();
    $('#dlg-excluir').showModal();
  }
  $('#btn-excluir').addEventListener('click', () => { if (editando) pedirExclusao(editando); });
  $('#exc-certeza').addEventListener('change', () => { $('#exc-confirmar').disabled = !$('#exc-certeza').checked; });
  $('#exc-cancelar').addEventListener('click', () => $('#dlg-excluir').close());
  $('#exc-confirmar').addEventListener('click', async () => {
    if (!excluindo || !$('#exc-certeza').checked) return;
    $('#exc-confirmar').disabled = true;
    const { error } = await db.from('links').delete().eq('id', excluindo.id);
    if (error) { $('#exc-confirmar').disabled = false; return toast(erroBR(error)); }
    $('#dlg-excluir').close();
    toast('Link excluído.');
    excluindo = null;
    carregar();
  });

  // ---------- nome (próprio ou de alguém da equipe) ----------
  let nomeDe = null;
  function editarNome(id, atual) {
    nomeDe = id;
    $('#nome-titulo').textContent = id === session.user.id ? 'Seu nome' : 'Nome do colaborador';
    $('#nome-campo').value = atual || '';
    msg($('#nome-erro'));
    $('#dlg-nome').showModal();
    $('#nome-campo').focus();
  }
  $('#btn-meu-nome').addEventListener('click', () => editarNome(session.user.id, meuNome));
  $('#nome-cancelar').addEventListener('click', () => $('#dlg-nome').close());
  $('#form-nome').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = $('#nome-campo').value.trim();
    if (v.length < 2) return msg($('#nome-erro'), 'Informe o nome e sobrenome.');
    $('#nome-salvar').disabled = true;
    const r = await db.rpc('perfil_nome', { p_nome: v, p_usuario: nomeDe });
    $('#nome-salvar').disabled = false;
    if (r.error) return msg($('#nome-erro'), r.error.message === 'sem_permissao' ? 'Só o responsável pela conta pode mudar o nome de outra pessoa.' : erroBR(r.error));
    if (nomeDe === session.user.id) { meuNome = v; $('#topo-email').textContent = v; $('#aviso-nome').hidden = true; }
    $('#dlg-nome').close();
    toast('Nome salvo.');
    carregar();
    if (visaoAtual === 'equipe') carregarEquipe();
  });

  // ---------- abas ----------
  const VISOES = {
    painel: ['Painel', 'Como seus links estão performando.'],
    links: ['Links', 'Seus links curtos, as UTMs de cada um e para onde eles levam agora.'],
    equipe: ['Equipe', 'Quem usa esta conta e o que cada pessoa pode fazer.'],
    empresa: ['Empresa', 'Os dados da sua empresa no sistema.']
  };
  function visao(v) {
    visaoAtual = v;
    Object.keys(VISOES).forEach(x => {
      $('#aba-' + x).setAttribute('aria-selected', String(x === v));
      $('#v-' + x).hidden = x !== v;
    });
    $('#band-titulo').textContent = VISOES[v][0];
    $('#band-sub').textContent = VISOES[v][1];
    $('.stats').hidden = !(v === 'painel' || v === 'links');
    $('#btn-novo').hidden = !(v === 'painel' || v === 'links') || !perm.criar;
    if (v === 'equipe') carregarEquipe();
    if (v === 'painel') desenharPainel();
  }
  document.querySelectorAll('.aba-app').forEach(b => b.addEventListener('click', () => visao(b.dataset.visao)));
  $('#btn-ver-links').addEventListener('click', () => visao('links'));
  $('#btn-completar').addEventListener('click', () => visao('empresa'));

  // ---------- painel (gráficos do PHAR Prospector) ----------
  const G = window.PP.graficos;
  const CORES = ['proposta', 'andamento', 'novo', 'fechado', 'depois', 'perdido'];
  function desenharPainel() {
    if (visaoAtual !== 'painel' || !carregado) return;
    const vazio = $('#painel-vazio'), conteudo = $('#painel-conteudo');
    if (!links.length) {
      vazio.replaceChildren(h('div', { class: 'vazio' }, h('h2', { text: 'Seu painel aparece aqui' }),
        h('p', { text: 'Crie o primeiro link e, assim que ele receber cliques, os gráficos começam a se formar.' }),
        perm.criar ? h('button', { class: 'btn btn-primary', type: 'button', text: 'Criar o primeiro link', onclick: () => abrir(null) }) : null));
      vazio.hidden = false; conteudo.hidden = true; return;
    }
    vazio.hidden = true; conteudo.hidden = false;

    // cliques por dia, últimos 30 dias
    const soma = {};
    porDia.forEach(d => { soma[d.dia] = (soma[d.dia] || 0) + d.total; });
    const pontos = [], ini = new Date(); ini.setDate(ini.getDate() - 29);
    for (let i = 0; i < 30; i++) { const d = new Date(ini); d.setDate(ini.getDate() + i); const k = diaISO(d); pontos.push({ x: k, y: soma[k] || 0 }); }
    G.linha($('#graf-dias'), pontos, { titulo: 'Cliques por dia', unidade: 'cliques', coluna: 'Cliques', vazio: 'Nenhum clique nos últimos 30 dias.' });

    // cliques por origem (utm_source), 5 maiores + outras
    const porOrigem = {};
    links.forEach(l => { const k = l.utm_source || 'Sem origem'; porOrigem[k] = (porOrigem[k] || 0) + Number(l.cliques); });
    const ordem = Object.entries(porOrigem).sort((a, b) => b[1] - a[1]);
    const fatias = ordem.slice(0, 5).map(([rotulo, valor], i) => ({ chave: CORES[i], rotulo, valor }));
    const resto = ordem.slice(5).reduce((s, x) => s + x[1], 0);
    if (resto) fatias.push({ chave: CORES[5], rotulo: 'Outras', valor: resto });
    G.rosca($('#graf-origem'), fatias, { titulo: 'Cliques por origem', unidade: 'cliques', vazio: 'Ainda não há cliques.' });

    // 5 links mais clicados
    const top = links.slice().sort((a, b) => b.cliques - a.cliques).slice(0, 5);
    $('#lista-top').replaceChildren(...top.map(linhaLink));
  }

  // ---------- empresa (mesmo cadastro do PHAR Prospector) ----------
  const CAMPOS_EMP = ['nome', 'razao_social', 'documento', 'segmento', 'telefone', 'email', 'site', 'instagram', 'descricao', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  const ERROS_EMP = {
    nome_invalido: 'Informe o nome da empresa.',
    documento_invalido: 'Confira o CNPJ ou CPF: o número não é válido.',
    cep_invalido: 'O CEP precisa ter 8 números.',
    uf_invalida: 'Escolha o estado na lista.',
    email_invalido: 'Confira o e-mail comercial.',
    sem_permissao: 'Só o responsável pela conta pode alterar os dados da empresa.'
  };
  const cadastroCompleto = (c) => !!(c && c.nome && c.documento && c.telefone && c.cidade && c.uf);
  const limpo = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  function docFormatado(v) {
    const d = limpo(v);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    return String(v || '');
  }
  function cepFormatado(v) { const d = String(v || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || ''); }
  function digito(v, pesos) { const s = v.reduce((a, x, i) => a + x * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; }
  function docValido(v) {
    const d = limpo(v);
    if (d.length === 11) {
      if (/^(\d)\1{10}$/.test(d)) return false;
      const n = d.split('').map(Number);
      const d1 = (n.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0) * 10) % 11 % 10;
      const d2 = (n.slice(0, 10).reduce((a, x, i) => a + x * (11 - i), 0) * 10) % 11 % 10;
      return d1 === n[9] && d2 === n[10];
    }
    if (d.length === 14 && /^[A-Z0-9]{12}\d{2}$/.test(d) && !/^(.)\1{13}$/.test(d)) {
      const v2 = d.split('').map(c => c.charCodeAt(0) - 48), p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      return digito(v2.slice(0, 12), p1) === v2[12] && digito(v2.slice(0, 13), [6, ...p1]) === v2[13];
    }
    return false;
  }

  function preencherEmpresa() {
    const c = empresa || {}, pode = papel === 'dono';
    CAMPOS_EMP.forEach(k => {
      const campo = $('#emp-' + k); if (!campo) return;
      let v = c[k] || '';
      if (k === 'documento') v = docFormatado(v);
      if (k === 'cep') v = cepFormatado(v);
      campo.value = v; campo.disabled = !pode;
    });
    $('#emp-acoes').hidden = !pode;
    $('#emp-dica').textContent = pode
      ? 'Preencha os dados completos da empresa. Toda a equipe pode ver; só o responsável pela conta altera.'
      : 'Estes são os dados da sua empresa no sistema. Só o responsável pela conta altera.';
    $('#emp-atualizado').textContent = c.dados_em ? 'Atualizado em ' + new Date(c.dados_em).toLocaleDateString('pt-BR') : '';
  }

  $('#emp-documento').addEventListener('blur', () => { const v = $('#emp-documento').value; if (docValido(v)) $('#emp-documento').value = docFormatado(v); });
  $('#emp-cep').addEventListener('blur', () => { $('#emp-cep').value = cepFormatado($('#emp-cep').value); });

  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#emp-erro'), dados = {};
    CAMPOS_EMP.forEach(k => { dados[k] = $('#emp-' + k).value.trim(); });
    $('#emp-documento').removeAttribute('aria-invalid');
    if (dados.nome.length < 2) return msg(err, ERROS_EMP.nome_invalido);
    if (dados.documento && !docValido(dados.documento)) { $('#emp-documento').setAttribute('aria-invalid', 'true'); return msg(err, ERROS_EMP.documento_invalido); }
    msg(err); $('#emp-salvar').disabled = true;
    const r = await db.rpc('empresa_salvar', { p: dados });
    $('#emp-salvar').disabled = false;
    if (r.error) return msg(err, ERROS_EMP[r.error.message] || erroBR(r.error));
    const nova = await db.from('empresas').select('*').eq('id', empresaId).single();
    if (nova.data) empresa = nova.data;
    $('#topo-empresa').textContent = empresa.nome;
    $('#aviso-cadastro').hidden = cadastroCompleto(empresa);
    preencherEmpresa();
    toast('Dados da empresa salvos.');
  });

  // ---------- equipe (mesmo modelo do PHAR Prospector) ----------
  const PERMS = [
    { grupo: 'O que pode ver', itens: [
      ['ver_painel', 'Painel com os gráficos'],
      ['ver_todos', 'Links de toda a equipe', 'Desmarcado: vê só os links que ela mesma criou.'],
      ['ver_equipe', 'Quem faz parte da equipe'],
      ['ver_empresa', 'Dados da empresa (CNPJ, endereço)']] },
    { grupo: 'O que pode fazer', itens: [
      ['criar', 'Criar links'],
      ['editar', 'Editar links (destino, UTMs, pausar)'],
      ['excluir', 'Excluir links']] }
  ];
  const PERM_PADRAO = { ver_painel: true, ver_todos: true, ver_equipe: true, ver_empresa: true, criar: true, editar: true, excluir: false };
  const ERROS_EQUIPE = {
    email_invalido: 'Confira o e-mail digitado.',
    ja_membro: 'Esta pessoa já faz parte da equipe.',
    ja_autorizado: 'Este e-mail já está na lista de quem falta se cadastrar.',
    ja_cadastrado: 'Este e-mail já usa o sistema em outra empresa. Fale com a PHAR para mover a conta.',
    limite_equipe: 'A equipe chegou ao limite de 20 pessoas.',
    sem_permissao: 'Só o responsável pela conta pode alterar a equipe.',
    nao_encontrado: 'Não deu para concluir. Recarregue a página.'
  };
  const erroEquipe = (e) => ERROS_EQUIPE[(e && e.message) || ''] || 'Não deu para concluir agora. Tente de novo.';
  const dataBR = (s) => new Date(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

  async function carregarEquipe() {
    const r = await db.rpc('equipe_listar');
    eq.dados = r.error ? { erro: true, membros: [], convites: [] } : r.data;
    desenharEquipe();
  }

  function caixas(prefixo, valores) {
    const v = valores || PERM_PADRAO;
    return h('div', { class: 'perms' }, PERMS.map(g => h('fieldset', null, h('legend', { text: g.grupo }),
      g.itens.map(([chave, rotulo, dica]) => {
        const c = h('input', { type: 'checkbox', id: prefixo + '-' + chave, 'data-perm': chave });
        c.checked = v[chave] === undefined ? PERM_PADRAO[chave] : !!v[chave];
        return h('label', { class: 'caixa', for: prefixo + '-' + chave }, c, h('span', null, rotulo, dica ? h('small', { text: dica }) : null));
      }))));
  }
  function lerPerms(bloco) {
    const p = {};
    bloco.querySelectorAll('input[data-perm]').forEach(c => { p[c.dataset.perm] = c.checked; });
    return p;
  }
  function resumo(v) {
    if (!v) return '';
    const lista = (a) => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : a[0];
    const ve = [v.ver_todos ? 'os links de toda a equipe' : 'só os links que criou'];
    if (v.ver_painel) ve.push('o painel');
    if (v.ver_equipe) ve.push('a equipe');
    if (v.ver_empresa) ve.push('os dados da empresa');
    const faz = [];
    if (v.criar) faz.push('criar'); if (v.editar) faz.push('editar'); if (v.excluir) faz.push('excluir');
    return 'Vê ' + lista(ve) + '. ' + (faz.length ? 'Pode ' + lista(faz) + '.' : 'Não altera nada.');
  }
  function editor(chave, valores, salvar) {
    const bloco = caixas('perm-' + chave, valores);
    const btn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Salvar permissões', onclick: async () => {
      btn.disabled = true;
      const r = await salvar(lerPerms(bloco));
      if (r.error) { btn.disabled = false; return toast(erroEquipe(r.error)); }
      eq.editando = ''; toast('Permissões atualizadas.'); carregarEquipe();
    } });
    return h('div', { class: 'eq-editor' }, bloco, h('div', { class: 'acoes' }, btn,
      h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Cancelar', onclick: () => { eq.editando = ''; desenharEquipe(); } })));
  }

  function desenharEquipe() {
    const membros = $('#eq-membros'), convites = $('#eq-convites'), d = eq.dados;
    membros.replaceChildren(); convites.replaceChildren();
    if (!d) return membros.append(h('p', { class: 'dica', text: 'Carregando a equipe…' }));
    if (d.erro) return membros.append(h('p', { class: 'erro', text: 'Não deu para carregar a equipe. Recarregue a página.' }));

    for (const m of d.membros) {
      const eu = m.id === session.user.id, editando = eq.editando === 'm' + m.id;
      const gerenciavel = d.pode_gerenciar && !eu && m.papel !== 'dono';
      let acoes = null;
      if (gerenciavel) {
        acoes = eq.removendo === m.id
          ? h('div', { class: 'eq-acoes' }, h('span', { text: 'Tirar o acesso?' }),
              h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Sim, remover', onclick: () => remover(m) }),
              h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Manter', onclick: () => { eq.removendo = ''; desenharEquipe(); } }))
          : h('div', { class: 'eq-acoes' },
              h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Permissões', 'aria-expanded': String(editando), onclick: () => { eq.editando = editando ? '' : 'm' + m.id; desenharEquipe(); } }),
              h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Remover', onclick: () => { eq.removendo = m.id; desenharEquipe(); } }));
      }
      membros.append(h('div', { class: 'eq-linha' },
        h('div', null,
          h('div', { class: 'nome' }, m.nome || m.email, eu ? ' (você)' : '', h('span', { class: 'tag tag-papel', text: m.papel === 'dono' ? 'Responsável' : 'Colaborador' })),
          m.nome ? h('div', { class: 'sub', text: m.email }) : null,
          (eu || (d.pode_gerenciar && m.papel !== 'dono')) ? h('button', { class: 'linkbtn', type: 'button', text: m.nome ? 'Mudar nome' : 'Colocar nome', onclick: () => editarNome(m.id, m.nome) }) : null,
          h('div', { class: 'sub', text: m.ultimo_acesso ? 'Último acesso em ' + dataBR(m.ultimo_acesso) : 'Ainda não entrou' }),
          m.papel === 'dono' ? (d.pode_gerenciar ? h('div', { class: 'eq-perm-resumo', text: 'Vê e pode tudo.' }) : null)
            : m.permissoes ? h('div', { class: 'eq-perm-resumo', text: resumo(m.permissoes) }) : null),
        acoes,
        gerenciavel && editando ? editor('m' + m.id, m.permissoes, (p) => db.rpc('equipe_permissoes', { p_permissoes: p, p_usuario: m.id })) : null));
    }

    $('#eq-gerenciar').hidden = !d.pode_gerenciar;
    $('#eq-dica').textContent = d.pode_gerenciar
      ? 'Você define o que cada pessoa pode ver e fazer. Clique em Permissões para mudar.'
      : 'O responsável pela conta define o que cada pessoa pode ver e fazer.';
    if (d.pode_gerenciar && !$('#eq-perms-novo').childNodes.length) $('#eq-perms-novo').append(caixas('novo', d.padrao));

    if (d.convites.length) {
      convites.append(h('p', { class: 'dica', text: 'Autorizados, aguardando o cadastro:' }));
      for (const c of d.convites) {
        const editando = eq.editando === 'c' + c.id;
        convites.append(h('div', { class: 'eq-linha' },
          h('div', null, h('div', { class: 'nome', text: c.nome || c.email }), c.nome ? h('div', { class: 'sub', text: c.email }) : null, h('div', { class: 'sub', text: 'Autorizado em ' + dataBR(c.criado_em) }),
            h('div', { class: 'eq-perm-resumo', text: resumo(c.permissoes) })),
          h('div', { class: 'eq-acoes' },
            h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Permissões', 'aria-expanded': String(editando), onclick: () => { eq.editando = editando ? '' : 'c' + c.id; desenharEquipe(); } }),
            h('button', { class: 'btn btn-sec btn-sm', type: 'button', text: 'Cancelar autorização', onclick: () => cancelarConvite(c) })),
          editando ? editor('c' + c.id, c.permissoes, (p) => db.rpc('equipe_permissoes', { p_permissoes: p, p_convite: c.id })) : null));
      }
    }
  }

  async function remover(m) {
    eq.removendo = '';
    const r = await db.rpc('equipe_remover', { p_usuario: m.id });
    if (r.error) { toast(erroEquipe(r.error)); return desenharEquipe(); }
    toast('Acesso removido.'); carregarEquipe();
  }
  async function cancelarConvite(c) {
    const r = await db.rpc('equipe_cancelar_convite', { p_id: c.id });
    if (r.error) return toast(erroEquipe(r.error));
    toast('Autorização cancelada.'); carregarEquipe();
  }
  $('#form-convite').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#eq-email').value.trim().toLowerCase(), err = $('#eq-erro'), btn = $('#eq-convidar');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg(err, ERROS_EQUIPE.email_invalido);
    msg(err); btn.disabled = true;
    const r = await db.rpc('equipe_autorizar', { p_email: email, p_permissoes: lerPerms($('#eq-perms-novo')), p_nome: $('#eq-nome').value.trim() });
    btn.disabled = false;
    if (r.error) return msg(err, erroEquipe(r.error));
    $('#eq-email').value = ''; $('#eq-nome').value = ''; $('#eq-perms-novo').replaceChildren();
    toast('E-mail autorizado. Peça para a pessoa criar a conta.');
    carregarEquipe();
  });
  $('#eq-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin + '/entrar?modo=criar'); toast('Link de cadastro copiado.'); }
    catch (e) { toast('Não foi possível copiar.'); }
  });

  iniciar();
})();
