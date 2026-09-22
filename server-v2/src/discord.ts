// Discord OAuth2 (scope identify) para o login do hub.

const {
    DISCORD_CLIENT_ID = "",
    DISCORD_CLIENT_SECRET = "",
    DISCORD_REDIRECT_URI = "",
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
