import { Alerts, FluxDispatcher } from "@webpack/common";
import definePlugin from "@utils/types";

import { startDiagBridge, stopDiagBridge } from "./diagBridge";
import { disableLogCollector, startLogCollector, stopLogCollector } from "./logCollector";
import { isNativeStreamConnection, setNativeStreamEndpoint } from "./probe/nativeStreamRedirect";
import { startStreamProbe, stopStreamProbe } from "./probe/streamProbe";
import { onLogUploadChange, settings } from "./settings";

function applyLogUpload(on: boolean): void {
    if (on) {
        if (settings.store.nativeStreamEndpoint) startLogCollector();
        return;
    }
    disableLogCollector();
    Alerts.show({
        title: "Desligar o envio de logs?",
        body: "Sem os logs, fica impossível a gente encontrar eventuais erros — como as quedas de conexão com o Discord. Os logs que ainda não foram enviados foram apagados.",
        confirmText: "Manter desligado",
        cancelText: "Ligar de novo",
        onCancel: () => {
            settings.store.logUpload = true;
            applyLogUpload(true);
        },
    });
}

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
        onLogUploadChange(applyLogUpload);
        // Antes da sonda e da ponte MCP: o console delas também entra nos logs.
        // Uma falha no diagnóstico não pode impedir o redirecionamento: sem ele, a tela iria para o Discord.
        try {
            if (settings.store.logUpload && settings.store.nativeStreamEndpoint) startLogCollector();
        } catch (e) {
            console.error("[FRD GoLive] falha ao iniciar os logs:", e);
        }

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
        stopLogCollector();
        setNativeStreamEndpoint("");
    },
});
