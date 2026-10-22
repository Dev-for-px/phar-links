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

  // h('div', {class:'x', text:'y', onclick: fn}, filho1, [filho2, filho3])
  function h(tag, props, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    filhos.flat().forEach(f => { if (f != null && f !== false) n.append(f); });
    return n;
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

  // CPF e CNPJ (o CNPJ novo pode ter letras nas 12 primeiras posições)
  const docLimpo = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  function docFormatado(v) {
    const d = docLimpo(v);
    if (d.length === 11) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
    return String(v || '');
  }
  function digito(v, pesos) { const s = v.reduce((a, x, i) => a + x * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; }
  function docValido(v) {
    const d = docLimpo(v);
    if (d.length === 11) {
      if (/^(\d)\1{10}$/.test(d)) return false;
      const n = d.split('').map(Number);
      const d1 = (n.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0) * 10) % 11 % 10;
      const d2 = (n.slice(0, 10).reduce((a, x, i) => a + x * (11 - i), 0) * 10) % 11 % 10;
      return d1 === n[9] && d2 === n[10];
    }
    if (d.length === 14 && /^[A-Z0-9]{12}\d{2}$/.test(d) && !/^(.)\1{13}$/.test(d)) {
      const c = d.split('').map(x => x.charCodeAt(0) - 48), p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      return digito(c.slice(0, 12), p1) === c[12] && digito(c.slice(0, 13), [6, ...p1]) === c[13];
    }
    return false;
  }
  const cepFormatado = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : String(v || ''); };

  // graficos.js (copiado do Prospector) usa window.PP.el
  window.PP = { el: h };

  return { dominio: 'links.pharconsultoria.com', db, hashInicial, $, el, h, msg, toast, erroBR, sair, docLimpo, docFormatado, docValido, cepFormatado };
})();
