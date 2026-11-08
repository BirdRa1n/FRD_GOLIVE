// Séries em memória para os gráficos do painel (/admin/stats). Nada vai para disco:
// depois de um restart a mídia e a atividade recomeçam vazias; os logs são
// reconstruídos a partir dos arquivos do dia (clientLogs.seedLogCounts).

const MEDIA_POINTS = 720; // 1 h com amostra a cada 5 s
const HOUR_MS = 3600_000;
const HOURS = 24;

export interface MediaSample { t: number; kbps: number; rttMs: number | null; }
export interface LogHour { t: number; info: number; warn: number; error: number; }

const media: MediaSample[] = [];
const logHours = new Map<number, LogHour>();
const activity = new Map<string, Map<number, number>>(); // channelId → hora → segundos com alguém no ar

const hourOf = (t: number) => Math.floor(t / HOUR_MS) * HOUR_MS;

export function pushMediaSample(kbps: number, rttMs: number | null, t = Date.now()): void {
    media.push({ t, kbps: Math.round(kbps), rttMs: rttMs === null ? null : Math.round(rttMs) });
    if (media.length > MEDIA_POINTS) media.splice(0, media.length - MEDIA_POINTS);
}

export function countLogs(entries: { t: number; l: string; }[]): void {
    const floor = hourOf(Date.now()) - (HOURS - 1) * HOUR_MS;
    for (const e of entries) {
        const h = hourOf(e.t);
        if (h < floor || e.l === "meta") continue;
        let b = logHours.get(h);
        if (!b) { b = { t: h, info: 0, warn: 0, error: 0 }; logHours.set(h, b); }
        if (e.l === "error") b.error++;
        else if (e.l === "warn") b.warn++;
        else b.info++;
    }
    for (const h of logHours.keys()) if (h < floor) logHours.delete(h);
}

export function addActivity(channelIds: Iterable<string>, seconds: number, t = Date.now()): void {
    const h = hourOf(t);
    const floor = h - (HOURS - 1) * HOUR_MS;
    for (const id of new Set(channelIds)) {
        let m = activity.get(id);
        if (!m) { m = new Map(); activity.set(id, m); }
        m.set(h, (m.get(h) ?? 0) + seconds);
        for (const k of m.keys()) if (k < floor) m.delete(k);
    }
}

export function getStats(now = Date.now()) {
    const start = hourOf(now) - (HOURS - 1) * HOUR_MS;
    const hours = Array.from({ length: HOURS }, (_, i) => start + i * HOUR_MS);
    const channels: Record<string, number[]> = {};
    for (const [id, m] of activity) {
        const row = hours.map(h => Math.round((m.get(h) ?? 0) / 60));
        if (row.some(Boolean)) channels[id] = row;
    }
    const last = media[media.length - 1];
    return {
        now,
        media: { intervalMs: 5000, samples: media, kbps: last?.kbps ?? 0, rttMs: last?.rttMs ?? null },
        logs: hours.map(h => logHours.get(h) ?? { t: h, info: 0, warn: 0, error: 0 }),
        activity: { hours, channels }, // minutos com alguém transmitindo, por hora
    };
}
