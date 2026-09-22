// Sessão do hub: cookie HMAC-assinado (sem dependências externas).

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-inseguro-troque";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Session {
    id: string; // user id do Discord
    name: string;
    exp: number;
}

export function sign(data: Omit<Session, "exp">): string {
    const full: Session = { ...data, exp: Date.now() + MAX_AGE_MS };
    const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    return `${payload}.${sig}`;
}

export function verify(token: string | undefined): Session | null {
    if (!token) return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
        return data.exp > Date.now() ? data : null;
    } catch {
        return null;
    }
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

export const COOKIE_NAME = "frd_session";
