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
 * Operação de uma op 27 (MLS_PROPOSALS): Add (key package do membro pendente) e/ou
 * Remove (leaf index do membro a remover — saída do sala ou recuperação de op 31).
 */
export type DaveProposalOp =
    | { kind: "add"; keyPackage: Uint8Array }
    | { kind: "remove"; removed: number };

/**
 * op 27 (MLS_PROPOSALS): proposals externos assinados pelo external sender. Receita libdave:
 * external_proposal(cs, group_id=BE8(channel_id), epoch, Proposal, signerIndex=0, signKey).
 * Framing: operation_type(0=append) | MLSMessage<V>.
 *
 * ⚠️ A spec (discord/dave-protocol, "Proposal Handling" / "Client Commit Validity") exige que
 * o gateway BROADCAST para todos os membros do grupo: um commit só é válido para um membro
 * existente se referir a proposals que ele já recebeu via op 27 ("previously cached proposal
 * reference"). Enviar o op 27 só ao committer faz o 1º viewer existente recusar o commit que
 * adiciona o 2º viewer → op 31 (MLS_INVALID_COMMIT_WELCOME). Vazio (solo) => op 27 vazio, e o
 * cliente comita o grupo solo (epoch 0→1).
 *
 * Nota: a assinatura do external sender cobre só (protocol_version, wireformat, framed content
 * com groupId/epoch/proposal) — senderType "external" não inclui o GroupContext no TBS
 * (ts-mls senderInfoEncoder ⇒ encVoid), então treeHash/transcript vazios aqui são seguros.
 */
export async function buildProposals(es: ExternalSenderKey, channelId: bigint, epoch: bigint, ops: DaveProposalOp[]): Promise<Buffer> {
    const cs = await ciphersuite();
    const groupId = Buffer.alloc(8);
    groupId.writeBigUInt64BE(channelId & 0xffffffffffffffffn);
    const groupContext = {
        version: "mls10" as const,
        cipherSuite: CIPHERSUITE,
        groupId: new Uint8Array(groupId),
        epoch,
        treeHash: new Uint8Array(),
        confirmedTranscriptHash: new Uint8Array(),
        extensions: [{ extensionType: "external_senders" as const, extensionData: encodeExternalSender(es.external) }],
    };
    const groupInfo = { groupContext } as unknown as Parameters<typeof proposeExternal>[0];
    const msgs: Buffer[] = [];
    for (const op of ops) {
        let proposal;
        if (op.kind === "remove") {
            proposal = { proposalType: "remove" as const, remove: { removed: op.removed } };
        } else {
            const kp = decodeClientKeyPackage(op.keyPackage);
            if (!kp) continue;
            proposal = { proposalType: "add" as const, add: { keyPackage: kp } };
        }
        const msg = await proposeExternal(groupInfo, proposal, es.signaturePublicKey, es.signKey, cs);
        msgs.push(Buffer.from(encodeMlsMessage(msg)));
    }
    const body = Buffer.concat(msgs);
    return Buffer.concat([Buffer.from([0]), encodeVarint(body.length), body]); // operation_type append + vetor<V>
}

/** op 28 = commit MLSMessage [+ Welcome MLSMessage]. Separa os dois (welcome só quando há Add). */
export function splitCommitWelcome(op28Payload: Uint8Array): { commit: Buffer; welcome?: Buffer; } {
    const r = decodeMlsMessage(op28Payload, 0);
    if (!r) return { commit: Buffer.from(op28Payload) };
    const commit = Buffer.from(op28Payload.subarray(0, r[1]));
    const rest = op28Payload.subarray(r[1]);
    return { commit, welcome: rest.length ? Buffer.from(rest) : undefined };
}

/** Prefixa transition_id(u16) — usado no op 29 (commit) e no op 30 (welcome). */
export function withTransitionId(transitionId: number, mlsBytes: Uint8Array): Buffer {
    const tid = Buffer.alloc(2);
    tid.writeUInt16BE(transitionId & 0xffff);
    return Buffer.concat([tid, Buffer.from(mlsBytes)]);
}

// --- Pendências (ver docs/DAVE.md, Phase 3) --------------------------------------
// Feito: op 26 (decode), op 27 (Add/Remove externos, BROADCAST), op 28 (commit+welcome,
// primeiro commit do epoch vence), op 29/30 (tid), op 31 (Remove + re-add), Remove na
// saída, sole member reset, leaf bookkeeping.
// Falta:
// - op 26: validar credential (snowflake do user_id, big-endian) + lifetime + assinatura.
// - Validar o commit/welcome recebidos (só repassamos; a validação real é do cliente).
