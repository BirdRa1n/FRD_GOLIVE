// PoC: servidor de mídia compatível com o Go Live NATIVO do Discord.
//
// O plugin (setting `nativeStreamEndpoint`) troca o `endpoint` do
// STREAM_SERVER_UPDATE pelo nosso (ex.: "golivefrd.SEU.com/dstream"). O cliente
// então fala o protocolo do voice gateway (v8) com este WS e o módulo nativo
// (discord_voice) manda a mídia RTP para o nosso UDP — nada passa pelo Discord.
//
// Protocolo levantado com a sonda (client/src/probe/streamProbe.ts):
//   C→S op 0 IDENTIFY {server_id, user_id, streams}   S→C op 8 HELLO, op 2 READY {ssrc, ip, port, modes, streams}
//   C→S op 16 {}                                       S→C op 16 {voice, rtc_worker}
//   C→S op 12 (quem transmite: ssrcs + streams)        S→C op 12 para os espectadores
//   C→S op 1 SELECT_PROTOCOL {address, port, mode}     S→C op 4 SESSION_DESCRIPTION {secret_key, codecs, dave}
//   C→S op 15 (espectador: pixelCounts desejados)      S→C op 15 para quem transmite (0 px = encoder parado)
//   C→S op 3 heartbeat {t, seq_ack}                    S→C op 6 {t}
//
// Mídia: IP discovery (74 bytes) e depois RTP/RTCP com aead_aes256_gcm_rtpsize.
// Todos da sala recebem a MESMA chave, então o servidor repassa os pacotes sem
// recifrar: quem transmite → espectadores; espectadores (RTCP/NACK/PLI) → quem
// transmite. DAVE (E2EE) desligado: dave_protocol_version 0.
//
// É um experimento: sem simulcast, sem estimativa de banda própria, sem resume.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createSocket, type RemoteInfo } from "node:dgram";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import {
    buildProposals, createExternalSender, DAVE_PROTOCOL_VERSION, decodeClientKeyPackage,
    encodeServerFrame, externalSenderPackage, parseClientFrame, splitCommitWelcome,
    withTransitionId, type ExternalSenderKey,
} from "./dave.js";
import { store } from "./store.js";
import { parseHeaderExtensions, TwccRecorder } from "./twcc.js";

const {
    NATIVE_STREAM_PUBLIC_IP = "",
    NATIVE_STREAM_UDP_PORT = "7883",
    NATIVE_STREAM_VIDEO_CODEC = "H264",
    // Sem espectador, pede vídeo mesmo assim (dá para testar só com quem transmite).
    NATIVE_STREAM_ALWAYS_WANT = "1",
    // Aceita qualquer usuário (sem checar a habilitação no hub). Só para teste.
    NATIVE_STREAM_ALLOW_ANY = "0",
    // Estimativa de banda (REMB) anunciada a quem transmite — teto do encoder.
    NATIVE_STREAM_REMB_BPS = "8000000",
    // ID da extensão transport-wide-cc no RTP do cliente (5 no Discord desktop atual);
    // vazio = detecta sozinho nos pacotes de vídeo.
    NATIVE_STREAM_TWCC_EXT_ID = "5",
    // JSON mesclado no op 4 (SESSION_DESCRIPTION); valor null remove o campo.
    // Ex.: {"dave_protocol_version":null,"secure_frames_version":null}
    NATIVE_STREAM_SESSION_OVERRIDE = "",
    // DAVE v1 (E2EE/MLS) — experimental, Phase 1. "1" liga: op 4 anuncia
    // dave_protocol_version 1 e o servidor entra como external sender (ver dave.ts).
    // Padrão desligado = comportamento atual (dave 0, sem MLS). Ver docs/DAVE.md.
    NATIVE_STREAM_DAVE = "0",
} = process.env;

const DAVE_ON = NATIVE_STREAM_DAVE === "1";

export const NATIVE_STREAM_PATH = "/dstream";
const UDP_PORT = Number(NATIVE_STREAM_UDP_PORT);
const HEARTBEAT_INTERVAL = 13750;
const MODE = "aead_aes256_gcm_rtpsize";
const FULL_HD_PIXELS = 1920 * 1080;
const STATS_INTERVAL_MS = 5000;

const OP = {
    IDENTIFY: 0, SELECT_PROTOCOL: 1, READY: 2, HEARTBEAT: 3, SESSION_DESCRIPTION: 4,
    SPEAKING: 5, HEARTBEAT_ACK: 6, RESUME: 7, HELLO: 8, CLIENTS_CONNECT: 11, VIDEO: 12,
    CLIENT_DISCONNECT: 13, MEDIA_SINK_WANTS: 15, VOICE_BACKEND_VERSION: 16, CLIENT_FLAGS: 18,
    CLIENT_PLATFORM: 20,
    // DAVE (JSON): transição de protocolo/epoch. Ver docs/DAVE.md.
    PREPARE_TRANSITION: 21, EXECUTE_TRANSITION: 22, TRANSITION_READY: 23, PREPARE_EPOCH: 24,
} as const;
/** Opcodes DAVE (E2EE/MLS), frames binários no gateway. Ver docs/DAVE.md. */
const DAVE_OP: Record<number, string> = {
    21: "PREPARE_TRANSITION", 22: "EXECUTE_TRANSITION", 23: "TRANSITION_READY",
    24: "PREPARE_EPOCH", 25: "MLS_EXTERNAL_SENDER", 26: "MLS_KEY_PACKAGE",
    27: "MLS_PROPOSALS", 28: "MLS_COMMIT_WELCOME", 29: "MLS_ANNOUNCE_COMMIT_TRANSITION",
    30: "MLS_WELCOME", 31: "MLS_INVALID_COMMIT_WELCOME",
};
/** Ops que o Discord manda com `seq` (despachos retomáveis). */
const SEQ_OPS = new Set<number>([OP.SPEAKING, OP.CLIENTS_CONNECT, OP.VIDEO, OP.CLIENT_DISCONNECT, OP.MEDIA_SINK_WANTS, OP.CLIENT_FLAGS, OP.CLIENT_PLATFORM, OP.PREPARE_TRANSITION, OP.EXECUTE_TRANSITION, OP.PREPARE_EPOCH]);

type VideoStream = Record<string, unknown> & { ssrc?: number; rtx_ssrc?: number; };

interface UdpStats { packets: number; bytes: number; byPt: Record<string, number>; forwarded: number; }

interface Member {
    ws: WebSocket;
    userId: string;
    room: Room;
    audioSsrc: number;
    videoSsrc: number;
    rtxSsrc: number;
    seq: number;
    streamer: boolean;
    /** op 12 anunciado por quem transmite (repassado aos espectadores). */
    video?: { audio_ssrc: number; video_ssrc: number; rtx_ssrc?: number; streams: VideoStream[]; };
    /** Pixels que este espectador quer do vídeo de quem transmite. */
    wantPixels: number;
    /** Destino para enviar a este membro: o último endereço de onde veio mídia (ou discovery). */
    udp?: RemoteInfo;
    /** Todos os endereços que fizeram IP discovery — o cliente pode descobrir por mais de um socket. */
    addrs: Set<string>;
    /** Feedback transport-cc para o que este membro envia. */
    twcc: TwccRecorder;
    twccExtId?: number;
    /** Detecção do ID: quantos pacotes trouxeram cada ID com 2 bytes. */
    extProbe: { packets: number; len2: Map<number, number>; seen: Map<number, number>; };
    stats: UdpStats;
    decryptedSamples: number;
    /** Key package MLS do cliente (op 26), guardado para as Add proposals (op 27). */
    daveKeyPackage?: Buffer;
    /** channel_id do IDENTIFY → group_id do MLS (BE8). */
    daveChannelId?: bigint;
    /** op 27 já enviado (evita comitar duas vezes). */
    daveProposalsSent?: boolean;
    /** Já entrou no grupo MLS (committer após solo commit; viewer após welcome). */
    daveJoined?: boolean;
    /** Debounce do Add do viewer (usa o ÚLTIMO key package). */
    daveAddTimer?: ReturnType<typeof setTimeout>;
    /** Pares (PT, ssrc) de vídeo já vistos (diag). */
    ptSsrc?: Set<string>;
    /** Maior seq recebido por ssrc, para os RTCP Receiver Reports. */
    seqBySsrc?: Map<number, { maxSeq: number; cycles: number; }>;
}

interface Room {
    id: string; key: Buffer; members: Map<string, Member>;
    /** Nonce dos pacotes que o servidor cifra. */ nonce: number;
    /** Último PLI enviado (throttle). */ lastPli?: number;
    /** External sender do DAVE para a sala (só com DAVE_ON). */ dave?: Promise<ExternalSenderKey>;
    /** Committer do grupo MLS (o 1º membro / transmissor). */ daveCommitter?: Member;
    /** Epoch atual do grupo (conta commits vistos). */ daveEpoch?: number;
    /** transition_id atual (incrementa por transição). */ daveTransition?: number;
    /** Viewer cujo Add está no op 27 pendente (aguarda o welcome). */ davePendingAdd?: Member;
}

const rooms = new Map<string, Room>();
const byAddr = new Map<string, Member>();
let nextSsrc = 1000;

export function nativeStreamEnabled(): boolean {
    return !!NATIVE_STREAM_PUBLIC_IP;
}

const log = (...a: unknown[]) => console.log("[dstream]", ...a);
const addrKey = (r: { address: string; port: number; }) => `${r.address}:${r.port}`;

// --- WS -------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

export function handleNativeStreamUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    wss.handleUpgrade(req, socket, head, ws => onConnection(ws, req));
}

function send(ws: WebSocket, op: number, d: unknown, m?: Member): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { op, d };
    if (m && SEQ_OPS.has(op)) msg.seq = m.seq++;
    ws.send(JSON.stringify(msg));
}

/** Envia um dispatch binário DAVE (op 25/27/29/30) — [seq u16][op][payload], seq compartilhado. */
function sendDave(m: Member, op: number, payload: Uint8Array): void {
    if (m.ws.readyState !== WebSocket.OPEN) return;
    m.ws.send(encodeServerFrame(m.seq++, op, payload));
}

/** op 25 (MLS_EXTERNAL_SENDER): anuncia o external sender da sala ao membro. */
function sendExternalSender(m: Member): void {
    m.room.dave?.then(es => {
        sendDave(m, 25, externalSenderPackage(es));
        // Transição inicial para DAVE v1 (transition_id 0, epoch 1). O cliente forma o grupo
        // solo, (re)gera key package e responde op 23 → aí executamos (op 22). Ver docs/DAVE.md.
        send(m.ws, OP.PREPARE_EPOCH, { protocol_version: DAVE_PROTOCOL_VERSION, epoch: 1 }, m);
        send(m.ws, OP.PREPARE_TRANSITION, { transition_id: 0, protocol_version: DAVE_PROTOCOL_VERSION }, m);
        log(`DAVE op25 + op24/op21 (external sender + prepare transition 0) → ${m.userId}`);
    }).catch(e => log("DAVE op25 falhou:", e));
}

/** Frames binários DAVE do cliente (op 26 key package, 28 commit/welcome, 23 ready, 31). */
function handleDaveBinary(m: Member, op: number, payload: Buffer): void {
    if (op === 26) {
        m.daveKeyPackage = payload;
        let info = "?(decode falhou)";
        try {
            const kp = decodeClientKeyPackage(payload);
            info = kp ? `cipher_suite=${kp.cipherSuite} credential=${kp.leafNode?.credential?.credentialType}` : info;
        } catch (e) { info = `?(erro: ${(e as Error).message})`; }
        log(`DAVE op26 (key package cru) de ${m.userId}: ${payload.length}B ${info}`);
        const room = m.room;
        if (!room.dave || m.daveChannelId === undefined) return;
        if (!room.daveCommitter) {
            // 1º membro = committer. op 27 vazio → comita o próprio grupo (solo bootstrap).
            room.daveCommitter = m; room.daveEpoch = 0; room.daveTransition = 0;
            if (!m.daveProposalsSent) {
                m.daveProposalsSent = true;
                const chId = m.daveChannelId;
                room.dave.then(es => buildProposals(es, chId, 0n, []))
                    .then(op27 => { sendDave(m, 27, op27); log(`DAVE op27 (solo, 0 add) → ${m.userId} ${op27.length}B`); })
                    .catch(e => log("DAVE op27 (solo) falhou:", e));
            }
        } else if (m !== room.daveCommitter && !m.daveJoined) {
            // Viewer: o cliente descarta a chave privada do key package anterior a cada op 26,
            // então usamos o ÚLTIMO (debounce, pega depois dos 2 iniciais). Só então op 27.
            if (m.daveAddTimer) clearTimeout(m.daveAddTimer);
            m.daveAddTimer = setTimeout(() => {
                const committer = room.daveCommitter;
                const chId = committer?.daveChannelId ?? m.daveChannelId;
                const kp = m.daveKeyPackage;
                if (!committer || chId === undefined || !kp || !room.dave) return;
                const epoch = BigInt(room.daveEpoch ?? 0);
                room.davePendingAdd = m;
                room.dave.then(es => buildProposals(es, chId, epoch, [kp]))
                    .then(op27 => { sendDave(committer, 27, op27); log(`DAVE op27 (add viewer ${m.userId}, epoch ${epoch}) → committer ${committer.userId} ${op27.length}B`); })
                    .catch(e => { room.davePendingAdd = undefined; log("DAVE op27 (viewer) falhou:", e); });
            }, 400);
        }
        return;
    }
    if (op === 28) {
        const room = m.room;
        const { commit, welcome } = splitCommitWelcome(payload);
        const tid = room.daveTransition ?? 0;
        const op29 = withTransitionId(tid, commit);
        for (const o of room.members.values()) if (o.daveJoined || o === room.daveCommitter) sendDave(o, 29, op29);
        log(`DAVE op29 (announce commit, tid ${tid}) → grupo ${op29.length}B`);
        if (welcome && room.davePendingAdd) {
            sendDave(room.davePendingAdd, 30, withTransitionId(tid, welcome));
            log(`DAVE op30 (welcome, tid ${tid}) → viewer ${room.davePendingAdd.userId}`);
            room.davePendingAdd.daveJoined = true;
            room.davePendingAdd = undefined;
        }
        m.daveJoined = true;
        room.daveEpoch = (room.daveEpoch ?? 0) + 1;
        room.daveTransition = tid + 1;
        return;
    }
    log(`DAVE C→S op ${op} (${DAVE_OP[op] ?? "?"}) ${payload.length}B — não tratado (TODO Phase 1)`);
}

function onConnection(ws: WebSocket, req: IncomingMessage): void {
    log("conexão", req.url, req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress);
    let member: Member | null = null;

    send(ws, OP.HELLO, { v: 8, heartbeat_interval: HEARTBEAT_INTERVAL });

    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            // Frame binário C→S = DAVE/MLS: [op u8][payload] (sem seq no sentido cliente→servidor).
            const { op, payload } = parseClientFrame(raw as Buffer);
            if (DAVE_ON && member) { handleDaveBinary(member, op, payload); return; }
            log(`DAVE C→S op ${op} (${DAVE_OP[op] ?? "?"}) ${(raw as Buffer).length}B — não tratado`);
            return;
        }
        let msg: { op: number; d: any; };
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.op === OP.IDENTIFY) { member = identify(ws, msg.d); return; }
        if (msg.op === OP.HEARTBEAT) { send(ws, OP.HEARTBEAT_ACK, { t: msg.d?.t }); return; }
        // Sem resume no PoC: 4006 faz o cliente refazer o identify na hora.
        if (msg.op === OP.RESUME) { ws.close(4006, "Session no longer valid."); return; }
        if (!member) { ws.close(4003, "Not authenticated."); return; }
        onMessage(member, msg.op, msg.d);
    });

    ws.on("close", (code, reason) => {
        if (member) leave(member);
        log("fechou", member?.userId ?? "-", code, reason.toString());
    });
}

function identify(ws: WebSocket, d: any): Member | null {
    const userId = String(d?.user_id ?? "");
    const roomId = String(d?.server_id ?? "");
    if (!userId || !roomId) { ws.close(4001, "Invalid identify."); return null; }
    if (NATIVE_STREAM_ALLOW_ANY !== "1" && !store.get(userId)?.enabled) {
        log("recusado (não habilitado no hub):", userId);
        ws.close(4004, "Authentication failed.");
        return null;
    }

    let room = rooms.get(roomId);
    if (!room) { room = { id: roomId, key: randomBytes(32), members: new Map(), nonce: 0 }; rooms.set(roomId, room); }
    if (DAVE_ON) room.dave ??= createExternalSender();
    room.members.get(userId)?.ws.close(4005, "Replaced.");

    const base = nextSsrc; nextSsrc += 3;
    const m: Member = {
        ws, userId, room, audioSsrc: base, videoSsrc: base + 1, rtxSsrc: base + 2, seq: 0,
        streamer: false, wantPixels: 0, stats: { packets: 0, bytes: 0, byPt: {}, forwarded: 0 }, decryptedSamples: 0,
        addrs: new Set(),
        twcc: new TwccRecorder(),
        twccExtId: NATIVE_STREAM_TWCC_EXT_ID ? Number(NATIVE_STREAM_TWCC_EXT_ID) : undefined,
        extProbe: { packets: 0, len2: new Map(), seen: new Map() },
    };
    room.members.set(userId, m);
    try { m.daveChannelId = BigInt(String(d?.channel_id ?? "0")); } catch { /* channel_id inválido */ }
    log(`identify ${userId} na sala ${roomId} (${room.members.size} na sala) streams=${JSON.stringify(d?.streams)} dave=${d?.max_dave_protocol_version}`);

    send(ws, OP.READY, {
        ssrc: m.audioSsrc,
        ip: NATIVE_STREAM_PUBLIC_IP,
        port: UDP_PORT,
        modes: [MODE],
        experiments: [],
        streams: [{ type: "video", ssrc: m.videoSsrc, rtx_ssrc: m.rtxSsrc, rid: "100", quality: 100, active: false }],
    });

    // Apresenta quem já está na sala (como o Discord faz para o espectador).
    const others = [...room.members.values()].filter(o => o !== m);
    if (others.length) send(ws, OP.CLIENTS_CONNECT, { user_ids: others.map(o => o.userId) }, m);
    for (const o of others) {
        send(ws, OP.CLIENT_FLAGS, { user_id: o.userId, flags: 0 }, m);
        send(ws, OP.CLIENT_PLATFORM, { user_id: o.userId, platform: null }, m);
        if (o.video) {
            send(ws, OP.SPEAKING, { user_id: o.userId, ssrc: o.video.audio_ssrc, speaking: 2 }, m);
            send(ws, OP.VIDEO, { user_id: o.userId, ...o.video }, m);
        }
        send(o.ws, OP.CLIENTS_CONNECT, { user_ids: [m.userId] }, o);
    }
    return m;
}

function onMessage(m: Member, op: number, d: any): void {
    switch (op) {
        case OP.VOICE_BACKEND_VERSION:
            send(m.ws, OP.VOICE_BACKEND_VERSION, { voice: "0.22.1", rtc_worker: "1.6.92" });
            break;

        case OP.SELECT_PROTOCOL:
            log(`select_protocol ${m.userId} mode=${d?.mode} codecs=${JSON.stringify((d?.codecs ?? []).map((c: any) => ({ name: c.name, pt: c.payload_type, rtx: c.rtx_payload_type, enc: c.encode, dec: c.decode })))}`);
            send(m.ws, OP.SESSION_DESCRIPTION, sessionDescription(m));
            sendWants(m);
            if (DAVE_ON) sendExternalSender(m);
            break;

        case OP.VIDEO: {
            const video = {
                audio_ssrc: Number(d?.audio_ssrc ?? m.audioSsrc),
                video_ssrc: Number(d?.video_ssrc ?? 0),
                rtx_ssrc: Number(d?.rtx_ssrc ?? 0),
                streams: (d?.streams ?? []) as VideoStream[],
            };
            m.streamer = video.video_ssrc > 0 || video.streams.some(s => s.active);
            m.video = video;
            log(`video ${m.userId} streamer=${m.streamer} op12=${JSON.stringify(d)}`);
            for (const o of peers(m)) send(o.ws, OP.VIDEO, { user_id: m.userId, ...video }, o);
            sendWants(m);
            break;
        }

        case OP.SPEAKING:
            for (const o of peers(m)) send(o.ws, OP.SPEAKING, { user_id: m.userId, ssrc: d?.ssrc ?? m.audioSsrc, speaking: d?.speaking ?? 0 }, o);
            break;

        case OP.MEDIA_SINK_WANTS: {
            const counts = Object.values((d?.pixelCounts ?? {}) as Record<string, number>).map(Number);
            m.wantPixels = counts.length ? Math.max(...counts) : 0;
            log(`sink_wants ${m.userId} → ${m.wantPixels}px ${JSON.stringify(d)}`);
            for (const o of peers(m)) if (o.streamer) sendWants(o);
            // Espectador quer vídeo: força um keyframe no transmissor, senão o receptor
            // entra no meio do GOP e estoura em video-stream-receiver-ready-timeout (Erro 2012).
            if (!m.streamer && m.wantPixels > 0) requestKeyframe(m.room);
            break;
        }

        case OP.TRANSITION_READY:
            // Cliente pronto para a transição → executa (op 22). Só ocorre com DAVE_ON.
            log(`DAVE op23 (transition_ready) de ${m.userId} tid=${d?.transition_id}`);
            send(m.ws, OP.EXECUTE_TRANSITION, { transition_id: d?.transition_id ?? 0 }, m);
            // Novo epoch → o transmissor re-chaveia e PAUSA a mídia. Re-ativa o encoder no
            // epoch novo: re-envia o sink want (pixels) e pede um keyframe fresco, com um
            // pequeno delay para a transição assentar dos dois lados.
            {
                const room = m.room;
                setTimeout(() => {
                    for (const o of room.members.values()) if (o.streamer) sendWants(o);
                    requestKeyframe(room);
                }, 600);
            }
            break;

        case OP.RESUME:
            m.ws.close(4006, "Session no longer valid."); // sem resume no PoC → cliente refaz o identify
            break;

        default:
            log(`op ${op} de ${m.userId} (não tratado)`, JSON.stringify(d)?.slice(0, 300));
    }
}

function sessionDescription(m: Member): Record<string, unknown> {
    const d: Record<string, unknown> = {
        audio_codec: "opus",
        video_codec: NATIVE_STREAM_VIDEO_CODEC,
        mode: MODE,
        secret_key: [...m.room.key],
        media_session_id: randomBytes(16).toString("hex"),
        dave_protocol_version: DAVE_ON ? DAVE_PROTOCOL_VERSION : 0,
        secure_frames_version: DAVE_ON ? 1 : 0,
    };
    if (NATIVE_STREAM_SESSION_OVERRIDE) {
        try {
            for (const [k, v] of Object.entries(JSON.parse(NATIVE_STREAM_SESSION_OVERRIDE) as Record<string, unknown>)) {
                if (v === null) delete d[k]; else d[k] = v;
            }
        } catch (e) {
            log("NATIVE_STREAM_SESSION_OVERRIDE inválido:", e);
        }
    }
    log(`session_description ${m.userId}: ${JSON.stringify({ ...d, secret_key: "[32]" })}`);
    return d;
}

/** op 15 para quem transmite: quantos pixels os espectadores querem (0 = encoder parado). */
function sendWants(m: Member): void {
    if (!m.streamer || !m.video) return;
    const viewers = peers(m);
    let px = Math.max(0, ...viewers.map(v => v.wantPixels));
    if (!px && NATIVE_STREAM_ALWAYS_WANT === "1") px = FULL_HD_PIXELS;
    // Clampa ao máximo que o encoder anunciou (max_resolution do op12) — pedir mais pixels
    // que o teto parece deixar o encoder em resolution 0×0 (real nunca pede acima do máx).
    const mr = m.video.streams[0]?.max_resolution as { width?: number; height?: number; } | undefined;
    if (mr?.width && mr?.height) px = Math.min(px, mr.width * mr.height);
    // Formato real do Discord (capturado, ver docs/DAVE.md): a qualidade por-ssrc e o
    // `any` são 100; a contagem de pixels vai SÓ em pixelCounts. (O sink want não é o que
    // destrava o bitrateTarget — isso depende do DAVE; ver docs/DAVE.md.)
    const ssrc = m.video.video_ssrc;
    send(m.ws, OP.MEDIA_SINK_WANTS, { any: 100, [ssrc]: px ? 100 : 0, pixelCounts: { [ssrc]: px } }, m);
}

function peers(m: Member): Member[] {
    return [...m.room.members.values()].filter(o => o !== m);
}

function leave(m: Member): void {
    const { room } = m;
    if (room.members.get(m.userId) !== m) return;
    room.members.delete(m.userId);
    for (const a of m.addrs) byAddr.delete(a);
    for (const o of room.members.values()) {
        send(o.ws, OP.CLIENT_DISCONNECT, { user_id: m.userId }, o);
        if (o.streamer) sendWants(o);
    }
    if (!room.members.size) rooms.delete(room.id);
}

// --- UDP ------------------------------------------------------------------------

const udp = createSocket("udp4");

function findBySsrc(ssrc: number): Member | undefined {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) if (m.audioSsrc === ssrc) return m;
    }
    return undefined;
}

/** Acha o membro dono de qualquer ssrc (áudio/vídeo/rtx, atribuído ou reportado no op 12). */
function findByAnySsrc(ssrc: number): Member | undefined {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) {
            if (m.audioSsrc === ssrc || m.videoSsrc === ssrc || m.rtxSsrc === ssrc) return m;
            const v = m.video;
            if (v && (v.audio_ssrc === ssrc || v.video_ssrc === ssrc || v.rtx_ssrc === ssrc)) return m;
        }
    }
    return undefined;
}

/** IP discovery: [type u16=1][len u16=70][ssrc u32][address 64][port u16] → responde type 2 com o endereço visto. */
function ipDiscovery(msg: Buffer, rinfo: RemoteInfo): boolean {
    if (msg.length !== 74 || msg.readUInt16BE(0) !== 1) return false;
    const ssrc = msg.readUInt32BE(4);
    const m = findBySsrc(ssrc);
    if (!m) { log(`ip discovery de ssrc desconhecido ${ssrc} (${addrKey(rinfo)})`); return true; }
    m.udp ??= rinfo;
    m.addrs.add(addrKey(rinfo));
    byAddr.set(addrKey(rinfo), m);

    const res = Buffer.alloc(74);
    res.writeUInt16BE(2, 0);
    res.writeUInt16BE(70, 2);
    res.writeUInt32BE(ssrc, 4);
    res.write(rinfo.address, 8, 64, "utf8");
    res.writeUInt16BE(rinfo.port, 72);
    udp.send(res, rinfo.port, rinfo.address);
    log(`ip discovery ${m.userId} ← ${addrKey(rinfo)}`);
    return true;
}

/** Tipo do pacote: "rtcp:<pt>", "pt<n>" (RTP) ou "other". */
function classify(msg: Buffer): string {
    if (msg.length < 12 || (msg[0] >> 6) !== 2) return "other";
    const pt = msg[1];
    if (pt >= 192 && pt <= 223) return `rtcp:${pt}`;
    return `pt${pt & 0x7f}`;
}

/**
 * Abre um RTP aead_aes256_gcm_rtpsize: AAD = cabeçalho fixo + CSRCs + 4 bytes do
 * cabeçalho de extensão; nonce = 4 bytes finais (IV = nonce + 8 zeros); tag = 16
 * bytes antes do nonce. O corpo da extensão vem cifrado junto com o payload.
 */
function openRtp(msg: Buffer, key: Buffer): { exts: Map<number, Buffer>; payload: Buffer; } | null {
    try {
        const cc = msg[0] & 0x0f;
        const hasExt = !!(msg[0] & 0x10);
        const extHdr = 12 + cc * 4;
        const aadLen = extHdr + (hasExt ? 4 : 0);
        const nonce = msg.subarray(msg.length - 4);
        const tag = msg.subarray(msg.length - 20, msg.length - 4);
        const d = createDecipheriv("aes-256-gcm", key, Buffer.concat([nonce, Buffer.alloc(8)]));
        d.setAAD(msg.subarray(0, aadLen));
        d.setAuthTag(tag);
        const plain = Buffer.concat([d.update(msg.subarray(aadLen, msg.length - 20)), d.final()]);
        if (!hasExt) return { exts: new Map(), payload: plain };
        const extLen = msg.readUInt16BE(extHdr + 2) * 4;
        return {
            exts: parseHeaderExtensions(msg.readUInt16BE(extHdr), plain.subarray(0, extLen)),
            payload: plain.subarray(extLen),
        };
    } catch {
        return null;
    }
}

const nowUs = () => Number(process.hrtime.bigint() / 1000n);

/**
 * Registra a chegada para o transport-cc. Sem ID configurado, detecta nos pacotes
 * de VÍDEO/RTX — o áudio (opus) do cliente não carrega a extensão transport-wide.
 */
function trackTwcc(m: Member, exts: Map<number, Buffer>, arrivalUs: number, isAudio: boolean): void {
    if (m.twccExtId === undefined) {
        if (isAudio) return;
        const p = m.extProbe;
        p.packets++;
        for (const [id, v] of exts) {
            p.seen.set(id, v.length);
            if (v.length === 2) p.len2.set(id, (p.len2.get(id) ?? 0) + 1);
        }
        if (p.packets < 20) return;
        const hit = [...p.len2].find(([, n]) => n >= p.packets * 0.9);
        log(`extensões RTP (vídeo) de ${m.userId}: ${JSON.stringify(Object.fromEntries(p.seen))} → transport-cc id=${hit?.[0] ?? "não encontrado"}`);
        if (hit) m.twccExtId = hit[0];
        else m.extProbe = { packets: 0, len2: new Map(), seen: new Map() }; // tenta de novo
        return;
    }
    const v = exts.get(m.twccExtId);
    if (v?.length === 2) m.twcc.record(v.readUInt16BE(0), arrivalUs);
}

function diagnose(m: Member, plain: Buffer | undefined, kind: string, ssrc: number): void {
    const pt = Number(kind.slice(2));
    if (pt === 120 || m.decryptedSamples >= 5) return; // opus não interessa aqui
    m.decryptedSamples++;
    const codec = ({ 103: "H265", 104: "H265", 105: "H264", 107: "VP8" } as Record<number, string>)[pt] ?? `pt${pt}`;
    if (!plain) { log(`decifrar ${codec} ssrc ${ssrc} de ${m.userId}: FALHOU (chave/layout errado?)`); return; }
    const dave = plain.length >= 2 && plain.readUInt16BE(plain.length - 2) === 0xfafa;
    log(`decifrou ${codec} ssrc ${ssrc} de ${m.userId}: ${plain.length}B dave=${dave} head=${plain.subarray(0, 8).toString("hex")}`);
}

udp.on("message", (msg, rinfo) => {
    if (ipDiscovery(msg, rinfo)) return;
    let m = byAddr.get(addrKey(rinfo));
    if (!m) {
        // O cliente Discord usa 2 sockets UDP (mídia e RTX). Um pode não ter feito IP discovery;
        // associa pelo ssrc RTP (cabeçalho em claro no rtpsize) para não descartar o vídeo.
        if (msg.length >= 12 && (msg[0] >> 6) === 2) {
            m = findByAnySsrc(msg.readUInt32BE(8));
            if (m) {
                byAddr.set(addrKey(rinfo), m);
                m.addrs.add(addrKey(rinfo));
                log(`novo socket de ${m.userId}: pt${msg[1] & 0x7f} ssrc ${msg.readUInt32BE(8)} ← ${addrKey(rinfo)}`);
            }
        }
        if (!m) return;
    }

    // Keepalive do cliente (8 bytes, contador u64): vem do socket primário → o eco e o
    // destino de feedback (REMB/RR/PLI) vão para ele.
    if (msg.length === 8) {
        m.udp = rinfo;
        udp.send(msg, rinfo.port, rinfo.address);
        m.stats.byPt.keepalive = (m.stats.byPt.keepalive ?? 0) + 1;
        return;
    }

    const kind = classify(msg);
    // O feedback vai para o socket PRIMÁRIO (áudio/vídeo/RTCP), nunca para o socket de RTX
    // (senão REMB/RR não são processados). Identifica o primário pelos ssrcs conhecidos.
    const ssrc0 = (msg[0] >> 6) === 2 && msg.length >= 12 ? msg.readUInt32BE(8) : 0;
    const isPrimary = kind.startsWith("rtcp") || ssrc0 === m.audioSsrc || ssrc0 === m.videoSsrc
        || ssrc0 === (m.video?.audio_ssrc ?? -1) || ssrc0 === (m.video?.video_ssrc ?? -1);
    if (isPrimary || !m.udp) m.udp = rinfo;

    m.stats.packets++;
    m.stats.bytes += msg.length;
    m.stats.byPt[kind] = (m.stats.byPt[kind] ?? 0) + 1;
    if (kind.startsWith("pt")) {
        const rtp = openRtp(msg, m.room.key);
        if (rtp) trackTwcc(m, rtp.exts, nowUs(), kind === "pt120");
        trackSeq(m, ssrc0, msg.readUInt16BE(2));
        diagnose(m, rtp?.payload, kind, msg.readUInt32BE(8));
        // Log dos pares (PT, ssrc) distintos que este membro envia (diag do relay de vídeo).
        if (kind !== "pt120") {
            const combo = `${kind}:${msg.readUInt32BE(8)}`;
            (m.ptSsrc ??= new Set());
            if (!m.ptSsrc.has(combo)) { m.ptSsrc.add(combo); log(`envia ${m.userId}: ${combo} (m bit=${(msg[1] >> 7) & 1})`); }
        }
    } else if (!m.streamer && msg[1] === 205 && (msg[0] & 0x1f) === 15) {
        return; // transport-cc do espectador: quem dá o feedback a quem transmite é o servidor
    }

    // Quem transmite → todos; espectador → só quem transmite (RTCP: NACK/PLI/RR).
    const targets = m.streamer ? peers(m) : peers(m).filter(o => o.streamer);
    for (const o of targets) {
        if (!o.udp) continue;
        udp.send(msg, o.udp.port, o.udp.address);
        m.stats.forwarded++;
    }
});

// --- RTCP do servidor ------------------------------------------------------------
//
// O nativo limita o vídeo pela estimativa de banda que o RECEPTOR informa
// (stats: receiverBitrateEstimate). Sem ela a meta do encoder fica 0 e todo
// quadro é descartado (framesDroppedEncoderQueue) — o áudio não depende disso.
// O servidor do Discord manda esse feedback; nós mandamos um REMB periódico.

const SERVER_SSRC = 1;
const REMB_INTERVAL_MS = 1000;

/** RTCP cifrado no modo rtpsize: AAD = 8 bytes de cabeçalho; depois cifra + tag(16) + nonce(4). */
function encryptRtcp(plain: Buffer, room: Room): Buffer {
    room.nonce = (room.nonce + 1) >>> 0;
    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(room.nonce);
    const c = createCipheriv("aes-256-gcm", room.key, Buffer.concat([nonce, Buffer.alloc(8)]));
    c.setAAD(plain.subarray(0, 8));
    const enc = Buffer.concat([c.update(plain.subarray(8)), c.final()]);
    return Buffer.concat([plain.subarray(0, 8), enc, c.getAuthTag(), nonce]);
}

/** PSFB (206) FMT 15 "REMB": bitrate = mantissa(18 bits) << exp(6 bits). */
function buildRemb(bps: number, ssrcs: number[]): Buffer {
    let exp = 0;
    let mantissa = Math.max(0, Math.floor(bps));
    while (mantissa > 0x3ffff) { mantissa >>>= 1; exp++; }
    const b = Buffer.alloc(20 + 4 * ssrcs.length);
    b[0] = 0x80 | 15;
    b[1] = 206;
    b.writeUInt16BE(b.length / 4 - 1, 2);
    b.writeUInt32BE(SERVER_SSRC, 4);
    b.writeUInt32BE(0, 8); // media SSRC: sempre 0 no REMB
    b.write("REMB", 12, "ascii");
    b.writeUInt32BE(((ssrcs.length & 0xff) << 24 | (exp & 0x3f) << 18 | mantissa) >>> 0, 16);
    ssrcs.forEach((ssrc, i) => b.writeUInt32BE(ssrc >>> 0, 20 + 4 * i));
    return b;
}

/** PLI (PSFB 206, FMT 1): pede um keyframe ao transmissor. media ssrc = ssrc do vídeo dele. */
function buildPli(videoSsrc: number): Buffer {
    const b = Buffer.alloc(12);
    b[0] = 0x80 | 1; // V=2, FMT=1 (PLI)
    b[1] = 206;      // PSFB
    b.writeUInt16BE(2, 2); // length em words - 1
    b.writeUInt32BE(SERVER_SSRC, 4);
    b.writeUInt32BE(videoSsrc >>> 0, 8);
    return b;
}

/**
 * Pede um keyframe aos transmissores da sala (novo espectador / voltou a querer vídeo).
 * Rajada de 3 (0/400/1000ms) porque o relay UDP hairpin perde o primeiro; throttle 1/s.
 */
function requestKeyframe(room: Room): void {
    const now = Date.now();
    if (now - (room.lastPli ?? 0) < 1000) return;
    room.lastPli = now;
    for (const s of room.members.values()) {
        if (!s.streamer || !s.udp || !s.video?.video_ssrc) continue;
        const ssrc = s.video.video_ssrc;
        const fire = () => { if (s.udp) udp.send(encryptRtcp(buildPli(ssrc), room), s.udp.port, s.udp.address); };
        log(`pli → ${s.userId} (video ssrc ${ssrc})`);
        fire();
        setTimeout(fire, 400).unref();
        setTimeout(fire, 1000).unref();
    }
}

/** RTCP Receiver Report (PT 201): confirma ao transmissor que recebemos a mídia dele. */
function buildRr(senderSsrc: number, blocks: { ssrc: number; extHighestSeq: number; }[]): Buffer {
    const b = Buffer.alloc(8 + blocks.length * 24);
    b[0] = 0x80 | (blocks.length & 0x1f); // V=2, RC=nº de blocos
    b[1] = 201; // RR
    b.writeUInt16BE(b.length / 4 - 1, 2);
    b.writeUInt32BE(senderSsrc >>> 0, 4);
    let o = 8;
    for (const blk of blocks) {
        b.writeUInt32BE(blk.ssrc >>> 0, o);       // ssrc do source
        b.writeUInt32BE(0, o + 4);                 // fraction lost (0) | cumulative lost (0)
        b.writeUInt32BE(blk.extHighestSeq >>> 0, o + 8);
        b.writeUInt32BE(0, o + 12);                // jitter
        b.writeUInt32BE(0, o + 16);                // LSR
        b.writeUInt32BE(0, o + 20);                // DLSR
        o += 24;
    }
    return b;
}

/** Atualiza o maior seq recebido para um ssrc (com detecção simples de wrap). */
function trackSeq(m: Member, ssrc: number, seq: number): void {
    (m.seqBySsrc ??= new Map());
    const s = m.seqBySsrc.get(ssrc);
    if (!s) { m.seqBySsrc.set(ssrc, { maxSeq: seq, cycles: 0 }); return; }
    if (seq > s.maxSeq) s.maxSeq = seq;
    else if (s.maxSeq - seq > 0x8000) { s.cycles = (s.cycles + 1) & 0xffff; s.maxSeq = seq; }
}

const RR_INTERVAL_MS = 1000;
const TWCC_INTERVAL_MS = 100;

setInterval(() => {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) {
            if (!m.udp || m.twccExtId === undefined) continue;
            const fb = m.twcc.build(SERVER_SSRC, m.audioSsrc);
            if (fb) udp.send(encryptRtcp(fb, room), m.udp.port, m.udp.address);
        }
    }
}, TWCC_INTERVAL_MS).unref();

setInterval(() => {
    const bps = Number(NATIVE_STREAM_REMB_BPS);
    for (const room of rooms.values()) {
        for (const m of room.members.values()) {
            if (!m.streamer || !m.udp || !m.video?.video_ssrc) continue;
            const ssrcs = [m.video.video_ssrc, ...(m.video.rtx_ssrc ? [m.video.rtx_ssrc] : [])];
            udp.send(encryptRtcp(buildRemb(bps, ssrcs), room), m.udp.port, m.udp.address);
        }
    }
}, REMB_INTERVAL_MS).unref();

setInterval(() => {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) {
            if (!m.udp || !m.seqBySsrc?.size) continue;
            const blocks = [...m.seqBySsrc.entries()].map(([ssrc, s]) => ({ ssrc, extHighestSeq: (s.cycles << 16) | s.maxSeq }));
            udp.send(encryptRtcp(buildRr(SERVER_SSRC, blocks), room), m.udp.port, m.udp.address);
        }
    }
}, RR_INTERVAL_MS).unref();

setInterval(() => {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) {
            if (!m.stats.packets) continue;
            const kbps = Math.round((m.stats.bytes * 8) / STATS_INTERVAL_MS);
            log(`udp ${m.userId}${m.streamer ? " (transmite)" : ""}: ${m.stats.packets} pkts ${kbps} kbps repassados=${m.stats.forwarded} ${JSON.stringify(m.stats.byPt)}`);
            m.stats = { packets: 0, bytes: 0, byPt: {}, forwarded: 0 };
        }
    }
}, STATS_INTERVAL_MS).unref();

export function startNativeStreamUdp(): void {
    udp.bind(UDP_PORT, () => log(`UDP ouvindo em ${UDP_PORT} (anunciado como ${NATIVE_STREAM_PUBLIC_IP}:${UDP_PORT}), WS em ${NATIVE_STREAM_PATH}`));
}
