const AUDIO_BASE=new URL("../assets/audio/",import.meta.url).href;
export const BACKROOMS_AUDIO_SOURCES=Object.freeze({
  ambient_horror:AUDIO_BASE+"ambient_horror.ogg",
  electric_buzz:AUDIO_BASE+"electric_buzz.ogg",
  footsteps:Object.freeze([AUDIO_BASE+"footstep_01.ogg",AUDIO_BASE+"footstep_02.ogg",AUDIO_BASE+"footstep_03.ogg",AUDIO_BASE+"footstep_04.ogg",AUDIO_BASE+"footstep_05.ogg",AUDIO_BASE+"footstep_06.ogg"])
});
function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}
export class AudioDirector{
  constructor(){this.ctx=null;this.master=null;this.fxBus=null;this.reverb=null;this.delay=null;this.ready=false;this.loading=null;this.buffers=new Map();this.stepTimer=0;this.ambientTimer=24;this.buzzTimer=5;this.humGain=null;this.volume=Number(localStorage.getItem("br.volume")??.65)}
  createImpulse(seconds=1.6,decay=2.8){const length=Math.floor(this.ctx.sampleRate*seconds),buffer=this.ctx.createBuffer(2,length,this.ctx.sampleRate);for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,decay)}return buffer}
  async init(){
    if(this.ready){if(this.ctx.state==="suspended")await this.ctx.resume();return}
    if(this.loading){await this.loading;return}
    this.loading=(async()=>{
      this.ctx=new(window.AudioContext||window.webkitAudioContext)();
      this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);
      this.fxBus=this.ctx.createGain();this.fxBus.gain.value=.68;this.fxBus.connect(this.master);
      this.reverb=this.ctx.createConvolver();this.reverb.buffer=this.createImpulse();const reverbGain=this.ctx.createGain();reverbGain.gain.value=.22;this.reverb.connect(reverbGain).connect(this.fxBus);
      this.delay=this.ctx.createDelay(.75);this.delay.delayTime.value=.22;const feedback=this.ctx.createGain();feedback.gain.value=.18;this.delay.connect(feedback).connect(this.delay);const delayGain=this.ctx.createGain();delayGain.gain.value=.12;this.delay.connect(delayGain).connect(this.fxBus);
      this.humGain=this.ctx.createGain();this.humGain.gain.value=.014;const hum=this.ctx.createOscillator();hum.type="sine";hum.frequency.value=58;const hum2=this.ctx.createOscillator();hum2.type="triangle";hum2.frequency.value=116;const humMix=this.ctx.createGain();humMix.gain.value=.33;const filter=this.ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=185;filter.Q.value=.35;hum.connect(filter).connect(this.humGain).connect(this.master);hum2.connect(humMix).connect(filter);hum.start();hum2.start();
      const entries=[["ambient_horror",BACKROOMS_AUDIO_SOURCES.ambient_horror],["electric_buzz",BACKROOMS_AUDIO_SOURCES.electric_buzz],...BACKROOMS_AUDIO_SOURCES.footsteps.map((url,i)=>["footstep_"+String(i+1).padStart(2,"0"),url])];
      const results=await Promise.allSettled(entries.map(async([key,url])=>{const response=await fetch(url,{cache:"force-cache"});if(!response.ok)throw new Error("HTTP "+response.status);this.buffers.set(key,await this.ctx.decodeAudioData(await response.arrayBuffer()))}));
      for(const result of results)if(result.status==="rejected")console.warn("[Backrooms] Audio asset unavailable; generated fallback remains active.",result.reason);
      this.ready=true;if(this.ctx.state==="suspended")await this.ctx.resume();
    })();
    await this.loading;this.loading=null;
  }
  setVolume(v){this.volume=clamp(Number(v));localStorage.setItem("br.volume",this.volume);if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.04)}
  async resume(){await this.init()}
  connectFx(node,send=.3,delay=.18){node.connect(this.master);if(this.reverb){const g=this.ctx.createGain();g.gain.value=send;node.connect(g).connect(this.reverb)}if(this.delay){const g=this.ctx.createGain();g.gain.value=delay;node.connect(g).connect(this.delay)}}
  playBuffer(name,{gain=.16,rate=1,pan=0,send=.24,delay=.08}={}){const buffer=this.buffers.get(name);if(!buffer||!this.ready)return false;const source=this.ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=rate;const gainNode=this.ctx.createGain();gainNode.gain.value=gain;const panner=this.ctx.createStereoPanner();panner.pan.value=clamp(pan,-1,1);source.connect(gainNode).connect(panner);this.connectFx(panner,send,delay);source.start();return true}
  clickToEnter(){this.tone(1180,.055,"square",.1);this.tone(260,.08,"square",.05);this.noise(.018,.12,1600)}
  tone(freq,duration,type="sine",gain=.05){if(!this.ready)return;const o=this.ctx.createOscillator(),g=this.ctx.createGain(),now=this.ctx.currentTime;o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(gain,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+duration);this.connectFx(g,.08,.04);o.connect(g);o.start(now);o.stop(now+duration+.02)}
  noise(duration=.12,gain=.035,band=900){if(!this.ready)return;const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration)),b=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);const s=this.ctx.createBufferSource(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();f.type="bandpass";f.frequency.value=band;f.Q.value=.75;g.gain.value=gain;s.buffer=b;s.connect(f).connect(g);this.connectFx(g,.06,.03);s.start()}
  step(intensity=1){const pick=1+Math.floor(Math.random()*6),played=this.playBuffer("footstep_"+String(pick).padStart(2,"0"),{gain:.19*intensity,rate:.93+Math.random()*.12,pan:(Math.random()-.5)*.16,send:.3,delay:.05});if(!played){this.tone(62+Math.random()*17,.055,"triangle",.018*intensity);this.noise(.045,.012*intensity,1300)}}
  click(){this.tone(420,.03,"square",.025);this.tone(70,.07,"sine",.012)}
  flicker(){this.playBuffer("electric_buzz",{gain:.22+Math.random()*.12,rate:.86+Math.random()*.24,pan:(Math.random()-.5)*.3,send:.34,delay:.1});this.noise(.09,.024,120);this.tone(38,.18,"sine",.018)}
  pickup(){this.tone(523,.09,"sine",.04);this.tone(659,.12,"sine",.032)}
  scare(){this.playBuffer("ambient_horror",{gain:.24,rate:.9+Math.random()*.18,pan:(Math.random()-.5)*.24,send:.5,delay:.2});this.noise(.45,.09,250);this.tone(43,.5,"sawtooth",.06);this.tone(89,.28,"triangle",.03)}
  ambientSting(gain=.1){this.playBuffer("ambient_horror",{gain,rate:.92+Math.random()*.12,pan:(Math.random()-.5)*.5,send:.52,delay:.18})}
  hurt(){this.noise(.16,.07,380);this.tone(71,.12,"square",.035)}
  exit(){this.tone(392,.12,"sine",.05);setTimeout(()=>this.tone(523,.16,"sine",.045),90);setTimeout(()=>this.tone(659,.22,"sine",.04),190)}
  distantKnock(angle=0){const pan=Math.sin(angle);this.tone(72,.08,"square",.022);setTimeout(()=>this.tone(55,.055,"square",.018),130+Math.random()*90);setTimeout(()=>this.tone(72,.08,"square",.018),310+Math.random()*110);this.playBuffer("electric_buzz",{gain:.025,rate:.72,pan,send:.72,delay:.35})}
  update(dt,moving,running,fear=0){
    if(!this.ready)return;
    if(moving){this.stepTimer-=dt;if(this.stepTimer<=0){this.stepTimer=running?.31:.48;this.step(running?1:.72)}}
    this.ambientTimer-=dt;this.buzzTimer-=dt;
    if(this.ambientTimer<=0){this.ambientSting(.045+Math.random()*.05);this.ambientTimer=28+Math.random()*48}
    if(this.buzzTimer<=0){this.playBuffer("electric_buzz",{gain:.07+Math.random()*.05,rate:.85+Math.random()*.25,pan:(Math.random()-.5)*.8,send:.38,delay:.14});this.buzzTimer=6+Math.random()*12}
    if(this.humGain)this.humGain.gain.setTargetAtTime(.012+Math.random()*.006+fear*.01,this.ctx.currentTime,.12);
  }
}
