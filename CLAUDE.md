# Regras do projeto

- Leia `docs/DOCUMENTACAO.md` antes de qualquer mudança.
- Toda mudança, por menor que seja, atualiza a documentação no mesmo envio: `docs/DOCUMENTACAO.md` (partes afetadas, data no topo e uma linha no Histórico), o `README.md` se couber e, se mexeu no banco, o `supabase/schema-completo.sql`.
- Economizar no Supabase: nada de registro por clique, tempo real, armazenamento de arquivos ou funções pagas.
- Comandos que removem coisas no banco (drop, delete) devem ser entregues como SQL para o Pedro rodar no SQL Editor.
- Nunca colocar senha do banco nem chave secreta do Supabase no repositório.
- Sem `<script>` solto nem `style=` no HTML (bloqueado pela CSP); usar classes e arquivos .js.
