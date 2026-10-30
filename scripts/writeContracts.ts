// Writes the published contract to contracts/ for other teams to generate clients from.
import { mkdirSync, writeFileSync } from "node:fs";
import { contractSchemas, openapi } from "../src/server/openapi.js";

mkdirSync("contracts", { recursive: true });
for (const [name, schema] of Object.entries(contractSchemas())) writeFileSync(`contracts/${name}.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
writeFileSync("contracts/openapi.json", `${JSON.stringify(openapi(), null, 2)}\n`);
console.log("Contracts written");
