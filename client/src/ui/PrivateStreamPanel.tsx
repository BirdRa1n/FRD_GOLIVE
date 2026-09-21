import { React } from "@webpack/common";

import { startScreenShare, stopSharing } from "../rtc/controller";
import type { RemoteStreamInfo } from "../rtc/session";
import { streamStore } from "../state/streamStore";

function VideoTile({ info }: { info: RemoteStreamInfo; }) {
    const ref = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        if (ref.current) ref.current.srcObject = info.stream;
    }, [info.stream]);

    return (
        <div className="frd-tile">
            <video ref={ref} autoPlay playsInline className="frd-video" />
            <span className="frd-name">{info.name}</span>
        </div>
    );
}

export function PrivateStreamPanel() {
    // Re-render sempre que o store mudar.
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(forceRender), []);

    if (!streamStore.connected) return null;

    const streams = streamStore.getStreams();

    return (
        <div className="frd-panel">
            <div className="frd-header">
                <span className="frd-title">Transmissão privada</span>
                {streamStore.sharing ? (
                    <button className="frd-btn frd-btn-stop" onClick={() => void stopSharing()}>
                        Parar
                    </button>
                ) : (
                    <button className="frd-btn" onClick={() => void startScreenShare()}>
                        Compartilhar tela
                    </button>
                )}
            </div>
            <div className="frd-grid">
                {streams.length === 0 ? (
                    <div className="frd-empty">Ninguém transmitindo ainda.</div>
                ) : (
                    streams.map(s => <VideoTile key={s.id} info={s} />)
                )}
            </div>
        </div>
    );
}
