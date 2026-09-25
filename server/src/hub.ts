// Páginas HTML do hub (golivefrd). Server-rendered + JS mínimo (fetch/polling).
// Visual e comportamento vêm do design system em /ui (public/ui/ui.css + ui.js);
// aqui só vai a estrutura de cada tela.

import type { AuthMode, Policy } from "./types.js";

// Versão nos links dos assets: um deploy novo não fica preso no cache (maxAge 1h).
const ASSET_V = encodeURIComponent(process.env.VERSION ?? "dev");

interface ShellOptions {
    /** Mostra a barra superior (brand + tema + ações). */
    topbar?: boolean;
    /** HTML extra à direita da barra (ex.: avatar/sair). */
    actions?: string;
    /** Fundo em malha de gradiente (login/erro). */
    mesh?: boolean;
}

const themeSwitch = `
<div class="segmented" data-theme-switch aria-label="Tema">
  <button data-value="system" aria-pressed="true">Sistema</button>
  <button data-value="light" aria-pressed="false">Claro</button>
  <button data-value="dark" aria-pressed="false">Escuro</button>
</div>`;

const shell = (title: string, body: string, opts: ShellOptions = {}) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/ui/ui.css?v=${ASSET_V}"/>
<script src="/ui/ui.js?v=${ASSET_V}"></script>
</head><body>
${opts.mesh ? `<div class="mesh" aria-hidden="true"></div>` : ""}
${opts.topbar === false ? "" : `<header class="topbar"><div class="container">
  <a class="brand" href="/"><span class="logo" data-icon="logo"></span>FRD GoLive</a>
  <div class="cluster">${opts.actions ?? ""}${themeSwitch}</div>
</div></header>`}
${body}
</body></html>`;

/** Layout centralizado com card de vidro (login, erro). */
const centered = (inner: string) => `
<main class="container" style="min-height:calc(100vh - 60px);display:grid;place-items:center;padding-block:32px">
  <div class="glass stack appear" style="width:min(400px,100%);padding:28px;--gap:18px">${inner}</div>
</main>`;

export function loginPage(configured: boolean, version: string): string {
    return shell("FRD GoLive — Entrar", centered(`
    <span class="logo logo-lg" data-icon="logo"></span>
    <div class="stack" style="--gap:6px">
      <h1 class="large-title">Transmissões privadas no Discord</h1>
      <p class="subhead">Sua tela vai pelo servidor da empresa. A voz continua no Discord.</p>
    </div>
    <div class="stack" style="--gap:8px">
      <div class="cluster muted" style="flex-wrap:nowrap;align-items:flex-start"><i data-icon="shield" class="text-ok" style="margin-top:3px"></i><span>O vídeo nunca passa pelos servidores do Discord.</span></div>
      <div class="cluster muted" style="flex-wrap:nowrap;align-items:flex-start"><i data-icon="lock" class="text-ok" style="margin-top:3px"></i><span>Um admin da sua empresa libera o seu acesso.</span></div>
    </div>
    ${configured
        ? `<a class="btn btn-blurple btn-lg btn-block" href="/login"><i data-icon="discord"></i>Entrar com Discord</a>`
        : `<div class="notice warn"><i data-icon="alert"></i><span>O login com Discord não está configurado neste servidor. Defina <span class="mono">DISCORD_CLIENT_ID</span>, <span class="mono">DISCORD_CLIENT_SECRET</span> e <span class="mono">DISCORD_REDIRECT_URI</span>.</span></div>`}
    <div class="spread caption"><span class="chip ok"><span class="dot"></span>Servidor online</span><span class="mono">v${escapeHtml(version)}</span></div>
    `), { mesh: true });
}

export function errorPage(title: string, message: string, status = 500): string {
    return shell(`FRD GoLive — ${title}`, centered(`
    <span class="icon-tile danger" data-icon="alert" style="width:44px;height:44px;border-radius:13px"></span>
    <div class="stack" style="--gap:6px">
      <h1 class="large-title">${escapeHtml(title)}</h1>
      <p class="subhead">${escapeHtml(message)}</p>
    </div>
    <div class="cluster"><a class="btn btn-prominent" href="/">Voltar ao início</a><span class="caption mono">HTTP ${status}</span></div>
    `), { mesh: true });
}

function userActions(name: string): string {
    return `<span class="avatar" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>
<a class="btn btn-icon btn-plain" href="/logout" aria-label="Sair" title="Sair"><i data-icon="logout"></i></a>`;
}

export function homePage(name: string, policy: Policy, isAdmin: boolean, authMode: AuthMode = "login"): string {
    const hero = authMode === "channels"
        ? `<div class="card-hero appear">
            <span class="caption" style="color:rgba(255,255,255,.82)">Status do acesso</span>
            <span class="title" style="font-size:26px">Acesso pelos canais</span>
            <span class="cluster"><span class="chip">quem está nos canais habilitados</span></span>
            <span class="caption" style="color:rgba(255,255,255,.82)">Você transmitiu em canais liberados pelo admin. Se o canal for desabilitado ou você for banido, a transmissão para o servidor privado é recusada.</span>
          </div>`
        : policy.enabled
        ? `<div class="card-hero appear">
            <span class="caption" style="color:rgba(255,255,255,.82)">Status do acesso</span>
            <span class="title" style="font-size:26px">Liberado para transmitir</span>
            <span class="cluster"><span class="chip">até ${policy.maxHeight}p</span><span class="chip">${policy.maxFps} fps</span></span>
          </div>`
        : `<div class="card-hero neutral appear" id="pending-card">
            <span class="caption" style="color:rgba(255,255,255,.82)">Status do acesso</span>
            <span class="title" style="font-size:26px">Aguardando o admin</span>
            <span class="caption" style="color:rgba(255,255,255,.82)">Esta página atualiza sozinha quando o acesso for liberado.</span>
            <span class="cluster"><button class="btn btn-glass btn-sm" id="req">Pedir acesso de novo</button></span>
          </div>`;

    return shell("FRD GoLive", `
    <main class="container page">
      <div class="stack" style="--gap:2px">
        <span class="caption" id="today"></span>
        <h1 class="large-title">Olá, ${escapeHtml(name)}</h1>
      </div>

      <div class="grid-auto" style="--min:300px;align-items:start">
        ${hero}
        <div>
          <p class="section-title">Como usar</p>
          <div class="group">
            <div class="row"><span class="icon-tile" data-icon="download"></span><div class="row-body"><div class="row-title">Instale o cliente</div><div class="row-detail">O instalador aplica o FRD GoLive no seu Discord.</div></div></div>
            <div class="row"><span class="icon-tile" data-icon="mic"></span><div class="row-body"><div class="row-title">Entre numa call de voz</div><div class="row-detail">O plugin conecta ao servidor privado sozinho.</div></div></div>
            <div class="row"><span class="icon-tile gradient" data-icon="monitor"></span><div class="row-body"><div class="row-title">Use os botões de tela/câmera do Discord</div><div class="row-detail">O vídeo vai pelo servidor da empresa, não pelo Discord.</div></div></div>
          </div>
        </div>
      </div>

      <div>
        <p class="section-title">Conta</p>
        <div class="group">
          ${isAdmin ? `<a class="row" href="/admin"><span class="icon-tile gradient" data-icon="chart"></span><div class="row-body"><div class="row-title">Painel admin</div><div class="row-detail">Liberar acessos, ver transmissões e métricas</div></div><span class="row-accessory chevron"></span></a>` : ""}
          <a class="row" href="/logout"><span class="icon-tile neutral" data-icon="logout"></span><div class="row-body"><div class="row-title">Sair</div></div><span class="row-accessory chevron"></span></a>
        </div>
      </div>
    </main>
    <script>
      (function () {
        var ui = window.FRDUI;
        document.getElementById("today").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
        var req = document.getElementById("req");
        if (!req) return;
        req.addEventListener("click", async function () {
          req.setAttribute("aria-busy", "true");
          var r = await fetch("/me/request-access", { method: "POST" }).catch(function () { return null; });
          req.removeAttribute("aria-busy");
          ui.toast(r && r.ok ? "Pedido enviado. Aguarde a liberação do admin." : "Não foi possível enviar o pedido.", r && r.ok ? "ok" : "danger");
        });
        // Enquanto pendente, confere a liberação a cada 8 s e recarrega quando sair.
        setInterval(async function () {
          try {
            var me = await (await fetch("/me")).json();
            if (me.policy && me.policy.enabled) { ui.toast("Acesso liberado!", "ok"); setTimeout(function () { location.reload(); }, 900); }
          } catch (e) { /* tenta de novo */ }
        }, 8000);
      })();
    </script>`, { actions: userActions(name) });
}

export function adminPage(name: string): string {
    return shell("FRD GoLive — Admin", `
    <main class="container page">
      <div class="spread">
        <div class="stack" style="--gap:2px"><span class="eyebrow">Painel admin</span><h1 class="large-title">Visão geral</h1></div>
        <span class="chip" id="updated"><span class="spinner" style="width:12px;height:12px"></span>carregando</span>
      </div>

      <div class="grid-auto" style="--min:170px" id="metrics"></div>

      <div>
        <p class="section-title">Transmissões ativas</p>
        <div class="group" id="tx"></div>
      </div>

      <div>
        <p class="section-title">Salas ao vivo</p>
        <div class="group" id="rooms"></div>
      </div>

      <div class="stack" style="--gap:6px">
        <div class="spread" style="margin-left:14px">
          <p class="section-title" style="margin:0">Canais do Discord</p>
          <div class="cluster">
            <span class="chip" id="bot-chip">verificando bot</span>
            <button class="btn btn-sm btn-plain" data-act="chan-sync">Sincronizar com o bot</button>
            <button class="btn btn-sm" data-act="chan-add"><i data-icon="plus"></i>Adicionar canal</button>
          </div>
        </div>
        <div class="group">
          <div class="row">
            <span class="icon-tile" data-icon="shield"></span>
            <div class="row-body">
              <div class="row-title">Quem pode transmitir</div>
              <div class="row-detail" id="mode-detail">…</div>
            </div>
            <div class="row-accessory">
              <div class="segmented" id="mode" aria-label="Modo de acesso">
                <button data-value="login" aria-pressed="true">Login</button>
                <button data-value="channels" aria-pressed="false">Canais</button>
              </div>
            </div>
          </div>
        </div>
        <div class="group" id="channels"></div>
      </div>

      <div>
        <p class="section-title">Pedidos pendentes</p>
        <div class="group" id="pending"></div>
      </div>

      <div class="stack" style="--gap:6px">
        <div class="spread" style="margin-left:14px">
          <p class="section-title" style="margin:0">Usuários liberados</p>
          <input class="field" id="q" type="search" placeholder="Buscar por nome ou ID" aria-label="Buscar usuários" style="max-width:260px;min-height:34px;padding-block:6px"/>
        </div>
        <div class="group" id="users"></div>
      </div>
    </main>

    <dialog class="sheet" id="quota" aria-labelledby="quota-title">
      <div class="sheet-header"><h2 class="title" id="quota-title">Liberar</h2><button class="btn btn-icon btn-plain" data-sheet-close aria-label="Fechar"><i data-icon="x"></i></button></div>
      <div class="sheet-body">
        <p class="subhead" id="quota-sub"></p>
        <div class="label">Resolução máxima
          <div class="segmented segmented-block" id="q-height" aria-label="Resolução máxima">
            <button data-value="720" aria-pressed="false">720p</button><button data-value="1080" aria-pressed="true">1080p</button><button data-value="1440" aria-pressed="false">1440p</button>
          </div>
        </div>
        <div class="label">FPS máximo
          <div class="segmented segmented-block" id="q-fps" aria-label="FPS máximo">
            <button data-value="15" aria-pressed="false">15</button><button data-value="30" aria-pressed="true">30</button><button data-value="60" aria-pressed="false">60</button>
          </div>
        </div>
      </div>
      <div class="sheet-footer"><button class="btn" data-sheet-close>Cancelar</button><button class="btn btn-prominent" id="quota-save">Liberar</button></div>
    </dialog>

    <dialog class="sheet" id="addchan" aria-labelledby="addchan-title">
      <div class="sheet-header"><h2 class="title" id="addchan-title">Adicionar canal</h2><button class="btn btn-icon btn-plain" data-sheet-close aria-label="Fechar"><i data-icon="x"></i></button></div>
      <div class="sheet-body">
        <div class="notice" id="ac-hint"><i data-icon="info"></i><span>Escolha um servidor onde o bot está e um canal de voz. Ele entra <b>habilitado</b>: todo mundo nele pode transmitir (menos os banidos) — desligue o toggle da linha se não quiser.</span></div>
        <div id="ac-bot">
          <div class="label">Servidor
            <select class="field" id="ac-guild"><option value="">Carregando…</option></select>
          </div>
          <div class="label" style="margin-top:14px">Canal de voz
            <select class="field" id="ac-channel"><option value="">Escolha o servidor primeiro</option></select>
          </div>
        </div>
        <div id="ac-manual" hidden>
          <div class="notice warn"><i data-icon="alert"></i><span>O bot não está configurado (<span class="mono">DISCORD_BOT_TOKEN</span>). Adicione pelo ID — os nomes são preenchidos quando o bot entrar.</span></div>
          <div class="label">ID do servidor (guild)
            <input class="field mono" id="ac-gid" placeholder="123456789012345678"/>
          </div>
          <div class="label" style="margin-top:14px">ID do canal de voz
            <input class="field mono" id="ac-cid" placeholder="123456789012345678"/>
          </div>
        </div>
      </div>
      <div class="sheet-footer"><button class="btn" data-sheet-close>Cancelar</button><button class="btn btn-prominent" id="ac-save">Adicionar e habilitar</button></div>
    </dialog>

    <dialog class="sheet" id="members" aria-labelledby="members-title">
      <div class="sheet-header"><h2 class="title" id="members-title">Membros</h2><button class="btn btn-icon btn-plain" data-sheet-close aria-label="Fechar"><i data-icon="x"></i></button></div>
      <div class="sheet-body">
        <p class="subhead">Quem apareceu neste canal. Banido não consegue transmitir; o resto depende do canal estar habilitado.</p>
        <div class="group" id="members-list"></div>
        <div class="label">Banir pelo ID
          <div class="cluster"><input class="field mono" id="ban-id" placeholder="user id" style="max-width:260px"/><button class="btn btn-destructive" id="ban-go">Banir</button></div>
        </div>
      </div>
      <div class="sheet-footer"><button class="btn" data-sheet-close>Fechar</button></div>
    </dialog>

    <script>
      (function () {
        var ui = window.FRDUI, esc = ui.escapeHtml;
        var $ = function (s) { return document.querySelector(s); };
        var history = { cpu: [], mem: [], tx: [], peers: [], rooms: [] };
        var users = [], transmissions = [], channels = [];
        var live = { rooms: [], settings: { authMode: "login" }, bot: false };
        var editing = null, membersChannel = null;

        async function j(u, o) { var r = await fetch(u, o); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
        function post(u, body) {
          return j(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        }
        function push(arr, v) { arr.push(v); if (arr.length > 30) arr.shift(); }
        function selected(seg) { var b = seg.querySelector('button[aria-pressed="true"]'); return b ? Number(b.dataset.value) : 0; }
        function nearest(seg, v) {
          var opts = Array.prototype.map.call(seg.querySelectorAll("button"), function (b) { return Number(b.dataset.value); });
          var best = opts.reduce(function (a, b) { return Math.abs(b - v) < Math.abs(a - v) ? b : a; }, opts[0]);
          ui.select(seg, best);
        }
        function avatar(n) { return '<span class="avatar">' + esc(ui.initials(n)) + "</span>"; }
        function empty(icon, title, sub) {
          return '<div class="empty"><i data-icon="' + icon + '"></i><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>";
        }

        function metric(label, value, series) {
          return '<div class="metric"><span class="metric-label">' + label + '</span><span class="metric-value">' + value + "</span>" + ui.sparkline(series) + "</div>";
        }

        function renderTx() {
          $("#tx").innerHTML = transmissions.length ? transmissions.map(function (t) {
            var since = t.since ? ui.duration((Date.now() - t.since) / 1000) : "—";
            return '<div class="row">' + avatar(t.name) +
              '<div class="row-body"><div class="row-title">' + esc(t.name) + ' <span class="chip live">AO VIVO</span></div>' +
              '<div class="row-detail"><i data-icon="' + (t.kind === "camera" ? "camera" : "monitor") + '"></i> ' + (t.kind === "camera" ? "Câmera" : "Tela") + ' · sala <span class="mono">' + esc(t.room) + "</span></div></div>" +
              '<span class="row-accessory mono num">' + since + "</span></div>";
          }).join("") : empty("live", "Nenhuma transmissão agora", "Quando alguém começar, aparece aqui.");
        }

        /** Transmissores de todas as salas — fonte: /admin/live (estado real do /dstream). */
        function flatStreamers() {
          var out = [];
          live.rooms.forEach(function (r) {
            r.members.forEach(function (m) {
              if (m.streamer) out.push({ userId: m.userId, name: m.name || m.userId, room: m.channelName || r.guildName || r.roomId, since: m.since || 0 });
            });
          });
          return out;
        }

        function renderRooms() {
          $("#rooms").innerHTML = live.rooms.length ? live.rooms.map(function (r) {
            var who = r.members.map(function (m) {
              var n = esc(m.name || m.userId);
              return '<span class="chip' + (m.streamer ? " live" : "") + '">' + n + (m.streamer ? " · no ar" : "") + "</span>";
            }).join("");
            return '<div class="row"><span class="icon-tile gradient" data-icon="live"></span>' +
              '<div class="row-body"><div class="row-title">' + esc(r.guildName || r.roomId) +
              ' <span class="chip' + (r.streamers ? " danger" : "") + '">' + r.streamers + " transmitindo</span>" +
              ' <span class="chip">' + r.viewers + " assistindo</span></div>" +
              '<div class="row-detail">sala <span class="mono">' + esc(r.roomId) + "</span>" +
              (r.members.some(function (m) { return m.channelName; })
                ? " · canal " + esc(r.members.filter(function (m) { return m.channelName; })[0].channelName) : "") +
              "</div>" +
              (who ? '<div class="cluster" style="margin-top:7px">' + who + "</div>" : "") +
              "</div></div>";
          }).join("") : empty("live", "Nenhuma sala agora", "Quando alguém entrar numa call, aparece aqui.");
        }

        function renderMode() {
          var mode = (live.settings && live.settings.authMode) || "login";
          ui.select($("#mode"), mode);
          $("#mode-detail").textContent = mode === "channels"
            ? "Todas as salas entram habilitadas — desligue as que não quiser. Quem está num canal habilitado pode transmitir (menos os banidos)."
            : "Só quem foi liberado na lista de usuários pode transmitir.";
          var chip = $("#bot-chip");
          chip.className = "chip " + (live.bot ? "ok" : "warn");
          chip.textContent = live.bot ? "bot conectado" : "bot não configurado";
        }

        function renderChannels() {
          $("#channels").innerHTML = channels.length ? channels.map(function (c) {
            var name = esc(c.channelName || c.channelId);
            return '<div class="row"><span class="icon-tile' + (c.enabled ? " gradient" : " neutral") + '" data-icon="mic"></span>' +
              '<div class="row-body"><div class="row-title">' + name +
              (c.enabled ? ' <span class="chip ok">habilitado</span>' : ' <span class="chip warn">desabilitado</span>') +
              (c.bans.length ? ' <span class="chip danger">' + c.bans.length + " banido(s)</span>" : "") +
              "</div>" +
              '<div class="row-detail">' + esc(c.guildName || c.guildId) + ' · <span class="mono">' + esc(c.channelId) + "</span>" +
              (c.seen.length ? " · " + c.seen.length + " membro(s) visto(s)" : "") + "</div></div>" +
              '<div class="row-accessory">' +
              '<button class="toggle" role="switch" aria-checked="' + String(Boolean(c.enabled)) + '" data-act="chan-toggle" data-id="' + esc(c.channelId) + '" aria-label="Habilitar transmissão neste canal" title="Habilitar transmissão"></button>' +
              '<button class="btn btn-sm" data-act="chan-members" data-id="' + esc(c.channelId) + '">Membros</button>' +
              '<button class="btn btn-destructive btn-sm" data-act="chan-remove" data-id="' + esc(c.channelId) + '">Remover</button>' +
              "</div></div>";
          }).join("") : empty("users", "Nenhum canal configurado", "Dê Sincronizar com o bot, adicione um canal — ou entre numa call e ele aparece aqui.");
        }

        function memberRow(c, userId, name, banned, lastSeen) {
          return '<div class="row">' + avatar(name || userId) +
            '<div class="row-body"><div class="row-title">' + esc(name || userId) +
            (banned ? ' <span class="chip danger">banido</span>' : ' <span class="chip ok">permitido</span>') + "</div>" +
            '<div class="row-detail"><span class="mono">' + esc(userId) + "</span>" + (lastSeen ? " · visto " + ui.relativeTime(lastSeen) : "") + "</div></div>" +
            '<div class="row-accessory"><button class="btn btn-sm' + (banned ? "" : " btn-destructive") + '" data-act="' + (banned ? "chan-unban" : "chan-ban") +
            '" data-id="' + esc(c.channelId) + '" data-user="' + esc(userId) + '">' + (banned ? "Permitir" : "Banir") + "</button></div></div>";
        }

        function renderMembers() {
          var c = channels.find(function (x) { return x.channelId === membersChannel; });
          if (!c) return;
          var rows = c.seen.map(function (s) {
            return memberRow(c, s.userId, s.name, c.bans.indexOf(s.userId) >= 0, s.lastSeen);
          });
          c.bans.forEach(function (id) {
            if (!c.seen.some(function (s) { return s.userId === id; })) rows.push(memberRow(c, id, undefined, true, 0));
          });
          $("#members-list").innerHTML = rows.length ? rows.join("")
            : empty("users", "Ninguém visto ainda", "Quem entrar neste canal aparece aqui.");
        }

        function renderUsers() {
          var q = $("#q").value.trim().toLowerCase();
          var pending = users.filter(function (u) { return !u.enabled; });
          var enabled = users.filter(function (u) { return u.enabled && (!q || u.name.toLowerCase().indexOf(q) >= 0 || u.id.indexOf(q) >= 0); });

          $("#pending").innerHTML = pending.length ? pending.map(function (u) {
            return '<div class="row">' + avatar(u.name) +
              '<div class="row-body"><div class="row-title">' + esc(u.name) + ' <span class="chip warn">pendente</span></div>' +
              '<div class="row-detail"><span class="mono">' + esc(u.id) + "</span> · pediu " + ui.relativeTime(u.requestedAt) + "</div></div>" +
              '<div class="row-accessory"><button class="btn btn-prominent btn-sm" data-act="enable" data-id="' + esc(u.id) + '">Liberar</button></div></div>';
          }).join("") : empty("inbox", "Nenhum pedido pendente");

          $("#users").innerHTML = enabled.length ? enabled.map(function (u) {
            return '<div class="row">' + avatar(u.name) +
              '<div class="row-body"><div class="row-title">' + esc(u.name) + ' <span class="chip ok">liberado</span></div>' +
              '<div class="row-detail"><span class="mono">' + esc(u.id) + "</span> · " + u.maxHeight + "p · " + u.maxFps + " fps" + (u.enabledAt ? " · desde " + ui.relativeTime(u.enabledAt) : "") + "</div></div>" +
              '<div class="row-accessory"><button class="btn btn-sm" data-act="edit" data-id="' + esc(u.id) + '">Editar</button>' +
              '<button class="btn btn-destructive btn-sm" data-act="revoke" data-id="' + esc(u.id) + '">Revogar</button></div></div>';
          }).join("") : empty("users", q ? "Ninguém encontrado" : "Nenhum usuário liberado ainda");
        }

        async function load() {
          try {
            var m = await j("/admin/metrics");
            users = await j("/admin/users");
            live = await j("/admin/live");
            channels = await j("/admin/channels");
            transmissions = flatStreamers();
            push(history.cpu, m.cpuLoad[0]); push(history.mem, m.memory.usedPct * 100);
            push(history.tx, transmissions.length); push(history.peers, m.peers); push(history.rooms, live.rooms.length);
            $("#metrics").innerHTML =
              metric("Transmissões", transmissions.length, history.tx) +
              metric("Salas", live.rooms.length + ' <span class="caption">ao vivo</span>', history.rooms) +
              metric("Conectados", m.peers + ' <span class="caption">em ' + m.rooms + (m.rooms === 1 ? " sala" : " salas") + "</span>", history.peers) +
              metric("CPU (1 min)", m.cpuLoad[0].toFixed(2) + ' <span class="caption">/ ' + m.cpus + "</span>", history.cpu) +
              metric("Memória", (m.memory.usedPct * 100).toFixed(0) + "%", history.mem);
            renderTx();
            renderRooms();
            renderMode();
            renderChannels();
            if (membersChannel && $("#members").open) renderMembers();
            renderUsers();
            $("#updated").innerHTML = '<span class="dot text-ok"></span>ao vivo · uptime ' + ui.duration(m.uptime);
          } catch (e) {
            $("#updated").innerHTML = '<span class="dot text-danger"></span>sem conexão';
            console.error(e);
          }
        }

        async function setEnabled(id, enabled, maxHeight, maxFps) {
          await j("/admin/users/" + encodeURIComponent(id) + "/enable", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: enabled, maxHeight: maxHeight, maxFps: maxFps }),
          });
        }

        document.addEventListener("click", async function (e) {
          var b = e.target.closest("[data-act]"); if (!b) return;
          var act = b.dataset.act, id = b.dataset.id;

          if (act === "chan-toggle") return; // o ui.js já inverteu o switch; confirmamos no "change"
          if (act === "chan-add") { openAddChan(); return; }
          if (act === "chan-sync") {
            b.setAttribute("aria-busy", "true");
            try {
              var r = await post("/admin/channels/sync", {});
              ui.toast(r.added ? r.added + " canal(is) adicionado(s), habilitados" : "Lista já está completa (" + r.total + " canais)", "ok");
              load();
            } catch (err) { ui.toast("Falha ao sincronizar: " + err.message, "danger"); }
            finally { b.removeAttribute("aria-busy"); }
            return;
          }
          if (act === "chan-members") { openMembers(id); return; }
          if (act === "chan-remove") {
            var ch = channels.find(function (x) { return x.channelId === id; }); if (!ch) return;
            var okRemove = await ui.confirm({ title: "Remover " + (ch.channelName || ch.channelId) + "?", message: "O canal sai da lista e ninguém novo passa a transmitir por ele. Quem já está na call continua até sair.", confirmLabel: "Remover", destructive: true });
            if (!okRemove) return;
            try { await j("/admin/channels/" + encodeURIComponent(id), { method: "DELETE" }); ui.toast("Canal removido", "danger"); load(); }
            catch (err) { ui.toast("Falha ao remover: " + err.message, "danger"); }
            return;
          }
          if (act === "chan-ban" || act === "chan-unban") {
            var banned = act === "chan-ban";
            try {
              await banMember(id, b.dataset.user, banned);
              ui.toast(banned ? "Membro banido de transmitir neste canal" : "Membro liberado neste canal", banned ? "danger" : "ok");
            } catch (err) { ui.toast("Falha: " + err.message, "danger"); }
            return;
          }

          var u = users.find(function (x) { return x.id === b.dataset.id; }); if (!u) return;
          if (b.dataset.act === "revoke") {
            var ok = await ui.confirm({ title: "Revogar acesso de " + u.name + "?", message: "A pessoa deixa de conseguir transmitir e assistir na hora.", confirmLabel: "Revogar", destructive: true });
            if (!ok) return;
            try { await setEnabled(u.id, false); ui.toast("Acesso de " + u.name + " revogado", "danger"); load(); }
            catch (err) { ui.toast("Falha ao revogar: " + err.message, "danger"); }
            return;
          }
          editing = u;
          $("#quota-title").textContent = (b.dataset.act === "edit" ? "Editar " : "Liberar ") + u.name;
          $("#quota-sub").textContent = "Limites aplicados à transmissão desta pessoa.";
          $("#quota-save").textContent = b.dataset.act === "edit" ? "Salvar" : "Liberar";
          nearest($("#q-height"), u.maxHeight || 1080);
          nearest($("#q-fps"), u.maxFps || 30);
          ui.openSheet("#quota");
        });

        // Toggle de um canal (o ui.js já virou o switch antes deste handler).
        document.addEventListener("change", async function (e) {
          var sw = e.target && e.target.closest ? e.target.closest('.toggle[data-act="chan-toggle"]') : null;
          if (!sw) return;
          var enabled = sw.getAttribute("aria-checked") === "true";
          try {
            await post("/admin/channels/" + encodeURIComponent(sw.dataset.id) + "/enable", { enabled: enabled });
            ui.toast(enabled ? "Canal habilitado — os membros podem transmitir" : "Canal desabilitado", enabled ? "ok" : "danger");
            channels = await j("/admin/channels");
            renderChannels();
          } catch (err) {
            ui.toast("Falha: " + err.message, "danger");
            sw.setAttribute("aria-checked", String(!enabled));
          }
        });

        // Modo de acesso: login (liberação manual) OU canais (todas as salas ligadas por padrão).
        $("#mode").addEventListener("change", async function (e) {
          var mode = e.detail && e.detail.value;
          if (mode !== "login" && mode !== "channels") return;
          try {
            var s = await post("/admin/settings", { authMode: mode });
            var msg;
            if (mode !== "channels") msg = "Modo login ativo: liberação manual por usuário";
            else if (!live.bot) msg = "Modo canais ativo — sem bot, adicione os canais pelos IDs";
            else if (s.seeded) msg = s.seeded.added ? s.seeded.added + " canal(is) novo(s) habilitado(s) · " + s.seeded.total + " no total" : s.seeded.total + " canais habilitados";
            else msg = "Modo canais ativo (não deu para sincronizar: " + (s.seededError || "erro") + ")";
            ui.toast(msg, "ok");
            load();
          } catch (err) { ui.toast("Falha: " + err.message, "danger"); load(); }
        });

        // --- Adicionar canal (bot) ---
        async function openAddChan() {
          var manual = !live.bot;
          $("#ac-bot").hidden = manual;
          $("#ac-manual").hidden = !manual;
          ui.openSheet("#addchan");
          if (manual) return;
          var sel = $("#ac-guild");
          sel.innerHTML = '<option value="">Carregando…</option>';
          try {
            var gs = await j("/admin/bot/guilds");
            sel.innerHTML = '<option value="">Escolha o servidor</option>' + gs.map(function (g) {
              return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>";
            }).join("");
            if (!gs.length) sel.innerHTML = '<option value="">O bot não está em nenhum servidor</option>';
          } catch (err) { sel.innerHTML = '<option value="">Falha: ' + esc(err.message) + "</option>"; }
          $("#ac-channel").innerHTML = '<option value="">Escolha o servidor primeiro</option>';
        }

        $("#ac-guild").addEventListener("change", async function () {
          var gid = this.value, sel = $("#ac-channel");
          if (!gid) { sel.innerHTML = '<option value="">Escolha o servidor primeiro</option>'; return; }
          sel.innerHTML = '<option value="">Carregando…</option>';
          try {
            var cs = await j("/admin/bot/guilds/" + encodeURIComponent(gid) + "/channels");
            sel.innerHTML = '<option value="">Escolha o canal</option>' + cs.map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.type === 13 ? " (palco)" : "") + "</option>";
            }).join("");
            if (!cs.length) sel.innerHTML = '<option value="">Sem canais de voz neste servidor</option>';
          } catch (err) { sel.innerHTML = '<option value="">Falha: ' + esc(err.message) + "</option>"; }
        });

        $("#ac-save").addEventListener("click", async function () {
          var manual = !$("#ac-manual").hidden;
          var guildId = manual ? $("#ac-gid").value.trim() : $("#ac-guild").value;
          var channelId = manual ? $("#ac-cid").value.trim() : $("#ac-channel").value;
          var guildName = manual ? "" : (($("#ac-guild").selectedOptions[0] || {}).textContent || "");
          var channelName = manual ? "" : (($("#ac-channel").selectedOptions[0] || {}).textContent || "");
          if (!guildId || !channelId) { ui.toast("Escolha o servidor e o canal", "danger"); return; }
          var btn = this; btn.setAttribute("aria-busy", "true");
          try {
            await post("/admin/channels", { guildId: guildId, guildName: guildName, channelId: channelId, channelName: channelName, enabled: true });
            ui.closeSheet("#addchan", "ok");
            ui.toast("Canal adicionado e habilitado", "ok");
            load();
          } catch (err) { ui.toast("Falha ao adicionar: " + err.message, "danger"); }
          finally { btn.removeAttribute("aria-busy"); }
        });

        // --- Membros de um canal (permitir/banir) ---
        function openMembers(id) {
          var c = channels.find(function (x) { return x.channelId === id; }); if (!c) return;
          membersChannel = id;
          $("#members-title").textContent = c.channelName || c.channelId;
          renderMembers();
          ui.openSheet("#members");
        }

        async function banMember(channelId, userId, banned) {
          await post("/admin/channels/" + encodeURIComponent(channelId) + "/ban", { userId: userId, banned: banned });
          channels = await j("/admin/channels");
          renderChannels(); renderMembers();
        }

        $("#ban-go").addEventListener("click", async function () {
          var id = $("#ban-id").value.trim();
          if (!membersChannel || !id) { ui.toast("Digite o ID do membro", "danger"); return; }
          try { await banMember(membersChannel, id, true); $("#ban-id").value = ""; ui.toast("Membro banido", "danger"); }
          catch (err) { ui.toast("Falha: " + err.message, "danger"); }
        });

        $("#quota-save").addEventListener("click", async function () {
          if (!editing) return;
          var btn = this; btn.setAttribute("aria-busy", "true");
          try {
            await setEnabled(editing.id, true, selected($("#q-height")), selected($("#q-fps")));
            ui.closeSheet("#quota", "ok");
            ui.toast(editing.name + " liberado · " + selected($("#q-height")) + "p " + selected($("#q-fps")) + " fps", "ok");
            load();
          } catch (err) { ui.toast("Falha ao salvar: " + err.message, "danger"); }
          finally { btn.removeAttribute("aria-busy"); }
        });

        $("#q").addEventListener("input", renderUsers);
        load(); setInterval(load, 4000);
        setInterval(renderTx, 1000); // relógio das durações
      })();
    </script>`, { actions: `<a class="btn btn-sm btn-plain" href="/">Início</a>${userActions(name)}` });
}

function initials(name: string): string {
    const parts = name.replace(/[._-]+/g, " ").trim().split(/\s+/);
    const first = parts[0] ?? "?";
    return ((first[0] ?? "?") + (parts[1]?.[0] ?? first[1] ?? "")).toUpperCase();
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
