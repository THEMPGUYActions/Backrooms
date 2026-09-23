import { LEVELS } from "./levels.js";

const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

export class BackroomsAdmin{
  constructor(game){
    this.game=game;
    this.opened=false;
    this.ready=false;
    this.busy=false;
    this.opener=null;
  }
  activate(){
    if(this.ready)return;
    if(!this.game.admin.enabled||!this.game.mounted||!this.game.running||this.game.introActive)return;
    this.build();
    this.bind();
    this.opener=document.createElement("button");
    this.opener.id="admin-open";
    this.opener.type="button";
    this.opener.textContent="ADMIN";
    this.opener.setAttribute("aria-label","Open admin panel");
    this.opener.setAttribute("aria-expanded","false");
    document.body.appendChild(this.opener);
    this.opener.addEventListener("click",()=>this.opened?this.close():this.open());
    this.ready=true;
    requestAnimationFrame(()=>{
      if(this.game.running&&!this.game.paused&&!this.game.introActive)this.open();
    });
  }

  build(){
    const root=document.createElement("section");
    root.id="admin-panel";
    root.className="admin-overlay hidden";
    root.innerHTML=`
      <div class="admin-window">
        <div class="admin-top">
          <div>
            <span class="admin-kicker">DEV BUILD</span>
            <h2>ADMIN</h2>
          </div>
          <div class="admin-meta">
            <span>CAM 01</span>
            <span id="admin-runtime">00:00</span>
            <button id="admin-close" class="admin-x" type="button" aria-label="Close admin panel">×</button>
          </div>
        </div>

        <div class="admin-body">
          <aside class="admin-nav">
            <button class="admin-nav-button active" data-admin-tab="world">WORLD</button>
            <button class="admin-nav-button" data-admin-tab="player">PLAYER</button>
            <button class="admin-nav-button" data-admin-tab="events">EVENTS</button>
            <button class="admin-nav-button" data-admin-tab="debug">DEBUG</button>
          </aside>

          <main class="admin-content">
            <section class="admin-tab active" data-admin-panel="world">
              <div class="admin-section-head">
                <div>
                  <span>WORLD</span>
                  <strong>LEVEL TELEPORT</strong>
                </div>
                <small>Instant reload</small>
              </div>
              <div id="admin-levels" class="admin-levels"></div>

              <div class="admin-section-head second">
                <div>
                  <span>POSITION</span>
                  <strong>TELEPORT</strong>
                </div>
              </div>
              <div class="admin-form">
                <label>X<input id="admin-x" type="number" step="0.5" value="0"></label>
                <label>Y<input id="admin-y" type="number" step="0.1" value="1.72"></label>
                <label>Z<input id="admin-z" type="number" step="0.5" value="0"></label>
                <button id="admin-teleport" class="admin-action" type="button">TELEPORT</button>
              </div>
            </section>

            <section class="admin-tab" data-admin-panel="player">
              <div class="admin-section-head">
                <div>
                  <span>PLAYER</span>
                  <strong>STATE</strong>
                </div>
              </div>
              <div class="admin-toggle-grid">
                <button id="admin-god" class="admin-toggle" type="button"><b>GOD MODE</b><span>INVULNERABLE</span><i>OFF</i></button>
                <button id="admin-noclip" class="admin-toggle" type="button"><b>NOCLIP</b><span>IGNORE WALL COLLISION</span><i>OFF</i></button>
              </div>
              <div class="admin-action-grid">
                <button data-admin-action="heal">FULL HEALTH</button>
                <button data-admin-action="stamina">FULL STAMINA</button>
                <button data-admin-action="sanity">FULL SANITY</button>
                <button data-admin-action="battery">FULL BATTERY</button>
              </div>
            </section>

            <section class="admin-tab" data-admin-panel="events">
              <div class="admin-section-head">
                <div>
                  <span>LIGHTING</span>
                  <strong>FORCE EVENT</strong>
                </div>
              </div>
              <div class="admin-action-grid three">
                <button data-admin-event="on">LIGHTS ON</button>
                <button data-admin-event="flicker">FLICKER</button>
                <button data-admin-event="blackout">BLACKOUT</button>
              </div>

              <div class="admin-section-head second">
                <div>
                  <span>GAME</span>
                  <strong>TEST ACTIONS</strong>
                </div>
              </div>
              <div class="admin-action-grid">
                <button data-admin-event="exit">FORCE EXIT</button>
                <button data-admin-event="fear">TRIGGER FEAR</button>
                <button data-admin-event="heal">RESET PLAYER</button>
                <button data-admin-event="reload">RELOAD WORLD</button>
              </div>
            </section>

            <section class="admin-tab" data-admin-panel="debug">
              <div class="admin-section-head">
                <div>
                  <span>RUNTIME</span>
                  <strong>DEBUG INFO</strong>
                </div>
              </div>
              <div id="admin-stats" class="admin-stats"></div>
              <div class="admin-action-grid">
                <button data-admin-action="reseed">NEW SEED</button>
                <button data-admin-action="clear-cache">RELOAD PAGE</button>
              </div>
            </section>
          </main>
        </div>

        <div class="admin-bottom">
          <span>ADMIN MODE</span>
          <span>QUERY FLAG: admin=1</span>
          <button id="admin-game" type="button">BACK TO GAME</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root=root;
    this.levels=root.querySelector("#admin-levels");
    this.stats=root.querySelector("#admin-stats");
    for(const [id,level] of Object.entries(LEVELS)){
      const button=document.createElement("button");
      button.className="admin-level";
      button.type="button";
      button.dataset.level=id;
      button.innerHTML=`<span>${esc(level.number)}</span><b>${esc(level.name)}</b><i>LOAD</i>`;
      this.levels.appendChild(button);
    }
  }

  bind(){
    window.addEventListener("keydown",event=>{
      const code=event.code;
      const key=event.key;
      const toggle=code==="Minus"||code==="Equal"||code==="NumpadSubtract"||code==="NumpadAdd"||code==="Backquote"||key==="-"||key==="=";
      if(this.ready&&this.game.admin.enabled&&toggle&&!event.repeat){
        event.preventDefault();
        event.stopPropagation();
        this.opened?this.close():this.open();
      }
    },true);
    this.root.querySelector("#admin-close")?.addEventListener("click",()=>this.close());
    this.root.querySelector("#admin-game")?.addEventListener("click",()=>this.close());

    this.root.querySelectorAll("[data-admin-tab]").forEach(button=>{
      button.addEventListener("click",()=>{
        const tab=button.dataset.adminTab;
        this.root.querySelectorAll("[data-admin-tab]").forEach(x=>x.classList.toggle("active",x===button));
        this.root.querySelectorAll("[data-admin-panel]").forEach(x=>x.classList.toggle("active",x.dataset.adminPanel===tab));
      });
    });

    this.root.querySelectorAll(".admin-level").forEach(button=>{
      button.addEventListener("click",()=>this.teleportLevel(button.dataset.level));
    });

    this.root.querySelector("#admin-teleport")?.addEventListener("click",()=>{
      const x=Number(this.root.querySelector("#admin-x")?.value||0);
      const y=Number(this.root.querySelector("#admin-y")?.value||this.game.player.eyeY);
      const z=Number(this.root.querySelector("#admin-z")?.value||0);
      this.game.player.position.set(x,y,z);
      this.game.toast("TELEPORTED",1);
    });

    this.root.querySelector("#admin-god")?.addEventListener("click",()=>{
      this.game.admin.god=!this.game.admin.god;
      this.sync();
    });
    this.root.querySelector("#admin-noclip")?.addEventListener("click",()=>{
      this.game.admin.noclip=!this.game.admin.noclip;
      this.sync();
    });

    this.root.querySelectorAll("[data-admin-action]").forEach(button=>{
      button.addEventListener("click",()=>this.action(button.dataset.adminAction));
    });
    this.root.querySelectorAll("[data-admin-event]").forEach(button=>{
      button.addEventListener("click",()=>this.event(button.dataset.adminEvent));
    });
  }

  async teleportLevel(id){
    const level=LEVELS[String(id)];
    if(!level||this.busy||!this.game.running||this.game.introActive||this.game.dead)return;
    this.busy=true;
    const wasPaused=this.game.paused;
    if(this.root)this.root.style.pointerEvents="none";
    try{
      this.game.paused=true;
      document.getElementById("pause")?.classList.add("hidden");
      document.getElementById("death")?.classList.add("hidden");
      document.getElementById("ending")?.classList.add("hidden");

      this.game.levelId=String(id);
      this.game.level=level;
      this.game.lightState="ON";
      this.game.lightEventTimer=48;
      this.game.intercomTimer=70;
      const FogClass=this.game.scene.fog?.constructor;
      if(FogClass)this.game.scene.fog=new FogClass(0x000000,level.id==="0"?.027:level.id==="1"?.043:level.id==="2"?.058:level.id==="3"?.052:.036);
      this.game.ambient.color.setHex(level.theme.ambient);
      this.game.flash.color.setHex(level.id==="2"?0xd9d7ff:0xffffee);

      await this.game.world.configure();
      this.game.world.ensureAround(0,0);
      this.game.entityManager.clear();
      this.game.player.reset();
      if(String(id)==="1")this.game.player.position.set(6,this.game.player.eyeY,3);
      else this.game.player.position.set(0,this.game.player.eyeY,0);

      this.game.running=true;
      this.game.paused=wasPaused;
      this.game.introActive=false;
      this.game.introPlaying=false;
      document.getElementById("hud")?.classList.remove("hidden");
      document.getElementById("mobile-controls")?.classList.toggle("hidden",matchMedia("(pointer:fine)").matches);
      const n=document.getElementById("level-number");if(n)n.textContent=level.number;
      const name=document.getElementById("level-name");if(name)name.textContent=level.name;
      const obj=document.getElementById("objective");if(obj)obj.textContent=level.objective;
      const rec=document.getElementById("recording-level");if(rec)rec.textContent=level.number;
      const pause=document.getElementById("pause-level");if(pause)pause.textContent=level.number;
      this.game.toast("LOADED "+level.number,1.4);
      this.sync();
    }catch(error){
      console.error("[Backrooms] Admin teleport failed:",error);
      this.game.running=true;
      this.game.paused=wasPaused;
      this.game.introActive=false;
      this.game.introPlaying=false;
      this.game.toast("ADMIN TELEPORT FAILED",2);
    }finally{
      this.busy=false;
      if(this.root)this.root.style.pointerEvents="";
    }
  }

  action(kind){
    if(!this.ready||!this.game.running||this.game.introActive)return;
    const p=this.game.player;
    if(kind==="heal")p.health=100;
    if(kind==="stamina")p.stamina=100;
    if(kind==="sanity")p.sanity=100;
    if(kind==="battery")p.flashBattery=100;
    if(kind==="reseed"){
      this.game.seed=(Math.random()*2147483647)|0;
      localStorage.setItem("br.seed",String(this.game.seed));
      this.game.restart();
    }
    if(kind==="clear-cache")location.reload();
    this.game.toast(kind.replace("-", " ").toUpperCase(),1);
  }

  event(kind){
    if(!this.ready||!this.game.running||this.game.introActive)return;
    if(kind==="on"){this.game.lightState="ON";this.game.lightEventTimer=60}
    if(kind==="flicker"){this.game.lightState="FLICKER";this.game.lightEventTimer=2.5}
    if(kind==="blackout"){this.game.lightState="BLACKOUT";this.game.lightEventTimer=5}
    if(kind==="fear")this.game.triggerFear(.9);
    if(kind==="heal"){this.game.player.reset();this.game.running=true;this.game.paused=false}
    if(kind==="reload"){
      const id=this.game.levelId;
      this.teleportLevel(id);
      return;
    }
    if(kind==="exit")this.game.reachExit();
    this.game.toast(kind.toUpperCase(),1);
  }

  sync(){
    const god=this.root.querySelector("#admin-god");
    const noclip=this.root.querySelector("#admin-noclip");
    if(god){god.classList.toggle("on",!!this.game.admin.god);god.querySelector("i").textContent=this.game.admin.god?"ON":"OFF"}
    if(noclip){noclip.classList.toggle("on",!!this.game.admin.noclip);noclip.querySelector("i").textContent=this.game.admin.noclip?"ON":"OFF"}
  }

  update(){
    if(!this.ready||!this.root||!this.game.running||this.game.introActive)return;
    const p=this.game.player;
    const c=this.game.world.chunkAt(p.position.x,p.position.z);
    this.root.querySelector("#admin-runtime").textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    if(this.stats)this.stats.innerHTML=[
      ["LEVEL",this.game.level.number],
      ["CHUNK",c?`${c.cx} : ${c.cz}`:"-- : --"],
      ["POSITION",`${p.position.x.toFixed(1)} / ${p.position.y.toFixed(1)} / ${p.position.z.toFixed(1)}`],
      ["BATTERY",`${Math.round(p.flashBattery)}%`],
      ["HEALTH",`${Math.round(p.health)}%`],
      ["LIGHT STATE",this.game.lightState],
      ["CHUNKS",this.game.world.chunks.size],
      ["QUALITY",this.game.quality.mode.toUpperCase()]
    ].map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    this.sync();
  }

  open(){
    if(!this.game.admin.enabled)return;
    this.opened=true;
    this.root.classList.remove("hidden");
    this.update();
    document.exitPointerLock?.();
    if(this.opener){
      this.opener.hidden=true;
      this.opener.setAttribute("aria-expanded","true");
    }
  }

  close(){
    this.opened=false;
    this.root.classList.add("hidden");
    if(this.opener){
      this.opener.hidden=!this.game.admin.enabled;
      this.opener.setAttribute("aria-expanded","false");
    }
  }
}
