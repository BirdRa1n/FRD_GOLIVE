// Fundação do DAVE v1 (E2EE do Go Live nativo) — Phase 1. Ver docs/DAVE.md.
//
// Papel do servidor: EXTERNAL SENDER + delivery service. NÃO é membro do grupo MLS,
// não faz commit, nunca aprende a chave de mídia. Só:
//   - anuncia seu pacote de external sender (op 25);
//   - cria propostas Add externas (op 27) referenciando key packages dos clientes (op 26);
//   - repassa commit (op 29) e welcome (op 30), e coordena epoch/transição (op 21/22/24).
//
// Cada cliente cria um grupo MLS solo ao receber o op 25; para validar com só o
// transmissor basta o op 25 + a transição inicial (transition_id 0). Coreografia completa
// em docs/DAVE.md (fonte: discord/dave-protocol).
//
// Ciphersuite: MLS_128_DHKEMP256_AES128GCM_SHA256_P256 (0x0002) — confirmado pelos bytes
// reais do op 26 (init_key P256 de 65B, prefixo 0x04). Provider noble (JS puro).

import {
    decodeMlsMessage,
    encodeExternalSender,
    encodeMlsMessage,
    getCiphersuiteFromName,
    nobleCryptoProvider,
    proposeExternal,
    type CiphersuiteImpl,
    type ExternalSender,
    type MLSMessage,
} from "ts-mls";
import { decodeKeyPackage, type KeyPackage } from "ts-mls/keyPackage.js";

export const DAVE_PROTOCOL_VERSION = 1;
const CIPHERSUITE = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256" as const;

let csImplPromise: Promise<CiphersuiteImpl> | null = null;
/** Implementação da ciphersuite do DAVE (lazy singleton, provider noble). */
export function ciphersuite(): Promise<CiphersuiteImpl> {
    csImplPromise ??= nobleCryptoProvider.getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE));
    return csImplPromise;
}

/** External sender do servidor para uma sala: keypair Ed25519 + a struct ExternalSender. */
export interface ExternalSenderKey {
    signaturePublicKey: Uint8Array;
    signKey: Uint8Array;
    external: ExternalSender;
}

/**
 * Gera o external sender do servidor. `identity` vai no credential basic. O libdave usa
 * exatamente `{0x00, 0x01, 0x01, 0x00}` (cpp/test/external_sender.cpp) — por isso o op 25
 * real tem 74B (com identity vazia dava 70B).
 */
export async function createExternalSender(identity: Uint8Array = new Uint8Array([0x00, 0x01, 0x01, 0x00])): Promise<ExternalSenderKey> {
    const cs = await ciphersuite();
    const { publicKey, signKey } = await cs.signature.keygen();
    return {
        signaturePublicKey: publicKey,
        signKey,
        external: { signaturePublicKey: publicKey, credential: { credentialType: "basic", identity } },
    };
}

/** Payload do op 25 (MLS_EXTERNAL_SENDER): a struct ExternalSender codificada em TLS. */
export function externalSenderPackage(es: ExternalSenderKey): Uint8Array {
    return encodeExternalSender(es.external);
}

// --- Framing binário do gateway -------------------------------------------------
// S→C: [seq u16 BE][op u8][payload].  C→S: [op u8][payload] (sem seq).
// (ops 29/30 ainda prefixam transition_id u16 no início do payload — ver docs/DAVE.md.)

/** Monta um frame binário servidor→cliente. */
export function encodeServerFrame(seq: number, op: number, payload: Uint8Array): Buffer {
    const b = Buffer.alloc(3 + payload.length);
    b.writeUInt16BE(seq & 0xffff, 0);
    b.writeUInt8(op, 2);
    Buffer.from(payload).copy(b, 3);
    return b;
}

/** Lê um frame binário cliente→servidor (op 26/28/23/31): [op u8][payload]. */
export function parseClientFrame(b: Buffer): { op: number; payload: Buffer; } {
    return { op: b[0], payload: b.subarray(1) };
}

/** Decodifica um MLSMessage (op 28 = commit/welcome, …). */
export function decodeMls(payload: Uint8Array): MLSMessage | undefined {
    return decodeMlsMessage(payload, 0)?.[0];
}

/** op 26 = KeyPackage CRU (não é MLSMessage). version(u16) cipher_suite(u16) init_key<V> … */
export function decodeClientKeyPackage(payload: Uint8Array): KeyPackage | undefined {
    return decodeKeyPackage(payload, 0)?.[0];
}

/** Varint de tamanho MLS/QUIC (RFC 9420 §2.1.2). */
function encodeVarint(n: number): Buffer {
    if (n < 0x40) return Buffer.from([n]);
    if (n < 0x4000) { const b = Buffer.alloc(2); b.writeUInt16BE(0x4000 | n); return b; }
    if (n < 0x40000000) { const b = Buffer.alloc(4); b.writeUInt32BE((0x80000000 | n) >>> 0); return b; }
    throw new Error("varint grande demais");
}

/**
 * op 27 (MLS_PROPOSALS): Add proposals externos para os key packages dos OUTROS membros.
 * O membro solo é fundador do próprio pending group, então adicioná-lo seria leaf duplicada —
 * por isso `keyPackages` traz só os PEERS. Vazio (solo) => op 27 vazio, e o cliente comita o
 * grupo solo (epoch 0→1). Receita libdave: external_proposal(cs, group_id=BE8(channel_id),
 * epoch=0, Add{kp}, signerIndex=0, signKey). Framing: operation_type(0=append) | MLSMessage<V>.
 */
export async function buildProposals(es: ExternalSenderKey, channelId: bigint, keyPackages: Uint8Array[]): Promise<Buffer> {
    const cs = await ciphersuite();
    const groupId = Buffer.alloc(8);
    groupId.writeBigUInt64BE(channelId & 0xffffffffffffffffn);
    const groupContext = {
        version: "mls10" as const,
        cipherSuite: CIPHERSUITE,
        groupId: new Uint8Array(groupId),
        epoch: 0n,
        treeHash: new Uint8Array(),
        confirmedTranscriptHash: new Uint8Array(),
        extensions: [{ extensionType: "external_senders" as const, extensionData: encodeExternalSender(es.external) }],
    };
    const groupInfo = { groupContext } as unknown as Parameters<typeof proposeExternal>[0];
    const msgs: Buffer[] = [];
    for (const kpBytes of keyPackages) {
        const kp = decodeClientKeyPackage(kpBytes);
        if (!kp) continue;
        const addProposal = { proposalType: "add" as const, add: { keyPackage: kp } };
        const msg = await proposeExternal(groupInfo, addProposal, es.signaturePublicKey, es.signKey, cs);
        msgs.push(Buffer.from(encodeMlsMessage(msg)));
    }
    const body = Buffer.concat(msgs);
    return Buffer.concat([Buffer.from([0]), encodeVarint(body.length), body]); // operation_type append + vetor<V>
}

/** op 29 (ANNOUNCE_COMMIT_TRANSITION): ecoa o commit do op 28 com transition_id. */
export function buildAnnounceCommit(transitionId: number, op28Payload: Uint8Array): Buffer | undefined {
    const r = decodeMlsMessage(op28Payload, 0);
    if (!r) return undefined;
    const commitBytes = Buffer.from(op28Payload.subarray(0, r[1]));
    const tid = Buffer.alloc(2);
    tid.writeUInt16BE(transitionId & 0xffff);
    return Buffer.concat([tid, commitBytes]);
}

// --- TODO Phase 1 (máquina de estados; ver docs/DAVE.md) ------------------------
// - op 26 (key package do cliente): decodeMlsMessage → validar credential (snowflake do
//   user_id, big-endian) + lifetime + assinatura.
// - op 27 (proposals): proposeExternal/proposeAddExternal (Add) assinado com o external
//   sender; operation_type append=0.
// - op 28 (commit+welcome do committer): validar, guardar; repassar.
// - op 29 (announce commit) aos membros existentes + op 30 (welcome) aos novos, ambos com
//   transition_id.
// - op 24 (prepare_epoch) / op 21 (prepare_transition) / op 22 (execute_transition) +
//   op 23 (transition_ready do cliente): coordenar a transição inicial (transition_id 0).
// - Só então: op 4 com dave_protocol_version 1 / secure_frames_version 1, e reverter o
//   Caminho A (deixar o cliente anunciar max_dave 1).
