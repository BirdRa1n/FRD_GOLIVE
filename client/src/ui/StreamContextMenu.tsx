// Menu de botão direito sobre uma transmissão privada, com os componentes de
// menu nativos do Discord (mesmo visual do "Volume do usuário"):
//  - no tile/teatro: menu próprio (openStreamContextMenu);
//  - no menu de usuário do Discord (lista da call, perfil): grupo extra via
//    patch "user-context" (userContextPatch).

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ContextMenuApi, Menu, React } from "@webpack/common";

import { streamStore } from "../state/streamStore";

/** Re-renderiza o componente quando o store muda (checkboxes refletem na hora). */
function useStore(): void {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => streamStore.subscribe(force), []);
}

/**
 * Slider de volume com assinatura própria ao store: funciona até dentro do patch
 * do menu de usuário, que não re-renderiza quando o nosso store muda.
 */
function VolumeSlider({ userId, sliderRef, ...props }: { userId: string; sliderRef: React.Ref<unknown>; }) {
    useStore();
    return (
        <Menu.MenuSliderControl
            {...props}
            ref={sliderRef}
            value={Math.round(streamStore.getVolume(userId) * 100)}
            minValue={0}
            maxValue={100}
            renderValue={(v: number) => `${Math.round(v)}%`}
            onChange={(v: number) => streamStore.setVolume(userId, v / 100)}
        />
    );
}

/**
 * Itens de volume/silenciar de um usuário — compartilhados pelos dois menus.
 * O parser de menu do Discord só entende itens Menu.* diretos (nada de wrapper).
 * `closeOnToggle`: no patch do menu de usuário os checkboxes não re-renderizam,
 * então fechamos o menu ao alternar (em vez de mostrar um estado velho).
 */
function streamItems(userId: string, keyPrefix: string, closeOnToggle = false) {
    const info = streamStore.getStream(userId);
    const hasAudio = !!info && info.stream.getAudioTracks().length > 0;
    const after = () => { if (closeOnToggle) ContextMenuApi.closeContextMenu(); };

    const items: React.ReactElement[] = [];
    if (hasAudio) {
        items.push(
            <Menu.MenuControlItem
                key={`${keyPrefix}-volume`}
                id={`${keyPrefix}-volume`}
                label="Volume da transmissão"
                control={(props: Record<string, unknown>, ref: React.Ref<unknown>) => (
                    <VolumeSlider {...props} userId={userId} sliderRef={ref} />
                )}
            />,
            <Menu.MenuCheckboxItem
                key={`${keyPrefix}-mute`}
                id={`${keyPrefix}-mute`}
                label="Silenciar transmissão"
                checked={streamStore.isMuted(userId)}
                action={() => { streamStore.toggleMute(userId); after(); }}
            />,
        );
    } else if (info) {
        items.push(
            <Menu.MenuItem key={`${keyPrefix}-noaudio`} id={`${keyPrefix}-noaudio`} label="Transmissão sem áudio" disabled />,
        );
    }
    items.push(
        <Menu.MenuCheckboxItem
            key={`${keyPrefix}-sounds`}
            id={`${keyPrefix}-sounds`}
            label="Silenciar sons de transmissão"
            checked={streamStore.isSoundMuted(userId)}
            action={() => { streamStore.toggleSoundMute(userId); after(); }}
        />,
    );
    return items;
}

function StreamMenu({ userId, onClose, onFullscreen }: { userId: string; onClose(): void; onFullscreen?(): void; }) {
    useStore();
    const theaterOpen = streamStore.focusedId === userId;
    return (
        <Menu.Menu navId="frd-stream-context" onClose={onClose} aria-label="Opções da transmissão">
            <Menu.MenuGroup>{streamItems(userId, "frd-stream")}</Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="frd-stream-theater"
                    label={theaterOpen ? "Sair do modo teatro" : "Modo teatro"}
                    action={() => streamStore.setFocused(theaterOpen ? null : userId)}
                />
                {onFullscreen && <Menu.MenuItem id="frd-stream-fullscreen" label="Tela cheia" action={onFullscreen} />}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

/** Abre o menu da transmissão de `userId` (evento de contextmenu do DOM ou React). */
export function openStreamContextMenu(event: MouseEvent | React.MouseEvent, userId: string, onFullscreen?: () => void): void {
    event.preventDefault();
    event.stopPropagation();
    ContextMenuApi.openContextMenu(event as unknown as React.UIEvent, () => (
        <StreamMenu userId={userId} onClose={ContextMenuApi.closeContextMenu} onFullscreen={onFullscreen} />
    ));
}

/**
 * Patch do menu de usuário do Discord: adiciona o grupo "Transmissão privada"
 * quando a pessoa está transmitindo pelo FRD GoLive (ou teve os sons silenciados,
 * para dar como desfazer mesmo fora da transmissão).
 */
export const userContextPatch: NavContextMenuPatchCallback = (children, props: { user?: { id: string; }; }) => {
    const id = props?.user?.id;
    if (!id) return;
    if (!streamStore.getStream(id) && !streamStore.isSoundMuted(id)) return;
    children.push(
        <Menu.MenuGroup key="frd-user-group" label="Transmissão privada">
            {streamItems(id, "frd-user", true)}
        </Menu.MenuGroup>,
    );
};
