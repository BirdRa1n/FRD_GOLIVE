// Tipos compartilhados sem dependências (usáveis nas camadas pura e Vencord).

/** Uma fonte de captura de tela/janela retornada pelo desktopCapturer do Electron. */
export interface NativeSource {
    id: string;
    name: string;
    /** thumbnail como data URL (image/png). */
    thumbnail: string;
}
