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
    getCiphersuiteFromName,
    nobleCryptoProvider,
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
 * Gera o external sender do servidor. `identity` vai no credential basic — o Discord valida
 * o credential do external sender; por ora vazio (TODO Phase 1: casar com o libdave).
 */
export async function createExternalSender(identity: Uint8Array = new Uint8Array()): Promise<ExternalSenderKey> {
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
