import { React } from "@webpack/common";

import {
    reconnectNow,
    startCameraShare,
    startScreenShare,
    stopSharing,
} from "../rtc/controller";
import type { RemoteStreamInfo } from "../rtc/session";
import { streamStore } from "../state/streamStore";

function VideoTile({ info }: { info: RemoteStreamInfo; }) {
    const ref = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        if (ref.current) ref.current.srcObject = info.stream;
    }, [info.stream]);

    return (
        <div
            className="frd-tile"
            role="button"
            tabIndex={0}
            title="Assistir em tela cheia"
            onClick={() => streamStore.setFocused(info.id)}
        >
            <video ref={ref} autoPlay playsInline muted className="frd-video" />
            <span className="frd-name">{info.name}</span>
            <span className="frd-tile-expand">⛶</span>
        </div>
    );
}

function StatusBanner() {
    const { status, errorMessage } = streamStore;

    if (status === "connecting") {
        return <div className="frd-status">Conectando ao servidor privado…</div>;
    }
    if (status === "reconnecting") {
        return <div className="frd-status frd-status-warn">Reconectando…</div>;
    }
    if (status === "error") {
        return (
            <div className="frd-status frd-status-error">
                <span>{errorMessage ?? "Erro de conexão."}</span>
                <button className="frd-btn frd-retry" onClick={() => void reconnectNow()}>
                    Tentar de novo
                </button>
            </div>
        );
    }
    return null;
}

export function PrivateStreamPanel() {
    // Re-render sempre que o store mudar.
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(forceRender), []);

    // Fora de call / desligado: não mostra nada.
    if (streamStore.status === "idle") return null;

    const streams = streamStore.getStreams();
    const canShare = streamStore.status === "connected";
    const { sharingKind } = streamStore;

    return (
        <div className="frd-panel">
            <div className="frd-header">
                <span className="frd-title">Transmissão privada</span>
                {sharingKind && (
                    <span className="frd-live" title="Você está transmitindo">
                        <span className="frd-live-dot" />
                        {sharingKind === "screen" ? "Transmitindo tela" : "Transmitindo câmera"}
                    </span>
                )}
            </div>

            <StatusBanner />

            <div className="frd-actions">
                {sharingKind ? (
                    <button className="frd-btn frd-btn-stop" onClick={() => void stopSharing()}>
                        Parar de transmitir
                    </button>
                ) : (
                    <>
                        <button
                            className="frd-btn"
                            disabled={!canShare}
                            onClick={() => void startScreenShare()}
                        >
                            Compartilhar tela
                        </button>
                        <button
                            className="frd-btn frd-btn-secondary"
                            disabled={!canShare}
                            onClick={() => void startCameraShare()}
                        >
                            Câmera
                        </button>
                    </>
                )}
            </div>

            <div className="frd-grid">
                {streams.length === 0 ? (
                    canShare ? (
                        <div className="frd-empty">Ninguém transmitindo ainda.</div>
                    ) : null
                ) : (
                    streams.map(s => <VideoTile key={s.id} info={s} />)
                )}
            </div>
        </div>
    );
}
