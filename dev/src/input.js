export class InputManager {
  constructor(game){
    this.game = game;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.run = false;
    this.locked = false;
    this.joystickId = null;
    this.lookId = null;
    this.joystickCenter = {x:0,y:0};
    this.lastTouch = {x:0,y:0};
    this.bind();
    document.documentElement.classList.toggle("touch-device",navigator.maxTouchPoints>0||matchMedia("(pointer:coarse)").matches||matchMedia("(hover:none)").matches);
  }

  bind(){
    addEventListener("keydown", e => {
      if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if(e.code==="KeyF" && !e.repeat) this.game.toggleFlashlight();
      if(e.code==="Escape"){e.preventDefault();this.game.togglePause();}
      if(e.code==="KeyR" && e.shiftKey && !e.repeat) this.game.restart();
    });
    addEventListener("keyup", e => this.keys.delete(e.code));

    const canvas = this.game.renderer?.domElement;
    const touchCapable=()=>navigator.maxTouchPoints>0||matchMedia("(pointer:coarse)").matches||matchMedia("(hover:none)").matches;
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.game.renderer.domElement;
    });
    addEventListener("mousemove", e => {
      if(this.locked && !this.game.paused){
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });

    this.game.renderer.domElement.addEventListener("click", () => {
      if(matchMedia("(pointer:fine)").matches && !this.game.paused){const lock=this.game.renderer.domElement.requestPointerLock?.();lock?.catch(()=>{});}
    });

    const stick = document.getElementById("stick-zone");
    const knob = document.getElementById("stick-knob");
    stick?.addEventListener("pointerdown", e => {
      e.preventDefault(); stick.setPointerCapture(e.pointerId);
      this.joystickId=e.pointerId;
      const r=stick.getBoundingClientRect();
      this.joystickCenter={x:r.left+r.width/2,y:r.top+r.height/2};
      this.updateStick(e.clientX,e.clientY,stick,knob);
    });
    stick?.addEventListener("pointermove", e => {
      if(e.pointerId===this.joystickId) this.updateStick(e.clientX,e.clientY,stick,knob);
    });
    const endStick=e=>{
      if(e.pointerId===this.joystickId){
        this.joystickId=null;this.moveX=0;this.moveY=0;
        if(knob)knob.style.transform="translate(-50%,-50%)";
      }
    };
    stick?.addEventListener("pointerup",endStick);stick?.addEventListener("pointercancel",endStick);

    const look=document.getElementById("look-zone");
    look?.addEventListener("pointerdown",e=>{
      e.preventDefault();
      if(this.lookId!==null) return;
      look.setPointerCapture(e.pointerId); this.lookId=e.pointerId;
      this.lastTouch={x:e.clientX,y:e.clientY};
    });
    look?.addEventListener("pointermove",e=>{
      if(e.pointerId!==this.lookId) return;
      const dx=e.clientX-this.lastTouch.x, dy=e.clientY-this.lastTouch.y;
      this.lookX += dx*1.18; this.lookY += dy*1.18;
      this.lastTouch={x:e.clientX,y:e.clientY};
    });
    const endLook=e=>{if(e.pointerId===this.lookId)this.lookId=null;};
    look?.addEventListener("pointerup",endLook);look?.addEventListener("pointercancel",endLook);

    const runButton=document.getElementById("mobile-run");
    runButton?.addEventListener("pointerdown",e=>{e.preventDefault();runButton.setPointerCapture(e.pointerId);this.run=true});
    runButton?.addEventListener("pointerup",()=>this.run=false);
    runButton?.addEventListener("pointercancel",()=>this.run=false);
    runButton?.addEventListener("lostpointercapture",()=>this.run=false);

    document.getElementById("mobile-flash")?.addEventListener("pointerdown",e=>{e.preventDefault();this.game.toggleFlashlight()});
    document.getElementById("mobile-pause")?.addEventListener("pointerdown",e=>{e.preventDefault();this.game.togglePause()});
  }

  updateStick(x,y,zone,knob){
    const r=zone.getBoundingClientRect();
    const max=r.width*.34, dx=x-(r.left+r.width/2), dy=y-(r.top+r.height/2);
    const len=Math.hypot(dx,dy)||1, scale=Math.min(1,max/len);
    const nx=dx/len*scale, ny=dy/len*scale;
    this.moveX=nx; this.moveY=ny;
    knob.style.transform="translate(calc(-50% + "+(nx*max)+"px),calc(-50% + "+(ny*max)+"px))";
  }

  consumeLook(){
    const out={x:this.lookX,y:this.lookY}; this.lookX=0; this.lookY=0; return out;
  }

  getMove(){
    let x=this.moveX,y=this.moveY;
    if(this.keys.has("KeyA")) x-=1;
    if(this.keys.has("KeyD")) x+=1;
    if(this.keys.has("KeyW")) y-=1;
    if(this.keys.has("KeyS")) y+=1;
    const l=Math.hypot(x,y);
    if(l>1){x/=l;y/=l}
    return {x,y};
  }

  wantsRun(){ return this.run || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"); }
}
