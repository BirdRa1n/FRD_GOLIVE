// Chime sintetizado (WebAudio) parecido com o "stream started/ended" do Discord:
// um arpejo curto e brilhante subindo (início) ou descendo (fim).
// Puro (só DOM/WebAudio) — typecheckável isolado. Usado como fallback quando o
// som nativo do Discord não está disponível.

export type ChimeKind = "start" | "stop";

// Mi5 → Si5 → Mi6: intervalos abertos, som "de notificação" sem ser estridente.
const NOTES: Record<ChimeKind, number[]> = {
    start: [659.25, 987.77, 1318.51],
    stop: [1318.51, 987.77, 659.25],
};
const STEP_S = 0.075; // atraso entre notas
const DECAY_S = 0.28; // cauda de cada nota

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext; }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
}

/** Toca o chime. `volume` em 0..1. */
export function playChime(kind: ChimeKind, volume: number): void {
    const ac = audioContext();
    if (!ac || volume <= 0) return;
    if (ac.state === "suspended") void ac.resume();

    const t0 = ac.currentTime + 0.01;
    const master = ac.createGain();
    master.gain.value = Math.min(1, volume) * 0.35;

    // Passa-baixa suaviza os harmônicos do triângulo (som mais "redondo").
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4200;
    lp.connect(master).connect(ac.destination);

    NOTES[kind].forEach((freq, i) => {
        const start = t0 + i * STEP_S;
        const end = start + DECAY_S;

        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(1, start + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        env.connect(lp);

        // Fundamental em seno + triângulo uma oitava acima, bem baixo: dá o "brilho".
        for (const [type, mult, gain] of [["sine", 1, 1], ["triangle", 2, 0.18]] as const) {
            const osc = ac.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(freq * mult, start);
            const g = ac.createGain();
            g.gain.value = gain;
            osc.connect(g).connect(env);
            osc.start(start);
            osc.stop(end + 0.02);
        }
    });
}
