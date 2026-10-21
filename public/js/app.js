(async () => {
  const { db, $, el, h, msg, toast, erroBR, dominio, sair } = PL;
  const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const CAMPOS = ['nome', 'slug', 'destino', ...UTMS];
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let links = [], editando = null, empresaId = null, perm = {}, papel = 'dono';
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
    const mp = await db.rpc('minhas_permissoes');
    if (mp.data) { perm = mp.data.permissoes || {}; papel = mp.data.papel; }
    $('#btn-novo').hidden = !perm.criar;
    $('#aba-equipe').hidden = !perm.ver_equipe && papel !== 'dono';
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
    opcoesUtm();
    desenhar();
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
  $('#btn-copiar-final').addEventListener('click', async () => {
    const l = lerForm();
    if (!l.destino) return toast('Preencha o destino primeiro.');
    try { await navigator.clipboard.writeText(urlFinal(l)); toast('URL com as UTMs copiada.'); }
    catch (e) { toast('Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  });

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

  $('#btn-excluir').addEventListener('click', async () => {
    if (!editando) return;
    if (!confirm(`Excluir o link "${editando.nome}"? Quem clicar em ${dominio}/${editando.slug} vai ver "link não encontrado". Para só pausar, desmarque "Link ativo".`)) return;
    const { error } = await db.from('links').delete().eq('id', editando.id);
    if (error) return msg($('#erro-link'), erroBR(error));
    fechar();
    toast('Link excluído.');
    carregar();
  });

  // ---------- abas ----------
  function visao(v) {
    ['links', 'equipe'].forEach(x => {
      $('#aba-' + x).setAttribute('aria-selected', String(x === v));
      $('#v-' + x).hidden = x !== v;
    });
    $('.stats').hidden = v !== 'links';
    $('#btn-novo').hidden = v !== 'links' || !perm.criar;
    if (v === 'equipe') carregarEquipe();
  }
  document.querySelectorAll('.aba-app').forEach(b => b.addEventListener('click', () => visao(b.dataset.visao)));

  // ---------- equipe (mesmo modelo do PHAR Prospector) ----------
  const PERMS = [
    { grupo: 'O que pode ver', itens: [
      ['ver_todos', 'Links de toda a equipe', 'Desmarcado: vê só os links que ela mesma criou.'],
      ['ver_equipe', 'Quem faz parte da equipe']] },
    { grupo: 'O que pode fazer', itens: [
      ['criar', 'Criar links'],
      ['editar', 'Editar links (destino, UTMs, pausar)'],
      ['excluir', 'Excluir links']] }
  ];
  const PERM_PADRAO = { ver_todos: true, ver_equipe: true, criar: true, editar: true, excluir: false };
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
    if (v.ver_equipe) ve.push('a equipe');
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
          h('div', { class: 'nome' }, m.email, eu ? ' (você)' : '', h('span', { class: 'tag tag-papel', text: m.papel === 'dono' ? 'Responsável' : 'Colaborador' })),
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
          h('div', null, h('div', { class: 'sub', text: c.email }), h('div', { class: 'sub', text: 'Autorizado em ' + dataBR(c.criado_em) }),
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
    const r = await db.rpc('equipe_autorizar', { p_email: email, p_permissoes: lerPerms($('#eq-perms-novo')) });
    btn.disabled = false;
    if (r.error) return msg(err, erroEquipe(r.error));
    $('#eq-email').value = ''; $('#eq-perms-novo').replaceChildren();
    toast('E-mail autorizado. Peça para a pessoa criar a conta.');
    carregarEquipe();
  });
  $('#eq-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin + '/entrar?modo=criar'); toast('Link de cadastro copiado.'); }
    catch (e) { toast('Não foi possível copiar.'); }
  });

  iniciar();
})();
