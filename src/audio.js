function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,v))}

export class AudioDirector{
  constructor(){
    this.ctx=null;this.master=null;this.ambientGain=null;this.humGain=null;this.ready=false;
    this.volume=Number(localStorage.getItem("br.volume")??.65);this.stepTimer=0;
    this.reverb=null;this.delay=null;this.delayFeedback=null;this.fxBus=null;
  }

  createImpulse(seconds=1.8,decay=2.6){
    const length=Math.floor(this.ctx.sampleRate*seconds);
    const buffer=this.ctx.createBuffer(2,length,this.ctx.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=buffer.getChannelData(ch);
      for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,decay);
    }
    return buffer;
  }

  async init(){
    if(this.ready){if(this.ctx.state==="suspended")await this.ctx.resume();return}
    this.ctx=new(window.AudioContext||window.webkitAudioContext)();

    this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);
    this.fxBus=this.ctx.createGain();this.fxBus.gain.value=.72;this.fxBus.connect(this.master);

    this.reverb=this.ctx.createConvolver();this.reverb.buffer=this.createImpulse(1.7,2.8);
    const reverbGain=this.ctx.createGain();reverbGain.gain.value=.26;
    this.reverb.connect(reverbGain).connect(this.fxBus);

    this.delay=this.ctx.createDelay(.8);this.delay.delayTime.value=.23;
    this.delayFeedback=this.ctx.createGain();this.delayFeedback.gain.value=.22;
    this.delay.connect(this.delayFeedback).connect(this.delay);
    const delayGain=this.ctx.createGain();delayGain.gain.value=.18;
    this.delay.connect(delayGain).connect(this.fxBus);

    this.humGain=this.ctx.createGain();this.humGain.gain.value=.028;
    const hum=this.ctx.createOscillator();hum.type="sine";hum.frequency.value=58;
    const humFilter=this.ctx.createBiquadFilter();humFilter.type="lowpass";humFilter.frequency.value=170;
    hum.connect(humFilter).connect(this.humGain).connect(this.master);hum.start();

    const noiseLen=this.ctx.sampleRate*2,buffer=this.ctx.createBuffer(1,noiseLen,this.ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.11;
    const source=this.ctx.createBufferSource();source.buffer=buffer;source.loop=true;
    const filter=this.ctx.createBiquadFilter();filter.type="bandpass";filter.frequency.value=235;filter.Q.value=.33;
    this.ambientGain=this.ctx.createGain();this.ambientGain.gain.value=.026;
    source.connect(filter).connect(this.ambientGain).connect(this.master);source.start();

    this.ready=true;
  }

  setVolume(v){
    this.volume=clamp(Number(v));localStorage.setItem("br.volume",this.volume);
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.04);
  }

  async resume(){await this.init()}

  connectFx(node,send=.42){
    node.connect(this.master);
    if(this.reverb){const g=this.ctx.createGain();g.gain.value=send;node.connect(g).connect(this.reverb)}
    if(this.delay){const g=this.ctx.createGain();g.gain.value=send*.65;node.connect(g).connect(this.delay)}
  }

  clickToEnter(){
    if(!this.ready)return;
    const now=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(),gain=this.ctx.createGain();
    osc.type="square";osc.frequency.setValueAtTime(1180,now);osc.frequency.exponentialRampToValueAtTime(260,now+.055);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.13,now+.002);gain.gain.exponentialRampToValueAtTime(.0001,now+.07);
    osc.connect(gain);this.connectFx(gain,.8);osc.start(now);osc.stop(now+.09);

    const len=Math.floor(this.ctx.sampleRate*.018),b=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);
    const s=this.ctx.createBufferSource(),g=this.ctx.createGain();g.gain.value=.16;s.buffer=b;s.connect(g);this.connectFx(g,.62);s.start(now);

    const tail=this.ctx.createOscillator(),tg=this.ctx.createGain();
    tail.type="sine";tail.frequency.value=180;tg.gain.setValueAtTime(.0001,now+.06);tg.gain.exponentialRampToValueAtTime(.028,now+.065);tg.gain.exponentialRampToValueAtTime(.0001,now+.55);
    tail.connect(tg);this.connectFx(tg,.55);tail.start(now+.06);tail.stop(now+.58);
  }

  tone(freq,duration,type="sine",gain=.05,detune=0){
    if(!this.ready)return;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain(),now=this.ctx.currentTime;
    o.type=type;o.frequency.value=freq;o.detune.value=detune;
    g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(gain,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+duration);
    o.connect(g);this.connectFx(g,.08);o.start(now);o.stop(now+duration+.02);
  }

  noise(duration=.12,gain=.035,band=900){
    if(!this.ready)return;
    const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration)),b=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
    const s=this.ctx.createBufferSource(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    f.type="bandpass";f.frequency.value=band;f.Q.value=.8;g.gain.value=gain;s.buffer=b;s.connect(f).connect(g);this.connectFx(g,.06);s.start();
  }

  step(intensity=1){this.tone(62+Math.random()*17,.055,"triangle",.018*intensity);this.noise(.045,.012*intensity,1300)}
  click(){this.tone(420,.03,"square",.025);this.tone(70,.07,"sine",.012)}
  flicker(){this.noise(.11,.026,120);this.tone(38,.18,"sine",.018)}
  pickup(){this.tone(523,.09,"sine",.04);this.tone(659,.12,"sine",.032)}
  scare(){this.noise(.55,.11,250);this.tone(47,.52,"sawtooth",.07);this.tone(91,.3,"triangle",.035)}
  hurt(){this.noise(.16,.07,380);this.tone(71,.12,"square",.035)}
  exit(){this.tone(392,.12,"sine",.05);setTimeout(()=>this.tone(523,.16,"sine",.045),90);setTimeout(()=>this.tone(659,.22,"sine",.04),190)}
  distantKnock(){
    this.tone(72,.08,"square",.022);
    setTimeout(()=>this.tone(55,.055,"square",.018),130+Math.random()*90);
    setTimeout(()=>this.tone(72,.08,"square",.018),310+Math.random()*110);
  }
  update(dt,moving,running){
    if(!this.ready)return;
    if(moving){this.stepTimer-=dt;if(this.stepTimer<=0){this.stepTimer=running?.28:.43;this.step(running?1:.65)}}
    if(this.humGain){const pulse=.022+Math.random()*.012;this.humGain.gain.setTargetAtTime(pulse,this.ctx.currentTime,.08)}
  }
}
