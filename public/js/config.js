// Configuração pública e funções comuns (a chave publicável pode ficar no navegador; a segurança está nas regras do banco).
window.PL = (function () {
  const hashInicial = window.location.hash || '';
  const db = supabase.createClient(
    'https://uqmjjrrpdgtjgzzjyxtn.supabase.co',
    'sb_publishable_egwp7VwFdWXsmzzmF4yy2A_FdmH6wBz',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
  const $ = (s) => document.querySelector(s);

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  // mostra (ou esconde, sem texto) uma mensagem de erro/aviso
  function msg(alvo, texto) { alvo.textContent = texto || ''; alvo.hidden = !texto; }

  let toastT;
  function toast(texto) {
    const t = $('#toast'); if (!t) return;
    t.textContent = texto; clearTimeout(toastT);
    toastT = setTimeout(() => { t.textContent = ''; }, 3200);
  }

  function erroBR(e) {
    const m = (e && e.message) || String(e);
    if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/already registered/i.test(m)) return 'Este e-mail já tem cadastro. Use "Entrar".';
    if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (/links_slug_key|duplicate key/i.test(m)) return 'Esse endereço curto já está em uso. Escolha outro.';
    if (/links_slug_check/i.test(m)) return 'Endereço curto inválido: use só letras minúsculas, números e hífen (sem acento ou espaço), e não use app, entrar, admin ou api.';
    if (/destino_check/i.test(m)) return 'O destino precisa começar com http:// ou https://';
    if (/utm_seguro/i.test(m)) return 'As UTMs aceitam só letras sem acento, números, espaço, ponto, hífen, + e _.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
    return m;
  }

  async function sair() { try { await db.auth.signOut(); } catch (e) {} location.href = '/'; }

  return { dominio: 'links.pharconsultoria.com', db, hashInicial, $, el, msg, toast, erroBR, sair };
})();
