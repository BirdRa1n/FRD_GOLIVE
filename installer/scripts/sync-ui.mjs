// Copia o design system (server/public/ui) para o renderer do instalador.
// Fonte única: o hub serve os mesmos arquivos em /ui. O destino é gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "server", "public", "ui");
const dest = join(here, "..", "renderer", "ui");

mkdirSync(dest, { recursive: true });
for (const file of ["ui.css", "ui.js"]) copyFileSync(join(src, file), join(dest, file));
console.log(`[sync-ui] design system copiado para ${dest}`);
