
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createSocket, type RemoteInfo } from "node:dgram";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import {
    buildProposals, createExternalSender, DAVE_PROTOCOL_VERSION, decodeClientKeyPackage, decodeMls,
    encodeServerFrame, externalSenderPackage, parseClientFrame, splitCommitWelcome,
    withTransitionId, type DaveProposalOp, type ExternalSenderKey,
} from "./dave.js";
import { gatewayEnabled, voiceLocation } from "./botGateway.js";
import { botConfigured, resolveChannelNames } from "./discord.js";
import { store } from "./store.js";
import { parseHeaderExtensions, TwccRecorder } from "./twcc.js";

const {
    NATIVE_STREAM_PUBLIC_IP = "",
    NATIVE_STREAM_UDP_PORT = "7883",
    NATIVE_STREAM_VIDEO_CODEC = "",
    NATIVE_STREAM_EXPERIMENTS = "fixed_keyframe_interval",
    NATIVE_STREAM_KEYFRAME_INTERVAL = "2000",
    NATIVE_STREAM_ALWAYS_WANT = "1",
    NATIVE_STREAM_ALLOW_ANY = "0",
    NATIVE_STREAM_REMB_BPS = "8000000",
    NATIVE_STREAM_TWCC_EXT_ID = "5",
    NATIVE_STREAM_SESSION_OVERRIDE = "",
    NATIVE_STREAM_DAVE = "0",
    NATIVE_STREAM_NO_VIDEO = "0",
} = process.env;

const DAVE_ON = NATIVE_STREAM_DAVE === "1";
const NO_VIDEO = NATIVE_STREAM_NO_VIDEO === "1";
const STREAM_EXPERIMENTS = NATIVE_STREAM_EXPERIMENTS.split(",").map(s => s.trim()).filter(Boolean);

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
    PREPARE_TRANSITION: 21, EXECUTE_TRANSITION: 22, TRANSITION_READY: 23, PREPARE_EPOCH: 24,
} as const;
const DAVE_OP: Record<number, string> = {
    21: "PREPARE_TRANSITION", 22: "EXECUTE_TRANSITION", 23: "TRANSITION_READY",
    24: "PREPARE_EPOCH", 25: "MLS_EXTERNAL_SENDER", 26: "MLS_KEY_PACKAGE",
    27: "MLS_PROPOSALS", 28: "MLS_COMMIT_WELCOME", 29: "MLS_ANNOUNCE_COMMIT_TRANSITION",
    30: "MLS_WELCOME", 31: "MLS_INVALID_COMMIT_WELCOME",
};
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
    streamerSince?: number;
    video?: { audio_ssrc: number; video_ssrc: number; rtx_ssrc?: number; streams: VideoStream[]; };
    clientCodecs?: { name: string; encode: boolean; priority: number; }[];
    wantPixels: number;
    udp?: RemoteInfo;
    addrs: Set<string>;
    twcc: TwccRecorder;
    twccExtId?: number;
    extProbe: { packets: number; len2: Map<number, number>; seen: Map<number, number>; };
    stats: UdpStats;
    decryptedSamples: number;
    daveKeyPackage?: Buffer;
    channelId?: string;
    guildId?: string;
    daveChannelId?: bigint;
    daveProposalsSent?: boolean;
    daveJoined?: boolean;
    daveLeaf?: number;
    daveAddTimer?: ReturnType<typeof setTimeout>;
    ptSsrc?: Set<string>;
    seqBySsrc?: Map<number, { maxSeq: number; cycles: number; }>;
}

type DaveProposal =
    | { kind: "bootstrap"; chId: bigint }
    | { kind: "add"; member: Member; chId: bigint }
    | { kind: "remove"; leaf: number; chId: bigint };

interface Room {
    id: string; key: Buffer; members: Map<string, Member>;
 nonce: number;
 lastPli?: number;
 dave?: Promise<ExternalSenderKey>;
 daveCommitter?: Member;
 daveEpoch?: number;
 daveTransition?: number;
 daveBootstrapped?: boolean;
 daveQueue?: DaveProposal[];
 daveInFlight?: DaveProposal;
 daveInFlightTimer?: ReturnType<typeof setTimeout>;
    daveReady?: { tid: number; users: Set<string>; };
    daveReadyTimer?: ReturnType<typeof setTimeout>;
    daveNextLeaf?: number;
    daveFreeLeaves?: number[];
}

const rooms = new Map<string, Room>();
const byAddr = new Map<string, Member>();
let nextSsrc = 1000;

export function nativeStreamEnabled(): boolean {
    return !!NATIVE_STREAM_PUBLIC_IP;
}

export function nativeStreamPublicIp(): string {
    return NATIVE_STREAM_PUBLIC_IP;
}

export function getLiveState(): { roomId: string; members: { userId: string; streamer: boolean; channelId?: string; guildId?: string; since?: number; }[]; streamers: number; viewers: number; }[] {
    const out = [];
    for (const [roomId, room] of rooms) {
        const members = [...room.members.values()].map(m => ({ userId: m.userId, streamer: m.streamer, channelId: m.channelId, guildId: m.guildId, since: m.streamer ? m.streamerSince : undefined }));
        out.push({
            roomId,
            members,
            streamers: members.filter(x => x.streamer).length,
            viewers: members.filter(x => !x.streamer).length,
        });
    }
    return out;
}

export function closeMembersInChannel(channelId: string, userId?: string): number {
    let closed = 0;
    for (const room of [...rooms.values()]) {
        for (const m of [...room.members.values()]) {
            if (m.channelId !== channelId || (userId && m.userId !== userId)) continue;
            log(`derrubado ${m.userId} canal ${channelId}${userId ? " (banido)" : " (canal desabilitado)"}`);
            leave(m);
            m.ws.close(4004, "Authentication failed.");
            closed++;
        }
    }
    return closed;
}

const log = (...a: unknown[]) => console.log("[dstream]", ...a);
const addrKey = (r: { address: string; port: number; }) => `${r.address}:${r.port}`;

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

function sendDave(m: Member, op: number, payload: Uint8Array): void {
    if (m.ws.readyState !== WebSocket.OPEN) return;
    m.ws.send(encodeServerFrame(m.seq++, op, payload));
}

function sendExternalSender(m: Member): void {
    m.room.dave?.then(es => {
        sendDave(m, 25, externalSenderPackage(es));
        sendDavePrepare(m);
        log(`DAVE op25 + op24/op21 (external sender + prepare transition 0) → ${m.userId}`);
    }).catch(e => log("DAVE op25 falhou:", e));
}

function sendDavePrepare(m: Member): void {
    send(m.ws, OP.PREPARE_EPOCH, { protocol_version: DAVE_PROTOCOL_VERSION, epoch: 1 }, m);
    send(m.ws, OP.PREPARE_TRANSITION, { transition_id: 0, protocol_version: DAVE_PROTOCOL_VERSION }, m);
}

function daveRecipients(room: Room): Member[] {
    return [...room.members.values()].filter(o => o.daveJoined || (o === room.daveCommitter && !room.daveBootstrapped));
}

function allocDaveLeaf(room: Room): number {
    const free = room.daveFreeLeaves ?? (room.daveFreeLeaves = []);
    if (free.length) return free.shift()!;
    const leaf = room.daveNextLeaf ?? 0;
    room.daveNextLeaf = leaf + 1;
    return leaf;
}

function freeDaveLeaf(room: Room, leaf: number): void {
    const free = room.daveFreeLeaves ?? (room.daveFreeLeaves = []);
    free.push(leaf);
    free.sort((a, b) => a - b);
}

function enqueueDaveProposal(room: Room, p: DaveProposal): void {
    (room.daveQueue ??= []).push(p);
    flushDaveProposals(room);
}

function flushDaveProposals(room: Room): void {
    const dave = room.dave;
    if (!dave || room.daveInFlight || !room.daveCommitter) return;
    if (room.daveReady) return; // espera todos mandarem op23 da transição anterior
    const q = room.daveQueue;
    if (!q?.length) return;
    const head = q[0];
    if (head.kind === "add" && (room.members.get(head.member.userId) !== head.member || !head.member.daveKeyPackage)) {
        q.shift();
        log(`DAVE op27 (add ${head.member.userId}) descartado (saiu da sala ou sem key package)`);
        flushDaveProposals(room);
        return;
    }
    const p = q.shift()!;
    const epoch = BigInt(room.daveEpoch ?? 0);
    const ops: DaveProposalOp[] = p.kind === "bootstrap" ? []
        : p.kind === "remove" ? [{ kind: "remove", removed: p.leaf }]
        : [{ kind: "add", keyPackage: p.member.daveKeyPackage! }];
    const desc = p.kind === "bootstrap" ? "solo, 0 add"
        : p.kind === "remove" ? `remove leaf ${p.leaf}`
        : `add viewer ${p.member.userId}`;
    const recipients = daveRecipients(room);
    if (!recipients.length) {
        log(`DAVE op27 (${desc}) sem destinatários — descartado`);
        flushDaveProposals(room);
        return;
    }
    room.daveInFlight = p;
    dave.then(es => buildProposals(es, p.chId, epoch, ops))
        .then(op27 => {
            if (room.daveInFlight !== p) return; // resetou no meio
            for (const o of recipients) sendDave(o, 27, op27);
            log(`DAVE op27 (${desc}, epoch ${epoch}) → grupo (${recipients.length}) ${op27.length}B`);
            if (room.daveInFlightTimer) clearTimeout(room.daveInFlightTimer);
            room.daveInFlightTimer = setTimeout(() => {
                if (room.daveInFlight !== p) return;
                log(`DAVE op27 (${desc}) sem commit há 8s — grupo re-sincronizado (op24 epoch 1 + op21 tid 0)`);
                resetDaveGroup(room, "8s sem commit para a proposta");
            }, 8000);
        })
        .catch(e => {
            if (room.daveInFlight === p) room.daveInFlight = undefined;
            log(`DAVE op27 (${desc}) falhou:`, e);
        });
}

function armDaveReady(room: Room, tid: number, users?: Set<string>): void {
    clearDaveReadyTimer(room);
    if (!users?.size) { room.daveReady = undefined; return; }
    room.daveReady = { tid, users };
    room.daveReadyTimer = setTimeout(() => {
        log(`DAVE transição tid ${tid}: sem op23 de ${[...users].join(",")} em 10s — libera a fila`);
        room.daveReady = undefined;
        room.daveReadyTimer = undefined;
        flushDaveProposals(room);
    }, 10000);
}

function clearDaveReadyTimer(room: Room): void {
    if (room.daveReadyTimer) { clearTimeout(room.daveReadyTimer); room.daveReadyTimer = undefined; }
}

function daveMemberUnready(room: Room, userId: string): void {
    const r = room.daveReady;
    if (!r || !r.users.delete(userId)) return;
    if (r.users.size) return;
    room.daveReady = undefined;
    clearDaveReadyTimer(room);
    flushDaveProposals(room);
}

function daveInvalidCommitWelcome(m: Member, d: unknown): void {
    const room = m.room;
    log(`DAVE op31 (invalid commit/welcome) de ${m.userId}: ${JSON.stringify(d)} — remove + re-add`);
    if (!DAVE_ON || !room.dave || !room.daveBootstrapped) return;
    if (!m.daveJoined || m.daveLeaf === undefined) return; // já está fora do grupo
    m.daveJoined = false;
    daveMemberUnready(room, m.userId); // não vai mandar op23 da transição que rejeitou
    const others = [...room.members.values()].filter(o => o.daveJoined);
    if (!others.length) {
        resetDaveGroup(room, "o único membro do grupo recusou o commit");
        return;
    }
    const leaf = m.daveLeaf;
    m.daveLeaf = undefined;
    if (room.daveCommitter === m) {
        const next = others[0];
        room.daveCommitter = next;
        log(`DAVE committer promovido → ${next.userId}`);
    }
    enqueueDaveProposal(room, { kind: "remove", leaf, chId: m.daveChannelId ?? room.daveCommitter?.daveChannelId ?? 0n });
}

function resetDaveGroup(room: Room, why: string): void {
    log(`DAVE reset do grupo (${why}) — op24 epoch 1 + op21 tid 0 → ${room.members.size} membro(s)`);
    for (const o of room.members.values()) {
        if (o.daveAddTimer) clearTimeout(o.daveAddTimer);
        sendDavePrepare(o);
        o.daveJoined = false;
        o.daveLeaf = undefined;
        o.daveProposalsSent = false;
    }
    if (room.daveInFlightTimer) clearTimeout(room.daveInFlightTimer);
    clearDaveReadyTimer(room);
    room.daveReady = undefined;
    room.daveCommitter = undefined;
    room.daveEpoch = 0;
    room.daveTransition = 0;
    room.daveBootstrapped = false;
    room.daveQueue = [];
    room.daveInFlight = undefined;
    room.daveInFlightTimer = undefined;
    room.daveNextLeaf = 0;
    room.daveFreeLeaves = [];
}

function daveOnDeparture(room: Room, m: Member): void {
    if (!DAVE_ON || !room.dave) return;
    if (m.daveAddTimer) clearTimeout(m.daveAddTimer);
    room.daveQueue = (room.daveQueue ?? []).filter(p => !(p.kind === "add" && p.member === m));
    daveMemberUnready(room, m.userId);
    const joinedLeft = [...room.members.values()].filter(o => o.daveJoined);
    if (!room.daveBootstrapped) {
        if (room.daveCommitter === m) resetDaveGroup(room, "committer saiu antes do bootstrap");
        return;
    }
    if (joinedLeft.length >= 2 && m.daveJoined && m.daveLeaf !== undefined) {
        enqueueDaveProposal(room, { kind: "remove", leaf: m.daveLeaf, chId: m.daveChannelId ?? room.daveCommitter?.daveChannelId ?? 0n });
    }
    if (m.daveJoined && joinedLeft.length <= 1) {
        resetDaveGroup(room, `só ${joinedLeft.length} membro(s) do grupo restou`);
        return;
    }
    if (room.daveCommitter === m) {
        const next = joinedLeft[0];
        if (next) {
            room.daveCommitter = next;
            log(`DAVE committer promovido → ${next.userId}`);
        } else {
            resetDaveGroup(room, "committer saiu e não restou membro do grupo");
        }
    }
}

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
            room.daveCommitter = m; room.daveEpoch = 0; room.daveTransition = 0;
            room.daveBootstrapped = false;
            room.daveNextLeaf = 0; room.daveFreeLeaves = [];
            if (!m.daveProposalsSent) {
                m.daveProposalsSent = true;
                enqueueDaveProposal(room, { kind: "bootstrap", chId: m.daveChannelId });
            }
        } else if (!m.daveJoined && (m !== room.daveCommitter || room.daveBootstrapped)) {
            if (room.daveInFlight?.kind === "add" && room.daveInFlight.member === m) return;
            if ((room.daveQueue ?? []).some(p => p.kind === "add" && p.member === m)) return;
            if (m.daveAddTimer) clearTimeout(m.daveAddTimer);
            m.daveAddTimer = setTimeout(() => {
                if (room.members.get(m.userId) !== m || m.daveJoined) return;
                const chId = room.daveCommitter?.daveChannelId ?? m.daveChannelId;
                if (chId === undefined || !room.dave) return;
                if (room.daveInFlight?.kind === "add" && room.daveInFlight.member === m) return;
                if ((room.daveQueue ?? []).some(p => p.kind === "add" && p.member === m)) return;
                enqueueDaveProposal(room, { kind: "add", member: m, chId });
            }, 400);
        }
        return;
    }
    if (op === 28) {
        const room = m.room;
        const flight = room.daveInFlight;
        if (!flight) {
            log(`DAVE op28 de ${m.userId} sem proposta em voo — descartado (commit duplicado/stale)`);
            return;
        }
        const msg = decodeMls(payload);
        if (!msg) {
            log(`DAVE op28 de ${m.userId} não decodifica como MLSMessage — descartado`);
            return;
        }
        const expected = BigInt(room.daveEpoch ?? 0);
        if (msg.wireformat === "mls_public_message" && msg.publicMessage.content.epoch !== expected) {
            log(`DAVE op28 epoch ${msg.publicMessage.content.epoch} ≠ esperado ${expected} — descartado`);
            return; // mantém a "porta" aberta esperando o commit válido deste epoch
        }
        if (room.daveInFlightTimer) { clearTimeout(room.daveInFlightTimer); room.daveInFlightTimer = undefined; }
        if (m.daveJoined || (m === room.daveCommitter && flight.kind === "bootstrap")) m.daveJoined = true;
        else log(`DAVE op28 de ${m.userId} fora do grupo — repassa sem marcá-lo como membro`);
        const { commit, welcome } = splitCommitWelcome(payload);
        const tid = room.daveTransition ?? 0;
        const op29 = withTransitionId(tid, commit);
        const recipients = daveRecipients(room);
        for (const o of recipients) sendDave(o, 29, op29);
        log(`DAVE op29 (announce commit, tid ${tid}) → grupo ${op29.length}B`);
        const ready = tid > 0 ? new Set(recipients.map(o => o.userId)) : undefined;
        if (flight.kind === "bootstrap") {
            m.daveLeaf = allocDaveLeaf(room);
        } else if (flight.kind === "add") {
            const target = flight.member;
            const alive = room.members.get(target.userId) === target;
            if (welcome && alive) {
                sendDave(target, 30, withTransitionId(tid, welcome));
                log(`DAVE op30 (welcome, tid ${tid}) → viewer ${target.userId}`);
                target.daveJoined = true;
                target.daveLeaf = allocDaveLeaf(room);
                target.daveKeyPackage = undefined; // key package consumido pelo welcome
                ready?.add(target.userId); // o novo membro também confirma a transição
            } else if (welcome) {
                const leaf = allocDaveLeaf(room);
                log(`DAVE op30 descartado (${target.userId} saiu) — remove da leaf ${leaf} em fila`);
                enqueueDaveProposal(room, { kind: "remove", leaf, chId: flight.chId });
            } else {
                log(`DAVE commit sem welcome para ${target.userId} — add re-enfileirado`);
                if (alive) enqueueDaveProposal(room, flight);
            }
        } else if (welcome) {
            log(`DAVE op30 inesperado no commit do remove (leaf ${flight.leaf}) — descartado`);
        }
        if (flight.kind === "remove") freeDaveLeaf(room, flight.leaf);
        room.daveBootstrapped = true;
        room.daveEpoch = (room.daveEpoch ?? 0) + 1;
        room.daveTransition = tid + 1;
        room.daveInFlight = undefined;
        armDaveReady(room, tid, ready);
        flushDaveProposals(room);
        return;
    }
    if (op === 31) {
        daveInvalidCommitWelcome(m, safeParseJson(payload));
        return;
    }
    log(`DAVE C→S op ${op} (${DAVE_OP[op] ?? "?"}) ${payload.length}B — não tratado`);
}

function safeParseJson(b: Buffer): unknown {
    try { return JSON.parse(b.toString("utf8")); } catch { return b.length; }
}

function onConnection(ws: WebSocket, req: IncomingMessage): void {
    log("conexão", req.url, req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress);
    let member: Member | null = null;
    let backlog: { op: number; d: any; }[] | null = null;

    send(ws, OP.HELLO, { v: 8, heartbeat_interval: HEARTBEAT_INTERVAL });

    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            const { op, payload } = parseClientFrame(raw as Buffer);
            if (DAVE_ON && member) { handleDaveBinary(member, op, payload); return; }
            log(`DAVE C→S op ${op} (${DAVE_OP[op] ?? "?"}) ${(raw as Buffer).length}B — não tratado`);
            return;
        }
        let msg: { op: number; d: any; };
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.op === OP.IDENTIFY) {
            backlog = [];
            void identify(ws, msg.d).then(m => {
                const q = backlog;
                backlog = null;
                if (ws.readyState !== WebSocket.OPEN) return;
                member = m;
                if (m && q) for (const x of q) onMessage(m, x.op, x.d);
            });
            return;
        }
        if (msg.op === OP.HEARTBEAT) { send(ws, OP.HEARTBEAT_ACK, { t: msg.d?.t }); return; }
        if (msg.op === OP.RESUME) { ws.close(4006, "Session no longer valid."); return; }
        if (backlog) { backlog.push({ op: msg.op, d: msg.d }); return; } // identify ainda resolvendo
        if (!member) { ws.close(4003, "Not authenticated."); return; }
        onMessage(member, msg.op, msg.d);
    });

    ws.on("close", (code, reason) => {
        if (member) leave(member);
        log("fechou", member?.userId ?? "-", code, reason.toString());
    });
}

function fillChannelNames(guildId: string, channelId: string): Promise<void> {
    if (!botConfigured()) return Promise.resolve();
    return resolveChannelNames(guildId, channelId).then(({ guildName, channelName }) => {
        if (guildName || channelName) store.fillNames(channelId, guildName ?? "", channelName ?? "");
    });
}

function scrubSecrets(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(scrubSecrets);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = /token|secret|password|nonce|credential/i.test(k)
            ? `<${typeof val === "string" ? val.length : "?"}>`
            : scrubSecrets(val);
    }
    return out;
}

const VOICE_LOOKUP_TIMEOUT_MS = 1200;

async function waitVoiceLocation(userId: string, sessionId: string): Promise<{ guildId: string; channelId: string; } | undefined> {
    const first = voiceLocation(userId, sessionId);
    if (first) return first;
    if (!gatewayEnabled()) return undefined; // sem gateway (sem token / deu erro fatal): não adianta esperar
    const deadline = Date.now() + VOICE_LOOKUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 120));
        const loc = voiceLocation(userId, sessionId);
        if (loc) return loc;
    }
    return undefined;
}

function resolveLater(m: Member, userId: string, sessionId: string, fallbackChannelId: string, fallbackGuildId: string): void {
    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        const loc = voiceLocation(userId, sessionId);
        if (!loc && tries < 10 && gatewayEnabled()) return; // janela de ~20s
        clearInterval(timer);
        if (m.ws.readyState !== WebSocket.OPEN) return;
        if (loc) applyChannel(m, loc.guildId, loc.channelId);
        else applyChannel(m, fallbackGuildId, fallbackChannelId);
    }, 2000);
    timer.unref();
}

function applyChannel(m: Member, guildId: string, channelId: string): void {
    if (m.channelId !== channelId || m.guildId !== guildId) {
        log(`canal corrigido via gateway: ${m.userId} ${m.channelId ?? "-"} → ${channelId}`);
        m.channelId = channelId;
        m.guildId = guildId;
    }
    if (store.getSettings().authMode === "channels" && !store.getChannel(channelId)) {
        store.upsertChannel({ guildId, guildName: "", channelId, channelName: "", enabled: true });
        void fillChannelNames(guildId, channelId);
    } else {
        const ch = store.getChannel(channelId);
        if (ch && (!ch.guildName || !ch.channelName)) void fillChannelNames(guildId, channelId);
    }
    store.noteSeen(channelId, m.userId);
    if (NATIVE_STREAM_ALLOW_ANY !== "1" && !store.canStream(m.userId, channelId)) {
        log(`derrubado (sem permissão): ${m.userId} canal ${channelId} modo ${store.getSettings().authMode}`);
        leave(m);
        m.ws.close(4004, "Authentication failed.");
    }
}

async function identify(ws: WebSocket, d: any): Promise<Member | null> {
    log("identify payload:", JSON.stringify(scrubSecrets(d)));
    const userId = String(d?.user_id ?? "");
    const roomId = String(d?.server_id ?? "");
    const mediaChannelId = String(d?.channel_id ?? "");
    const sessionId = String(d?.session_id ?? "");
    if (!userId || !roomId) { ws.close(4001, "Invalid identify."); return null; }

    const loc = await waitVoiceLocation(userId, sessionId);
    const guildId = loc?.guildId ?? roomId;
    const channelId = loc?.channelId ?? mediaChannelId;
    const pending = !loc && gatewayEnabled();                        // gateway no ar, call ainda não chegou
    const provisional = pending && store.getSettings().authMode === "channels";

    if (pending) {
        log(`canal de ${userId} ainda não resolvido pelo gateway`);
    } else if (store.getSettings().authMode === "channels" && channelId && !store.getChannel(channelId)) {
        store.upsertChannel({ guildId, guildName: "", channelId, channelName: "", enabled: true });
        void fillChannelNames(guildId, channelId); // nomes chegam em segundo plano
    } else if (channelId) {
        const ch = store.getChannel(channelId);
        if (ch && (!ch.guildName || !ch.channelName)) void fillChannelNames(guildId, channelId);
    }
    if (!pending) store.noteSeen(channelId, userId);

    if (provisional) {
        log(`aceito provisoriamente (${userId}) — revalida a permissão quando o canal chegar`);
    } else if (NATIVE_STREAM_ALLOW_ANY !== "1" && !store.canStream(userId, channelId)) {
        log("recusado (sem permissão):", userId, "canal", channelId, "modo", store.getSettings().authMode);
        ws.close(4004, "Authentication failed.");
        return null;
    }

    let room = rooms.get(roomId);
    if (!room) { room = { id: roomId, key: randomBytes(32), members: new Map(), nonce: 0 }; rooms.set(roomId, room); }
    if (DAVE_ON) room.dave ??= createExternalSender();
    const prev = room.members.get(userId);
    if (prev) {
        prev.ws.close(4005, "Replaced.");
        room.members.delete(userId);
        for (const a of prev.addrs) byAddr.delete(a);
        daveOnDeparture(room, prev);
    }

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
    m.channelId = channelId;
    m.guildId = guildId;
    try { m.daveChannelId = BigInt(mediaChannelId || "0"); } catch { /* channel_id inválido */ }
    if (pending) resolveLater(m, userId, sessionId, channelId, guildId);
    log(`identify ${userId} na sala ${roomId} → canal ${channelId}${loc ? "" : " (efêmero do IDENTIFY)"} (${room.members.size} na sala) streams=${JSON.stringify(d?.streams)} dave=${d?.max_dave_protocol_version}`);

    send(ws, OP.READY, {
        ssrc: m.audioSsrc,
        ip: NATIVE_STREAM_PUBLIC_IP,
        port: UDP_PORT,
        modes: [MODE],
        experiments: STREAM_EXPERIMENTS,
        streams: [{ type: "video", ssrc: m.videoSsrc, rtx_ssrc: m.rtxSsrc, rid: "100", quality: 100, active: false }],
    });

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
            log(`select_protocol ${m.userId} mode=${d?.mode} codecs=${JSON.stringify((d?.codecs ?? []).map((c: any) => ({ name: c.name, pt: c.payload_type, rtx: c.rtx_payload_type, enc: c.encode, dec: c.decode, prio: c.priority })))}`);
            m.clientCodecs = (Array.isArray(d?.codecs) ? d.codecs : [])
                .map((c: any) => ({ name: String(c?.name ?? ""), encode: c?.encode !== false, priority: Number(c?.priority ?? 9999) }))
                .filter((c: { name: string; }) => c.name);
            send(m.ws, OP.SESSION_DESCRIPTION, sessionDescription(m));
            if (!NO_VIDEO) send(m.ws, OP.MEDIA_SINK_WANTS, { any: 100 }, m);
            if (DAVE_ON) sendExternalSender(m);
            break;

        case OP.VIDEO: {
            const video = {
                audio_ssrc: Number(d?.audio_ssrc ?? m.audioSsrc),
                video_ssrc: Number(d?.video_ssrc ?? 0),
                rtx_ssrc: Number(d?.rtx_ssrc ?? 0),
                streams: (d?.streams ?? []) as VideoStream[],
            };
            const on = video.video_ssrc > 0 || video.streams.some(s => s.active);
            if (on && !m.streamer) m.streamerSince = Date.now();
            if (!on) m.streamerSince = undefined;
            m.streamer = on;
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
            if (!m.streamer && m.wantPixels > 0) requestKeyframe(m.room);
            break;
        }

        case OP.TRANSITION_READY: {
            log(`DAVE op23 (transition_ready) de ${m.userId} tid=${d?.transition_id}`);
            send(m.ws, OP.EXECUTE_TRANSITION, { transition_id: d?.transition_id ?? 0 }, m);
            const room = m.room;
            const r = room.daveReady;
            if (r && Number(d?.transition_id) === r.tid && r.users.delete(m.userId) && !r.users.size) {
                room.daveReady = undefined;
                clearDaveReadyTimer(room);
                log(`DAVE transição tid ${r.tid} pronta em todos — fila liberada`);
                flushDaveProposals(room);
            }
            setTimeout(() => {
                for (const o of room.members.values()) if (o.streamer) sendWants(o);
                requestKeyframe(room);
            }, 600);
            break;
        }

        case 31:
            daveInvalidCommitWelcome(m, d);
            break;

        case OP.RESUME:
            m.ws.close(4006, "Session no longer valid."); // sem resume no PoC → cliente refaz o identify
            break;

        default:
            log(`op ${op} de ${m.userId} (não tratado)`, JSON.stringify(d)?.slice(0, 300));
    }
}

const VIDEO_CODECS = new Set(["H265", "H264", "VP8", "VP9", "AV1"]);

function pickVideoCodec(m: Member): string {
    if (NATIVE_STREAM_VIDEO_CODEC) return NATIVE_STREAM_VIDEO_CODEC;
    const best = (m.clientCodecs ?? []).filter(c => c.encode && VIDEO_CODECS.has(c.name))
        .sort((a, b) => a.priority - b.priority)[0];
    return best?.name ?? "H264";
}

function sessionDescription(m: Member): Record<string, unknown> {
    const kf = Number(NATIVE_STREAM_KEYFRAME_INTERVAL);
    const d: Record<string, unknown> = {
        audio_codec: "opus",
        video_codec: pickVideoCodec(m),
        ...(Number.isFinite(kf) && kf > 0 ? { keyframe_interval: kf } : {}),
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

function sendWants(m: Member): void {
    if (!m.streamer || !m.video) return;
    const viewers = peers(m);
    const anyWant = !NO_VIDEO && (viewers.some(v => v.wantPixels > 0) || NATIVE_STREAM_ALWAYS_WANT === "1");
    const mr = m.video.streams[0]?.max_resolution as { width?: number; height?: number; } | undefined;
    const maxPx = (mr?.width && mr?.height) ? mr.width * mr.height : FULL_HD_PIXELS;
    const px = anyWant ? maxPx : 0;
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
    daveOnDeparture(room, m); // Remove no grupo / sole reset / promove committer
    for (const o of room.members.values()) {
        send(o.ws, OP.CLIENT_DISCONNECT, { user_id: m.userId }, o);
        if (o.streamer) sendWants(o);
    }
    if (!room.members.size) rooms.delete(room.id);
}

const udp = createSocket("udp4");

function findBySsrc(ssrc: number): Member | undefined {
    for (const room of rooms.values()) {
        for (const m of room.members.values()) if (m.audioSsrc === ssrc) return m;
    }
    return undefined;
}

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

function classify(msg: Buffer): string {
    if (msg.length < 12 || (msg[0] >> 6) !== 2) return "other";
    const pt = msg[1];
    if (pt >= 192 && pt <= 223) return `rtcp:${pt}`;
    return `pt${pt & 0x7f}`;
}

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

    if (msg.length === 8) {
        m.udp = rinfo;
        udp.send(msg, rinfo.port, rinfo.address);
        m.stats.byPt.keepalive = (m.stats.byPt.keepalive ?? 0) + 1;
        return;
    }

    const kind = classify(msg);
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
        if (kind !== "pt120") {
            const combo = `${kind}:${msg.readUInt32BE(8)}`;
            (m.ptSsrc ??= new Set());
            if (!m.ptSsrc.has(combo)) { m.ptSsrc.add(combo); log(`envia ${m.userId}: ${combo} (m bit=${(msg[1] >> 7) & 1})`); }
        }
    } else if (!m.streamer && msg[1] === 205 && (msg[0] & 0x1f) === 15) {
        return; // transport-cc do espectador: quem dá o feedback a quem transmite é o servidor
    }

    const targets = m.streamer ? peers(m) : peers(m).filter(o => o.streamer);
    for (const o of targets) {
        if (!o.udp) continue;
        udp.send(msg, o.udp.port, o.udp.address);
        m.stats.forwarded++;
    }
});

const SERVER_SSRC = 1;
const REMB_INTERVAL_MS = 1000;

function encryptRtcp(plain: Buffer, room: Room): Buffer {
    room.nonce = (room.nonce + 1) >>> 0;
    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(room.nonce);
    const c = createCipheriv("aes-256-gcm", room.key, Buffer.concat([nonce, Buffer.alloc(8)]));
    c.setAAD(plain.subarray(0, 8));
    const enc = Buffer.concat([c.update(plain.subarray(8)), c.final()]);
    return Buffer.concat([plain.subarray(0, 8), enc, c.getAuthTag(), nonce]);
}

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

function buildPli(videoSsrc: number): Buffer {
    const b = Buffer.alloc(12);
    b[0] = 0x80 | 1; // V=2, FMT=1 (PLI)
    b[1] = 206;      // PSFB
    b.writeUInt16BE(2, 2); // length em words - 1
    b.writeUInt32BE(SERVER_SSRC, 4);
    b.writeUInt32BE(videoSsrc >>> 0, 8);
    return b;
}

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
            const fb = m.twcc.build(SERVER_SSRC, m.video?.video_ssrc || m.videoSsrc);
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
