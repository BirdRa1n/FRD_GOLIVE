import { React } from "@webpack/common";

import type { RemoteStreamInfo } from "../rtc/session";
import { streamStore } from "../state/streamStore";
import { volumeIcon } from "./icons";

function Video({ info, className }: { info: RemoteStreamInfo; className: string; }) {
    const ref = React.useRef<HTMLVideoElement>(null);
    React.useEffect(() => {
        if (ref.current) ref.current.srcObject = info.stream;
    }, [info.stream]);
    return <video ref={ref} autoPlay playsInline muted className={className} />;
}

function Icon({ svg }: { svg: string; }) {
    return <span className="frd-icon" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Mute + slider de volume da transmissão em foco (só afeta quem assiste). */
function VolumeControl({ info }: { info: RemoteStreamInfo; }) {
    const hasAudio = info.stream.getAudioTracks().length > 0;
    const volume = streamStore.getVolume(info.id);
    const muted = streamStore.isMuted(info.id);
    const shown = hasAudio && !muted ? volume : 0;
    const pct = Math.round(shown * 100);

    const onWheel = (e: React.WheelEvent) => {
        if (!hasAudio) return;
        streamStore.setVolume(info.id, volume + (e.deltaY < 0 ? 0.05 : -0.05));
    };

    return (
        <div className={"frd-vol frd-vol-inline" + (hasAudio ? "" : " frd-vol-disabled")} onWheel={onWheel}>
            <button
                className="frd-native-btn frd-vol-btn"
                disabled={!hasAudio}
                title={!hasAudio ? "Transmissão sem áudio" : muted ? "Ativar som" : "Silenciar"}
                onClick={() => streamStore.toggleMute(info.id)}
            >
                <Icon svg={volumeIcon(volume, muted || !hasAudio)} />
            </button>
            <input
                type="range"
                className="frd-vol-range"
                min={0}
                max={100}
                step={1}
                value={pct}
                disabled={!hasAudio}
                aria-label="Volume da transmissão"
                style={{ "--frd-fill": `${pct}%` } as React.CSSProperties}
                onChange={e => streamStore.setVolume(info.id, Number(e.currentTarget.value) / 100)}
            />
            <span className="frd-vol-pct">{hasAudio ? `${pct}%` : "sem áudio"}</span>
        </div>
    );
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
                    <VolumeControl info={focused} />
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
