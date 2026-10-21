(async () => {
  const { db, $, el, msg, toast, erroBR, sair } = PL;
  const num = (n) => Number(n || 0).toLocaleString('pt-BR');
  const NOMES = { pendente: 'Pendente', ativa: 'Liberada', bloqueada: 'Suspensa' };
  document.querySelectorAll('[data-sair]').forEach(b => b.addEventListener('click', sair));

  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('/entrar'); return; }
  const { data: eu } = await db.from('perfis').select('admin').eq('user_id', session.user.id).single();
  if (!eu || !eu.admin) { location.replace('/app'); return; }
  $('#topo-email').textContent = session.user.email;
  $('#tela-carregando').hidden = true;
  $('#tela-admin').hidden = false;

  async function mudar(e, situacao) {
    const { error } = await db.from('empresas').update({ situacao }).eq('id', e.id);
    if (error) return msg($('#aviso-erro'), erroBR(error));
    toast(`${e.nome}: ${NOMES[situacao].toLowerCase()}.`);
    carregar();
  }

  function botao(texto, classe, fn) {
    const b = el('button', 'btn btn-sm ' + classe, texto);
    b.type = 'button'; b.addEventListener('click', fn);
    return b;
  }

  async function carregar() {
    msg($('#aviso-erro'));
    const [emp, perfis, links] = await Promise.all([
      db.from('empresas').select('*').order('criado_em', { ascending: false }),
      db.from('perfis').select('email, empresa_id, papel'),
      db.from('links').select('empresa_id, cliques')
    ]);
    const erro = emp.error || perfis.error || links.error;
    if (erro) return msg($('#aviso-erro'), erroBR(erro));

    // pendentes primeiro
    const ordem = { pendente: 0, ativa: 1, bloqueada: 2 };
    const lista = emp.data.slice().sort((a, b) => ordem[a.situacao] - ordem[b.situacao]);
    $('#n-pendentes').textContent = num(lista.filter(e => e.situacao === 'pendente').length);
    $('#n-ativas').textContent = num(lista.filter(e => e.situacao === 'ativa').length);
    $('#n-links').textContent = num(links.data.length);
    $('#n-cliques').textContent = num(links.data.reduce((s, l) => s + Number(l.cliques), 0));

    const alvo = $('#lista');
    alvo.replaceChildren();
    $('.adm-head').hidden = !lista.length;
    if (!lista.length) {
      const v = el('div', 'vazio');
      v.append(el('h2', '', 'Nenhuma empresa ainda'), el('p', '', 'Quando alguém criar conta, a empresa aparece aqui para você liberar.'));
      return alvo.append(v);
    }

    for (const e of lista) {
      const ls = links.data.filter(l => l.empresa_id === e.id);
      const dono = perfis.data.find(p => p.empresa_id === e.id && p.papel === 'dono');
      const linha = el('div', 'adm-linha lk');
      const cNome = el('div', 'a-nome');
      const completo = !!(e.documento && e.telefone && e.cidade && e.uf);
      cNome.append(el('div', 'nome', e.nome), el('div', 'sub', 'Desde ' + new Date(e.criado_em).toLocaleDateString('pt-BR') + (e.cidade ? ' · ' + e.cidade + (e.uf ? '/' + e.uf : '') : '')));
      if (!completo) cNome.append(el('div', 'sub adm-falta', 'Cadastro incompleto'));
      const cSit = el('div');
      cSit.append(el('span', 'tag c-' + e.situacao, NOMES[e.situacao]));
      const nLinks = el('div', 'num-col rot', num(ls.length)); nLinks.dataset.rot = 'Links';
      const nCliques = el('div', 'num-col rot', num(ls.reduce((s, l) => s + Number(l.cliques), 0))); nCliques.dataset.rot = 'Cliques';
      const acoes = el('div', 'adm-acoes');
      if (e.situacao === 'pendente') acoes.append(botao('Liberar', 'btn-primary', () => mudar(e, 'ativa')));
      if (e.situacao === 'ativa') acoes.append(botao('Suspender', 'btn-danger', () => {
        if (confirm(`Suspender ${e.nome}? A empresa perde o acesso e os links param de redirecionar.`)) mudar(e, 'bloqueada');
      }));
      if (e.situacao === 'bloqueada') acoes.append(botao('Reativar', 'btn-sec', () => mudar(e, 'ativa')));
      linha.append(cNome, el('div', 'sub a-email', dono ? dono.email : '—'), cSit, nLinks, nCliques, acoes);
      alvo.append(linha);
    }
  }

  carregar();
})();
