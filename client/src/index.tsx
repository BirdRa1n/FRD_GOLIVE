import { FluxDispatcher } from "@webpack/common";
import definePlugin from "@utils/types";

import { getCurrentVoiceChannelId } from "./discordState";
import { disconnect, onVoiceChannelChange } from "./rtc/controller";
import { isNativeStreamConnection, setNativeStreamEndpoint } from "./probe/nativeStreamRedirect";
import { startStreamProbe, stopStreamProbe } from "./probe/streamProbe";
import { settings } from "./settings";
import { clearAudioSinks, syncAudioSinks } from "./state/audioSink";
import { streamStore } from "./state/streamStore";
import { userContextPatch } from "./ui/StreamContextMenu";
import { startNativeControls, stopNativeControls, syncNativeControls } from "./ui/nativeControlsHijack";
import { startNativeTiles, stopNativeTiles, syncNativeTiles } from "./ui/nativeTileInject";
import { mountPanel, unmountPanel } from "./ui/panelMount";
import { injectStyles, removeStyles } from "./ui/styles";

let storeUnsub: (() => void) | null = null;
let prefsUnsub: (() => void) | null = null;

function handleVoiceSelect(payload: { channelId: string | null; }): void {
    onVoiceChannelChange(payload.channelId ?? null);
}

export default definePlugin({
    name: "FRDGoLive",
    description:
        "Compartilhamento de tela/câmera privado via servidor próprio (LiveKit), sem que o vídeo passe pelos servidores do Discord. Voz continua no Discord.",
    authors: [{ name: "Dário Jr", id: 0n }],
    settings,

    patches: [
        {
            // RTCConnection._maybeRefuseDaveDowngrade(stage, version, transitionId):
            // aceita DAVE 0 só quando a conexão é com o nosso servidor (ver nativeStreamRedirect).
            find: "Refusing DAVE protocol downgrade to version",
            predicate: () => !!settings.store.nativeStreamEndpoint,
            replacement: {
                match: /(_maybeRefuseDaveDowngrade\(\i,(\i),\i\)\{if\(0!==\2)/,
                replace: "$1||$self.allowDaveDowngrade(this)",
            },
        },
    ],

    allowDaveDowngrade: isNativeStreamConnection,

    // Botão direito num usuário da call: volume/silenciar da transmissão privada.
    contextMenus: {
        "user-context": userContextPatch,
    },

    start() {
        // Diagnóstico do Go Live nativo — cedo, antes de o Discord abrir o WS de mídia.
        // Redirecionamento antes da sonda: o interceptor dela deve ver o endpoint já trocado.
        setNativeStreamEndpoint(settings.store.nativeStreamEndpoint);
        if (settings.store.streamProbe) startStreamProbe();

        // Volume/silenciar por pessoa (menu de botão direito) sobrevivem a reinícios.
        streamStore.hydratePrefs(settings.store.streamPrefs);
        prefsUnsub = streamStore.subscribePrefs(() => {
            settings.store.streamPrefs = streamStore.exportPrefs();
        });

        injectStyles();
        mountPanel();
        startNativeTiles();
        startNativeControls();

        // Desbloqueia os botões nativos (override do experimento "video guard").
        // Só com o hijack ligado, pois o hijack é o que impede o Go Live nativo de
        // rodar — assim os botões ficam nativos, mas a mídia vai pro servidor privado.
        // Com a sonda ligada também, para o Go Live nativo poder ser testado.
        if ((settings.store.hijackNativeControls || settings.store.streamProbe || settings.store.nativeStreamEndpoint) && settings.store.unlockNativeVideoGate) {
            try {
                FluxDispatcher.dispatch({
                    type: "APEX_EXPERIMENT_OVERRIDE_CREATE",
                    experimentName: settings.store.videoGuardExperiment,
                    variantId: -1,
                });
            } catch (e) {
                console.error("[FRD GoLive] falha ao desbloquear o video guard:", e);
            }
        }

        // Reage a mudanças de streams: players de áudio, overlays nos tiles e
        // estado ativo dos botões nativos.
        storeUnsub = streamStore.subscribe(() => {
            syncAudioSinks();
            syncNativeTiles();
            syncNativeControls();
        });

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceSelect);

        // Caso o plugin seja ativado já dentro de um canal de voz.
        const current = getCurrentVoiceChannelId();
        if (current) onVoiceChannelChange(current);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceSelect);
        storeUnsub?.();
        storeUnsub = null;
        prefsUnsub?.();
        prefsUnsub = null;
        void disconnect();
        stopNativeTiles();
        stopNativeControls();
        clearAudioSinks();
        unmountPanel();
        removeStyles();
        stopStreamProbe();
        setNativeStreamEndpoint("");
    },
});
