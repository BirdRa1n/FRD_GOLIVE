// Discord OAuth2 (scope identify) para o login do hub.

const {
    DISCORD_CLIENT_ID = "",
    DISCORD_CLIENT_SECRET = "",
    DISCORD_REDIRECT_URI = "",
    DISCORD_BOT_TOKEN = "",
} = process.env;

export function oauthConfigured(): boolean {
    return Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
}

export function oauthUrl(state: string): string {
    const p = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: "code",
        scope: "identify",
        state,
    });
    return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
    });
    const res = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) throw new Error(`troca de código falhou (${res.status})`);
    const d = await res.json() as { access_token: string; };
    return d.access_token;
}

export async function getUser(accessToken: string): Promise<{ id: string; name: string; }> {
    const res = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`/users/@me falhou (${res.status})`);
    const u = await res.json() as { id: string; username: string; global_name?: string; };
    return { id: u.id, name: u.global_name || u.username };
}

// --- Bot (REST) — para o modo "channels": listar guilds/canais e resolver nomes ---

const API = "https://discord.com/api/v10";

export function botConfigured(): boolean {
    return Boolean(DISCORD_BOT_TOKEN);
}

async function bot<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`bot ${path} falhou (${res.status})`);
    return res.json() as Promise<T>;
}

const CACHE_TTL = 60_000; // 1 min — evita estourar rate limit a cada poll da dashboard
let guildsCache: { at: number; list: { id: string; name: string; }[] } = { at: 0, list: [] };
const channelsCache = new Map<string, { at: number; list: { id: string; name: string; type: number; }[] }>();

/** Guilds em que o bot está (cache de 1 min). */
export async function botGuilds(): Promise<{ id: string; name: string; }[]> {
    if (guildsCache.at && Date.now() - guildsCache.at < CACHE_TTL) return guildsCache.list;
    const gs = await bot<{ id: string; name: string; }[]>("/users/@me/guilds");
    guildsCache = { at: Date.now(), list: gs.map(g => ({ id: g.id, name: g.name })) };
    return guildsCache.list;
}

/** Canais de voz (type 2) e stage (13) de um guild (cache de 1 min por guild). */
export async function guildVoiceChannels(guildId: string): Promise<{ id: string; name: string; type: number; }[]> {
    const hit = channelsCache.get(guildId);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.list;
    const chs = await bot<{ id: string; name: string; type: number; }[]>(`/guilds/${guildId}/channels`);
    const list = chs.filter(c => c.type === 2 || c.type === 13).map(c => ({ id: c.id, name: c.name, type: c.type }));
    channelsCache.set(guildId, { at: Date.now(), list });
    if (channelsCache.size > 50) channelsCache.clear();
    return list;
}

/** Resolve nomes de guild e canal (best-effort; para rotular canais auto-descobertos). */
export async function resolveChannelNames(guildId: string, channelId: string): Promise<{ guildName?: string; channelName?: string; }> {
    try {
        const [gs, chs] = await Promise.all([botGuilds(), guildVoiceChannels(guildId)]);
        return {
            guildName: gs.find(g => g.id === guildId)?.name,
            channelName: chs.find(c => c.id === channelId)?.name,
        };
    } catch {
        return {};
    }
}

/** Resolve o nome de um membro (best-effort; usado só para exibição). */
export async function memberName(guildId: string, userId: string): Promise<string | undefined> {
    try {
        const m = await bot<{ nick?: string; user?: { global_name?: string; username?: string; }; }>(`/guilds/${guildId}/members/${userId}`);
        return m.nick || m.user?.global_name || m.user?.username;
    } catch {
        return undefined;
    }
}
