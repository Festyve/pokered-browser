#!/usr/bin/env python3
"""Import declarative Pokémon Red data and original PNG assets from pret/pokered.
No ROM or emulator is used. Requires Pillow. Source path is explicit to keep the
upstream checkout separate from the browser rewrite. See data/provenance.json.
"""
import argparse, json, re, subprocess
from pathlib import Path
from PIL import Image

ap=argparse.ArgumentParser()
ap.add_argument('source', type=Path)
ap.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist')
args=ap.parse_args(); src=args.source.resolve(); out=args.output.resolve()
for part in ['data','assets/maps','assets/sprites','assets/pokemon/front','assets/pokemon/back','assets/trainers','assets/font','assets/tilesets']:
    (out/part).mkdir(parents=True,exist_ok=True)

def read(path): return (src/path).read_text()
def clean(s): return s.split(';')[0].strip()
def num(s): return int(s.replace('$','0x').replace('%','0b'),0) if not re.fullmatch(r'-?\d+',s) else int(s)
def fields(s): return [x.strip() for x in s.split(',')]
def constants(path, prefix='const'):
    result={}; i=0
    for raw in read(path).splitlines():
        line=clean(raw)
        m=re.match(r'const_def(?:\s+(\d+))?$',line)
        if m:i=int(m[1] or 0)
        elif line.startswith('const_skip'):i+=int(line.split()[1]) if len(line.split())>1 else 1
        else:
            m=re.match(prefix+r'\s+(\w+)$',line)
            if m:result[m[1]]=i;i+=1
    return result

def red_only(s):
    active=[True]; result=[]
    for line in s.splitlines():
        t=clean(line)
        if t.startswith('IF '):
            cond=('_RED' in t and '!DEF(_RED)' not in t) or ('!DEF(_BLUE)' in t)
            if '_BLUE' not in t and '_RED' not in t:cond=True
            active.append(active[-1] and cond)
        elif t=='ELSE': active[-1]=active[-2] and not active[-1]
        elif t=='ENDC':
            if len(active)>1:active.pop()
        elif active[-1]:result.append(line)
    return '\n'.join(result)

def labels(s):
    found=list(re.finditer(r'^([A-Za-z_][\w]*):{1,2}',s,re.M))
    return {m[1]:s[m.end():found[i+1].start() if i+1<len(found) else len(s)] for i,m in enumerate(found)}

def image_copy(path,target,transparent=True):
    im=Image.open(src/path).convert('RGBA')
    if transparent:
        im.putdata([(r,g,b,0 if r>240 and g>240 and b>240 else a) for r,g,b,a in im.getdata()])
    im.save(out/target,optimize=True)
    return im.size

def pretty(s):return s.replace('_',' ').title().replace('Ss Anne','S.S. Anne')

# Original dialogue is preserved as text. Runtime event logic is deliberately separate.
textblocks={}
for p in (src/'text').glob('*.asm'):textblocks.update(labels(p.read_text()))
for p in (src/'scripts').glob('*.asm'):textblocks.update(labels(p.read_text()))

def decode_text(s):
    s=s.replace('#','POKé').replace('<PLAYER>','RED').replace('<RIVAL>','BLUE').replace('<POKE>','POKé').replace('<MON>','MON').replace('<PKMN>','POKéMON').replace('<DEXEND>','').replace('@','').replace('<LINE>','\n')
    return re.sub(r'<[^>]+>','…',s)
def resolve_text(label,visited=None):
    visited=set() if visited is None else visited
    if label in visited:return ''
    visited.add(label); body=textblocks.get(label,''); chunks=[]
    for command,value in re.findall(r'\b(text|line|cont|para|next)\s+"([^"\n]*)"',body):
        chunks.append(('\n\n' if command=='para' else '\n' if chunks else '')+decode_text(value))
    if chunks:return ''.join(chunks).strip()
    refs=re.findall(r'(?:text_far|text_jump|text_near)\s+(\w+)',body)
    if not refs:refs=re.findall(r'\b(_\w+Text\w*)\b',body)
    if not refs:refs=re.findall(r'(?:ld hl,|ld de,)\s*(\w+(?:Text|Header\d+))',body)
    if not refs:
        trainer=re.search(r'\btrainer [^,]+,\s*[^,]+,\s*(\w+)',body)
        if trainer:refs=[trainer[1]]
    for ref in refs:
        t=resolve_text(ref,visited)
        if t:return t
    if not label.startswith('_') and '_'+label in textblocks:return resolve_text('_'+label,visited)
    return ''
alltexts={k:resolve_text(k) for k in textblocks if k.startswith('_')}
alltexts={k:v for k,v in alltexts.items() if v}

# Resolve aliases in graphics include declarations.
def includes(path):
    result={}; pending=[]
    for line in read(path).splitlines():
        m=re.match(r'^(\w+)::?',line)
        if m:pending.append(m[1])
        inc=re.search(r'INCBIN "([^"]+)"',line)
        if inc:
            for label in pending:result[label]=inc[1]
            pending=[]
    return result
inc=includes('gfx/tilesets.asm')
coll={}; pending=[]
for raw in read('data/tilesets/collision_tile_ids.asm').splitlines():
    m=re.match(r'(\w+)_Coll::',raw)
    if m:pending.append(m[1])
    m=re.match(r'\s*coll_tiles\s+(.+)',raw)
    if m:
        vals=[num(x) for x in fields(clean(m[1])) if x]
        for name in pending:coll[name]=set(vals)
        pending=[]
tileconst=list(constants('constants/tileset_constants.asm'))
tilesets={}
for i,m in enumerate(re.finditer(r'^\s*tileset (\w+),\s*([^\n]+)',read('data/tilesets/tileset_headers.asm'),re.M)):
    name=m[1]; args2=fields(clean(m[2])); path=inc[name+'_GFX'].replace('.2bpp','.png')
    im=Image.open(src/path).convert('RGB'); tiles=[]
    for y in range(0,im.height,8):
        for x in range(0,im.width,8):tiles.append(im.crop((x,y,x+8,y+8)))
    tilesets[tileconst[i]]={'name':name,'tiles':tiles,'blocks':(src/inc[name+'_Block']).read_bytes(),'coll':coll[name],'grass':num(args2[3])}

mapconst={m[1]:(int(m[2]),int(m[3])) for m in re.finditer(r'^\s*map_const (\w+),\s*(\d+),\s*(\d+)',read('constants/map_constants.asm'),re.M)}
maporder=list(mapconst)
mapblocks=includes('maps.asm')
world={'maps':{},'sprites':{},'texts':alltexts,'tilesets':{}}
for ident,tileset in tilesets.items():
    assert len(tileset['blocks'])%16==0,(ident,len(tileset['blocks']))
    count=len(tileset['blocks'])//16
    atlas=Image.new('RGB',(16*32,((count+15)//16)*32),(255,255,255)); descriptors=[]
    for block_id in range(count):
        block=tileset['blocks'][block_id*16:block_id*16+16]
        for iy in range(4):
            for ix in range(4):
                tile_id=block[iy*4+ix]
                if tile_id<len(tileset['tiles']):atlas.paste(tileset['tiles'][tile_id],((block_id%16)*32+ix*8,(block_id//16)*32+iy*8))
        ids=[[block[(iy*2+1)*4+ix*2] for ix in range(2)] for iy in range(2)]
        collisions=[[2 if t==tileset['grass'] and t>=0 else 1 if t in tileset['coll'] else 3 if t==0x14 else 0 for t in row] for row in ids]
        descriptors.append({'collision':collisions,'tileIds':ids})
    atlas_path='assets/tilesets/'+ident+'.png';atlas.save(out/atlas_path,optimize=True)
    world['tilesets'][ident]={'blockAtlas':atlas_path,'columns':16,'blocks':descriptors}

toggles={name: state=='OFF' for name,state in re.findall(r'toggle_object_state (\w+),\s*(ON|OFF)',read('data/maps/toggleable_objects.asm'))}
for p in sorted((src/'data/maps/headers').glob('*.asm')):
    header=p.read_text(); m=re.search(r'map_header (\w+),\s*(\w+),\s*(\w+)',header)
    if not m:continue
    name,ident,ts=m.groups()
    # One unused copied map shares the header dimension symbol, but has its own ID.
    object_source=(src/'data/maps/objects'/p.name).read_text()
    true_id=re.search(r'def_warps_to (\w+)',object_source)
    if true_id and true_id[1] in mapconst:ident=true_id[1]
    bw,bh=mapconst[ident]; w,h=bw*2,bh*2; tileset=tilesets[ts]
    blockpath=mapblocks.get(name+'_Blocks','maps/'+name+'.blk'); blockdata=(src/blockpath).read_bytes()
    # A few original map tables deliberately read into the following INCBIN.
    if len(blockdata)<bw*bh:
        assembly=read('maps.asm'); start=assembly.index('INCBIN \"'+blockpath+'\"')
        following=re.findall(r'INCBIN \"([^\"]+)\"',assembly[start:])[1:]
        for extra in following:
            if extra.endswith('.blk'):
                blockdata+=(src/extra).read_bytes()
                if len(blockdata)>=bw*bh:break
    assert len(blockdata)>=bw*bh,(name,len(blockdata),bw*bh)
    pic=Image.new('RGB',(bw*32,bh*32),(255,255,255)); ids=[[0]*w for _ in range(h)]
    for by in range(bh):
        for bx in range(bw):
            bi=blockdata[by*bw+bx]; block=tileset['blocks'][bi*16:bi*16+16]
            for iy in range(4):
                for ix in range(4):
                    ti=block[iy*4+ix]
                    if ti<len(tileset['tiles']):pic.paste(tileset['tiles'][ti],(bx*32+ix*8,by*32+iy*8))
            for iy in range(2):
                for ix in range(2):ids[by*2+iy][bx*2+ix]=block[(iy*2+1)*4+ix*2]
    imgpath='assets/maps/'+name+'.png';pic.save(out/imgpath,optimize=True)
    border_match=re.search(r'^\s*db\s+(\$[0-9A-Fa-f]+|\d+)\s*;\s*border block',object_source,re.M)
    if not border_match:raise ValueError('Missing border block for '+name)
    border_index=num(border_match[1]); border_block=tileset['blocks'][border_index*16:border_index*16+16]
    border_pic=Image.new('RGB',(32,32),(255,255,255))
    for iy in range(4):
        for ix in range(4):
            ti=border_block[iy*4+ix]
            if ti<len(tileset['tiles']):border_pic.paste(tileset['tiles'][ti],(ix*8,iy*8))
    borderpath='assets/maps/'+name+'-border.png';border_pic.save(out/borderpath,optimize=True)
    collisions=[[2 if t==tileset['grass'] and t>=0 else 1 if t in tileset['coll'] else 3 if t==0x14 else 0 for t in row] for row in ids]
    script=(src/'scripts'/p.name).read_text() if (src/'scripts'/p.name).exists() else ''
    pointers={b:a for a,b in re.findall(r'dw_const\s+(\w+),\s*(TEXT_\w+)',script)}
    def event_text(t):return resolve_text(pointers.get(t,''))
    obj=(src/'data/maps/objects'/p.name).read_text()
    warps=[];objects=[];signs=[]
    for raw in obj.splitlines():
        line=clean(raw)
        if line.startswith('warp_event '):
            a=fields(line[11:]);warps.append({'x':num(a[0]),'y':num(a[1]),'target':a[2],'targetWarp':num(a[3])})
        elif line.startswith('bg_event '):
            a=fields(line[9:]);signs.append({'x':num(a[0]),'y':num(a[1]),'textId':a[2],'text':event_text(a[2])})
        elif line.startswith('object_event '):
            a=fields(line[13:]);o={'x':num(a[0]),'y':num(a[1]),'sprite':a[2],'movement':a[3],'direction':a[4],'textId':a[5],'text':event_text(a[5])}
            if len(a)>7 and a[6].startswith('OPP_'):o['trainer']={'class':a[6][4:],'party':num(a[7])}
            elif len(a)>6:
                if a[2]=='SPRITE_POKE_BALL':o['item']=a[6]
                else:o['encounter']={'species':a[6],'level':num(a[7]) if len(a)>7 else 5}
            objkeys=re.findall(r'const_export (\w+)',obj)
            if len(objects)<len(objkeys):
                o['objectId']=objkeys[len(objects)]
                o['defaultHidden']=toggles.get(o['objectId'],False)
            pointer=pointers.get(a[5],''); body=textblocks.get(pointer,'')
            trainer_ref=re.search(r'ld hl, (\w+TrainerHeader\d+)',body)
            if trainer_ref:
                tm=re.search(r'\btrainer ([^\n]+)',textblocks.get(trainer_ref[1],''))
                if tm:
                    ta=fields(clean(tm[1]));o['sightRange']=num(ta[1]);o['text']=resolve_text(ta[2]);o['defeatText']=resolve_text(ta[3]);o['afterText']=resolve_text(ta[4])
            objects.append(o)
    for warp in warps:
        # Warps take precedence over static collision, including gate top doors.
        if 0 <= warp['y'] < h and 0 <= warp['x'] < w:collisions[warp['y']][warp['x']]=1
    connections=[{'direction':a,'target':b,'offset':int(c)} for a,b,c in re.findall(r'connection (\w+),\s*\w+,\s*(\w+),\s*(-?\d+)',header)]
    world['maps'][ident]={'id':ident,'name':name,'outdoor':maporder.index(ident)<37,'displayName':re.sub(r'(?<=[a-z])(?=[A-Z0-9])',' ',name),'width':w,'height':h,'image':imgpath,'borderImage':borderpath,'borderBlock':border_index,'tileset':ts,'blocks':[list(blockdata[y*bw:(y+1)*bw]) for y in range(bh)],'collision':collisions,'tileIds':ids,'warps':warps,'objects':objects,'signs':signs,'connections':connections}

spritesinc=includes('gfx/sprites.asm')
for m in re.finditer(r'overworld_sprite (\w+),[^\n;]+;\s*(SPRITE_\w+)',read('data/sprites/sprites.asm')):
    label,key=m.groups(); path=spritesinc[label].replace('.2bpp','.png');target='assets/sprites/'+Path(path).name
    w,h=image_copy(path,target)
    world['sprites'][key]={'image':target,'width':w,'height':h,'frames':h//16}

speciesids=constants('constants/pokemon_constants.asm'); dexids=constants('constants/pokedex_constants.asm')
evos=labels(read('data/pokemon/evos_moves.asm'))
evosnorm={k.replace('EvosMoves','').lower():v for k,v in evos.items()}
pokemon={'species':{},'moves':{},'wild':{},'trainers':{},'trainerMetadata':{},'typeChart':[], 'encounterWeights':[int(x) for x in re.findall(r'^\s*wild_chance\s+(\d+)',read('data/wild/probabilities.asm'),re.M)]}
for p in sorted((src/'data/pokemon/base_stats').glob('*.asm')):
    s=p.read_text(); rows=[fields(clean(m[1])) for m in re.finditer(r'^\s*db\s+([^\n]+)',s,re.M)]
    if not rows or not rows[0][0].startswith('DEX_'):continue
    ident=rows[0][0][4:]; stats=dict(zip(['hp','attack','defense','speed','special'],map(num,rows[1])))
    movs=[x for x in rows[5] if x!='NO_MOVE'];base=re.search(r'gfx/pokemon/front/([^\"]+)\.pic',s)[1]
    front='assets/pokemon/front/'+base+'.png'; back='assets/pokemon/back/'+base+'b.png'
    image_copy('gfx/pokemon/front/'+base+'.png',front)
    image_copy('gfx/pokemon/back/'+base+'b.png',back)
    body=evosnorm.get(ident.replace('_','').lower(),'');learnset=[];evolutions=[]
    for m in re.finditer(r'^\s*db\s+([^\n]+)',body,re.M):
        a=fields(clean(m[1]))
        if a[0].startswith('EVOLVE_'):
            e={'method':a[0][7:].lower(),'species':a[-1]}
            if e['method']=='level':e['level']=num(a[1])
            elif e['method']=='item':e['item']=a[1]
            evolutions.append(e)
        elif len(a)==2:learnset.append({'level':num(a[0]),'move':a[1]})
    pokemon['species'][ident]={'id':ident,'dex':dexids['DEX_'+ident],'name':pretty(ident),'internalId':speciesids[ident],'stats':stats,'types':rows[2],'catchRate':num(rows[3][0]),'baseExp':num(rows[4][0]),'startingMoves':movs,'moves':movs,'growth':rows[6][0].replace('GROWTH_',''),'learnset':learnset,'evolutions':evolutions,'front':front,'back':back}
for i,m in enumerate(re.finditer(r'^\s*move\s+([^\n]+)',read('data/moves/moves.asm'),re.M),1):
    a=fields(clean(m[1]));pokemon['moves'][a[0]]={'id':i,'name':pretty(a[0]),'effect':a[1],'power':num(a[2]),'type':a[3],'accuracy':num(a[4]),'pp':num(a[5])}
for m in re.finditer(r'^\s*db\s+(\w+),\s*(\w+),\s*(\w+)',read('data/types/type_matchups.asm'),re.M):
    a,b,c=m.groups();pokemon['typeChart'].append({'attack':a,'defense':b,'multiplier':{'SUPER_EFFECTIVE':2,'NOT_VERY_EFFECTIVE':0.5,'NO_EFFECT':0}[c]})
wildblocks={}
for p in (src/'data/wild/maps').glob('*.asm'):
    s=red_only(p.read_text()); lab=re.search(r'^(\w+):',s,re.M)
    if not lab:continue
    info={'grassRate':0,'grass':[],'waterRate':0,'water':[]};kind=None
    for raw in s.splitlines():
        line=clean(raw);m=re.match(r'def_(grass|water)_wildmons\s+(\d+)',line)
        if m:kind=m[1];info[kind+'Rate']=int(m[2])
        elif line.startswith('end_'):kind=None
        elif kind and line.startswith('db '):
            a=fields(line[3:]);info[kind].append({'level':num(a[0]),'species':a[1]})
    wildblocks[lab[1]]=info
wildpointers=re.findall(r'^\s*dw (\w+)',read('data/wild/grass_water.asm'),re.M)
for ident,label in zip(maporder,wildpointers):
    if ident in world['maps']:pokemon['wild'][ident]=wildblocks.get(label,{'grassRate':0,'grass':[],'waterRate':0,'water':[]})
trainerclasses=list(constants('constants/trainer_constants.asm','trainer_const'))[1:]
trainertext=red_only(read('data/trainers/parties.asm'));trainerlabels=labels(trainertext)
trainerptrs=re.findall(r'^\s*dw (\w+Data)',trainertext,re.M)
for cls,label in zip(trainerclasses,trainerptrs):
    parties=[]
    for m in re.finditer(r'^\s*db\s+([^\n]+)',trainerlabels.get(label,''),re.M):
        a=fields(clean(m[1])); party=[]
        if a[0]=='$FF':
            for i in range(1,len(a)-1,2):party.append({'level':num(a[i]),'species':a[i+1]})
        else:
            for mon in a[1:]:
                if mon!='0':party.append({'level':num(a[0]),'species':mon})
        parties.append(party)
    pokemon['trainers'][cls]=parties
pics=includes('gfx/pics.asm')
for cls,m in zip(trainerclasses,re.finditer(r'^\s*pic_money (\w+),\s*(\d+)',read('data/trainers/pic_pointers_money.asm'),re.M)):
    path=pics.get(m[1])
    pokemon['trainerMetadata'][cls]={'name':pretty(cls),'rewardPerLevel':int(m[2])//100,'image':'assets/trainers/'+Path(path).stem+'.png' if path else None}
# Retain original trainer art for use by editable battle presentation.
for p in (src/'gfx/trainers').glob('*.png'):image_copy(p.relative_to(src),'assets/trainers/'+p.name)
for p in (src/'gfx/font').glob('*.png'):image_copy(p.relative_to(src),'assets/font/'+p.name,False)
image_copy('gfx/font/font.png','assets/font.png',False)
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()
provenance={'url':'https://github.com/pret/pokered','commit':commit,'version':'Red English','method':'Declarative ASM table parsing and PNG/blockset composition; no ROM execution.','coverage':{'maps':len(world['maps']),'species':len(pokemon['species']),'moves':len(pokemon['moves']),'spriteSheets':len(world['sprites']),'trainerClasses':len(pokemon['trainers']),'trainerParties':sum(map(len,pokemon['trainers'].values())),'textEntries':len(alltexts)},'limitations':['Text resolution selects one static branch; event-dependent dialogue is implemented by the JavaScript runtime.','Original assembly event scripts and move effects are not automatically translated.','Collision grid uses bottom-left metatile collision IDs; ledges and tile-pair restrictions require runtime handling.']}
world['source']=provenance
world['ledges']=[{'direction':d.lower(),'fromTile':num(a),'toTile':num(b)} for d,a,b in re.findall(r'db SPRITE_FACING_(\w+),\s*(\$[0-9A-Fa-f]+),\s*(\$[0-9A-Fa-f]+)',read('data/tilesets/ledge_tiles.asm'))]
world['tilePairCollisions']=[{'tileset':ts,'a':num(a),'b':num(b)} for ts,a,b in re.findall(r'db (\w+),\s*(\$[0-9A-Fa-f]+),\s*(\$[0-9A-Fa-f]+)',read('data/tilesets/pair_collision_tile_ids.asm').split('TilePairCollisionsWater')[0])]
world['font']={'image':'assets/font/font.png','width':128,'height':64,'start':128,'glyphs':{char:int(code,16)-128 for char,code in re.findall(r'charmap \"([^\"]+)\",\s*\$([0-9a-f]+)',read('constants/charmap.asm')) if len(char)==1 and int(code,16)>=128}}
for filename,data in [('world',world),('pokemon',pokemon),('provenance',provenance)]:
    (out/'data'/f'{filename}.json').write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False))
assert len(pokemon['species'])==151
assert len(pokemon['moves'])==165
assert len(world['maps'])==223
for ident,m in world['maps'].items():
    assert len(m['blocks'])==m['height']//2
    assert all(len(row)==m['width']//2 for row in m['blocks'])
    assert all(0<=block<len(world['tilesets'][m['tileset']]['blocks']) for row in m['blocks'] for block in row)
    assert len(m['collision'])==m['height']
    assert all(len(r)==m['width'] for r in m['collision'])
    for obj in m['objects']:assert obj['sprite'] in world['sprites'],obj
    for warp in m['warps']:assert warp['target'] in world['maps'] or warp['target']=='LAST_MAP' or warp['target'].startswith('UNUSED_MAP_'),(ident,warp)
print(json.dumps(provenance,indent=2))
