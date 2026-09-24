// Feedback transport-wide congestion control (RTCP RTPFB FMT 15 — draft-holmer-rmcat-transport-wide-cc).
//
// O nativo do Discord (libwebrtc) estima a banda de envio pelo feedback de
// chegada que o RECEPTOR manda. Sem ele a estimativa fica nos ~600 kbps iniciais,
// abaixo do mínimo do Go Live, e o vídeo recebe 0 de bitrate. Aqui registramos a
// hora de chegada de cada número de sequência transport-wide e montamos o feedback.

const DELTA_UNIT_US = 250;
const REF_UNIT_US = 64_000;
const MAX_STATUS_PER_PACKET = 2000;

export class TwccRecorder {
    private arrivals = new Map<number, number>();
    private lastSeq: number | null = null;
    private nextBase: number | null = null;
    private fbCount = 0;

    /** seq: número transport-wide (16 bits); tUs: chegada em µs (relógio monotônico). */
    record(seq16: number, tUs: number): void {
        const seq = this.unwrap(seq16);
        if (this.nextBase !== null && seq < this.nextBase) return; // chegou depois de reportado
        if (!this.arrivals.has(seq)) this.arrivals.set(seq, tUs);
    }

    private unwrap(seq16: number): number {
        if (this.lastSeq === null) { this.lastSeq = seq16; return seq16; }
        let diff = seq16 - (this.lastSeq & 0xffff);
        if (diff > 0x8000) diff -= 0x10000;
        else if (diff < -0x8000) diff += 0x10000;
        const seq = this.lastSeq + diff;
        if (seq > this.lastSeq) this.lastSeq = seq;
        return seq;
    }

    /** Monta o próximo feedback (sem cifra) ou null se não chegou nada novo. */
    build(senderSsrc: number, mediaSsrc: number): Buffer | null {
        if (!this.arrivals.size) return null;
        const seqs = [...this.arrivals.keys()].sort((a, b) => a - b);
        let base = this.nextBase ?? seqs[0];
        const end = seqs[seqs.length - 1];
        if (end - base + 1 > MAX_STATUS_PER_PACKET) base = end - MAX_STATUS_PER_PACKET + 1;
        const count = end - base + 1;

        const firstArrival = this.arrivals.get(seqs.find(s => s >= base)!)!;
        const refTime = Math.floor(firstArrival / REF_UNIT_US) & 0xffffff;
        let prevUs = Math.floor(firstArrival / REF_UNIT_US) * REF_UNIT_US;

        const symbols: number[] = [];
        const deltas: Buffer[] = [];
        for (let s = base; s <= end; s++) {
            const t = this.arrivals.get(s);
            if (t === undefined) { symbols.push(0); continue; }
            const delta = Math.round((t - prevUs) / DELTA_UNIT_US);
            if (delta >= 0 && delta <= 0xff) {
                symbols.push(1);
                deltas.push(Buffer.from([delta]));
            } else {
                const d = Math.max(-0x8000, Math.min(0x7fff, delta));
                const b = Buffer.alloc(2);
                b.writeInt16BE(d);
                symbols.push(2);
                deltas.push(b);
            }
            prevUs += delta * DELTA_UNIT_US;
        }

        // Status vector chunks de 2 bits: 1 | 1 | 7 símbolos × 2 bits.
        const chunks: Buffer[] = [];
        for (let i = 0; i < symbols.length; i += 7) {
            let v = 0xc000;
            for (let j = 0; j < 7; j++) v |= (symbols[i + j] ?? 0) << (12 - 2 * j);
            const b = Buffer.alloc(2);
            b.writeUInt16BE(v);
            chunks.push(b);
        }

        const head = Buffer.alloc(20);
        head[1] = 205; // RTPFB
        head.writeUInt32BE(senderSsrc >>> 0, 4);
        head.writeUInt32BE(mediaSsrc >>> 0, 8);
        head.writeUInt16BE(base & 0xffff, 12);
        head.writeUInt16BE(count, 14);
        head.writeUIntBE(refTime, 16, 3);
        head[19] = this.fbCount;
        this.fbCount = (this.fbCount + 1) & 0xff;

        let body = Buffer.concat([head, ...chunks, ...deltas]);
        const pad = (4 - (body.length % 4)) % 4;
        if (pad) {
            const p = Buffer.alloc(pad);
            p[pad - 1] = pad;
            body = Buffer.concat([body, p]);
        }
        body[0] = 0x80 | (pad ? 0x20 : 0) | 15;
        body.writeUInt16BE(body.length / 4 - 1, 2);

        for (const s of seqs) if (s <= end) this.arrivals.delete(s);
        this.nextBase = end + 1;
        return body;
    }
}

/** Elementos de extensão de cabeçalho RTP (one-byte 0xBEDE ou two-byte 0x100x). */
export function parseHeaderExtensions(profile: number, body: Buffer): Map<number, Buffer> {
    const out = new Map<number, Buffer>();
    let i = 0;
    if (profile === 0xbede) {
        while (i < body.length) {
            const b = body[i];
            if (b === 0) { i++; continue; }
            const id = b >> 4;
            const len = (b & 0x0f) + 1;
            if (id === 15) break;
            out.set(id, body.subarray(i + 1, i + 1 + len));
            i += 1 + len;
        }
    } else if ((profile & 0xfff0) === 0x1000) {
        while (i + 1 < body.length) {
            const id = body[i];
            if (id === 0) { i++; continue; }
            const len = body[i + 1];
            out.set(id, body.subarray(i + 2, i + 2 + len));
            i += 2 + len;
        }
    }
    return out;
}
