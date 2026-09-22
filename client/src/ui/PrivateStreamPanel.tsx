import { React } from "@webpack/common";

import { reconnectNow } from "../rtc/controller";
import { streamStore } from "../state/streamStore";

// Sem a janelinha flutuante: as transmissões aparecem nos tiles nativos do
// Discord e a captura é iniciada pelos botões nativos. Este componente só mostra
// um chip discreto durante conexão/erro.
export function PrivateStreamPanel() {
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(forceRender), []);

    const { status, errorMessage } = streamStore;

    if (status === "connecting" || status === "reconnecting") {
        return (
            <div className="frd-chip">
                {status === "connecting" ? "Conectando à transmissão privada…" : "Reconectando…"}
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className="frd-chip frd-chip-error">
                <span>{errorMessage ?? "Erro de conexão."}</span>
                <button className="frd-btn frd-retry" onClick={() => void reconnectNow()}>
                    Tentar de novo
                </button>
            </div>
        );
    }

    return null;
}
