// Configuração pública (a chave publicável pode ficar no navegador; a segurança está nas regras do banco).
window.PL = {
  dominio: 'links.pharconsultoria.com',
  db: supabase.createClient(
    'https://uqmjjrrpdgtjgzzjyxtn.supabase.co',
    'sb_publishable_egwp7VwFdWXsmzzmF4yy2A_FdmH6wBz'
  ),
  $: (s) => document.querySelector(s),
  msg(el, texto, tipo) { el.textContent = texto || ''; el.className = 'msg ' + (tipo || ''); },
  erroBR(e) {
    const m = (e && e.message) || String(e);
    if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/already registered/i.test(m)) return 'Este e-mail já tem cadastro. Use "Entrar".';
    if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/links_slug_key|duplicate key/i.test(m)) return 'Esse endereço curto já está em uso. Escolha outro.';
    if (/links_slug_check/i.test(m)) return 'Endereço curto inválido: use só letras minúsculas, números e hífen (sem acento ou espaço), e não use app, entrar, admin ou api.';
    if (/destino_check/i.test(m)) return 'O destino precisa começar com http:// ou https://';
    if (/utm_seguro/i.test(m)) return 'As UTMs aceitam só letras sem acento, números, espaço, ponto, hífen, + e _.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
    return m;
  }
};
