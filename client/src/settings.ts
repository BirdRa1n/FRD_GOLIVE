import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import type { StreamPrefs } from "./state/streamStore";

export const settings = definePluginSettings({
    tokenServiceUrl: {
        type: OptionType.STRING,
        description: "URL do servidor FRD GoLive (hub) — ex.: https://golivefrd.SEU.com. O instalador preenche isto.",
        default: "",
    },
    streamSounds: {
        type: OptionType.BOOLEAN,
        description: "Tocar um som quando alguém da call inicia ou encerra uma transmissão privada (dá pra silenciar por pessoa no botão direito da transmissão)",
        default: true,
    },
    streamSoundStyle: {
        type: OptionType.SELECT,
        description: "Som de início/fim de transmissão",
        options: [
            { label: "Sons do próprio Discord", value: "discord", default: true },
            { label: "Chime sintetizado (use se o som nativo não tocar)", value: "synth" },
        ],
    },
    streamSoundVolume: {
        type: OptionType.SLIDER,
        description: "Volume do som de início/fim de transmissão (%)",
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false,
        default: 60,
    },
    excludeDiscordAudio: {
        type: OptionType.BOOLEAN,
        description: "Transmitir o som SEM o áudio do Discord (a call não vai para a live — ninguém se escuta). Windows 10 2004+. Desligue só se o som da transmissão falhar.",
        default: true,
        restartNeeded: true,
    },
    nativeTileOverlay: {
        type: OptionType.BOOLEAN,
        description: "Mostrar a transmissão privada dentro do tile do participante na call (desligue se quebrar após um update do Discord)",
        default: true,
    },
    hijackNativeControls: {
        type: OptionType.BOOLEAN,
        description: "Usar os botões nativos de câmera/tela do Discord para iniciar a transmissão privada (desligue se quebrar após um update do Discord)",
        default: true,
    },
    unlockNativeVideoGate: {
        type: OptionType.BOOLEAN,
        description: "Desbloquear os botões nativos em regiões censuradas (só com os botões nativos ligados — o Go Live do Discord nunca roda)",
        default: true,
    },
    videoGuardExperiment: {
        type: OptionType.STRING,
        description: "Nome do experimento do 'video guard' do Discord (atualize se o Discord rotacionar e os botões voltarem a ficar bloqueados)",
        default: "2026-08-video-guard",
    },

    streamProbe: {
        type: OptionType.BOOLEAN,
        description: "[Diagnóstico] Registrar o protocolo do Go Live NATIVO do Discord no console (FRDStreamProbe.copy() copia o log). Só leitura. Desligue os botões nativos (hijack) para o Go Live nativo rodar.",
        default: false,
        restartNeeded: true,
    },

    // --- Escondidas: lembradas automaticamente, sem mexer em Configurações ---
    // Qualidade/som agora são escolhidos no picker de transmissão; guardamos a
    // última escolha para abrir o picker já nela.
    maxHeight: { type: OptionType.NUMBER, description: "Última resolução escolhida (0 = fonte)", default: 1080, hidden: true },
    fps: { type: OptionType.NUMBER, description: "Último FPS escolhido", default: 30, hidden: true },
    includeSystemAudio: { type: OptionType.BOOLEAN, description: "Último 'compartilhar som'", default: true, hidden: true },
    /** Volume/silenciar por usuário (menu de botão direito). */
    streamPrefs: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, StreamPrefs>,
        hidden: true,
    },
});
