function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}

export class AudioDirector {
  constructor(){
    this.ctx=null; this.master=null; this.ambientGain=null; this.ambientSource=null;
    this.volume=Number(localStorage.getItem("br.volume") ?? .65);
    this.ready=false; this.stepTimer=0;
  }

  async init(){
    if(this.ready) return;
    this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=this.ctx.createGain(); this.master.gain.value=this.volume; this.master.connect(this.ctx.destination);
    const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*.12;
    this.ambientSource=this.ctx.createBufferSource(); this.ambientSource.buffer=buffer; this.ambientSource.loop=true;
    const filter=this.ctx.createBiquadFilter(); filter.type="bandpass"; filter.frequency.value=210; filter.Q.value=.35;
    this.ambientGain=this.ctx.createGain(); this.ambientGain.gain.value=.035;
    this.ambientSource.connect(filter).connect(this.ambientGain).connect(this.master);
    this.ambientSource.start();
    this.ready=true;
  }

  setVolume(v){this.volume=clamp(Number(v));localStorage.setItem("br.volume",this.volume);if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.04)}
  async resume(){if(!this.ready) await this.init(); if(this.ctx.state==="suspended") await this.ctx.resume()}

  tone(freq,duration,type="sine",gain=.05,detune=0){
    if(!this.ready)return;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type;o.frequency.value=freq;o.detune.value=detune;
    g.gain.setValueAtTime(0,this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain,this.ctx.currentTime+.01);
    g.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);
    o.connect(g).connect(this.master);o.start();o.stop(this.ctx.currentTime+duration+.02);
  }

  noise(duration=.12,gain=.035,band=900){
    if(!this.ready)return;
    const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration));
    const b=this.ctx.createBuffer(1,len,this.ctx.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
    const s=this.ctx.createBufferSource(), f=this.ctx.createBiquadFilter(), g=this.ctx.createGain();
    s.buffer=b;f.type="bandpass";f.frequency.value=band;f.Q.value=.8;
    g.gain.value=gain;s.connect(f).connect(g).connect(this.master);s.start();
  }

  step(intensity=1){ this.tone(62+Math.random()*17,.055,"triangle",.018*intensity); this.noise(.045,.012*intensity,1300); }
  click(){this.tone(420,.03,"square",.025);this.tone(70,.07,"sine",.012)}
  flicker(){this.noise(.11,.026,120);this.tone(38,.18,"sine",.018)}
  pickup(){this.tone(523,.09,"sine",.04);this.tone(659,.12,"sine",.032)}
  scare(){this.noise(.55,.11,250);this.tone(47,.52,"sawtooth",.07);this.tone(91,.3,"triangle",.035)}
  hurt(){this.noise(.16,.07,380);this.tone(71,.12,"square",.035)}
  exit(){this.tone(392,.12,"sine",.05);setTimeout(()=>this.tone(523,.16,"sine",.045),90);setTimeout(()=>this.tone(659,.22,"sine",.04),190)}
  update(dt,moving,running){
    if(!this.ready)return;
    if(moving){this.stepTimer-=dt;if(this.stepTimer<=0){this.stepTimer=running?.28:.43;this.step(running?1:.65)}}
  }
}
