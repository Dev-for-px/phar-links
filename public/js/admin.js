// Painel administrativo (mesmo modelo do PHAR Prospector): todas as empresas, liberar, recusar, bloquear,
// reativar, editar o cadastro, simular acesso, gráficos gerais e backup em CSV.
// A checagem de verdade acontece no banco (funções admin_*).
(async () => {
  const { db, $, h, msg, toast, erroBR, sair, docLimpo, docFormatado, docValido, cepFormatado } = PL;
  const G = window.PP.graficos;
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const dataBR = (s) => s ? new Date(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' ') : '';
  const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ROTULO = { pendente: 'Aguardando', ativa: 'Ativa', bloqueada: 'Bloqueada' };
  const CORES = ['proposta', 'andamento', 'novo', 'fechado', 'depois', 'perdido'];
  const st = { empresas: [], painel: null, modo: 'carregando', filtro: '', q: '', confirmando: '', editando: null };

  function tela(qual) {
    $('#tela-carregando').hidden = qual !== 'carregando';
    $('#tela-estado').hidden = qual !== 'estado';
    $('#tela-admin').hidden = qual !== 'admin';
  }
  function estado(titulo, texto) { $('#estado-titulo').textContent = titulo; $('#estado-texto').textContent = texto; tela('estado'); }

  async function carregar() {
    const [e, p] = await Promise.all([db.rpc('admin_empresas'), db.rpc('admin_painel')]);
    if (e.error || p.error) {
      msg($('#aviso-erro'), 'Não deu para carregar o painel. Clique em Atualizar.');
      if (st.modo === 'carregando') { st.modo = 'erro'; render(); }
      return false;
    }
    st.empresas = e.data || []; st.painel = p.data; st.modo = 'ok';
    msg($('#aviso-erro'));
    render();
    return true;
  }

  async function mudar(emp, novo, feito) {
    st.confirmando = '';
    const r = await db.rpc('admin_empresa_status', { alvo: emp.id, novo });
    if (r.error) { toast('Não deu para alterar esta empresa agora.'); return render(); }
    toast(feito);
    carregar();
  }
  async function simular(emp) {
    const r = await db.rpc('admin_simular', { alvo: emp.id });
    if (r.error) return toast('Não deu para abrir a simulação agora.');
    location.href = '/app';
  }
  async function pararSimulacao() {
    const r = await db.rpc('admin_simular', { alvo: null });
    if (r.error) return toast('Não deu para sair da simulação. Tente de novo.');
    $('#faixa-simulando').hidden = true;
    toast('Simulação encerrada.');
  }

  const botao = (texto, classe, fn) => h('button', { class: 'btn btn-sm ' + classe, type: 'button', text: texto, onclick: fn });

  function acoes(e) {
    if (st.confirmando === e.id) return [
      h('span', { class: 'dica', text: e.situacao === 'pendente' ? 'Recusar o cadastro?' : 'Bloquear o acesso?' }),
      botao(e.situacao === 'pendente' ? 'Sim, recusar' : 'Sim, bloquear', 'btn-danger', () => mudar(e, 'bloqueada', e.situacao === 'pendente' ? 'Cadastro recusado.' : 'Empresa bloqueada.')),
      botao('Manter', 'btn-sec', () => { st.confirmando = ''; render(); })
    ];
    const b = [];
    if (!e.propria) {
      if (e.situacao === 'pendente') b.push(botao('Liberar', 'btn-primary', () => mudar(e, 'ativa', 'Empresa liberada.')), botao('Recusar', 'btn-sec', () => { st.confirmando = e.id; render(); }));
      else if (e.situacao === 'ativa') b.push(botao('Bloquear', 'btn-sec', () => { st.confirmando = e.id; render(); }));
      else b.push(botao('Reativar', 'btn-primary', () => mudar(e, 'ativa', 'Empresa reativada.')));
    }
    b.push(botao('Editar', 'btn-sec', () => abrirEditar(e)));
    if (!e.propria) b.push(botao('Simular', 'btn-sec', () => simular(e)));
    else b.push(h('span', { class: 'dica', text: 'Sua empresa' }));
    return b;
  }

  function linha(e) {
    const membros = e.membros || [], dono = membros.find(m => m.papel === 'dono') || membros[0];
    const semConfirmar = membros.filter(m => !m.email_confirmado).length;
    const doc = docLimpo(e.documento), local = [e.cidade, e.uf].filter(Boolean).join('/');
    const cadastro = [doc ? (doc.length === 11 ? 'CPF ' : 'CNPJ ') + docFormatado(doc) : '', local, e.telefone].filter(Boolean).join(' · ');
    const nomes = membros.map(m => (m.nome || m.email) + (m.papel === 'dono' ? ' (responsável)' : '')).join(', ');
    return h('div', { class: 'adm-linha', role: 'listitem' },
      h('div', { class: 'a-nome' },
        h('div', { class: 'nome', text: e.nome }),
        dono ? h('div', { class: 'sub', text: dono.email }) : h('div', { class: 'sub', text: 'Sem usuários' }),
        cadastro ? h('div', { class: 'sub', text: cadastro }) : null,
        e.completo ? null : h('div', { class: 'sub adm-falta', text: 'Cadastro incompleto' })),
      h('div', { class: 'a-email' },
        h('div', { class: 'adm-membros', text: membros.length ? (membros.length === 1 ? '1 usuário: ' : membros.length + ' usuários: ') + nomes : 'Nenhum usuário' }),
        e.convites ? h('div', { class: 'sub', text: e.convites + (e.convites === 1 ? ' e-mail autorizado sem cadastro' : ' e-mails autorizados sem cadastro') }) : null,
        semConfirmar ? h('div', { class: 'sub', text: semConfirmar === 1 ? '1 e-mail ainda não confirmado' : semConfirmar + ' e-mails ainda não confirmados' }) : null),
      h('div', { class: 'sub num-col' }, dataBR(e.criado_em), h('div', { text: e.ultimo_acesso ? 'Último acesso: ' + dataBR(e.ultimo_acesso) : 'Ninguém entrou ainda' })),
      h('div', { class: 'num-col rot', 'data-rot': 'Links' }, num(e.links), h('div', { class: 'sub', text: num(e.cliques) + ' cliques' })),
      h('div', null, h('span', { class: 'tag c-' + e.situacao, text: ROTULO[e.situacao] || e.situacao })),
      h('div', { class: 'adm-acoes' }, acoes(e)));
  }

  function graficos() {
    const p = st.painel;
    if (!p) return;
    const soma = {};
    (p.cliques_dias || []).forEach(d => { soma[d.dia] = Number(d.n) || 0; });
    const pontos = [], ini = new Date(); ini.setDate(ini.getDate() - 29);
    for (let i = 0; i < 30; i++) { const d = new Date(ini); d.setDate(ini.getDate() + i); const k = diaISO(d); pontos.push({ x: k, y: soma[k] || 0 }); }
    G.linha($('#graf-dias'), pontos, { titulo: 'Cliques por dia, todas as empresas', unidade: 'cliques', coluna: 'Cliques', vazio: 'Nenhum clique nos últimos 30 dias.' });
    const lista = p.por_empresa || [];
    const fatias = lista.slice(0, 5).map((x, i) => ({ chave: CORES[i], rotulo: x.nome, valor: Number(x.n) }));
    const resto = lista.slice(5).reduce((s, x) => s + Number(x.n), 0);
    if (resto) fatias.push({ chave: CORES[5], rotulo: 'Outras empresas', valor: resto });
    G.rosca($('#graf-empresas'), fatias, { titulo: 'Cliques por empresa', unidade: 'cliques', vazio: 'Nenhuma empresa recebeu cliques ainda.' });
  }

  function render() {
    const n = { pendente: 0, ativa: 0, bloqueada: 0 }, lista = $('#lista'), pronto = st.modo === 'ok';
    let links = 0;
    st.empresas.forEach(e => { if (n[e.situacao] != null) n[e.situacao]++; links += Number(e.links) || 0; });
    $('#n-pendente').textContent = pronto ? num(n.pendente) : '–';
    $('#n-ativa').textContent = pronto ? num(n.ativa) : '–';
    $('#n-usuarios').textContent = pronto && st.painel ? num(st.painel.usuarios) : '–';
    $('#n-links').textContent = pronto ? num(links) : '–';
    document.querySelectorAll('button.stat').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtro === st.filtro)));
    lista.replaceChildren(); lista.removeAttribute('role');
    $('#btn-limpar').hidden = true;
    if (st.modo === 'carregando') { $('#contagem').textContent = 'Carregando empresas…'; return; }
    if (st.modo === 'erro') { $('#contagem').textContent = ''; return; }
    graficos();
    const q = semAcento(st.q.trim());
    const vis = st.empresas.filter(e => {
      if (st.filtro && e.situacao !== st.filtro) return false;
      if (!q) return true;
      const alvo = [e.nome, e.razao_social, e.documento, docFormatado(e.documento), e.cidade, e.uf, e.segmento, e.telefone]
        .concat((e.membros || []).map(m => m.nome + ' ' + m.email)).join(' ');
      return semAcento(alvo).includes(q);
    });
    const filtrando = !!(st.filtro || q), todas = st.empresas.length;
    $('#contagem').textContent = (filtrando ? 'Mostrando ' + vis.length + ' de ' + todas : String(todas)) + (todas === 1 ? ' empresa' : ' empresas')
      + (n.bloqueada ? ' · ' + n.bloqueada + (n.bloqueada === 1 ? ' bloqueada' : ' bloqueadas') : '');
    $('#btn-limpar').hidden = !filtrando;
    $('.adm-head').hidden = !vis.length;
    if (!vis.length) {
      lista.append(h('div', { class: 'vazio' }, h('h2', { text: 'Nenhuma empresa neste filtro' }),
        h('p', { text: 'Quando alguém criar conta na página de entrada, a empresa aparece aqui para você liberar.' })));
      return;
    }
    lista.setAttribute('role', 'list');
    vis.forEach(e => lista.append(linha(e)));
  }

  // ---------- editar empresa ----------
  const CAMPOS = ['nome', 'razao_social', 'documento', 'segmento', 'telefone', 'email', 'site', 'instagram', 'descricao', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  const ERROS = {
    nome_invalido: 'Informe o nome da empresa.',
    documento_invalido: 'Confira o CNPJ ou CPF: o número não é válido.',
    cep_invalido: 'O CEP precisa ter 8 números.',
    uf_invalida: 'Escolha o estado na lista.',
    email_invalido: 'Confira o e-mail comercial.',
    sem_permissao: 'Sua conta não tem acesso de administrador.'
  };
  function abrirEditar(e) {
    st.editando = e;
    $('#emp-titulo').textContent = 'Editar ' + e.nome;
    CAMPOS.forEach(k => {
      let v = e[k] || '';
      if (k === 'documento') v = docFormatado(v);
      if (k === 'cep') v = cepFormatado(v);
      $('#emp-' + k).value = v;
    });
    $('#emp-situacao').value = e.situacao;
    $('#emp-situacao').disabled = !!e.propria;
    $('#emp-documento').removeAttribute('aria-invalid');
    msg($('#emp-erro'));
    $('#dlg-empresa').showModal();
  }
  const fecharEditar = () => { $('#dlg-empresa').close(); st.editando = null; };
  $('#emp-fechar').addEventListener('click', fecharEditar);
  $('#emp-cancelar').addEventListener('click', fecharEditar);
  $('#emp-documento').addEventListener('blur', () => { const v = $('#emp-documento').value; if (docValido(v)) $('#emp-documento').value = docFormatado(v); });
  $('#emp-cep').addEventListener('blur', () => { $('#emp-cep').value = cepFormatado($('#emp-cep').value); });
  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = st.editando; if (!e) return;
    const dados = {}, err = $('#emp-erro');
    CAMPOS.forEach(k => { dados[k] = $('#emp-' + k).value.trim(); });
    $('#emp-documento').removeAttribute('aria-invalid');
    if (dados.nome.length < 2) return msg(err, ERROS.nome_invalido);
    if (dados.documento && !docValido(dados.documento)) { $('#emp-documento').setAttribute('aria-invalid', 'true'); return msg(err, ERROS.documento_invalido); }
    msg(err); $('#emp-salvar').disabled = true;
    const r = await db.rpc('admin_empresa_salvar', { alvo: e.id, p: dados });
    if (!r.error && !e.propria && $('#emp-situacao').value !== e.situacao) {
      const s = await db.rpc('admin_empresa_status', { alvo: e.id, novo: $('#emp-situacao').value });
      if (s.error) r.error = s.error;
    }
    $('#emp-salvar').disabled = false;
    if (r.error) return msg(err, ERROS[r.error.message] || erroBR(r.error));
    fecharEditar();
    toast('Empresa atualizada.');
    carregar();
  });

  // ---------- backup (CSV com todos os links de todas as empresas) ----------
  async function backup() {
    const btn = $('#btn-backup'); btn.disabled = true;
    const r = await db.rpc('admin_exportar');
    btn.disabled = false;
    if (r.error) return toast('Não deu para gerar o backup agora.');
    const links = r.data || [];
    if (!links.length) return toast('Ainda não há links para o backup.');
    const cols = [['Empresa', 'empresa'], ['CNPJ ou CPF', '#doc'], ['Nome do link', 'nome'], ['Link curto', '#curto'], ['Destino', 'destino'],
      ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign'], ['utm_term', 'utm_term'], ['utm_content', 'utm_content'],
      ['Situação', '#ativo'], ['Cliques', 'cliques'], ['Observação', 'observacao'], ['Criado por', 'criado_por'], ['Criado em', '#criado']];
    const cel = (v) => {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    };
    const linhas = [cols.map(c => cel(c[0])).join(';')];
    for (const x of links) {
      linhas.push(cols.map(([, k]) => {
        if (k === '#doc') return cel(docFormatado(x.documento));
        if (k === '#curto') return cel(PL.dominio + '/' + x.slug);
        if (k === '#ativo') return cel(x.ativo ? 'Ativo' : 'Pausado');
        if (k === '#criado') return cel(new Date(x.criado_em).toLocaleDateString('pt-BR'));
        return cel(x[k]);
      }).join(';'));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: 'backup-phar-links-' + diaISO(new Date()) + '.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Backup baixado: ' + num(links.length) + (links.length === 1 ? ' link' : ' links') + '.');
  }

  document.querySelectorAll('button.stat').forEach(b => b.addEventListener('click', () => { st.filtro = st.filtro === b.dataset.filtro ? '' : b.dataset.filtro; render(); }));
  $('#q').addEventListener('input', () => { st.q = $('#q').value; render(); });
  $('#btn-limpar').addEventListener('click', () => { st.filtro = ''; st.q = ''; $('#q').value = ''; render(); });
  $('#btn-atualizar').addEventListener('click', async () => { if (await carregar()) toast('Painel atualizado.'); });
  $('#btn-backup').addEventListener('click', backup);
  $('#btn-sair-simulacao').addEventListener('click', pararSimulacao);
  document.querySelectorAll('[data-sair]').forEach(b => b.addEventListener('click', sair));

  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('/entrar'); return; }
  const ses = await db.rpc('minha_sessao');
  if (ses.error || !ses.data) return estado('Não deu para carregar', 'Confira sua conexão e recarregue a página.');
  if (!ses.data.admin) return estado('Área restrita', 'Este painel é só para a administração do sistema. Sua conta não tem esse acesso.');
  $('#topo-nome').textContent = ses.data.nome || ses.data.email || '';
  tela('admin');
  render();
  await carregar();
  if (ses.data.simulando) {
    const e = st.empresas.find(x => x.id === ses.data.empresa_id);
    $('#simulando-nome').textContent = e ? e.nome : 'outra empresa';
    $('#faixa-simulando').hidden = false;
  }
})();
