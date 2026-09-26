const AUDIO_BASE=new URL("../assets/audio/",import.meta.url).href;
const RED_ZONE_AUDIO=new URL("../assets/RedZone.ogg",import.meta.url).href;

export const BACKROOMS_AUDIO_SOURCES=Object.freeze({
  ambient_horror:AUDIO_BASE+"ambient_horror.ogg",
  electric_buzz:AUDIO_BASE+"electric_buzz.ogg",
  footsteps:Object.freeze([
    AUDIO_BASE+"footstep_01.ogg",
    AUDIO_BASE+"footstep_02.ogg",
    AUDIO_BASE+"footstep_03.ogg",
    AUDIO_BASE+"footstep_04.ogg",
    AUDIO_BASE+"footstep_05.ogg",
    AUDIO_BASE+"footstep_06.ogg"
  ])
});

function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}

export class AudioDirector{
  constructor(){
    this.ctx=null;this.master=null;this.fxBus=null;this.reverb=null;this.delay=null;
    this.ready=false;this.loading=null;this.buffers=new Map();
    this.stepDistance=0;this.ambientTimer=70;this.buzzTimer=11;this.humGain=null;this.lastRareEvent=-Infinity;
    this.volume=Number(localStorage.getItem("br.volume")??.65);
    this.redZoneSource=null;this.redZoneGain=null;this.redZoneStartedAt=0;this.redZoneDuration=0;this.redZoneLoading=null;
    this.redZoneMedia=null;this.redZoneMetadataPromise=null;
  }
  createImpulse(seconds=1.6,decay=2.8){
    const length=Math.floor(this.ctx.sampleRate*seconds),buffer=this.ctx.createBuffer(2,length,this.ctx.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=buffer.getChannelData(ch);
      for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,decay);
    }
    return buffer;
  }
  createNoiseLoop(seconds=2){
    const length=Math.floor(this.ctx.sampleRate*seconds),buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<length;i++){
      const fade=Math.min(1,Math.min(i/4000,(length-i)/4000));
      data[i]=(Math.random()*2-1)*fade;
    }
    return buffer;
  }
  async init(){
    if(this.ready)return;
    if(this.loading){await this.loading;return}
    this.loading=(async()=>{
      if(!this.ctx){
        const Ctx=window.AudioContext||window.webkitAudioContext;
        if(!Ctx)throw new Error("Web Audio API unavailable");
        this.ctx=new Ctx();
      }
      this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);
      this.fxBus=this.ctx.createGain();this.fxBus.gain.value=.64;this.fxBus.connect(this.master);
      this.reverb=this.ctx.createConvolver();this.reverb.buffer=this.createImpulse();
      const reverbGain=this.ctx.createGain();reverbGain.gain.value=.24;this.reverb.connect(reverbGain).connect(this.fxBus);
      this.delay=this.ctx.createDelay(.8);this.delay.delayTime.value=.24;
      const feedback=this.ctx.createGain();feedback.gain.value=.14;this.delay.connect(feedback).connect(this.delay);
      const delayGain=this.ctx.createGain();delayGain.gain.value=.1;this.delay.connect(delayGain).connect(this.fxBus);

      this.humGain=this.ctx.createGain();this.humGain.gain.value=.008;
      const humFilter=this.ctx.createBiquadFilter();humFilter.type="lowpass";humFilter.frequency.value=520;humFilter.Q.value=.35;
      humFilter.connect(this.humGain).connect(this.master);
      const humMix=this.ctx.createGain();humMix.gain.value=.9;humMix.connect(humFilter);
      const o1=this.ctx.createOscillator();o1.type="sine";o1.frequency.value=60;
      const o1g=this.ctx.createGain();o1g.gain.value=.52;o1.connect(o1g).connect(humMix);
      const o2=this.ctx.createOscillator();o2.type="triangle";o2.frequency.value=120;
      const o2g=this.ctx.createGain();o2g.gain.value=.2;o2.connect(o2g).connect(humMix);
      const o3=this.ctx.createOscillator();o3.type="sine";o3.frequency.value=240;
      const o3g=this.ctx.createGain();o3g.gain.value=.08;o3.connect(o3g).connect(humMix);
      o1.start();o2.start();o3.start();

      const noise=this.ctx.createBufferSource();noise.buffer=this.createNoiseLoop();noise.loop=true;
      const buzzFilter=this.ctx.createBiquadFilter();buzzFilter.type="bandpass";buzzFilter.frequency.value=1450;buzzFilter.Q.value=.9;
      const noiseGain=this.ctx.createGain();noiseGain.gain.value=.038;
      noise.connect(buzzFilter).connect(noiseGain).connect(this.humGain);noise.start();

      this.ready=true;

      const entries=[
        ["ambient_horror",BACKROOMS_AUDIO_SOURCES.ambient_horror],
        ["electric_buzz",BACKROOMS_AUDIO_SOURCES.electric_buzz],
        ...BACKROOMS_AUDIO_SOURCES.footsteps.map((url,i)=>["footstep_"+String(i+1).padStart(2,"0"),url])
      ];
      Promise.allSettled(entries.map(async([key,url])=>{
        const response=await fetch(url,{cache:"force-cache"});
        if(!response.ok)throw new Error("HTTP "+response.status);
        this.buffers.set(key,await this.ctx.decodeAudioData(await response.arrayBuffer()));
      })).then(results=>{
        for(const result of results)if(result.status==="rejected")console.warn("[Backrooms] Audio asset unavailable; generated fallback remains active.",result.reason);
      });
    })();
    try{
      await this.loading;
    }finally{
      this.loading=null;
    }
  }
  setVolume(v){
    this.volume=clamp(Number(v));localStorage.setItem("br.volume",this.volume);
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.04);
  }
  async testUnlock(){
    if(!this.ctx)return false;
    try{
      if(this.ctx.state==="suspended")await this.ctx.resume();
      const buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);
      const source=this.ctx.createBufferSource();
      source.buffer=buffer;
      source.connect(this.ctx.destination);
      source.start();
      return this.ctx.state==="running";
    }catch{return false}
  }
  isEnabled(){
    return !!this.ctx&&this.ctx.state==="running";
  }
  unlockFromGesture(){
    try{
      if(!this.ctx){
        const Ctx=window.AudioContext||window.webkitAudioContext;
        if(!Ctx)return;
        // Construct the context synchronously from the user gesture.
        this.ctx=new Ctx();
      }
      if(this.ctx.state==="suspended"){
        const resume=this.ctx.resume();
        Promise.resolve(resume).then(()=>{
          if(this.isEnabled()&&this.ready)this.clickToEnter();
        }).catch(error=>console.warn("[Backrooms] Audio resume failed:",error));
      }else if(this.isEnabled()&&this.ready){
        this.clickToEnter();
      }
      if(!this.ready)this.init().catch(error=>console.warn("[Backrooms] Audio init failed:",error));
    }catch(error){
      console.warn("[Backrooms] Audio unlock failed:",error);
    }
  }
  async resume(){
    await this.init();
    if(this.ctx?.state==="suspended"){
      try{await this.ctx.resume()}catch(error){console.warn("[Backrooms] Audio resume failed:",error)}
    }
  }
  connectFx(node,send=.3,delay=.18){
    node.connect(this.master);
    if(this.reverb){const g=this.ctx.createGain();g.gain.value=send;node.connect(g).connect(this.reverb)}
    if(this.delay){const g=this.ctx.createGain();g.gain.value=delay;node.connect(g).connect(this.delay)}
  }
  playBuffer(name,{gain=.16,rate=1,pan=0,send=.24,delay=.08}={}){
    const buffer=this.buffers.get(name);if(!buffer||!this.ready)return false;
    const source=this.ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;
    const gainNode=this.ctx.createGain();gainNode.gain.value=gain;
    const panner=this.ctx.createStereoPanner();panner.pan.value=clamp(pan,-1,1);
    source.connect(gainNode).connect(panner);this.connectFx(panner,send,delay);source.start();return true;
  }
  async getRedZoneMetadata(){
    if(this.redZoneDuration>0)return this.redZoneDuration;
    if(this.redZoneMetadataPromise)return this.redZoneMetadataPromise;
    this.redZoneMetadataPromise=new Promise(resolve=>{
      let media=this.redZoneMedia;
      if(!media){
        media=new Audio();
        media.preload="metadata";
        media.src=RED_ZONE_AUDIO;
        media.setAttribute("playsinline","");
        media.controls=false;
        media.style.display="none";
        this.redZoneMedia=media;
      }
      const finish=()=>{
        const duration=Number.isFinite(media.duration)&&media.duration>0?media.duration:0;
        if(duration)this.redZoneDuration=duration;
        resolve(duration);
      };
      if(Number.isFinite(media.duration)&&media.duration>0){
        finish();
        return;
      }
      media.addEventListener("loadedmetadata",finish,{once:true});
      media.addEventListener("error",()=>{
        console.warn("[Backrooms] RedZone.ogg metadata error:",media.error?.code,media.error?.message||"unknown");
        resolve(0);
      },{once:true});
      media.load();
    }).finally(()=>{this.redZoneMetadataPromise=null});
    return this.redZoneMetadataPromise;
  }
  async playRedZone(){
    await this.init();
    if(this.ctx?.state==="suspended"){
      try{await this.ctx.resume()}catch(error){console.warn("[Backrooms] Red Zone audio resume failed:",error)}
    }

    const duration=await this.getRedZoneMetadata();
    if(!duration)return null;

    const media=this.redZoneMedia;
    if(!media)return null;

    this.stopRedZone();
    media.preload="auto";
    media.loop=false;
    media.volume=clamp(this.volume*.9);
    media.currentTime=0;

    try{
      // Use Safari's native media pipeline instead of fetching + decodeAudioData().
      // iOS can stream OGG playback without making us wait for a complete decoded
      // AudioBuffer, while currentTime stays tied to the real playback clock.
      await media.play();
    }catch(error){
      console.warn("[Backrooms] RedZone.ogg playback failed:",error);
      return null;
    }

    this.redZoneStartedAt=this.ctx?.currentTime||0;
    this.redZoneDuration=Number.isFinite(media.duration)&&media.duration>0?media.duration:duration;
    media.onended=()=>{
      if(this.redZoneMedia===media){
        this.redZoneStartedAt=0;
      }
    };
    return {duration:this.redZoneDuration,startedAt:this.redZoneStartedAt};
  }
  stopRedZone(){
    const media=this.redZoneMedia;
    if(media){
      try{media.pause()}catch{}
      try{media.currentTime=0}catch{}
    }
    this.redZoneSource=null;this.redZoneGain=null;this.redZoneStartedAt=0;
  }
  redZoneElapsed(){
    const media=this.redZoneMedia;
    if(!media||!this.redZoneDuration)return 0;
    return Math.max(0,Number.isFinite(media.currentTime)?media.currentTime:0);
  }
  clickToEnter(){this.tone(1180,.055,"square",.08);this.tone(260,.08,"square",.04)}
  tone(freq,duration,type="sine",gain=.05){
    if(!this.ready)return;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain(),now=this.ctx.currentTime;
    o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.0001,now);
    g.gain.exponentialRampToValueAtTime(gain,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+duration);
    this.connectFx(g,.08,.04);o.connect(g);o.start(now);o.stop(now+duration+.02);
  }
  noise(duration=.12,gain=.035,band=900){
    if(!this.ready)return;
    const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration)),b=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
    const s=this.ctx.createBufferSource(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    f.type="bandpass";f.frequency.value=band;f.Q.value=.75;g.gain.value=gain;s.buffer=b;s.connect(f).connect(g);
    this.connectFx(g,.06,.03);s.start();
  }
  step(intensity=1){
    const pick=1+Math.floor(Math.random()*6);
    const played=this.playBuffer("footstep_"+String(pick).padStart(2,"0"),{
      gain:.28*intensity,rate:.91+Math.random()*.1,pan:(Math.random()-.5)*.18,send:.32,delay:.045
    });
    if(!played){this.tone(62+Math.random()*17,.055,"triangle",.022*intensity);this.noise(.045,.014*intensity,1300)}
  }
  click(){this.tone(420,.03,"square",.02);this.tone(70,.07,"sine",.01)}
  flicker(){
    if(Math.random()<.06)this.tone(95,.018,"sine",.0045);
  }
  pickup(){this.tone(523,.09,"sine",.04);this.tone(659,.12,"sine",.032)}
  intercom(){
    this.tone(1320,.055,"square",.012);
    setTimeout(()=>this.tone(880,.075,"square",.008),90);
    this.noise(.7,.022,1550);
    this.tone(196,.55,"sine",.008);
  }
  scare(){
    this.playBuffer("ambient_horror",{gain:.24,rate:.92+Math.random()*.16,pan:(Math.random()-.5)*.24,send:.5,delay:.2});
    this.noise(.45,.08,250);this.tone(43,.5,"sawtooth",.055);this.tone(89,.28,"triangle",.028);
  }
  lightsOut(){
    if(this.humGain)this.humGain.gain.setTargetAtTime(.001,this.ctx.currentTime,.035);
    if(Math.random()<.16)this.tone(72,.035,"square",.008);
  }
  ambientSting(gain=.1){
    this.playBuffer("ambient_horror",{gain,rate:.94+Math.random()*.1,pan:(Math.random()-.5)*.5,send:.52,delay:.18});
  }
  hurt(){this.noise(.16,.065,380);this.tone(71,.12,"square",.032)}
  exit(){this.tone(392,.12,"sine",.045);setTimeout(()=>this.tone(523,.16,"sine",.04),90);setTimeout(()=>this.tone(659,.22,"sine",.035),190)}
  distantKnock(angle=0){
    const pan=Math.sin(angle);
    this.tone(72,.08,"square",.022);setTimeout(()=>this.tone(55,.055,"square",.018),130+Math.random()*90);
    setTimeout(()=>this.tone(72,.08,"square",.018),310+Math.random()*110);
    if(Math.random()<.16)this.playBuffer("ambient_horror",{gain:.018,rate:.68,pan,send:.6,delay:.35});
  }
  update(dt,moving,running,fear=0,proximity=0,lightState="ON",distance=0){
    if(!this.ready)return;
    if(moving){
      this.stepDistance+=Math.max(0,distance);
      const cadence=running?1.03:.71;
      while(this.stepDistance>=cadence){
        this.stepDistance-=cadence;
        this.step(running?1:.78);
      }
    }else{
      this.stepDistance=Math.min(this.stepDistance,.45);
    }

    this.ambientTimer-=dt;this.buzzTimer-=dt;
    const p=clamp(proximity);

    if(this.ambientTimer<=0){
      this.ambientSting(.028+Math.random()*.038);
      this.ambientTimer=78+Math.random()*110;
    }

    // The ballast buzz becomes audible as you approach an actual fluorescent fixture.
    if(this.buzzTimer<=0&&lightState==="ON"){
      if(p>.03){
        const gain=.035+p*.17;
        this.playBuffer("electric_buzz",{
          gain,
          rate:.9+Math.random()*.16,
          pan:(Math.random()-.5)*.5,
          send:.38+p*.2,
          delay:.08
        });
        this.buzzTimer=14+(1-p)*20+Math.random()*11;
      }else{
        this.buzzTimer=12+Math.random()*18;
      }
    }

    let target=.008+p*.078+fear*.004;
    if(lightState==="FLICKER")target*=.48;
    if(lightState==="BLACKOUT")target=.00045;
    if(this.humGain)this.humGain.gain.setTargetAtTime(target,this.ctx.currentTime,.11);
  }
}
