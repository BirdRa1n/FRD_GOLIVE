// Versão do FRD GoLive embutida no plugin. O build (installer/scripts/build-vencord-dist.mjs)
// reescreve este arquivo na cópia do plugin com a versão da tag/do installer/package.json —
// mantenha igual ao installer/package.json ao trocar a versão.
export const FRD_VERSION = "2.1.0";

/** Repositório (owner/name) cujas releases o plugin consulta para avisar de atualização. */
export const FRD_REPO = "BirdRa1n/FRD_GOLIVE";

function parts(v: string): number[] {
    return v.trim().replace(/^v/i, "").split(/[-+]/)[0].split(".").map(n => Number.parseInt(n, 10) || 0);
}

/** >0 se a > b, <0 se a < b, 0 se iguais (só major.minor.patch; sufixos -x/+x são ignorados). */
export function compareVersions(a: string, b: string): number {
    const pa = parts(a), pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}
