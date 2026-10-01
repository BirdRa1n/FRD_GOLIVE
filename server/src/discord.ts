
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

const API = "https://discord.com/api/v10";

export function botConfigured(): boolean {
    return Boolean(DISCORD_BOT_TOKEN);
}

export function clientId(): string {
    return DISCORD_CLIENT_ID;
}

const CDN = "https://cdn.discordapp.com";

export function guildIconUrl(guildId: string, iconHash?: string | null): string | undefined {
    return iconHash ? `${CDN}/icons/${guildId}/${iconHash}.png?size=128` : undefined;
}

export function userAvatarUrl(userId: string, avatarHash?: string | null): string | undefined {
    return avatarHash ? `${CDN}/avatars/${userId}/${avatarHash}.png?size=128` : undefined;
}

export function botInviteUrl(): string | undefined {
    if (!DISCORD_CLIENT_ID) return undefined;
    const perms = (1 << 10) | (1 << 20);
    const p = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        scope: "bot applications.commands",
        permissions: String(perms),
    });
    return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

async function bot<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`bot ${path} falhou (${res.status})`);
    return res.json() as Promise<T>;
}

export interface BotGuild { id: string; name: string; icon?: string; }

const CACHE_TTL = 60_000; // 1 min — evita estourar rate limit a cada poll da dashboard
let guildsCache: { at: number; list: BotGuild[] } = { at: 0, list: [] };
const channelsCache = new Map<string, { at: number; list: { id: string; name: string; type: number; }[] }>();
const avatarCache = new Map<string, { at: number; hash?: string }>(); // userId → hash do avatar

export async function botGuilds(): Promise<BotGuild[]> {
    if (guildsCache.at && Date.now() - guildsCache.at < CACHE_TTL) return guildsCache.list;
    const gs = await bot<{ id: string; name: string; icon?: string; }[]>("/users/@me/guilds");
    guildsCache = { at: Date.now(), list: gs.map(g => ({ id: g.id, name: g.name, icon: g.icon ?? undefined })) };
    return guildsCache.list;
}

export async function guildIcon(guildId: string): Promise<string | undefined> {
    try { return (await botGuilds()).find(g => g.id === guildId)?.icon; }
    catch { return undefined; }
}

export async function userAvatar(userId: string): Promise<string | undefined> {
    const hit = avatarCache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.hash;
    try {
        const u = await bot<{ avatar?: string; }>(`/users/${userId}`);
        if (avatarCache.size > 500) avatarCache.clear();
        avatarCache.set(userId, { at: Date.now(), hash: u.avatar ?? undefined });
        return u.avatar ?? undefined;
    } catch {
        return undefined;
    }
}

export async function guildVoiceChannels(guildId: string): Promise<{ id: string; name: string; type: number; }[]> {
    const hit = channelsCache.get(guildId);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.list;
    const chs = await bot<{ id: string; name: string; type: number; }[]>(`/guilds/${guildId}/channels`);
    const list = chs.filter(c => c.type === 2 || c.type === 13).map(c => ({ id: c.id, name: c.name, type: c.type }));
    channelsCache.set(guildId, { at: Date.now(), list });
    if (channelsCache.size > 50) channelsCache.clear();
    return list;
}

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

export async function memberName(guildId: string, userId: string): Promise<string | undefined> {
    try {
        const m = await bot<{ nick?: string; user?: { global_name?: string; username?: string; }; }>(`/guilds/${guildId}/members/${userId}`);
        return m.nick || m.user?.global_name || m.user?.username;
    } catch {
        return undefined;
    }
}
