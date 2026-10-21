// Redireciona o link curto para o destino atual, com as UTMs, e conta o clique.
const SUPABASE_URL = 'https://uqmjjrrpdgtjgzzjyxtn.supabase.co';
const CHAVE_PUBLICA = 'sb_publishable_egwp7VwFdWXsmzzmF4yy2A_FdmH6wBz';
const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function montarDestino(l) {
  const url = new URL(l.destino);
  for (const k of UTMS) {
    if (l[k]) url.searchParams.set(k, l[k]);
  }
  return url.toString();
}

function naoEncontrado(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link não encontrado</title><link rel="stylesheet" href="/css/estilo.css"><body class="centro"><main class="cartao"><h1>Link não encontrado</h1><p>Este link não existe ou foi desativado.</p></main></body></html>');
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.s) || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(slug)) return naoEncontrado(res);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolver_link`, {
      method: 'POST',
      headers: { apikey: CHAVE_PUBLICA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug })
    });
    if (!r.ok) return naoEncontrado(res);
    const l = await r.json();
    if (!l || !l.destino) return naoEncontrado(res);
    res.statusCode = 302;
    res.setHeader('Location', montarDestino(l));
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  } catch (e) {
    return naoEncontrado(res);
  }
};
