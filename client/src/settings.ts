import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    serverUrl: {
        type: OptionType.STRING,
        description: "URL do servidor LiveKit privado (ex.: wss://media.suaempresa.com)",
        default: "ws://localhost:7880",
    },
    tokenServiceUrl: {
        type: OptionType.STRING,
        description: "URL do token-service (ex.: https://media.suaempresa.com)",
        default: "http://localhost:8080",
    },
    orgSecret: {
        type: OptionType.STRING,
        description: "Segredo da organização (credencial de acesso ao servidor privado)",
        default: "",
    },
    includeSystemAudio: {
        type: OptionType.BOOLEAN,
        description: "Incluir áudio do sistema na transmissão privada (deixa os membros se ouvirem)",
        default: true,
    },
    nativeScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Captura nativa (desktopCapturer): contorna o bloqueio de compartilhamento de tela do Discord em regiões censuradas",
        default: false,
    },
    nativeTileOverlay: {
        type: OptionType.BOOLEAN,
        description: "Mostrar a transmissão privada dentro do tile do participante na grade de chamada (desligue se quebrar após update do Discord)",
        default: true,
    },
    hijackNativeControls: {
        type: OptionType.BOOLEAN,
        description: "Usar os botões nativos de câmera/tela do Discord para iniciar a transmissão privada (desligue se quebrar após update do Discord)",
        default: true,
    },
    unlockNativeVideoGate: {
        type: OptionType.BOOLEAN,
        description: "Desbloquear os botões nativos em regiões censuradas (override do experimento). Só faz efeito com o hijack ligado — o clique é redirecionado pra transmissão privada, o Go Live do Discord nunca roda.",
        default: true,
    },
    videoGuardExperiment: {
        type: OptionType.STRING,
        description: "Nome do experimento do 'video guard' do Discord (atualize se o Discord rotacionar e os botões voltarem a ficar bloqueados)",
        default: "2026-08-video-guard",
    },
    maxHeight: {
        type: OptionType.SELECT,
        description: "Resolução máxima da captura de tela",
        options: [
            { label: "720p", value: 720 },
            { label: "1080p", value: 1080, default: true },
            { label: "1440p", value: 1440 },
        ],
    },
    fps: {
        type: OptionType.SELECT,
        description: "Quadros por segundo da captura",
        options: [
            { label: "15 fps", value: 15 },
            { label: "30 fps", value: 30, default: true },
            { label: "60 fps", value: 60 },
        ],
    },
});
