import { React } from "@webpack/common";

import { streamStore } from "../state/streamStore";
import { resolvePick } from "./sourcePicker";

/** Overlay para escolher qual tela/janela capturar (modo nativo). */
export function SourcePicker() {
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(forceRender), []);

    const sources = streamStore.pickerSources;
    if (!sources) return null;

    return (
        <div className="frd-picker-backdrop" onClick={() => resolvePick(null)}>
            <div className="frd-picker" onClick={e => e.stopPropagation()}>
                <div className="frd-picker-title">Escolha o que compartilhar</div>
                <div className="frd-picker-grid">
                    {sources.map(source => (
                        <button
                            key={source.id}
                            className="frd-picker-item"
                            onClick={() => resolvePick(source)}
                            title={source.name}
                        >
                            <img className="frd-picker-thumb" src={source.thumbnail} alt="" />
                            <span className="frd-picker-name">{source.name}</span>
                        </button>
                    ))}
                </div>
                <button className="frd-btn frd-btn-secondary" onClick={() => resolvePick(null)}>
                    Cancelar
                </button>
            </div>
        </div>
    );
}
