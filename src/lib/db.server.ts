import { neon } from "@neondatabase/serverless";

// Nunca importado pelo cliente: só as server functions em `api.server.ts`
// tocam neste módulo, então a connection string do Neon jamais chega ao
// navegador.
function createSql() {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("Variável de ambiente DATABASE_URL não configurada.");
  }
  return neon(url);
}

let _sql: ReturnType<typeof createSql> | undefined;

export function sql() {
  if (!_sql) _sql = createSql();
  return _sql;
}
