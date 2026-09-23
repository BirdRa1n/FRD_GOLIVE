// Picker de transmissão imitando o "Compartilhamento de tela" nativo do Discord:
// abas Aplicativos/Telas com prévias, e a qualidade (resolução + FPS) e o som
// escolhidos no mesmo modal. Usa o Modal nativo do Discord (via Vencord), então
// herda cabeçalho, animação, foco e tema do cliente.

import { Checkbox, Modal, openModal, React } from "@webpack/common";

import type { NativeSource } from "../types";

export interface GoLiveChoice {
    /** null quando não há captura nativa (a janela é escolhida no passo seguinte). */
    source: NativeSource | null;
    /** Altura em px; 0 = resolução da fonte. */
    maxHeight: number;
    fps: number;
    audio: boolean;
}

export interface GoLivePickerOptions {
    /** Fontes do desktopCapturer; null = sem captura nativa (só qualidade). */
    sources: NativeSource[] | null;
    /** Limites do admin (0 = sem limite). */
    policyMaxHeight: number;
    policyMaxFps: number;
    /** Última escolha do usuário. */
    initial: { maxHeight: number; fps: number; audio: boolean; };
    /** Dá para compartilhar som nesta máquina. */
    audioSupported: boolean;
    /** Por que não dá (quando audioSupported = false). */
    audioBlockedReason?: string;
    /** Observação sobre o som (ex.: "sem o áudio da call"). */
    audioNote?: string;
    /** A observação é um alerta (ex.: o som INCLUI a call). */
    audioNoteWarn?: boolean;
}

const RESOLUTIONS = [
    { value: 720, label: "720p" },
    { value: 1080, label: "1080p" },
    { value: 1440, label: "1440p" },
    { value: 0, label: "Fonte" },
];
const FRAME_RATES = [15, 30, 60];

type Tab = "window" | "screen";

function allowedHeight(value: number, cap: number): boolean {
    if (cap <= 0) return true;
    return value > 0 && value <= cap; // "Fonte" é ilimitado: bloqueado se há teto
}

/** Maior opção permitida que não passa do pedido (ou a menor permitida). */
function clampChoice(value: number, options: number[], allowed: (v: number) => boolean): number {
    if (allowed(value)) return value;
    const ok = options.filter(allowed);
    return ok.filter(v => v !== 0 && v <= value).pop() ?? ok[0] ?? value;
}

function LockIcon() {
    return (
        <svg className="frd-gl-lock" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="currentColor">
            <path d="M12 2a5 5 0 0 1 5 5v2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Z" />
        </svg>
    );
}

function Pills<T extends number>({ label, options, value, onChange, isAllowed, lockedTitle }: {
    label: string;
    options: { value: T; label: string; }[];
    value: T;
    onChange(v: T): void;
    isAllowed(v: T): boolean;
    lockedTitle: string;
}) {
    return (
        <div className="frd-gl-field">
            <div className="frd-gl-eyebrow">{label}</div>
            <div className="frd-gl-pills" role="radiogroup" aria-label={label}>
                {options.map(o => {
                    const allowed = isAllowed(o.value);
                    const selected = o.value === value;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!allowed}
                            title={allowed ? undefined : lockedTitle}
                            className={"frd-gl-pill" + (selected ? " frd-gl-pill-on" : "")}
                            onClick={() => onChange(o.value)}
                        >
                            {!allowed && <LockIcon />}
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function SourceGrid({ sources, tab, selectedId, onSelect, onConfirm }: {
    sources: NativeSource[];
    tab: Tab;
    selectedId: string | null;
    onSelect(s: NativeSource): void;
    onConfirm(s: NativeSource): void;
}) {
    const list = sources.filter(s => s.kind === tab);
    if (list.length === 0) {
        return <div className="frd-gl-empty">{tab === "window" ? "Nenhum aplicativo aberto para compartilhar." : "Nenhuma tela encontrada."}</div>;
    }
    return (
        <div className="frd-gl-grid">
            {list.map(s => (
                <button
                    key={s.id}
                    type="button"
                    className={"frd-gl-source" + (s.id === selectedId ? " frd-gl-source-on" : "")}
                    aria-pressed={s.id === selectedId}
                    onClick={() => onSelect(s)}
                    onDoubleClick={() => onConfirm(s)}
                    title={s.name}
                >
                    <span className="frd-gl-thumb">
                        <img src={s.thumbnail} alt="" draggable={false} />
                    </span>
                    <span className="frd-gl-name">
                        {s.appIcon && <img className="frd-gl-appicon" src={s.appIcon} alt="" />}
                        <span>{s.name}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

function GoLiveDialog({ modalProps, opts, onDone }: {
    modalProps: { transitionState: number; onClose(): void; };
    opts: GoLivePickerOptions;
    onDone(choice: GoLiveChoice | null): void;
}) {
    const { sources, policyMaxHeight, policyMaxFps } = opts;
    const heightOk = (v: number) => allowedHeight(v, policyMaxHeight);
    const fpsOk = (v: number) => policyMaxFps <= 0 || v <= policyMaxFps;

    const hasWindows = !!sources?.some(s => s.kind === "window");
    const [tab, setTab] = React.useState<Tab>(hasWindows ? "window" : "screen");
    const [selected, setSelected] = React.useState<NativeSource | null>(null);
    const [maxHeight, setMaxHeight] = React.useState(() =>
        clampChoice(opts.initial.maxHeight, RESOLUTIONS.map(r => r.value), heightOk));
    const [fps, setFps] = React.useState(() => clampChoice(opts.initial.fps, FRAME_RATES, fpsOk));
    const [audio, setAudio] = React.useState(opts.audioSupported && opts.initial.audio);

    const confirm = (source: NativeSource | null) => {
        onDone({ source, maxHeight, fps, audio: opts.audioSupported && audio });
        modalProps.onClose();
    };

    const canGoLive = sources === null || selected !== null;
    const limitText = policyMaxHeight > 0 || policyMaxFps > 0
        ? `O admin do servidor limita sua transmissão a ${policyMaxHeight > 0 ? `${policyMaxHeight}p` : "qualquer resolução"}${policyMaxFps > 0 ? ` · ${policyMaxFps} fps` : ""}.`
        : null;

    const count = (k: Tab) => sources?.filter(s => s.kind === k).length ?? 0;

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Compartilhamento de tela"
            subtitle="A transmissão vai pelo servidor privado da sua empresa, não pelo Discord."
            actions={[
                { text: "Cancelar", variant: "secondary", onClick: modalProps.onClose },
                {
                    text: sources === null ? "Escolher janela e transmitir" : "Transmitir ao vivo",
                    variant: "primary",
                    disabled: !canGoLive,
                    onClick: () => confirm(selected),
                },
            ]}
            actionBarInput={
                <div className="frd-gl-audio" title={opts.audioSupported ? opts.audioNote : opts.audioBlockedReason}>
                    <Checkbox
                        value={audio}
                        disabled={!opts.audioSupported}
                        onChange={(_e: unknown, v: boolean) => setAudio(v)}
                        size={18}
                    >
                        <span className="frd-gl-audio-label">
                            Compartilhar som
                            <span className={"frd-gl-audio-note" + (opts.audioNoteWarn ? " frd-gl-audio-warn" : "")}>
                                {opts.audioSupported ? opts.audioNote : opts.audioBlockedReason}
                            </span>
                        </span>
                    </Checkbox>
                </div>
            }
        >
            <div className="frd-gl">
                {sources !== null && (
                    <>
                        <div className="frd-gl-tabs" role="tablist">
                            {(["window", "screen"] as Tab[]).map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === t}
                                    className={"frd-gl-tab" + (tab === t ? " frd-gl-tab-on" : "")}
                                    onClick={() => setTab(t)}
                                >
                                    {t === "window" ? "Aplicativos" : "Telas"}
                                    <span className="frd-gl-count">{count(t)}</span>
                                </button>
                            ))}
                        </div>
                        <SourceGrid
                            sources={sources}
                            tab={tab}
                            selectedId={selected?.id ?? null}
                            onSelect={setSelected}
                            onConfirm={s => confirm(s)}
                        />
                    </>
                )}
                {sources === null && (
                    <div className="frd-gl-empty">Você escolhe a janela ou tela no próximo passo.</div>
                )}

                <div className="frd-gl-quality">
                    <div className="frd-gl-quality-title">Qualidade da transmissão</div>
                    <div className="frd-gl-quality-row">
                        <Pills
                            label="Resolução"
                            options={RESOLUTIONS}
                            value={maxHeight}
                            onChange={setMaxHeight}
                            isAllowed={heightOk}
                            lockedTitle="Acima do limite definido pelo admin"
                        />
                        <Pills
                            label="Taxa de quadros"
                            options={FRAME_RATES.map(v => ({ value: v, label: `${v} FPS` }))}
                            value={fps}
                            onChange={setFps}
                            isAllowed={fpsOk}
                            lockedTitle="Acima do limite definido pelo admin"
                        />
                    </div>
                    {limitText && <div className="frd-gl-hint">{limitText}</div>}
                </div>
            </div>
        </Modal>
    );
}

let pending: ((c: GoLiveChoice | null) => void) | null = null;

/** Abre o picker. Resolve com a escolha ou null se o usuário cancelar. */
export function openGoLivePicker(opts: GoLivePickerOptions): Promise<GoLiveChoice | null> {
    pending?.(null); // um picker por vez
    return new Promise(resolve => {
        let settled = false;
        const done = (c: GoLiveChoice | null) => {
            if (settled) return;
            settled = true;
            if (pending === done) pending = null;
            resolve(c);
        };
        pending = done;
        openModal(
            props => <GoLiveDialog modalProps={props} opts={opts} onDone={done} />,
            { onCloseCallback: () => done(null) },
        );
    });
}
