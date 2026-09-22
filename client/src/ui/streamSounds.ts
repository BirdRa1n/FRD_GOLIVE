// Sons de "transmissão iniciada/encerrada", como o Go Live nativo do Discord.
//
// Preferimos os próprios sons do Discord (stream_started / stream_ended) pelo
// módulo interno de sons; se ele não for encontrado (Discord mudou), caímos no
// chime sintetizado. Também dá pra forçar o sintetizado em Configurações.

import { findByPropsLazy } from "@webpack";

import { settings } from "../settings";
import { type ChimeKind, playChime } from "./chime";

type SoundModule = { playSound(name: string, volume?: number): unknown; };
const Sounds = findByPropsLazy("playSound") as SoundModule;

const DISCORD_SOUND: Record<ChimeKind, string> = {
    start: "stream_started",
    stop: "stream_ended",
};

// Várias tracks mudando juntas (vídeo + áudio, ou duas pessoas) viram um som só.
const THROTTLE_MS = 700;
let lastPlayed = 0;

export function playStreamSound(kind: ChimeKind): void {
    if (!settings.store.streamSounds) return;

    const now = Date.now();
    if (now - lastPlayed < THROTTLE_MS) return;
    lastPlayed = now;

    const volume = Number(settings.store.streamSoundVolume) / 100;
    if (volume <= 0) return;

    if (settings.store.streamSoundStyle === "discord") {
        try {
            Sounds.playSound(DISCORD_SOUND[kind], volume);
            return;
        } catch (e) {
            console.warn("[FRD GoLive] som nativo indisponível, usando o sintetizado:", e);
        }
    }
    playChime(kind, volume);
}
