import { timingSafeEqual } from "node:crypto";
import express from "express";
import { AccessToken } from "livekit-server-sdk";

const {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  ORG_SECRET,
  PORT = "8080",
  TOKEN_TTL = "10m",
} = process.env;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !ORG_SECRET) {
  console.error(
    "Faltam variáveis de ambiente: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ORG_SECRET",
  );
  process.exit(1);
}

/** Comparação em tempo constante para evitar timing attacks no segredo. */
function secretMatches(provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ORG_SECRET as string);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const app = express();
app.use(express.json({ limit: "16kb" }));

// O plugin roda dentro do cliente Discord (origem app://). O controle de acesso
// real é o ORG_SECRET, não a origem — por isso liberamos CORS amplamente.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/token", async (req, res) => {
  const { room, identity, orgSecret, name } = req.body ?? {};

  if (typeof room !== "string" || room.length === 0) {
    return res.status(400).json({ error: "room é obrigatório" });
  }
  if (typeof identity !== "string" || identity.length === 0) {
    return res.status(400).json({ error: "identity é obrigatório" });
  }
  if (!secretMatches(orgSecret)) {
    return res.status(403).json({ error: "orgSecret inválido" });
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
  res.json({ token });
});

app.listen(Number(PORT), () => {
  console.log(`token-service ouvindo na porta ${PORT}`);
});
