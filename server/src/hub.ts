
import type { AuthMode, Policy } from "./types.js";

const ASSET_V = encodeURIComponent(process.env.VERSION ?? "dev");

interface ShellOptions {
    topbar?: boolean;
    actions?: string;
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
<script src="/ui/ui-canvas.js?v=${ASSET_V}"></script>
</head><body>
${opts.mesh ? `<div class="mesh" aria-hidden="true"></div>` : ""}
${opts.topbar === false ? "" : `<header class="topbar"><div class="container">
  <a class="brand" href="/"><span class="logo" data-icon="logo"></span>FRD GoLive</a>
  <div class="cluster">${opts.actions ?? ""}${themeSwitch}</div>
</div></header>`}
${body}
</body></html>`;

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
    const hero = authMode === "channels" || (authMode === "both" && !policy.enabled)
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
    <div class="app-shell">
      <nav class="rail" aria-label="Seções do painel">
        <a class="logo" href="/" data-icon="logo" aria-label="Início"></a>
        <button class="rail-btn" data-tab="overview" aria-current="page"><i data-icon="pulse"></i>Ao vivo<span class="badge" id="live-badge" hidden></span></button>
        <button class="rail-btn" data-tab="groups"><i data-icon="grid"></i>Grupos</button>
        <button class="rail-btn" data-tab="users"><i data-icon="users"></i>Pessoas<span class="badge" id="pending-badge" hidden></span></button>
        <button class="rail-btn" data-tab="logs"><i data-icon="doc"></i>Logs</button>
        <button class="rail-btn" data-tab="settings"><i data-icon="settings"></i>Ajustes</button>
        <span class="rail-spacer"></span>
        <a class="rail-btn rail-extra" href="/"><i data-icon="home"></i>Início</a>
        <a class="rail-btn rail-extra" href="/logout"><i data-icon="logout"></i>Sair</a>
      </nav>

      <main class="app-main">
        <div class="app-bar">
          <div>
            <h1 class="large-title" id="page-title">Ao vivo</h1>
            <div class="subtitle" id="page-sub">Quem está transmitindo agora e como está o servidor</div>
          </div>
          <div class="cluster">
            <span class="chip" id="updated"><span class="spinner" style="width:12px;height:12px"></span>carregando</span>
            ${themeSwitch}
            <span class="avatar" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>
          </div>
        </div>

        <section id="tab-overview" class="bento">
          <div class="tile w2 h2 in" style="--i:0">
            <p class="tile-title">Mapa ao vivo <span>a mídia passa pelo hub</span></p>
            <canvas class="chart" id="cv-map" style="height:340px" role="img" aria-label="Mapa das salas ao vivo: hub no centro, salas ao redor, pessoas em volta de cada sala"></canvas>
          </div>
          <div class="tile accent in" style="--i:1">
            <p class="tile-title">No ar agora</p>
            <div class="big" id="m-live">0</div>
            <div class="delta" id="m-live-sub">—</div>
          </div>
          <div class="tile in" style="--i:2">
            <p class="tile-title">Assistindo</p>
            <div class="big" id="m-viewers">0</div>
            <div class="delta" id="m-viewers-sub">—</div>
          </div>
          <div class="tile in" style="--i:3">
            <p class="tile-title">Latência <span>conexão de controle</span></p>
            <canvas class="chart" id="cv-gauge" style="height:104px" role="img" aria-label="Latência mediana da conexão de controle"></canvas>
          </div>
          <div class="tile in" style="--i:4">
            <p class="tile-title">Banda recebida</p>
            <div class="big"><span id="m-kbps">0</span><small>Mb/s</small></div>
            <div class="delta" id="m-kbps-sub">—</div>
          </div>
          <div class="tile w2 in" style="--i:5">
            <p class="tile-title">Bitrate das transmissões <span>última hora</span></p>
            <canvas class="chart" id="cv-area" style="height:170px" role="img" aria-label="Bitrate total recebido na última hora"></canvas>
          </div>
          <div class="tile w2 in" style="--i:6">
            <p class="tile-title">Transmissões <span id="tx-count"></span></p>
            <div class="group" id="tx"></div>
          </div>
          <div class="tile w2 in" style="--i:7">
            <p class="tile-title">Salas ao vivo</p>
            <div class="group" id="rooms"></div>
          </div>
          <div class="tile w2 in" style="--i:8">
            <p class="tile-title">Servidor</p>
            <div class="group">
              <div class="row"><span class="icon-tile neutral" data-icon="server"></span><div class="row-body"><div class="row-title">Processo</div><div class="row-detail" id="sys">—</div></div></div>
              <div class="row"><span class="icon-tile neutral" data-icon="users"></span><div class="row-body"><div class="row-title">Conexões</div><div class="row-detail" id="sys-peers">—</div></div></div>
            </div>
          </div>
        </section>

        <section id="tab-groups" class="stack" style="--gap:14px" hidden>
          <div class="spread">
            <div class="cluster"><span class="chip" id="bot-chip">verificando bot</span></div>
            <div class="cluster">
              <button class="btn btn-sm btn-plain" data-act="chan-sync"><i data-icon="refresh"></i>Sincronizar</button>
              <button class="btn btn-sm btn-prominent" data-act="chan-add"><i data-icon="plus"></i>Adicionar canal</button>
            </div>
          </div>
          <div class="notice" id="groups-login-hint" hidden><i data-icon="info"></i><span>O acesso está no modo <b>Login</b>: a gestão por grupos não decide quem transmite. Mude para o modo <b>Canais</b> ou <b>Ambos</b> em Ajustes para habilitar grupos.</span></div>
          <div class="tile flat in">
            <p class="tile-title">Atividade por canal <span>minutos com alguém no ar, últimas 24 h</span></p>
            <canvas class="chart" id="cv-heat" style="height:96px" role="img" aria-label="Minutos com alguém transmitindo por canal e por hora"></canvas>
          </div>
          <div class="bento" id="groups"></div>
        </section>

        <section id="tab-users" class="bento" hidden>
          <div class="tile w4 in" style="--i:0">
            <p class="tile-title">Pedidos pendentes <span id="pending-count"></span></p>
            <div class="group" id="pending"></div>
          </div>
          <div class="tile w4 in" style="--i:1">
            <div class="spread" style="margin-bottom:10px">
              <p class="tile-title" style="margin:0">Liberados pelo login</p>
              <input class="field" id="q" type="search" placeholder="Buscar por nome ou ID" aria-label="Buscar usuários" style="max-width:260px;min-height:34px;padding-block:6px"/>
            </div>
            <div class="group" id="users"></div>
          </div>
        </section>

        <section id="tab-logs" class="stack" style="--gap:14px" hidden>
          <div class="notice warn" id="logs-paused" hidden><i data-icon="alert"></i><span><b>Armazenamento pausado.</b> Os logs enviados pelos clientes são descartados e não voltam ao retomar.</span></div>
          <div class="tile flat in">
            <p class="tile-title">Volume nas últimas 24 h <span>info · aviso · erro</span></p>
            <canvas class="chart" id="cv-bars" style="height:130px" role="img" aria-label="Linhas de log recebidas por hora, por nível"></canvas>
          </div>
          <div class="bento">
            <div class="tile in" style="--i:1">
              <p class="tile-title">Pessoas</p>
              <div class="group" id="logs-users"></div>
              <div class="stack" style="--gap:6px;margin-top:26px">
                <button class="btn btn-sm" id="logs-pause">Pausar armazenamento</button>
                <button class="btn btn-sm btn-destructive" id="logs-delete-all">Apagar todos os logs</button>
              </div>
            </div>
            <div class="tile w3 in" style="--i:2">
              <div class="empty" id="logs-empty"><i data-icon="doc"></i><b>Escolha uma pessoa</b><span>Os logs do dia aparecem aqui.</span></div>
              <div class="stack" id="logs-viewer" style="--gap:10px" hidden>
                <div class="spread">
                  <p class="tile-title" style="margin:0" id="logs-who">—</p>
                  <div class="cluster">
                    <select class="field" id="logs-day" aria-label="Dia" style="width:auto;min-height:34px;padding-block:5px"></select>
                    <select class="field" id="logs-level" aria-label="Nível" style="width:auto;min-height:34px;padding-block:5px">
                      <option value="">Todos os níveis</option>
                      <option value="warn,error">Só avisos e erros</option>
                    </select>
                    <a class="btn btn-sm" id="logs-download" download>Baixar</a>
                    <button class="btn btn-sm btn-destructive" id="logs-delete">Apagar</button>
                  </div>
                </div>
                <p class="caption" id="logs-count" style="margin:0"></p>
                <pre class="term" id="logs-text"></pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-settings" class="bento" hidden>
          <div class="tile w4 in" style="--i:0">
            <p class="tile-title">Quem pode transmitir</p>
            <div class="choice" role="radiogroup" id="mode" aria-label="Modo de acesso">
              <button class="choice-card" role="radio" data-value="login" aria-checked="true"><b>Login</b><span>Só quem foi liberado na lista de pessoas.</span></button>
              <button class="choice-card" role="radio" data-value="channels" aria-checked="false"><b>Canais</b><span>Quem está num canal habilitado e não banido.</span></button>
              <button class="choice-card" role="radio" data-value="both" aria-checked="false"><b>Ambos</b><span>Liberado na lista ou num canal habilitado. Banimento vence.</span></button>
            </div>
            <p class="caption" id="mode-detail" style="margin:12px 0 0">…</p>
          </div>
          <div class="tile w2 in" style="--i:1">
            <p class="tile-title">Bot do Discord <span class="chip" id="bot-status">—</span></p>
            <div class="group">
              <div class="row"><span class="icon-tile gradient" data-icon="bot"></span><div class="row-body"><div class="row-title">Status</div><div class="row-detail" id="bot-detail">…</div></div></div>
              <a class="row" id="bot-invite-row" href="#" target="_blank" rel="noopener" hidden>
                <span class="icon-tile" data-icon="link"></span>
                <div class="row-body"><div class="row-title">Convidar / gerenciar o bot</div><div class="row-detail">Adiciona o bot a um servidor do Discord com as permissões de voz.</div></div>
                <span class="row-accessory chevron"></span>
              </a>
            </div>
          </div>
          <div class="tile w2 in" style="--i:2">
            <p class="tile-title">Painel</p>
            <div class="group">
              <div class="row"><span class="icon-tile neutral" data-icon="discord"></span><div class="row-body"><div class="row-title">Login com Discord</div><div class="row-detail" id="oauth-detail">…</div></div><div class="row-accessory"><span class="chip" id="oauth-chip">—</span></div></div>
              <div class="row"><span class="icon-tile neutral" data-icon="users"></span><div class="row-body"><div class="row-title">Admins do painel</div><div class="row-detail" id="admin-detail">definidos em ADMIN_DISCORD_IDS</div></div><div class="row-accessory"><span class="chip" id="admin-chip">—</span></div></div>
            </div>
          </div>
        </section>
      </main>
    </div>

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
        <div class="notice" id="ac-hint"><i data-icon="info"></i><span>Escolha um servidor onde o bot está e um canal de voz. Ele entra <b>habilitado</b>: todo mundo nele pode transmitir (menos os banidos). Desligue o toggle da linha se não quiser.</span></div>
        <div id="ac-bot">
          <div class="label">Servidor
            <select class="field" id="ac-guild"><option value="">Carregando…</option></select>
          </div>
          <div class="label" style="margin-top:14px">Canal de voz
            <select class="field" id="ac-channel"><option value="">Escolha o servidor primeiro</option></select>
          </div>
        </div>
        <div id="ac-manual" hidden>
          <div class="notice warn"><i data-icon="alert"></i><span>O bot não está configurado (<span class="mono">DISCORD_BOT_TOKEN</span>). Adicione pelo ID. Os nomes são preenchidos quando o bot entrar.</span></div>
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
        var ui = window.FRDUI, cv = window.FRDCanvas, esc = ui.escapeHtml;
        var $ = function (s) { return document.querySelector(s); };
        var users = [], transmissions = [], groups = [], bot = {}, stats = null;
        var live = { rooms: [], settings: { authMode: "login" }, bot: false };
        var editing = null, membersChannel = null;

        async function j(u, o) { var r = await fetch(u, o); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
        function post(u, body) {
          return j(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        }
        function selected(seg) { var b = seg.querySelector('button[aria-pressed="true"]'); return b ? Number(b.dataset.value) : 0; }
        function nearest(seg, v) {
          var opts = Array.prototype.map.call(seg.querySelectorAll("button"), function (b) { return Number(b.dataset.value); });
          var best = opts.reduce(function (a, b) { return Math.abs(b - v) < Math.abs(a - v) ? b : a; }, opts[0]);
          ui.select(seg, best);
        }
        function avatar(name, id) { return ui.thumb(id ? "/admin/img/user/" + encodeURIComponent(id) : "", name); }
        function guildThumb(g, cls) { return ui.thumb(g.guildIcon || "", g.guildName || g.guildId, true, cls); }
        function findChannel(id) {
          for (var i = 0; i < groups.length; i++) {
            var c = groups[i].channels.find(function (x) { return x.channelId === id; });
            if (c) return Object.assign({ guildId: groups[i].guildId, guildName: groups[i].guildName }, c);
          }
          return null;
        }
        function empty(icon, title, sub) {
          return '<div class="empty"><i data-icon="' + icon + '"></i><b>' + title + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>";
        }
        function mbps(kbps) { return (kbps || 0) / 1000; }
        function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

        // --- Canvas ---
        cv.mount($("#cv-map"), "liveMap", { rooms: [] });
        cv.mount($("#cv-gauge"), "gauge", { value: null, max: 200, good: 80 });
        cv.mount($("#cv-area"), "area", { values: [] });
        cv.mount($("#cv-heat"), "heat", { rows: [] });
        cv.mount($("#cv-bars"), "bars", { hours: [] });

        /** Transmissores de todas as salas — fonte: /admin/live (estado real do /dstream). */
        function flatStreamers() {
          var out = [];
          live.rooms.forEach(function (r) {
            var viewers = r.members.filter(function (m) { return !m.streamer; }).length;
            r.members.forEach(function (m) {
              if (m.streamer) out.push({ userId: m.userId, name: m.name || m.userId, avatar: m.avatar, room: m.channelName || r.label || r.guildName || r.roomId, guild: r.guildName || "", since: m.since || 0, kbps: m.kbps || 0, viewers: viewers });
            });
          });
          return out;
        }

        function renderTx() {
          $("#tx-count").textContent = transmissions.length ? plural(transmissions.length, "ativa", "ativas") : "";
          $("#tx").innerHTML = transmissions.length ? transmissions.map(function (t) {
            var since = t.since ? ui.duration((Date.now() - t.since) / 1000) : "—";
            return '<div class="row">' + ui.thumb(t.avatar || "/admin/img/user/" + encodeURIComponent(t.userId), t.name) +
              '<div class="row-body"><div class="row-title">' + esc(t.name) + '</div>' +
              '<div class="row-detail">' + esc(t.room) + (t.guild ? " · " + esc(t.guild) : "") + " · " + plural(t.viewers, "assistindo", "assistindo") + " · " + mbps(t.kbps).toFixed(1).replace(".", ",") + " Mb/s</div></div>" +
              '<span class="row-accessory"><span class="chip live mono num">' + since + "</span></span></div>";
          }).join("") : empty("live", "Ninguém transmitindo agora", "Quando alguém começar, aparece aqui.");
        }

        function peopleStrip(members) {
          if (!members.length) return "";
          return '<div class="cluster" style="margin-top:8px;gap:6px">' + members.map(function (m) {
            var n = esc(m.name || m.userId);
            var url = m.avatar || (m.userId ? "/admin/img/user/" + encodeURIComponent(m.userId) : "");
            return '<span class="cluster" style="gap:5px;font-size:12px;' + (m.streamer ? "color:var(--live);font-weight:600" : "color:var(--text-3)") + '" title="' + n + '">' +
              ui.thumb(url, m.name || m.userId, false, "sm") + n + (m.streamer ? " · no ar" : "") + "</span>";
          }).join("") + "</div>";
        }

        function renderRooms() {
          $("#rooms").innerHTML = live.rooms.length ? live.rooms.map(function (r) {
            var title = r.label || r.guildName || r.roomId;
            var detail = r.label ? esc(r.guildName || r.guildId || "") : 'sala <span class="mono">' + esc(r.roomId) + "</span>";
            return '<div class="row">' + guildThumb(r) +
              '<div class="row-body"><div class="row-title">' + esc(title) +
              (r.streamers ? ' <span class="chip live">' + r.streamers + " no ar</span>" : "") +
              ' <span class="chip">' + r.viewers + " assistindo</span></div>" +
              '<div class="row-detail">' + detail + "</div>" +
              peopleStrip(r.members) +
              "</div></div>";
          }).join("") : empty("live", "Nenhuma sala agora", "Quando alguém entrar numa call, aparece aqui.");
        }

        function renderOverview(m) {
          var viewers = live.rooms.reduce(function (n, r) { return n + r.viewers; }, 0);
          var liveRooms = live.rooms.filter(function (r) { return r.streamers; }).length;
          ui.countTo($("#m-live"), transmissions.length);
          $("#m-live-sub").textContent = transmissions.length ? "em " + plural(liveRooms, "sala", "salas") : "ninguém transmitindo";
          ui.countTo($("#m-viewers"), viewers);
          $("#m-viewers-sub").textContent = plural(m.peers, "conexão", "conexões") + " em " + plural(m.rooms, "sala", "salas");
          var badge = $("#live-badge"); badge.hidden = !transmissions.length; badge.textContent = transmissions.length;

          var media = stats && stats.media;
          var kbps = media ? media.kbps : 0;
          ui.countTo($("#m-kbps"), mbps(kbps), 1);
          var peak = media && media.samples.length ? Math.max.apply(null, media.samples.map(function (s) { return s.kbps; })) : 0;
          $("#m-kbps-sub").textContent = peak ? "pico de " + mbps(peak).toFixed(1).replace(".", ",") + " Mb/s na última hora" : "sem transmissão na última hora";

          cv.set($("#cv-map"), {
            rooms: live.rooms.map(function (r) {
              return { label: r.label || r.guildName || r.roomId, members: r.members.map(function (x) { return { name: x.name || x.userId, streamer: x.streamer }; }) };
            }),
          });
          cv.set($("#cv-gauge"), { value: media && typeof media.rttMs === "number" ? media.rttMs : null, max: 200, good: 80 });
          cv.set($("#cv-area"), { values: media ? media.samples.map(function (s) { return s.kbps; }) : [], empty: "Coletando dados (uma amostra a cada 5 s)…" });

          $("#sys").textContent = "CPU " + m.cpuLoad[0].toFixed(2) + " / " + m.cpus + " · memória " + (m.memory.usedPct * 100).toFixed(0) + "% · no ar há " + ui.duration(m.uptime);
          $("#sys-peers").textContent = plural(m.peers, "conexão de mídia", "conexões de mídia") + " · " + plural(m.rooms, "sala", "salas");
        }

        function renderActivity() {
          if (!stats) return;
          var act = stats.activity, rows = Object.keys(act.channels).map(function (id) {
            var c = findChannel(id);
            return { label: c ? (c.channelName || id) + (c.guildName ? " · " + c.guildName : "") : id, values: act.channels[id] };
          }).sort(function (a, b) { return b.values.reduce(function (s, v) { return s + v; }, 0) - a.values.reduce(function (s, v) { return s + v; }, 0); }).slice(0, 12);
          $("#cv-heat").style.height = Math.max(96, rows.length * 30 + 22) + "px";
          cv.set($("#cv-heat"), { hours: act.hours, rows: rows, empty: "Sem transmissões nas últimas 24 h (desde que o servidor ligou)" });
          cv.set($("#cv-bars"), { hours: stats.logs });
        }

        function renderMode() {
          var mode = (live.settings && live.settings.authMode) || "login";
          $("#mode").querySelectorAll(".choice-card").forEach(function (c) { c.setAttribute("aria-checked", String(c.dataset.value === mode)); });
          $("#mode").dataset.current = mode;
          $("#mode-detail").textContent = mode === "channels"
            ? "Todas as salas entram habilitadas. Desligue as que não quiser em Grupos. Quem está num canal habilitado pode transmitir, menos os banidos."
            : mode === "both"
            ? "Pode transmitir quem está num canal habilitado OU quem foi liberado na lista de pessoas (em qualquer canal). Banido num canal não transmite nele."
            : "Só quem foi liberado na lista de pessoas pode transmitir.";
          var chip = $("#bot-chip");
          var ok = live.bot && live.voice;
          chip.className = "chip " + (ok ? "ok" : "warn");
          chip.textContent = !live.bot ? "bot não configurado"
            : live.voice ? "bot + voz conectados" : "bot ok · voz desconectada";
          $("#groups-login-hint").hidden = mode !== "login";
        }

        function renderBot() {
          var oauthOk = bot.oauth;
          var oc = $("#oauth-chip");
          oc.className = "chip " + (oauthOk ? "ok" : "warn");
          oc.textContent = oauthOk ? "configurado" : "ausente";
          $("#oauth-detail").textContent = oauthOk
            ? "As pessoas entram com a conta do Discord para pedir acesso."
            : "Defina DISCORD_CLIENT_ID / SECRET / REDIRECT_URI para habilitar o login.";

          var gw = bot.gateway || {};
          var bs = $("#bot-status");
          bs.className = "chip " + (!bot.configured ? "warn" : gw.connected ? "ok" : "warn");
          bs.textContent = !bot.configured ? "não configurado" : gw.connected ? "conectado" : "desconectado";
          $("#bot-detail").textContent = !bot.configured
            ? "Defina DISCORD_BOT_TOKEN para listar servidores e resolver canais/nomes."
            : gw.connected
              ? (gw.guilds || 0) + " servidor(es) · " + (gw.voices || 0) + " em voz"
              : "Token definido, mas o gateway não conectou" + (gw.error ? " (" + gw.error + ")" : "") + ".";

          var row = $("#bot-invite-row");
          if (bot.invite) { row.href = bot.invite; row.hidden = false; } else { row.hidden = true; }

          var ac = $("#admin-chip");
          ac.className = "chip";
          ac.textContent = (bot.adminCount || 0) + " admin(s)";
        }

        function channelRow(c) {
          var inCall = c.liveMembers || [];
          return '<div class="row"><span class="icon-tile' + (c.enabled ? "" : " neutral") + '" data-icon="mic"></span>' +
            '<div class="row-body"><div class="row-title">' + esc(c.channelName || c.channelId) +
            (c.streamers ? ' <span class="chip live">' + c.streamers + " no ar</span>" : "") +
            (c.bans.length ? ' <span class="chip danger">' + c.bans.length + " banido(s)</span>" : "") +
            "</div>" +
            '<div class="row-detail">' + (c.enabled ? "habilitado" : "desabilitado") +
            (inCall.length ? " · " + inCall.length + " na sala" : c.seen.length ? " · " + c.seen.length + " visto(s)" : "") + "</div>" +
            peopleStrip(inCall) + "</div>" +
            '<div class="row-accessory">' +
            '<button class="toggle" role="switch" aria-checked="' + String(Boolean(c.enabled)) + '" data-act="chan-toggle" data-id="' + esc(c.channelId) + '" aria-label="Habilitar transmissão em ' + esc(c.channelName || c.channelId) + '" title="Habilitar transmissão"></button>' +
            '<button class="btn btn-sm" data-act="chan-members" data-id="' + esc(c.channelId) + '">Membros</button>' +
            '<button class="btn btn-icon btn-sm btn-plain" data-act="chan-remove" data-id="' + esc(c.channelId) + '" aria-label="Remover canal" title="Remover canal"><i data-icon="x"></i></button>' +
            "</div></div>";
        }

        function renderGroups() {
          if (!groups.length) {
            $("#groups").innerHTML = '<div class="tile w4 flat">' + empty("users", "Nenhum grupo configurado", "Sincronize com o bot ou adicione um canal. Quem entrar numa call também aparece aqui.") + "</div>";
            return;
          }
          $("#groups").innerHTML = groups.map(function (g, i) {
            var enabled = g.channels.filter(function (c) { return c.enabled; }).length;
            return '<div class="tile ' + (groups.length === 1 ? "w4" : "w2") + '">' +
              '<div class="cluster" style="gap:12px;margin-bottom:6px">' + guildThumb(g, "xl") +
              '<div class="row-body"><div class="row-title" style="font-size:15.5px">' + esc(g.guildName || g.guildId) +
              (g.botPresent ? "" : ' <span class="chip warn">bot fora</span>') + "</div>" +
              '<div class="row-detail">' + g.channels.length + " canal(is) · " + enabled + " habilitado(s)</div></div></div>" +
              '<div class="group">' + g.channels.map(channelRow).join("") + "</div></div>";
          }).join("");
        }

        function memberRow(c, userId, name, banned, lastSeen, isLive, streamer) {
          var status = banned ? ' <span class="chip danger">banido</span>'
            : streamer ? ' <span class="chip live">no ar</span>'
            : isLive ? ' <span class="chip">na sala</span>'
            : ' <span class="chip ok">permitido</span>';
          return '<div class="row">' + avatar(name || userId, userId) +
            '<div class="row-body"><div class="row-title">' + esc(name || userId) + status + "</div>" +
            '<div class="row-detail"><span class="mono">' + esc(userId) + "</span>" + (lastSeen ? " · visto " + ui.relativeTime(lastSeen) : "") + "</div></div>" +
            '<div class="row-accessory"><button class="btn btn-sm' + (banned ? "" : " btn-destructive") + '" data-act="' + (banned ? "chan-unban" : "chan-ban") +
            '" data-id="' + esc(c.channelId) + '" data-user="' + esc(userId) + '">' + (banned ? "Permitir" : "Banir") + "</button></div></div>";
        }

        function renderMembers() {
          var c = findChannel(membersChannel);
          if (!c) return;
          var map = {};
          (c.liveMembers || []).forEach(function (m) { map[m.userId] = { name: m.name, live: true, streamer: m.streamer, lastSeen: 0 }; });
          c.seen.forEach(function (s) { var e = map[s.userId] || {}; e.name = e.name || s.name; e.lastSeen = s.lastSeen; map[s.userId] = e; });
          c.bans.forEach(function (id) { if (!map[id]) map[id] = {}; });
          var rows = Object.keys(map).map(function (id) {
            var e = map[id];
            return memberRow(c, id, e.name, c.bans.indexOf(id) >= 0, e.lastSeen, e.live, e.streamer);
          });
          $("#members-list").innerHTML = rows.length ? rows.join("")
            : empty("users", "Ninguém visto ainda", "Quem entrar neste canal aparece aqui.");
        }

        function renderUsers() {
          var q = $("#q").value.trim().toLowerCase();
          var pending = users.filter(function (u) { return !u.enabled; });
          var enabled = users.filter(function (u) { return u.enabled && (!q || u.name.toLowerCase().indexOf(q) >= 0 || u.id.indexOf(q) >= 0); });
          $("#pending-count").textContent = pending.length ? String(pending.length) : "";
          var badge = $("#pending-badge"); badge.hidden = !pending.length; badge.textContent = pending.length;

          $("#pending").innerHTML = pending.length ? pending.map(function (u) {
            return '<div class="row">' + avatar(u.name, u.id) +
              '<div class="row-body"><div class="row-title">' + esc(u.name) + ' <span class="chip warn">pendente</span></div>' +
              '<div class="row-detail"><span class="mono">' + esc(u.id) + "</span> · pediu " + ui.relativeTime(u.requestedAt) + "</div></div>" +
              '<div class="row-accessory"><button class="btn btn-prominent btn-sm" data-act="enable" data-id="' + esc(u.id) + '">Liberar</button></div></div>';
          }).join("") : empty("inbox", "Nenhum pedido pendente");

          $("#users").innerHTML = enabled.length ? enabled.map(function (u) {
            return '<div class="row">' + avatar(u.name, u.id) +
              '<div class="row-body"><div class="row-title">' + esc(u.name) + ' <span class="chip">' + u.maxHeight + "p · " + u.maxFps + " fps</span></div>" +
              '<div class="row-detail"><span class="mono">' + esc(u.id) + "</span>" + (u.enabledAt ? " · liberado " + ui.relativeTime(u.enabledAt) : "") + "</div></div>" +
              '<div class="row-accessory"><button class="btn btn-sm" data-act="edit" data-id="' + esc(u.id) + '">Editar</button>' +
              '<button class="btn btn-destructive btn-sm" data-act="revoke" data-id="' + esc(u.id) + '">Revogar</button></div></div>';
          }).join("") : empty("users", q ? "Ninguém encontrado" : "Ninguém liberado ainda");
        }

        async function load() {
          try {
            var m = await j("/admin/metrics");
            users = await j("/admin/users");
            live = await j("/admin/live");
            groups = await j("/admin/groups");
            bot = await j("/admin/bot");
            stats = await j("/admin/stats").catch(function () { return null; });
            transmissions = flatStreamers();
            renderOverview(m);
            renderTx();
            renderRooms();
            renderMode();
            renderGroups();
            renderActivity();
            renderBot();
            if (membersChannel && $("#members").open) renderMembers();
            renderUsers();
            $("#updated").className = "chip ok";
            $("#updated").innerHTML = '<span class="dot"></span>ao vivo';
          } catch (e) {
            $("#updated").className = "chip danger";
            $("#updated").innerHTML = '<span class="dot"></span>sem conexão';
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
            var ch = findChannel(id); if (!ch) return;
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
          if (act === "revoke") {
            var ok = await ui.confirm({ title: "Revogar acesso de " + u.name + "?", message: "A pessoa deixa de conseguir transmitir e assistir na hora.", confirmLabel: "Revogar", destructive: true });
            if (!ok) return;
            try { await setEnabled(u.id, false); ui.toast("Acesso de " + u.name + " revogado", "danger"); load(); }
            catch (err) { ui.toast("Falha ao revogar: " + err.message, "danger"); }
            return;
          }
          editing = u;
          $("#quota-title").textContent = (act === "edit" ? "Editar " : "Liberar ") + u.name;
          $("#quota-sub").textContent = "Limites aplicados à transmissão desta pessoa.";
          $("#quota-save").textContent = act === "edit" ? "Salvar" : "Liberar";
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
            ui.toast(enabled ? "Canal habilitado: os membros podem transmitir" : "Canal desabilitado", enabled ? "ok" : "danger");
            groups = await j("/admin/groups");
            renderGroups();
          } catch (err) {
            ui.toast("Falha: " + err.message, "danger");
            sw.setAttribute("aria-checked", String(!enabled));
          }
        });

        // Modo de acesso: cartões (role=radio); o ui.js marca o cartão e dispara "change" no grupo.
        $("#mode").addEventListener("change", async function (e) {
          var mode = e.detail && e.detail.value;
          if (mode !== "login" && mode !== "channels" && mode !== "both") return;
          if (mode === $("#mode").dataset.current) return;
          try {
            var s = await post("/admin/settings", { authMode: mode });
            var msg;
            if (mode === "login") msg = "Modo login ativo: liberação manual por pessoa";
            else if (!live.bot) msg = (mode === "both" ? "Modo ambos" : "Modo canais") + " ativo. Sem bot, adicione os canais pelos IDs";
            else if (s.seeded) msg = s.seeded.added ? s.seeded.added + " canal(is) novo(s) habilitado(s) · " + s.seeded.total + " no total" : s.seeded.total + " canais habilitados";
            else msg = "Modo canais ativo (não deu para sincronizar: " + (s.seededError || "erro") + ")";
            ui.toast(msg, "ok");
            load();
          } catch (err) { ui.toast("Falha: " + err.message, "danger"); load(); }
        });

        // --- Adicionar canal (bot) ---
        async function openAddChan() {
          var manual = !bot.configured;
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
          var c = findChannel(id); if (!c) return;
          membersChannel = id;
          $("#members-title").textContent = c.channelName || c.channelId;
          renderMembers();
          ui.openSheet("#members");
        }

        async function banMember(channelId, userId, banned) {
          await post("/admin/channels/" + encodeURIComponent(channelId) + "/ban", { userId: userId, banned: banned });
          groups = await j("/admin/groups");
          renderGroups(); renderMembers();
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

        // --- Navegação pelo trilho (com #hash para dar para favoritar/compartilhar a aba) ---
        var TABS = {
          overview: ["Ao vivo", "Quem está transmitindo agora e como está o servidor"],
          groups: ["Grupos", "Canais de voz por servidor do Discord"],
          users: ["Pessoas", "Pedidos de acesso e quem foi liberado pelo login"],
          logs: ["Logs", "Enviados pelos clientes a cada 5 minutos"],
          settings: ["Ajustes", "Modo de acesso, bot e login"],
        };
        function showTab(v, push) {
          if (!TABS[v]) v = "overview";
          Object.keys(TABS).forEach(function (k) { $("#tab-" + k).hidden = k !== v; });
          document.querySelectorAll(".rail-btn[data-tab]").forEach(function (b) {
            if (b.dataset.tab === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
          });
          $("#page-title").textContent = TABS[v][0];
          $("#page-sub").textContent = TABS[v][1];
          var sec = $("#tab-" + v);
          // reinicia a cascata de entrada e as animações dos gráficos da aba
          sec.querySelectorAll(".in").forEach(function (el) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; });
          cv.replay(sec);
          if (v === "logs") loadLogUsers();
          if (push) { try { history.replaceState(null, "", "#" + v); } catch (err) { location.hash = v; } }
        }
        document.querySelectorAll(".rail-btn[data-tab]").forEach(function (b) {
          b.addEventListener("click", function () { showTab(b.dataset.tab, true); });
        });
        window.addEventListener("hashchange", function () { showTab(location.hash.slice(1)); });

        // --- Logs ---
        var logUsers = [], logUser = null;
        function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB"; }
        var logsPaused = false;
        function renderLogsPaused() {
          $("#logs-paused").hidden = !logsPaused;
          $("#logs-pause").textContent = logsPaused ? "Retomar armazenamento" : "Pausar armazenamento";
        }
        function showViewer(on) { $("#logs-viewer").hidden = !on; $("#logs-empty").hidden = on; }
        async function loadLogUsers() {
          try { logsPaused = Boolean((await j("/admin/settings")).clientLogsPaused); renderLogsPaused(); logUsers = await j("/admin/logs"); } catch (err) { ui.toast("Falha ao listar logs: " + err.message, "danger"); return; }
          $("#logs-users").innerHTML = logUsers.length ? logUsers.map(function (u) {
            var cur = logUser && logUser.userId === u.userId;
            return '<button class="row" data-log-user="' + esc(u.userId) + '"' + (cur ? ' style="background:var(--accent-soft)"' : "") + ">" + ui.thumb(u.avatar, u.name || u.userId) +
              '<div class="row-body"><div class="row-title">' + esc(u.name || u.userId) + '</div><div class="row-detail">' + fmtBytes(u.bytes) + " · " + u.days.length + " dia(s) · " + ui.relativeTime(u.lastAt) + "</div></div></button>";
          }).join("") : empty("doc", "Nenhum log recebido ainda");
          if (logUser && !logUsers.some(function (u) { return u.userId === logUser.userId; })) { logUser = null; showViewer(false); }
        }
        function openLogUser(id) {
          logUser = logUsers.find(function (u) { return u.userId === id; }); if (!logUser) return;
          $("#logs-who").textContent = logUser.name || logUser.userId;
          $("#logs-day").innerHTML = logUser.days.map(function (d) { return '<option value="' + esc(d.day) + '">' + esc(d.day) + " (" + fmtBytes(d.bytes) + ")</option>"; }).join("");
          showViewer(true);
          document.querySelectorAll("[data-log-user]").forEach(function (r) { r.style.background = r.dataset.logUser === id ? "var(--accent-soft)" : ""; });
          loadLogDay();
        }
        async function loadLogDay() {
          if (!logUser) return;
          var base = "/admin/logs/" + encodeURIComponent(logUser.userId) + "/" + encodeURIComponent($("#logs-day").value);
          $("#logs-download").href = base + "?download=1";
          try {
            var r = await j(base + "?tail=1000&level=" + encodeURIComponent($("#logs-level").value));
            $("#logs-count").textContent = "Mostrando " + r.entries.length + " de " + r.total + " linhas";
            $("#logs-text").innerHTML = r.entries.map(function (e) {
              var line = esc(new Date(e.t).toISOString() + " " + e.l + " " + e.s + " " + e.m);
              return e.l === "error" ? '<span class="e">' + line + "</span>" : e.l === "warn" ? '<span class="w">' + line + "</span>" : line;
            }).join("\\n");
          } catch (err) { ui.toast("Falha ao ler o log: " + err.message, "danger"); }
        }
        $("#logs-users").addEventListener("click", function (e) { var r = e.target.closest("[data-log-user]"); if (r) openLogUser(r.dataset.logUser); });
        $("#logs-day").addEventListener("change", loadLogDay);
        $("#logs-level").addEventListener("change", loadLogDay);
        $("#logs-pause").addEventListener("click", async function () {
          var next = !logsPaused;
          if (next && !(await ui.confirm({ title: "Pausar o armazenamento de logs?", message: "Os logs enviados pelos clientes durante a pausa são descartados. Sem eles, fica impossível encontrar erros que aconteçam nesse período.", confirmLabel: "Pausar" }))) return;
          try { logsPaused = (await post("/admin/logs/pause", { paused: next })).paused; renderLogsPaused(); ui.toast(logsPaused ? "Armazenamento pausado" : "Armazenamento retomado"); }
          catch (err) { ui.toast("Falha ao alterar: " + err.message, "danger"); }
        });
        $("#logs-delete-all").addEventListener("click", async function () {
          if (!(await ui.confirm({ title: "Apagar todos os logs?", message: "Os logs de todos os usuários são apagados do servidor. Isso não pode ser desfeito.", confirmLabel: "Apagar tudo", destructive: true }))) return;
          try { await j("/admin/logs", { method: "DELETE" }); logUser = null; showViewer(false); ui.toast("Logs apagados", "danger"); loadLogUsers(); }
          catch (err) { ui.toast("Falha ao apagar: " + err.message, "danger"); }
        });
        $("#logs-delete").addEventListener("click", async function () {
          if (!logUser || !(await ui.confirm({ title: "Apagar os logs deste usuário?", message: "Isso não pode ser desfeito.", confirmLabel: "Apagar", destructive: true }))) return;
          try { await j("/admin/logs/" + encodeURIComponent(logUser.userId), { method: "DELETE" }); ui.toast("Logs apagados", "danger"); loadLogUsers(); }
          catch (err) { ui.toast("Falha ao apagar: " + err.message, "danger"); }
        });

        showTab(location.hash.slice(1));
        load(); setInterval(load, 4000);
        setInterval(renderTx, 1000); // relógio das durações
      })();
    </script>`, { topbar: false });
}

function initials(name: string): string {
    const parts = name.replace(/[._-]+/g, " ").trim().split(/\s+/);
    const first = parts[0] ?? "?";
    return ((first[0] ?? "?") + (parts[1]?.[0] ?? first[1] ?? "")).toUpperCase();
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
