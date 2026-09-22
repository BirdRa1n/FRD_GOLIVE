/* global window, document */
const api = window.installer;
const log = document.getElementById("log");
const hostInput = document.getElementById("host");
const applyBtn = document.getElementById("apply");

let defaults = { defaultHost: "", hubUrl: "" };
api.defaults().then(d => { defaults = d; });

// alterna o campo de host conforme a opção
for (const radio of document.querySelectorAll('input[name="server"]')) {
    radio.addEventListener("change", () => {
        const own = document.querySelector('input[name="server"]:checked').value === "own";
        hostInput.classList.toggle("hidden", !own);
    });
}

function say(msg, cls) {
    log.textContent = msg;
    log.className = cls || "";
}

applyBtn.addEventListener("click", async () => {
    const own = document.querySelector('input[name="server"]:checked').value === "own";
    const host = own ? hostInput.value.trim() : defaults.defaultHost;
    if (own && !host) { say("Informe o host do seu servidor.", "err"); return; }

    applyBtn.disabled = true;
    say("Buscando config no servidor e aplicando a modificação…\n(Feche o Discord se pedir.)");
    try {
        const r = await api.apply(host);
        document.getElementById("done-msg").textContent =
            `Servidor: ${r.domain} · transporte: ${r.transport}. Reinicie o Discord se ele estiver aberto.`;
        document.getElementById("step-config").classList.add("hidden");
        document.getElementById("step-done").classList.remove("hidden");
    } catch (e) {
        say("Falha: " + (e && e.message ? e.message : e), "err");
        applyBtn.disabled = false;
    }
});

document.getElementById("open-hub").addEventListener("click", () => api.openHub());
document.getElementById("restart").addEventListener("click", () => {
    document.getElementById("step-done").classList.add("hidden");
    document.getElementById("step-config").classList.remove("hidden");
    applyBtn.disabled = false;
    say("");
});
