(async () => {
  const { db, $, msg, erroBR, hashInicial } = PL;
  const telas = ['carregando', 'acesso', 'esqueci', 'nova', 'aviso'];
  const mostrar = (id) => telas.forEach(t => { $('#v-' + t).hidden = t !== id; });

  function aba(criar) {
    $('#aba-entrar').setAttribute('aria-selected', String(!criar));
    $('#aba-criar').setAttribute('aria-selected', String(criar));
    $('#form-entrar').hidden = criar;
    $('#form-criar').hidden = !criar;
  }
  function aviso(titulo, texto) {
    $('#aviso-titulo').textContent = titulo;
    $('#aviso-texto').textContent = texto;
    mostrar('aviso');
  }

  $('#aba-entrar').addEventListener('click', () => aba(false));
  $('#aba-criar').addEventListener('click', () => aba(true));
  $('#e-esqueci').addEventListener('click', () => { $('#r-email').value = $('#e-email').value; mostrar('esqueci'); });
  document.querySelectorAll('[data-voltar]').forEach(b => b.addEventListener('click', () => { aba(false); mostrar('acesso'); }));

  async function enviando(botao, fn) {
    botao.disabled = true;
    try { await fn(); } finally { botao.disabled = false; }
  }

  $('#form-entrar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    msg($('#e-erro'));
    enviando($('#e-botao'), async () => {
      const { error } = await db.auth.signInWithPassword({ email: $('#e-email').value.trim(), password: $('#e-senha').value });
      if (error) return msg($('#e-erro'), erroBR(error));
      location.href = '/app';
    });
  });

  $('#form-criar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    msg($('#c-erro'));
    const empresa = $('#c-empresa').value.trim(), email = $('#c-email').value.trim(), senha = $('#c-senha').value;
    if (empresa.length === 1) return msg($('#c-erro'), 'Informe o nome completo da empresa.');
    if (!email) return msg($('#c-erro'), 'Informe seu e-mail.');
    if (senha.length < 8) return msg($('#c-erro'), 'A senha precisa ter pelo menos 8 caracteres.');
    enviando($('#c-botao'), async () => {
      try { if (empresa) localStorage.setItem('pl_empresa', empresa); else localStorage.removeItem('pl_empresa'); } catch (e) {}
      const { data, error } = await db.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + '/app' } });
      if (error) return msg($('#c-erro'), erroBR(error));
      if (data.session) { location.href = '/app'; return; }
      aviso('Confirme seu e-mail', `Enviamos um link de confirmação para ${email}. Abra o e-mail, clique no link e você volta para cá já com a conta criada.`);
    });
  });

  $('#form-esqueci').addEventListener('submit', (ev) => {
    ev.preventDefault();
    msg($('#r-erro'));
    const email = $('#r-email').value.trim();
    if (!email) return msg($('#r-erro'), 'Informe o e-mail da sua conta.');
    enviando($('#r-botao'), async () => {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/entrar' });
      if (error) return msg($('#r-erro'), erroBR(error));
      aviso('Confira seu e-mail', `Se existir uma conta com ${email}, você vai receber um link para criar uma nova senha.`);
    });
  });

  $('#form-nova').addEventListener('submit', (ev) => {
    ev.preventDefault();
    msg($('#n-erro'));
    const senha = $('#n-senha').value;
    if (senha.length < 8) return msg($('#n-erro'), 'A senha precisa ter pelo menos 8 caracteres.');
    enviando($('#n-botao'), async () => {
      const { error } = await db.auth.updateUser({ password: senha });
      if (error) return msg($('#n-erro'), erroBR(error));
      location.href = '/app';
    });
  });

  // chegou pelo link de recuperação de senha
  if (/type=recovery/.test(hashInicial)) {
    db.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') mostrar('nova'); });
    const { data: { session } } = await db.auth.getSession();
    if (session) mostrar('nova');
    return;
  }

  const { data: { session } } = await db.auth.getSession();
  if (session) { location.href = '/app'; return; }
  aba(new URLSearchParams(location.search).get('modo') === 'criar');
  mostrar('acesso');
})();
