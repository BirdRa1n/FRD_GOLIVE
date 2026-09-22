import { timingSafeEqual } from "node:crypto";
import express, { type Response } from "express";
import { AccessToken } from "livekit-server-sdk";

import { createAdminRouter } from "./admin.js";
import { checkVoicePresence, isReady, startPresence } from "./presence.js";

const {
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    ORG_SECRET,
    DISCORD_BOT_TOKEN,
    // strict | lenient | off  (só se aplica quando há DISCORD_BOT_TOKEN)
    PRESENCE_ENFORCEMENT = "strict",
    PORT = "8080",
    TOKEN_TTL = "10m",
    // Painel admin de atualização (opt-in) e origem do código.
    ADMIN_UI = "off",
    UPDATE_REPO = "https://github.com/BirdRa1n/FRD_GOLIVE",
    UPDATE_BRANCH = "main",
    REPO_DIR = "/repo",
    HOST_REPO_DIR = "",
} = process.env;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !ORG_SECRET) {
    console.error(
        "Faltam variáveis de ambiente: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ORG_SECRET",
    );
    process.exit(1);
}

// Rotação sem downtime: aceita uma lista de segredos separados por vírgula.
// Durante a troca, mantenha o antigo e o novo até todos migrarem.
const ORG_SECRETS = ORG_SECRET.split(",").map(s => s.trim()).filter(Boolean);

const presenceEnabled = Boolean(DISCORD_BOT_TOKEN) && PRESENCE_ENFORCEMENT !== "off";
const presenceStrict = PRESENCE_ENFORCEMENT !== "lenient";

/** Comparação em tempo constante contra qualquer segredo válido. */
function secretMatches(provided: unknown): boolean {
    if (typeof provided !== "string") return false;
    const a = Buffer.from(provided);
    return ORG_SECRETS.some(secret => {
        const b = Buffer.from(secret);
        return a.length === b.length && timingSafeEqual(a, b);
    });
}

interface AuditEntry {
    room?: unknown;
    identity?: unknown;
    result: "granted" | "denied";
    reason?: string;
    presence?: string;
}

function audit(entry: AuditEntry): void {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "token", ...entry }));
}

function deny(res: Response, status: number, entry: Omit<AuditEntry, "result">): void {
    audit({ ...entry, result: "denied" });
    res.status(status).json({ error: entry.reason ?? "negado" });
}

const app = express();
app.use(express.json({ limit: "16kb" }));

// O plugin roda dentro do cliente Discord (origem app://). O controle de acesso
// real é o ORG_SECRET + presença, não a origem — por isso liberamos CORS.
app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    next();
});

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        presenceEnabled,
        presenceReady: presenceEnabled ? isReady() : undefined,
        adminUi: ADMIN_UI === "on",
    });
});

if (ADMIN_UI === "on") {
    app.use("/admin", createAdminRouter({
        updateRepo: UPDATE_REPO,
        updateBranch: UPDATE_BRANCH,
        repoDir: REPO_DIR,
        hostRepoDir: HOST_REPO_DIR,
        secretMatches,
    }));
}

app.post("/token", async (req, res) => {
    const { room, identity, orgSecret, name } = req.body ?? {};

    if (typeof room !== "string" || room.length === 0) {
        return deny(res, 400, { room, identity, reason: "room é obrigatório" });
    }
    if (typeof identity !== "string" || identity.length === 0) {
        return deny(res, 400, { room, identity, reason: "identity é obrigatório" });
    }
    if (!secretMatches(orgSecret)) {
        return deny(res, 403, { room, identity, reason: "orgSecret inválido" });
    }

    if (presenceEnabled) {
        if (!isReady()) {
            return deny(res, 503, { room, identity, reason: "serviço de presença inicializando" });
        }
        const presence = checkVoicePresence(room, identity);
        if (presence === "absent") {
            return deny(res, 403, { room, identity, presence, reason: "usuário não está no canal de voz" });
        }
        if (presence === "unknown" && presenceStrict) {
            return deny(res, 403, { room, identity, presence, reason: "presença não verificável (canal fora do alcance do bot)" });
        }
    }

    const at = new AccessToken(LIVEKIT_API_KEY as string, LIVEKIT_API_SECRET as string, {
        identity,
        name: typeof name === "string" && name.length > 0 ? name : identity,
        ttl: TOKEN_TTL,
    });
    at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    const token = await at.toJwt();
    audit({ room, identity, result: "granted", presence: presenceEnabled ? "present" : "n/a" });
    res.json({ token });
});

async function main(): Promise<void> {
    if (presenceEnabled) {
        try {
            await startPresence(DISCORD_BOT_TOKEN as string);
        } catch (e) {
            console.error("[presence] falha ao conectar o bot:", e);
            process.exit(1);
        }
    } else {
        console.warn(
            "[presence] DISCORD_BOT_TOKEN ausente ou enforcement=off — emitindo tokens só com o segredo (modo Fase 1).",
        );
    }

    app.listen(Number(PORT), () => {
        console.log(`token-service ouvindo na porta ${PORT} (presença: ${presenceEnabled ? PRESENCE_ENFORCEMENT : "off"})`);
    });
}

void main();
