import { React } from "@webpack/common";

import type { RemoteStreamInfo } from "../rtc/session";
import { streamStore } from "../state/streamStore";

function Video({ info, className }: { info: RemoteStreamInfo; className: string; }) {
    const ref = React.useRef<HTMLVideoElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.srcObject = info.stream;
    }, [info.stream]);
    return <video ref={ref} autoPlay playsInline muted className={className} />;
}

/** Modo teatro: stream em foco grande + filmstrip dos outros (estilo Go Live). */
export function TheaterView() {
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(forceRender), []);

    const stageRef = React.useRef<HTMLDivElement>(null);

    const focusedId = streamStore.focusedId;

    // Fecha com Esc.
    React.useEffect(() => {
        if (!focusedId) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") streamStore.setFocused(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [focusedId]);

    if (!focusedId) return null;

    const streams = streamStore.getStreams();
    const focused = streams.find(s => s.id === focusedId);
    if (!focused) {
        streamStore.setFocused(null);
        return null;
    }

    const requestFullscreen = () => {
        void stageRef.current?.requestFullscreen?.();
    };

    return (
        <div className="frd-theater">
            <div className="frd-theater-top">
                <span className="frd-theater-name">
                    <span className="frd-live-dot" /> {focused.name}
                </span>
                <div className="frd-theater-actions">
                    <button className="frd-btn frd-btn-secondary" onClick={requestFullscreen}>
                        Tela cheia
                    </button>
                    <button className="frd-btn frd-btn-stop" onClick={() => streamStore.setFocused(null)}>
                        Fechar
                    </button>
                </div>
            </div>

            <div className="frd-theater-stage" ref={stageRef}>
                <Video info={focused} className="frd-theater-video" />
            </div>

            {streams.length > 1 && (
                <div className="frd-theater-strip">
                    {streams.map(s => (
                        <button
                            key={s.id}
                            className={"frd-strip-item" + (s.id === focusedId ? " frd-strip-active" : "")}
                            onClick={() => streamStore.setFocused(s.id)}
                            title={s.name}
                        >
                            <Video info={s} className="frd-strip-video" />
                            <span className="frd-strip-name">{s.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
