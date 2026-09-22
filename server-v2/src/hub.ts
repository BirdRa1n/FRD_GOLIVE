// Páginas HTML do hub (golivefrd). Server-rendered + JS mínimo (fetch/polling).

import type { Policy } from "./types.js";

const shell = (title: string, body: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#0f1014;color:#dbdee1;margin:0;padding:24px}
  .wrap{max-width:960px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;color:#b5bac1;margin:24px 0 8px}
  .card{background:#1a1b20;border:1px solid #26272e;border-radius:10px;padding:18px;margin-top:14px}
  a.btn,button{display:inline-block;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;color:#fff;background:#5865f2;font-size:14px;text-decoration:none}
  button.sec{background:#4e5058} button.danger{background:#da373c}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #26272e}
  .muted{color:#949ba4} .ok{color:#3ba55d} .pend{color:#f0b232}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .metric{background:#0f1014;border:1px solid #26272e;border-radius:8px;padding:12px}
  .metric b{font-size:20px;display:block}
  input{width:70px;padding:5px;border-radius:6px;border:1px solid #26272e;background:#0f1014;color:#fff}
</style></head><body><div class="wrap">${body}</div></body></html>`;

export function loginPage(configured: boolean): string {
    return shell("FRD GoLive — Entrar", `
    <h1>FRD GoLive</h1>
    <p class="muted">Compartilhamento de tela/câmera privado no Discord.</p>
    <div class="card">
      ${configured
            ? `<p>Entre com sua conta do Discord para solicitar acesso ao servidor.</p>
         <a class="btn" href="/login">Entrar com Discord</a>`
            : `<p class="pend">Discord OAuth não configurado no servidor (defina DISCORD_CLIENT_ID/SECRET/REDIRECT_URI).</p>`}
    </div>`);
}

export function homePage(name: string, policy: Policy, isAdmin: boolean): string {
    const status = policy.enabled
        ? `<span class="ok">✔ Acesso liberado</span> — qualidade até ${policy.maxHeight}p @ ${policy.maxFps}fps`
        : `<span class="pend">⏳ Aguardando liberação do admin</span>`;
    return shell("FRD GoLive", `
    <h1>Olá, ${escapeHtml(name)}</h1>
    <div class="card">
      <p><b>Status:</b> ${status}</p>
      ${policy.enabled
            ? `<p class="muted">Tudo pronto. Abra o Discord — o plugin já ligou as funções.</p>`
            : `<button onclick="req()">Solicitar acesso</button>
         <p class="muted" id="msg" style="margin-top:8px"></p>`}
      <p style="margin-top:14px"><a href="/logout" class="muted">Sair</a>
      ${isAdmin ? ` · <a href="/admin">Painel admin →</a>` : ""}</p>
    </div>
    <script>
      async function req(){
        const r = await fetch('/me/request-access',{method:'POST'});
        document.getElementById('msg').textContent = r.ok ? 'Pedido enviado. Aguarde a liberação do admin.' : 'Falha ao enviar o pedido.';
      }
    </script>`);
}

export function adminPage(): string {
    return shell("FRD GoLive — Admin", `
    <h1>Painel admin</h1>
    <h2>Métricas</h2>
    <div class="grid" id="metrics"></div>
    <h2>Transmissões ativas</h2>
    <div class="card"><table id="tx"><tbody><tr><td class="muted">carregando…</td></tr></tbody></table></div>
    <h2>Usuários</h2>
    <div class="card"><table id="users"><thead><tr><th>Usuário</th><th>Status</th><th>Qualidade</th><th>FPS</th><th></th></tr></thead><tbody></tbody></table></div>
    <p style="margin-top:14px"><a href="/" class="muted">← Início</a></p>
    <script>
      const $ = s => document.querySelector(s);
      async function j(u,o){ const r=await fetch(u,o); if(!r.ok) throw new Error(r.status); return r.json(); }
      async function enable(id, enabled){
        const h = prompt('Qualidade máx (px altura, ex: 1080):','1080'); if(h===null) return;
        const f = prompt('FPS máx (ex: 30):','30'); if(f===null) return;
        await j('/admin/users/'+id+'/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,maxHeight:+h,maxFps:+f})});
        load();
      }
      async function load(){
        try{
          const m = await j('/admin/metrics');
          $('#metrics').innerHTML =
            metric('CPU (1m)', m.cpuLoad[0].toFixed(2)) +
            metric('Memória', (m.memory.usedPct*100).toFixed(0)+'%') +
            metric('Salas', m.rooms) + metric('Peers', m.peers) +
            metric('Uptime', Math.round(m.uptime)+'s');
          const tx = await j('/admin/transmissions');
          $('#tx').innerHTML = '<tbody>'+(tx.length? tx.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+t.kind+'</td><td class="muted">sala '+esc(t.room)+'</td></tr>').join('') : '<tr><td class="muted">nenhuma agora</td></tr>')+'</tbody>';
          const us = await j('/admin/users');
          $('#users tbody').innerHTML = us.map(u=>'<tr><td>'+esc(u.name)+'<br><span class="muted">'+u.id+'</span></td>'+
            '<td>'+(u.enabled?'<span class=ok>liberado</span>':'<span class=pend>pendente</span>')+'</td>'+
            '<td>'+u.maxHeight+'p</td><td>'+u.maxFps+'</td>'+
            '<td>'+(u.enabled?'<button class="sec" onclick="enable(\\''+u.id+'\\',false)">Revogar</button>':'<button onclick="enable(\\''+u.id+'\\',true)">Liberar</button>')+'</td></tr>').join('');
        }catch(e){ console.error(e); }
      }
      function metric(l,v){ return '<div class="metric"><span class="muted">'+l+'</span><b>'+v+'</b></div>'; }
      function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
      load(); setInterval(load, 4000);
    </script>`);
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
}
