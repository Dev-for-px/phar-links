(async () => {
  const { db, $, msg, erroBR } = PL;
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = '/entrar'; return; }
  $('#sair').addEventListener('click', async () => { await db.auth.signOut(); location.href = '/entrar'; });

  const { data: eu } = await db.from('perfis').select('admin').eq('user_id', session.user.id).single();
  if (!eu || !eu.admin) { location.href = '/app'; return; }

  const [emp, perfis, links] = await Promise.all([
    db.from('empresas').select('*').order('criado_em', { ascending: false }),
    db.from('perfis').select('email, empresa_id, papel'),
    db.from('links').select('empresa_id, cliques')
  ]);
  const erro = emp.error || perfis.error || links.error;
  if (erro) return msg($('#msg'), erroBR(erro), 'erro');

  const tb = $('#tabela');
  const td = (t) => { const c = document.createElement('td'); c.textContent = t; return c; };
  const nomes = { pendente: 'Pendente', ativa: 'Liberada', bloqueada: 'Suspensa' };

  for (const e of emp.data) {
    const ls = links.data.filter(l => l.empresa_id === e.id);
    const dono = perfis.data.find(p => p.empresa_id === e.id && p.papel === 'dono');
    const tr = document.createElement('tr');
    const sel = document.createElement('select');
    for (const [v, n] of Object.entries(nomes)) { const o = new Option(n, v, false, v === e.situacao); sel.append(o); }
    sel.addEventListener('change', async () => {
      const { error } = await db.from('empresas').update({ situacao: sel.value }).eq('id', e.id);
      if (error) { msg($('#msg'), erroBR(error), 'erro'); sel.value = e.situacao; return; }
      e.situacao = sel.value;
      msg($('#msg'), `${e.nome}: ${nomes[sel.value]}.`, 'ok');
    });
    const cel = document.createElement('td'); cel.append(sel);
    tr.append(td(e.nome), td(dono ? dono.email : '—'), td(ls.length),
      td(ls.reduce((s, l) => s + Number(l.cliques), 0).toLocaleString('pt-BR')),
      td(new Date(e.criado_em).toLocaleDateString('pt-BR')), cel);
    tb.append(tr);
  }
  if (!emp.data.length) { const tr = document.createElement('tr'); const c = td('Nenhuma empresa cadastrada ainda.'); c.colSpan = 6; tr.append(c); tb.append(tr); }
})();
