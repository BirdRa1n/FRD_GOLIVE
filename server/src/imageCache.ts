// Cache de imagens do Discord (ícones de guild, avatares de usuário). Busca a URL
// do CDN uma vez, guarda em memória + disco, e serve os bytes — o navegador do
// admin e o instalador (Electron) nunca batem direto no CDN do Discord.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.IMG_CACHE_DIR ?? "./img-cache";
const TTL = 6 * 3600_000; // revalida a imagem a cada 6 h
const MAX_BYTES = 512 * 1024; // teto por imagem

interface Entry { at: number; buf: Buffer; }
const mem = new Map<string, Entry>();

function diskPath(url: string): string {
    return join(DIR, createHash("sha1").update(url).digest("hex") + ".png");
}

/**
 * Bytes PNG da imagem em `url` (CDN do Discord), vindos do cache quando possível.
 * `null` quando não há URL ou a busca falha — o cliente mostra o fallback (iniciais).
 */
export async function cachedImage(url: string | undefined): Promise<Buffer | null> {
    if (!url) return null;
    const hit = mem.get(url);
    if (hit && Date.now() - hit.at < TTL) return hit.buf;

    const file = diskPath(url);
    if (!hit && existsSync(file)) {
        try {
            const buf = readFileSync(file);
            mem.set(url, { at: Date.now(), buf });
            return buf;
        } catch { /* cai na busca remota */ }
    }

    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const arr = new Uint8Array(await res.arrayBuffer());
        if (arr.byteLength > MAX_BYTES) return null;
        const buf = Buffer.from(arr);
        if (mem.size > 1000) mem.clear();
        mem.set(url, { at: Date.now(), buf });
        try { mkdirSync(DIR, { recursive: true }); writeFileSync(file, buf); } catch { /* melhor esforço */ }
        return buf;
    } catch {
        return null;
    }
}
