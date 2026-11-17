// Original note sequences are translated from pokered's music assembly into JSON.
// WebAudio synthesis approximates Game Boy timbres; it does not emulate its APU.
export class MusicPlayer {
  constructor(data) {
    this.data=data; this.context=null; this.master=null; this.song=null; this.start=0;
    this.enabled=false; this.volume=.13; this.timer=null; this.voices=new Set(); this.scheduled=new Set(); this.waves=new Map();
  }
  async enable(enabled) {
    this.enabled=enabled;
    if(!enabled){this.stopVoices();if(this.master)this.master.gain.setTargetAtTime(0,this.context.currentTime,.02);return;}
    if(!this.context){this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=this.volume;this.master.connect(this.context.destination);}
    await this.context.resume();this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.02);
    this.start=this.context.currentTime+.04;this.scheduled.clear();
    if(!this.timer)this.timer=setInterval(()=>this.tick(),60);
    this.tick();
  }
  setVolume(volume){this.volume=Math.max(0,Math.min(.5,volume));if(this.master&&this.enabled)this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.02);}
  stopVoices(){for(const voice of this.voices){try{voice.stop();}catch{}}this.voices.clear();this.scheduled.clear();}
  play(id){if(this.song===id)return;if(!this.data.tracks[id])return;this.stopVoices();this.song=id;if(this.context)this.start=this.context.currentTime+.03;this.tick();}
  tick(){
    if(!this.enabled||!this.context||this.context.state!=='running'||!this.song)return;
    const track=this.data.tracks[this.song],now=this.context.currentTime,elapsed=now-this.start,ahead=.22;
    for(const channel of track.channels){
      const loopStart=channel.loopStart,loopEnd=channel.loopEnd||channel.duration,loopLength=loopStart===null?0:loopEnd-loopStart;
      const cycle=loopLength>0?Math.max(0,Math.floor((elapsed-loopStart)/loopLength)):0;
      for(const lap of new Set([0,cycle,cycle+1])){
        for(let i=0;i<channel.notes.length;i++){
          const note=channel.notes[i];if(lap>0&&(loopStart===null||note.time<loopStart-.001))continue;
          const time=this.start+note.time+lap*loopLength,key=`${channel.channel}:${lap}:${i}`;
          if(time<now-.04||time>now+ahead||this.scheduled.has(key))continue;
          this.scheduled.add(key);this.note(channel,note,Math.max(now,time));
        }
      }
    }
    // Only keys around the current loop are useful. Bound memory during long play.
    if(this.scheduled.size>12000)this.scheduled.clear();
  }
  pulseWave(duty){
    const key=`pulse:${duty}`;if(this.waves.has(key))return this.waves.get(key);
    const width=[.125,.25,.5,.75][duty]??.5,real=new Float32Array(33),imag=new Float32Array(33);
    for(let n=1;n<33;n++){real[n]=Math.sin(2*Math.PI*n*width)/(Math.PI*n);imag[n]=(1-Math.cos(2*Math.PI*n*width))/(Math.PI*n);}
    const wave=this.context.createPeriodicWave(real,imag);this.waves.set(key,wave);return wave;
  }
  sampleWave(index){
    const key=`wave:${index}`;if(this.waves.has(key))return this.waves.get(key);
    const samples=this.data.waveSamples[index];if(!samples)return null;
    const real=new Float32Array(17),imag=new Float32Array(17);
    for(let n=1;n<17;n++)for(let k=0;k<32;k++){const value=(samples[k]/15-.5)*2;real[n]+=value*Math.cos(2*Math.PI*n*k/32)/16;imag[n]+=value*Math.sin(2*Math.PI*n*k/32)/16;}
    const wave=this.context.createPeriodicWave(real,imag);this.waves.set(key,wave);return wave;
  }
  note(channel,note,time){
    const context=this.context,duration=Math.max(.015,note.duration*.95),gain=context.createGain();
    let oscillator;
    if(channel.kind==='noise'){
      oscillator=context.createBufferSource();const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*.18),context.sampleRate),v=buffer.getChannelData(0);let seed=0x5a17;
      for(let i=0;i<v.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;v[i]=(seed/2147483648-1)*.3;}
      oscillator.buffer=buffer;oscillator.loop=true;oscillator.playbackRate.value=note.drum%2?1:.55;
    }else{
      if(!Number.isFinite(note.midi))return;
      oscillator=context.createOscillator();oscillator.frequency.value=note.frequencyHz||440*2**((note.midi-69)/12);
      if(channel.kind==='pulse')oscillator.setPeriodicWave(this.pulseWave(note.duty));
      else {const wave=this.sampleWave(note.wave);if(wave)oscillator.setPeriodicWave(wave);else oscillator.type='triangle';}
    }
    const volume=Math.max(.001,Math.min(1,note.volume??.5))*(channel.kind==='noise'?.17:.23);
    gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+.004);
    const release=Math.min(.03,duration/3);gain.gain.setValueAtTime(volume,time+duration-release);gain.gain.linearRampToValueAtTime(0,time+duration);
    oscillator.connect(gain).connect(this.master);oscillator.start(time);oscillator.stop(time+duration+.005);this.voices.add(oscillator);
    oscillator.onended=()=>{this.voices.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  }
  effect(kind='confirm'){
    if(!this.enabled||!this.context)return;
    const start=this.context.currentTime;
    const notes=kind==='victory'?[72,76,79,84]:kind==='hit'?[45,38]:kind==='heal'?[72,76,79,76,84]:[81];
    notes.forEach((midi,i)=>this.note({kind:'pulse'},{midi,duration:kind==='victory'?.13:.06,volume:.6,duty:2},start+i*.08));
  }
}
