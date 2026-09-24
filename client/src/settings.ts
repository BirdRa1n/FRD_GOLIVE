import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    nativeStreamEndpoint: {
        type: OptionType.STRING,
        description: "Servidor privado do Go Live nativo — ex.: golivefrd.SEU.com/dstream. O instalador preenche isto. Quem transmite e quem assiste precisam dele. Vazio = desligado (o Go Live vai para o Discord).",
        default: "",
        restartNeeded: true,
    },
    nativeStreamDave: {
        type: OptionType.BOOLEAN,
        description: "Cifrar o áudio da transmissão ponta a ponta (DAVE v1 / E2EE) — o servidor não vê o conteúdo. Requer o servidor com NATIVE_STREAM_DAVE=1. Ver docs/DAVE.md.",
        default: true,
        restartNeeded: true,
    },
    excludeDiscordAudio: {
        type: OptionType.BOOLEAN,
        description: "Transmitir o som SEM o áudio do Discord (a call não vai para a live — ninguém se escuta). Windows 10 2004+. Desligue só se o som da transmissão falhar.",
        default: true,
        restartNeeded: true,
    },
    unlockNativeVideoGate: {
        type: OptionType.BOOLEAN,
        description: "Desbloquear os botões nativos de tela/câmera em regiões censuradas (necessário para o Go Live nativo poder iniciar a transmissão privada).",
        default: true,
    },
    videoGuardExperiment: {
        type: OptionType.STRING,
        description: "Nome do experimento do 'video guard' do Discord (atualize se o Discord rotacionar e os botões voltarem a ficar bloqueados)",
        default: "2026-08-video-guard",
    },

    // --- Diagnóstico ---
    streamProbe: {
        type: OptionType.BOOLEAN,
        description: "[Diagnóstico] Registrar o protocolo do Go Live nativo no console (FRDStreamProbe.copy() copia o log). Só leitura.",
        default: false,
        restartNeeded: true,
    },
    diagMcp: {
        type: OptionType.BOOLEAN,
        description: "[Diagnóstico] Ponte MCP: conecta o Discord a um agente local (OpenCode + mcp/) para inspeção ao vivo — stats de mídia, protocolo, stores, eval. Só em máquina própria: quem usa a ponte executa código no Discord. Ver docs/MCP-DIAG.md.",
        default: false,
        restartNeeded: true,
    },
    diagMcpUrl: {
        type: OptionType.STRING,
        description: "[Diagnóstico] URL da ponte MCP local (o servidor mcp/).",
        default: "http://127.0.0.1:8756",
        restartNeeded: true,
    },
});
