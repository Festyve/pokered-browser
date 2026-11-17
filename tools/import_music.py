#!/usr/bin/env python3
"""Translate pret/pokered's declarative music scores to browser sequencing data.

This is an offline score interpreter, not CPU or ROM emulation. It expands calls
and bounded loops, records the first complete repeating passage per channel, and
uses the original fractional note-delay arithmetic and pitch lookup table.
"""
from pathlib import Path
import argparse, heapq, json, math, re, subprocess

ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('source',type=Path)
ap.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist/data/music.json')
args=ap.parse_args(); src=args.source.resolve()
FPS=4194304/70224
PITCHES={'C_':0,'C#':1,'D_':2,'D#':3,'E_':4,'F_':5,'F#':6,'G_':7,'G#':8,'A_':9,'A#':10,'B_':11}
def number(x):return int(x[1:],16) if x.startswith('$') else int(x[1:],2) if x.startswith('%') else int(x)
def fields(s):return [x.strip() for x in s.split(',')]
def sec(frames):return round(frames/FPS,7)
def read(p):return (src/p).read_text()

# Every local label is scoped to its last global label, exactly as in RGBDS.
commands=[];labels={};locations={};track_files={}
for path in sorted((src/'audio/music').glob('*.asm')):
    scope=''
    for lineno,raw in enumerate(path.read_text().splitlines(),1):
        line=raw.split(';')[0].strip()
        if not line:continue
        if re.fullmatch(r'[.\w]+:{1,2}',line):
            name=line.rstrip(':')
            if not name.startswith('.'):scope=name
            else:name=scope+name
            labels[name]=len(commands);locations[len(commands)]=(path.name,lineno)
            continue
        cmd,_,rest=line.partition(' ');a=fields(rest) if rest else []
        if cmd in ['sound_call','sound_loop']:
            index=0 if cmd=='sound_call' else 1
            if a[index].startswith('.'):a[index]=scope+a[index]
        commands.append((cmd,a,str(path.relative_to(src)),lineno))

headers={}
for bank in [1,2,3]:
    scope=None
    for line in read(f'audio/headers/musicheaders{bank}.asm').splitlines():
        m=re.match(r'(Music_\w+)::',line)
        if m:scope=m[1];headers[scope]={'bank':bank,'channels':[]}
        m=re.match(r'\s*channel (\d+),\s*(\w+)',line)
        if m:headers[scope]['channels'].append((int(m[1]),m[2]))
# Preserve scores that do not have an active music header, e.g. the unused song.
for label in labels:
    m=re.fullmatch(r'(Music_\w+)_Ch([1-4])',label)
    if m and m[1] not in headers:
        headers[m[1]]={'bank':1,'channels':[(int(n),l) for l in labels if (mm:=re.fullmatch(re.escape(m[1])+r'_Ch([1-4])',l)) for n in [mm[1]]]}

raw_pitch=[int(x,16)-65536 for x in re.findall(r'dw \$([0-9A-Fa-f]+)',read('audio/notes.asm'))]
def frequency(pitch,octave,channel,perfect=False):
    register=2048+(raw_pitch[PITCHES[pitch]]>>(octave-1))
    if perfect:register+=1
    divisor=max(1,2048-register)
    hz=(65536 if channel==3 else 131072)/divisor
    return register,round(hz,6),round(69+12*math.log2(hz/440))

# Original four-bit wave-channel sample points, including bank-specific wave 5.
wave_samples=[]
for m in re.finditer(r'^\s*dn ([^\n]+)',read('audio/wave_samples.asm'),re.M):wave_samples.append([number(x) for x in fields(m[1])])
wave5=[list(map(number,fields(x))) for x in re.findall(r'^;\s*dn ([^\n]+)',read('audio/wave_samples.asm'),re.M)]
wave_samples.append(wave5[0])
noise={}
for bank in [1,2,3]:
    noise[str(bank)]={}
    for path in sorted((src/'audio/sfx').glob(f'noise_instrument*_{bank}.asm')):
        ident=int(re.search(r'instrument(\d+)_',path.name)[1]);parts=[];time=0
        for m in re.finditer(r'noise_note ([^\n;]+)',path.read_text()):
            length,volume,fade,register=map(number,fields(m[1]));duration=(length+1)/FPS
            parts.append({'time':round(time,7),'duration':round(duration,7),'volume':volume/15,'envelope':fade,'noiseRegister':register});time+=duration
        noise[str(bank)][str(ident)]=parts

class Channel:
    def __init__(self,channel,label):
        self.channel=channel;self.pc=labels[label];self.label=label;self.frame=0;self.fraction=0;self.octave=8;self.speed=1;self.volume=0;self.envelope=0;self.duty=0;self.wave=0;self.perfect=False;self.vibrato=None;self.slide=None;self.duty_pattern=None;self.stack=[];self.loops={};self.visits={};self.notes=[];self.loop_start=None;self.loop_end=None;self.ended=False;self.instructions=0
    def step(self,shared,channels,bank):
        while not self.ended:
            self.instructions+=1
            if self.instructions>200000:raise RuntimeError('Unbounded command path '+self.label)
            self.visits.setdefault(self.pc,self.frame)
            command,a,path,line=commands[self.pc];pc=self.pc;self.pc+=1
            if command=='tempo':
                shared['tempo']=number(a[0]);shared['tempos'].append({'time':sec(self.frame),'value':shared['tempo']})
                for ch in channels:ch.fraction=0
            elif command=='volume':shared['master']=[number(x)/7 for x in a]
            elif command=='stereo_panning':shared['panning']=[number(x) for x in a]
            elif command=='octave':self.octave=number(a[0])
            elif command=='note_type':
                self.speed,self.volume,self.envelope=map(number,a)
                if self.channel==3:self.wave=abs(self.envelope)%16
            elif command=='drum_speed':self.speed=number(a[0])
            elif command=='duty_cycle':self.duty=number(a[0]);self.duty_pattern=None
            elif command=='duty_cycle_pattern':self.duty_pattern=list(map(number,a))
            elif command=='vibrato':self.vibrato={'delayFrames':number(a[0]),'depth':number(a[1]),'rate':number(a[2])}
            elif command=='toggle_perfect_pitch':self.perfect=not self.perfect
            elif command=='pitch_slide':self.slide={'frames':number(a[0]),'octave':number(a[1]),'pitch':a[2]}
            elif command=='execute_music':pass
            elif command=='sound_call':
                assert a[0] in labels,(path,line,a)
                self.stack.append(self.pc);self.pc=labels[a[0]]
            elif command=='sound_ret':
                if self.stack:self.pc=self.stack.pop()
                else:self.ended=True;self.loop_end=self.frame
            elif command=='sound_loop':
                n=number(a[0]);target=labels[a[1]]
                if n==0:
                    # Some unconditional jumps lead to a not-yet-visited body.
                    if target in self.visits:
                        self.loop_start=self.visits[target];self.loop_end=self.frame;self.ended=True
                        if self.loop_end<=self.loop_start:raise RuntimeError('Zero-length loop '+self.label)
                    else:self.pc=target
                else:
                    remaining=self.loops.get(pc,n)-1
                    if remaining>0:self.loops[pc]=remaining;self.pc=target
                    else:self.loops.pop(pc,None)
            elif command in ['note','rest','drum_note']:
                length=number(a[-1]);delay=self.fraction+length*self.speed*shared['tempo'];frames=(delay>>8)&255;self.fraction=delay&255
                if frames==0:frames=256  # 8-bit delay decrement underflows to 255.
                duration=sec(frames)
                if command!='rest':
                    event={'time':sec(self.frame),'duration':duration,'midi':None,'volume':round(self.volume/15,5),'duty':self.duty,'channel':self.channel,'envelope':self.envelope}
                    if self.duty_pattern:event['dutyPattern']=self.duty_pattern.copy()
                    if command=='drum_note':
                        ident=number(a[0]);inst=noise[str(bank)].get(str(ident),[])
                        event.update({'drum':ident,'volume':inst[0]['volume'] if inst else 0.5,'envelope':inst[0]['envelope'] if inst else 1,'noiseRegister':inst[0]['noiseRegister'] if inst else 0x33})
                    else:
                        register,hz,midi=frequency(a[0],self.octave,self.channel,self.perfect)
                        event.update({'midi':midi,'frequencyHz':hz,'frequencyRegister':register})
                        if self.channel==3:event.update({'volume':[0,1,0.5,0.25][self.volume&3],'wave':self.wave,'envelope':0})
                        if self.vibrato:event['vibrato']=self.vibrato.copy()
                        if self.slide:
                            _,target_hz,target_midi=frequency(self.slide['pitch'],self.slide['octave'],self.channel,self.perfect)
                            event['slide']={'duration':sec(self.slide['frames']),'frequencyHz':target_hz,'midi':target_midi};self.slide=None
                    self.notes.append(event)
                self.frame+=frames
                return
            else:raise ValueError(f'Unrecognized score command {command} in {path}:{line}')
    def export(self):
        return {'channel':self.channel,'kind':'pulse' if self.channel in [1,2] else 'wave' if self.channel==3 else 'noise','duration':sec(self.frame),'loopStart':sec(self.loop_start) if self.loop_start is not None else None,'loopEnd':sec(self.loop_end),'notes':self.notes}

tracks={}
for key,header in headers.items():
    chs=[Channel(ch,label) for ch,label in header['channels']]
    shared={'tempo':256,'master':[1,1],'panning':[15,15],'tempos':[]};q=[(0,ch.channel,i) for i,ch in enumerate(chs)];heapq.heapify(q)
    while q:
        _,_,i=heapq.heappop(q);ch=chs[i];ch.step(shared,chs,header['bank'])
        if not ch.ended:heapq.heappush(q,(ch.frame,ch.channel,i))
    exp=[ch.export() for ch in chs]
    tracks[key]={'name':re.sub(r'(?<=[a-z])(?=[A-Z])',' ',key[6:]),'bank':header['bank'],'tempo':shared['tempos'][0]['value'] if shared['tempos'] else 256,'tempoChanges':shared['tempos'],'duration':max(x['duration'] for x in exp),'channels':exp}
    assert any(x['notes'] for x in exp),key
    for ch in exp:
        assert 0<ch['duration']<600,(key,ch['duration'])
        assert ch['loopStart'] is None or 0<=ch['loopStart']<ch['loopEnd']<=ch['duration']
        assert all(n['duration']>0 and 0<=n['volume']<=1 and n['time']+n['duration']<=ch['duration']+1e-6 for n in ch['notes']),key
        assert all(a['time']<b['time'] for a,b in zip(ch['notes'],ch['notes'][1:])),key

map_music={m[3]:m[2] for m in re.finditer(r'db (MUSIC_\w+), BANK\((Music_\w+)\)\s*;\s*(\w+)',read('data/maps/songs.asm'))}
assert all(t in tracks for t in map_music.values())
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()
data={'tracks':tracks,'mapMusic':map_music,'waveSamples':wave_samples,'wave5ByBank':{str(i+1):w for i,w in enumerate(wave5)},'drumInstruments':noise,'source':{'url':'https://github.com/pret/pokered','commit':commit,'frameRate':FPS,'method':'Original ASM note score translation with call/loop expansion; no ROM/emulator.','trackCount':len(tracks),'mapCount':len(map_music),'notes':sum(len(c['notes']) for t in tracks.values() for c in t['channels']),'timing':'Integer frame delays + original 8-bit fractional accumulation. Channels loop independently.','limitations':['WebAudio timbre depends on the renderer; duty patterns, vibrato, envelopes and pitch slides are exported as metadata.','Loop phase is recorded once; repeated hardware-frame fractional carry may differ by a frame.','SFX and Pokémon cries are not included in this music score file.']}}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False))
print(json.dumps(data['source'],indent=2))
for key in ['Music_PalletTown','Music_Routes1','Music_Cities1','Music_Dungeon2','Music_GymLeaderBattle','Music_PkmnHealed']:
    t=tracks[key];print(key, t['duration'],[(c['channel'],len(c['notes']),c['loopStart'],c['loopEnd']) for c in t['channels']])
