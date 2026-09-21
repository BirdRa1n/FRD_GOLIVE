import { FluxDispatcher } from "@webpack/common";
import definePlugin from "@utils/types";

import { getCurrentVoiceChannelId } from "./discordState";
import { disconnect, onVoiceChannelChange } from "./rtc/controller";
import { settings } from "./settings";
import { mountPanel, unmountPanel } from "./ui/panelMount";
import { injectStyles, removeStyles } from "./ui/styles";

function handleVoiceSelect(payload: { channelId: string | null; }): void {
    onVoiceChannelChange(payload.channelId ?? null);
}

export default definePlugin({
    name: "FRDGoLive",
    description:
        "Compartilhamento de tela/câmera privado via servidor próprio (LiveKit), sem que o vídeo passe pelos servidores do Discord. Voz continua no Discord.",
    authors: [{ name: "Dário Jr", id: 0n }],
    settings,

    start() {
        injectStyles();
        mountPanel();
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceSelect);

        // Caso o plugin seja ativado já dentro de um canal de voz.
        const current = getCurrentVoiceChannelId();
        if (current) onVoiceChannelChange(current);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceSelect);
        void disconnect();
        unmountPanel();
        removeStyles();
    },
});
