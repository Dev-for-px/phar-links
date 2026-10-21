(async () => {
  const { db, $, msg, erroBR } = PL;
  let cadastro = false;

  const { data: { session } } = await db.auth.getSession();
  if (session) location.href = '/app';

  $('#trocar').addEventListener('click', () => {
    cadastro = !cadastro;
    $('#titulo').textContent = cadastro ? 'Criar cadastro' : 'Entrar';
    $('#sub').textContent = cadastro ? 'Cadastre sua empresa. O acesso é liberado após a aprovação.' : 'Acesse seus links curtos.';
    $('#botao').textContent = cadastro ? 'Criar cadastro' : 'Entrar';
    $('#trocar').textContent = cadastro ? 'Já tem conta? Entrar' : 'Não tem conta? Criar cadastro';
    $('#campo-empresa').classList.toggle('oculto', !cadastro);
    $('#empresa').required = cadastro;
    msg($('#msg'));
  });

  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#email').value.trim(), password = $('#senha').value;
    $('#botao').disabled = true;
    try {
      if (cadastro) {
        const nome = $('#empresa').value.trim();
        if (nome.length < 2) throw new Error('Informe o nome da empresa.');
        try { localStorage.setItem('pl_empresa', nome); } catch (e) {}
        const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + '/app' } });
        if (error) throw error;
        if (data.session) { location.href = '/app'; return; }
        msg($('#msg'), 'Cadastro criado. Abra o e-mail de confirmação que enviamos e depois entre aqui.', 'ok');
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.href = '/app';
      }
    } catch (e) {
      msg($('#msg'), erroBR(e), 'erro');
    } finally {
      $('#botao').disabled = false;
    }
  });
})();
