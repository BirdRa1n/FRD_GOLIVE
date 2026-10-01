
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
export function ciphersuite(): Promise<CiphersuiteImpl> {
    csImplPromise ??= nobleCryptoProvider.getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE));
    return csImplPromise;
}

export interface ExternalSenderKey {
    signaturePublicKey: Uint8Array;
    signKey: Uint8Array;
    external: ExternalSender;
}

export async function createExternalSender(identity: Uint8Array = new Uint8Array([0x00, 0x01, 0x01, 0x00])): Promise<ExternalSenderKey> {
    const cs = await ciphersuite();
    const { publicKey, signKey } = await cs.signature.keygen();
    return {
        signaturePublicKey: publicKey,
        signKey,
        external: { signaturePublicKey: publicKey, credential: { credentialType: "basic", identity } },
    };
}

export function externalSenderPackage(es: ExternalSenderKey): Uint8Array {
    return encodeExternalSender(es.external);
}

export function encodeServerFrame(seq: number, op: number, payload: Uint8Array): Buffer {
    const b = Buffer.alloc(3 + payload.length);
    b.writeUInt16BE(seq & 0xffff, 0);
    b.writeUInt8(op, 2);
    Buffer.from(payload).copy(b, 3);
    return b;
}

export function parseClientFrame(b: Buffer): { op: number; payload: Buffer; } {
    return { op: b[0], payload: b.subarray(1) };
}

export function decodeMls(payload: Uint8Array): MLSMessage | undefined {
    return decodeMlsMessage(payload, 0)?.[0];
}

export function decodeClientKeyPackage(payload: Uint8Array): KeyPackage | undefined {
    return decodeKeyPackage(payload, 0)?.[0];
}

function encodeVarint(n: number): Buffer {
    if (n < 0x40) return Buffer.from([n]);
    if (n < 0x4000) { const b = Buffer.alloc(2); b.writeUInt16BE(0x4000 | n); return b; }
    if (n < 0x40000000) { const b = Buffer.alloc(4); b.writeUInt32BE((0x80000000 | n) >>> 0); return b; }
    throw new Error("varint grande demais");
}

export type DaveProposalOp =
    | { kind: "add"; keyPackage: Uint8Array }
    | { kind: "remove"; removed: number };

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

export function splitCommitWelcome(op28Payload: Uint8Array): { commit: Buffer; welcome?: Buffer; } {
    const r = decodeMlsMessage(op28Payload, 0);
    if (!r) return { commit: Buffer.from(op28Payload) };
    const commit = Buffer.from(op28Payload.subarray(0, r[1]));
    const rest = op28Payload.subarray(r[1]);
    return { commit, welcome: rest.length ? Buffer.from(rest) : undefined };
}

export function withTransitionId(transitionId: number, mlsBytes: Uint8Array): Buffer {
    const tid = Buffer.alloc(2);
    tid.writeUInt16BE(transitionId & 0xffff);
    return Buffer.concat([tid, Buffer.from(mlsBytes)]);
}

