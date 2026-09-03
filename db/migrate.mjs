#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida. Copie .env.example para .env e preencha.");
  process.exit(1);
}

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const schemaSql = readFileSync(schemaPath, "utf8");

const client = new Client(url);
await client.connect();
try {
  await client.query(schemaSql);
  console.log("Schema aplicado com sucesso.");
} finally {
  await client.end();
}
