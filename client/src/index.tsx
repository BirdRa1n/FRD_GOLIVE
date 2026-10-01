import { FluxDispatcher } from "@webpack/common";
import definePlugin from "@utils/types";

import { startDiagBridge, stopDiagBridge } from "./diagBridge";
import { isNativeStreamConnection, setNativeStreamEndpoint } from "./probe/nativeStreamRedirect";
import { startStreamProbe, stopStreamProbe } from "./probe/streamProbe";
import { settings } from "./settings";

export default definePlugin({
    name: "FRDGoLive",
    description:
        "Compartilhamento de tela privado: o Go Live nativo do Discord é redirecionado para um servidor próprio (vídeo + áudio E2EE), sem que a mídia passe pelos servidores do Discord. Câmera e voz continuam nativas.",
    authors: [{ name: "Dário Jr", id: 0n }],
    settings,

    patches: [
        {
            find: "Refusing DAVE protocol downgrade to version",
            predicate: () => !!settings.store.nativeStreamEndpoint,
            replacement: {
                match: /(_maybeRefuseDaveDowngrade\(\i,(\i),\i\)\{if\(0!==\2)/,
                replace: "$1||$self.allowDaveDowngrade(this)",
            },
        },
    ],

    allowDaveDowngrade: isNativeStreamConnection,

    start() {
        setNativeStreamEndpoint(settings.store.nativeStreamEndpoint);
        if (settings.store.streamProbe) startStreamProbe();

        if (settings.store.diagMcp) startDiagBridge();

        if ((settings.store.nativeStreamEndpoint || settings.store.streamProbe) && settings.store.unlockNativeVideoGate) {
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
    },

    stop() {
        stopStreamProbe();
        stopDiagBridge();
        setNativeStreamEndpoint("");
    },
});
