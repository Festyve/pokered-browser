// Native JavaScript battle rules. No emulator, ROM, or CPU interpreter.
export const SPECIAL = new Set(['FIRE','WATER','GRASS','ELECTRIC','ICE','PSYCHIC_TYPE','DRAGON']);
export const pretty = s => String(s || '').replaceAll('_',' ');
export function rng(seed = 0x726564) {
  return {seed: seed >>> 0, next() {this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296;}, int(n) {return Math.floor(this.next()*n);}};
}
export function experience(level, growth='GROWTH_MEDIUM_FAST') {
  const n=level;
  if(growth.includes('MEDIUM_SLOW')) return Math.max(0,Math.floor(6*n*n*n/5-15*n*n+100*n-140));
  if(growth.includes('FAST')) return Math.floor(n*n*n*(growth.includes('MEDIUM')?1:0.8));
  if(growth.includes('SLOW')) return Math.floor(n*n*n*1.25);
  return n*n*n;
}
export function statsFor(base, level, dvs={}, evs={}) {
  return Object.fromEntries(Object.entries(base).map(([key,value])=>[key, Math.floor(((value+(dvs[key]??8))*2+Math.floor(Math.min(255,Math.ceil(Math.sqrt(evs[key]||0)))/4))*level/100)+(key==='hp'?level+10:5)]));
}
export function makeMon(db, species, level, random=rng()) {
  const s=db.species[species]; if(!s) throw new Error(`Unknown species ${species}`);
  const dvs={attack:random.int(16),defense:random.int(16),speed:random.int(16),special:random.int(16)};
  dvs.hp=((dvs.attack&1)<<3)|((dvs.defense&1)<<2)|((dvs.speed&1)<<1)|(dvs.special&1);
  const learned=[...(s.startingMoves||s.moves||[]),...(s.learnset||[]).filter(x=>x.level<=level).map(x=>x.move)].filter(x=>x!=='NO_MOVE'&&db.moves[x]);
  const moves=[...new Set(learned)].slice(-4).map(id=>({id,pp:db.moves[id].pp}));
  const stats=statsFor(s.stats,level,dvs);
  return {species,level,dvs,evs:{},stats,hp:stats.hp,moves,status:null,exp:experience(level,s.growth),stages:{},sleep:0};
}
export function typeEffect(db, type, targetTypes) {
  return [...new Set(targetTypes)].reduce((m,t)=>m*(db.typeChart.find(e=>e.attack===type&&e.defense===t)?.multiplier??1),1);
}
export function stageMultiplier(n=0) {return n>=0?(2+n)/2:2/(2-n);}
export function damage(db, attacker, defender, move, random=rng()) {
  if(!move.power) return {amount:0,effectiveness:1,critical:false};
  const baseSpeed=db.species[attacker.species].stats.speed;
  const highCrit=['KARATE_CHOP','RAZOR_LEAF','CRABHAMMER','SLASH'].includes(move.id);
  const critical=random.int(256)<Math.min(255,Math.floor(baseSpeed/2)*(highCrit?8:1)/(attacker.focusEnergy?4:1));
  const special=SPECIAL.has(move.type), a=special?'special':'attack', d=special?'special':'defense';
  let atk=attacker.stats[a],def=defender.stats[d];
  if(!critical) {atk=Math.max(1,Math.floor(atk*stageMultiplier(attacker.stages[a])));def=Math.max(1,Math.floor(def*stageMultiplier(defender.stages[d])));if(a==='attack'&&attacker.status==='BRN')atk=Math.max(1,Math.floor(atk/2));}
  if(!critical&&((special&&defender.lightScreen)||(!special&&defender.reflect)))def*=2;
  if(move.effect==='EXPLODE_EFFECT')def=Math.max(1,Math.floor(def/2));
  if(atk>255||def>255){atk=Math.max(1,Math.floor(atk/4));def=Math.max(1,Math.floor(def/4));}
  let value=Math.floor(Math.floor(Math.floor(2*attacker.level*(critical?2:1)/5+2)*move.power*atk/def)/50)+2;
  if(battleTypes(db,attacker).includes(move.type)) value=Math.floor(value*1.5);
  const effectiveness=typeEffect(db,move.type,battleTypes(db,defender));
  value=Math.floor(value*effectiveness);
  if(value>1)value=Math.floor(value*(217+random.int(39))/255);
  return {amount:effectiveness===0?0:Math.max(1,value),effectiveness,critical};
}
function stage(mon,key,n,log){mon.stages[key]=Math.max(-6,Math.min(6,(mon.stages[key]||0)+n));log.push(`${pretty(mon.species)}'s ${key.toUpperCase()} ${n>0?'rose':'fell'}!`);}
export function battleTypes(db,mon){return mon.transformedTypes||db.species[mon.species].types;}
function inflict(db,a,d,status,log,random){
  const types=battleTypes(db,d);
  if(d.status||d.substitute>0||(status==='PSN'&&types.includes('POISON'))||(status==='BRN'&&types.includes('FIRE'))||(status==='FRZ'&&types.includes('ICE'))){log.push('But it failed!');return;}
  d.status=status;d.sleep=status==='SLP'?1+random.int(7):0;log.push(`${pretty(d.species)}: ${status}!`);
}
export function clearVolatile(mon){
  if(mon.transformOriginal){Object.assign(mon,mon.transformOriginal);delete mon.transformOriginal;}
  for(const key of ['transformedTypes','confusion','disabled','recharge','charging','trapped','rampage','bide','substitute','reflect','lightScreen','mist','focusEnergy','rage','lastDamage','lastMove','escapeRequested','toxic','flinched'])delete mon[key];
  mon.stages={};mon.seeded=false;
}
export function useMove(db,a,d,index,random=rng(),depth=0){
  const log=[],name=pretty(a.species);
  if(a.flinched){a.flinched=false;return [`${name} flinched!`];}
  if(a.recharge){a.recharge=false;return [`${name} must recharge!`];}
  if(a.trapped>0){a.trapped--;return [`${name} can't move!`];}
  if(a.status==='SLP'){if(a.sleep-->0)return [`${name} is fast asleep!`];a.status=null;return [`${name} woke up!`];}
  if(a.status==='FRZ')return [`${name} is frozen solid!`];
  if(a.status==='PAR'&&random.int(4)===0)return [`${name} is fully paralyzed!`];
  if(a.confusion>0){a.confusion--;log.push(`${name} is confused!`);if(random.int(2)===0){const n=Math.max(1,Math.floor(((Math.floor(2*a.level/5)+2)*40*a.stats.attack/a.stats.defense)/50)+2);a.hp=Math.max(0,a.hp-n);return [...log,'It hurt itself in its confusion!'];}}
  if(a.disabled&&--a.disabled.turns<=0)delete a.disabled;
  if(a.bide){a.bide.turns--;if(a.bide.turns>0)return [`${name} is storing energy!`];const n=a.bide.damage*2;delete a.bide;d.hp=Math.max(0,d.hp-n);return [`${name} unleashed energy!`,...(n?[]:['But it failed!'])];}
  if(a.charging)index=a.charging.index;
  if(a.rampage)index=a.rampage.index;
  let slot=a.moves[index];if(a.disabled?.id===slot?.id)return [`${pretty(slot.id)} is disabled!`];
  if(!slot||slot.pp<=0){if(a.moves.some(m=>m.pp>0))return ['No PP left for this move!'];slot={id:'STRUGGLE',pp:1};}
  const m={...db.moves[slot.id],id:slot.id},ef=m.effect||'';
  if(!a.charging&&!a.rampage)slot.pp--;
  a.lastMove=m.id;log.push(`${name} used ${pretty(m.id)}!`);
  if(['CHARGE_EFFECT','FLY_EFFECT'].includes(ef)&&!a.charging){a.charging={index,id:m.id};return [...log,m.id==='DIG'?`${name} dug a hole!`:m.id==='FLY'?`${name} flew up high!`:`${name} is charging power!`];}
  delete a.charging;
  if(d.charging&&['DIG','FLY'].includes(d.charging.id)&&ef!=='SWIFT_EFFECT')return [...log,'But it missed!'];
  const accuracy=Math.min(255,Math.floor(m.accuracy*255/100*stageMultiplier((a.stages.accuracy||0)-(d.stages.evasion||0))));
  const always=['SWIFT_EFFECT','HAZE_EFFECT','TRANSFORM_EFFECT','LIGHT_SCREEN_EFFECT','REFLECT_EFFECT','MIST_EFFECT','FOCUS_ENERGY_EFFECT','SUBSTITUTE_EFFECT','BIDE_EFFECT','HEAL_EFFECT','METRONOME_EFFECT','MIRROR_MOVE_EFFECT','CONVERSION_EFFECT'].includes(ef);
  if(!always&&random.int(256)>=accuracy){if(ef==='JUMP_KICK_EFFECT')a.hp=Math.max(0,a.hp-1);return [...log,'But it missed!'];}
  if(ef==='DREAM_EATER_EFFECT'&&d.status!=='SLP')return [...log,'But it failed!'];
  if(ef==='METRONOME_EFFECT'||ef==='MIRROR_MOVE_EFFECT'){
    const pool=Object.keys(db.moves).filter(id=>!['METRONOME','MIRROR_MOVE','STRUGGLE'].includes(id));const id=ef==='METRONOME_EFFECT'?pool[random.int(pool.length)]:d.lastMove;
    if(!id||depth>2)return [...log,'But it failed!'];
    const old=a.moves;a.moves=[{id,pp:db.moves[id].pp}];const result=useMove(db,a,d,0,random,depth+1);a.moves=old;return [...log,...result];
  }
  if(ef==='OHKO_EFFECT'){
    if(a.stats.speed<d.stats.speed||typeEffect(db,m.type,battleTypes(db,d))===0)return [...log,'But it failed!'];
    d.hp=0;return [...log,'One-hit KO!'];
  }
  if(m.power){
    let result=damage(db,a,d,m,random);
    if(ef==='SPECIAL_DAMAGE_EFFECT')result.amount=['SEISMIC_TOSS','NIGHT_SHADE'].includes(m.id)?a.level:m.id==='DRAGON_RAGE'?40:m.id==='SONICBOOM'?20:m.id==='PSYWAVE'?1+random.int(Math.max(1,Math.floor(a.level*1.5)-1)):result.amount;
    if(ef==='SUPER_FANG_EFFECT')result.amount=Math.max(1,Math.floor(d.hp/2));
    if(m.id==='COUNTER'){result.amount=a.lastDamage&&['NORMAL','FIGHTING'].includes(a.lastDamage.type)?a.lastDamage.amount*2:0;if(!result.amount)log.push('But it failed!');}
    if(result.effectiveness===0)result.amount=0;
    const hits=['ATTACK_TWICE_EFFECT','TWINEEDLE_EFFECT'].includes(ef)?2:ef==='TWO_TO_FIVE_ATTACKS_EFFECT'?[2,2,2,3,3,3,4,5][random.int(8)]:1;
    const dealt=Math.min(d.hp,result.amount*hits),shield=d.substitute>0;
    if(shield){d.substitute=Math.max(0,d.substitute-result.amount*hits);log.push(d.substitute?'The SUBSTITUTE took damage!':'The SUBSTITUTE broke!');}
    else {d.hp=Math.max(0,d.hp-dealt);d.lastDamage={amount:dealt,type:m.type};if(d.bide)d.bide.damage+=dealt;if(d.rage&&dealt)stage(d,'attack',1,log);}
    if(result.critical)log.push('Critical hit!');
    if(result.effectiveness>1)log.push("It's super effective!");
    if(result.effectiveness>0&&result.effectiveness<1)log.push("It's not very effective...");
    if(result.effectiveness===0)log.push("It doesn't affect the foe!");
    if(hits>1)log.push(`Hit ${hits} times!`);
    if(ef==='DRAIN_HP_EFFECT'||ef==='DREAM_EATER_EFFECT'){a.hp=Math.min(a.stats.hp,a.hp+Math.max(1,Math.floor(dealt/2)));log.push('Health was absorbed!');}
    if(ef==='RECOIL_EFFECT'){a.hp=Math.max(0,a.hp-Math.max(1,Math.floor(dealt/4)));log.push('Hit with recoil!');}
    if(ef==='EXPLODE_EFFECT')a.hp=0;
    if(ef==='HYPER_BEAM_EFFECT'&&d.hp>0&&!shield)a.recharge=true;
    if(ef==='TRAPPING_EFFECT'&&dealt)d.trapped=1+random.int(4);
    if(ef==='RAGE_EFFECT')a.rage=true;
    if(ef==='THRASH_PETAL_DANCE_EFFECT'){a.rampage??={index,turns:2+random.int(2)};if(--a.rampage.turns<=0){delete a.rampage;a.confusion=2+random.int(4);}}
    if(ef==='PAY_DAY_EFFECT')a.payDay=(a.payDay||0)+a.level*2;
    if(d.hp>0&&!shield&&result.effectiveness>0){
      if(m.type==='FIRE'&&d.status==='FRZ'){d.status=null;log.push('The ice melted!');}
      const chance=ef.endsWith('2')?30:10;
      if(ef.includes('SIDE')&&random.int(100)<chance){
        if(ef.startsWith('FLINCH'))d.flinched=true;
        if(ef.startsWith('CONFUSION')){d.confusion=2+random.int(4);log.push('The foe became confused!');}
        const stat=ef.match(/^(ATTACK|DEFENSE|SPEED|SPECIAL)_DOWN_SIDE/);if(stat&&!d.mist)stage(d,stat[1].toLowerCase(),-1,log);
        for(const [word,status]of [['POISON','PSN'],['BURN','BRN'],['PARALYZE','PAR'],['FREEZE','FRZ']])if(ef.startsWith(word)&&!d.status)inflict(db,a,d,status,log,random);
      }
      if(ef==='TWINEEDLE_EFFECT'&&random.int(100)<20&&!d.status)inflict(db,a,d,'PSN',log,random);
    }
  }else{
    const match=ef.match(/^(ATTACK|DEFENSE|SPEED|SPECIAL|ACCURACY|EVASION)_(UP|DOWN)([12])/);
    if(match){const up=match[2]==='UP';if(!up&&(d.mist||d.substitute>0))log.push('But it failed!');else stage(up?a:d,match[1].toLowerCase(),(up?1:-1)*Number(match[3]),log);}
    else if(ef==='HEAL_EFFECT'){if(a.hp===a.stats.hp)log.push('But it failed!');else {a.hp=Math.min(a.stats.hp,a.hp+Math.floor(a.stats.hp/2));if(m.id==='REST'){a.hp=a.stats.hp;a.status='SLP';a.sleep=2;}log.push('HP was restored!');}}
    else if(ef==='LEECH_SEED_EFFECT'){if(battleTypes(db,d).includes('GRASS')||d.substitute)log.push('But it failed!');else {d.seeded=true;log.push('The foe was seeded!');}}
    else if(['SLEEP_EFFECT','POISON_EFFECT','PARALYZE_EFFECT'].includes(ef)){if(m.id==='THUNDER_WAVE'&&battleTypes(db,d).includes('GROUND'))log.push("It doesn't affect the foe!");else {inflict(db,a,d,ef==='SLEEP_EFFECT'?'SLP':ef==='POISON_EFFECT'?'PSN':'PAR',log,random);if(m.id==='TOXIC'&&d.status==='PSN')d.toxic=1;}}
    else if(ef==='CONFUSION_EFFECT'){if(d.confusion||d.substitute)log.push('But it failed!');else {d.confusion=2+random.int(4);log.push('The foe became confused!');}}
    else if(ef==='DISABLE_EFFECT'){const choices=d.moves.filter(slot=>slot.pp>0);if(!choices.length||d.disabled)log.push('But it failed!');else{const slot=choices[random.int(choices.length)];d.disabled={id:slot.id,turns:1+random.int(8)};log.push(`${pretty(slot.id)} was disabled!`);}}
    else if(['REFLECT_EFFECT','LIGHT_SCREEN_EFFECT','MIST_EFFECT','FOCUS_ENERGY_EFFECT'].includes(ef)){a[{REFLECT_EFFECT:'reflect',LIGHT_SCREEN_EFFECT:'lightScreen',MIST_EFFECT:'mist',FOCUS_ENERGY_EFFECT:'focusEnergy'}[ef]]=true;log.push(`${name} gained protection!`);}
    else if(ef==='HAZE_EFFECT'){a.stages={};d.stages={};for(const mon of [a,d]){mon.status=null;mon.seeded=false;mon.confusion=0;mon.reflect=false;mon.lightScreen=false;mon.mist=false;mon.toxic=0;}log.push('All status changes were eliminated!');}
    else if(ef==='BIDE_EFFECT'){a.bide={turns:2+random.int(2),damage:0};log.push(`${name} is storing energy!`);}
    else if(ef==='SUBSTITUTE_EFFECT'){const cost=Math.floor(a.stats.hp/4);if(a.substitute||a.hp<=cost)log.push('But it failed!');else {a.hp-=cost;a.substitute=cost+1;log.push(`${name} made a SUBSTITUTE!`);}}
    else if(ef==='SWITCH_AND_TELEPORT_EFFECT'){a.escapeRequested=true;log.push(`${name} tried to end the battle!`);}
    else if(ef==='MIMIC_EFFECT'){const id=d.moves[random.int(d.moves.length)].id;slot.id=id;slot.pp=5;log.push(`${name} learned ${pretty(id)}!`);}
    else if(ef==='TRANSFORM_EFFECT'){a.transformOriginal??={stats:{...a.stats},moves:structuredClone(a.moves),species:a.species};a.transformedTypes=[...battleTypes(db,d)];a.stats={...d.stats,hp:a.stats.hp};a.stages={...d.stages};a.moves=d.moves.map(slot=>({id:slot.id,pp:5}));a.species=d.species;log.push(`${name} transformed into ${pretty(d.species)}!`);}
    else if(ef==='CONVERSION_EFFECT'){a.transformedTypes=[...battleTypes(db,d)];log.push(`${name} changed its type!`);}
    else if(ef==='SPLASH_EFFECT')log.push('No effect!');
    else log.push('But it failed!');
  }
  return log;
}

export function endTurn(mon, opponent) {
  const log=[];
  if(mon.hp>0&&['PSN','BRN'].includes(mon.status)){mon.hp=Math.max(0,mon.hp-Math.max(1,Math.floor(mon.stats.hp/16))*(mon.toxic?mon.toxic++:1));log.push(`${pretty(mon.species)} is hurt by ${mon.status==='PSN'?'poison':'its burn'}!`);}
  if(mon.hp>0&&mon.seeded){const n=Math.min(mon.hp,Math.max(1,Math.floor(mon.stats.hp/16)));mon.hp-=n;opponent.hp=Math.min(opponent.stats.hp,opponent.hp+n);log.push('LEECH SEED saps health!');}
  return log;
}
export function addExperience(db, mon, enemy, trainer=false, deferLearning=false) {
  const reward=Math.floor(db.species[enemy.species].baseExp*enemy.level*(trainer?1.5:1)/7),log=[`${pretty(mon.species)} gained ${reward} EXP. points!`];
  mon.exp+=reward;
  for(const [key,v] of Object.entries(db.species[enemy.species].stats))mon.evs[key]=Math.min(65535,(mon.evs[key]||0)+v);
  while(mon.level<100&&mon.exp>=experience(mon.level+1,db.species[mon.species].growth)){
    const old=mon.stats.hp;mon.level++;mon.stats=statsFor(db.species[mon.species].stats,mon.level,mon.dvs,mon.evs);mon.hp+=mon.stats.hp-old;
    log.push(`${pretty(mon.species)} grew to level ${mon.level}!`);
    for(const learned of db.species[mon.species].learnset||[])if(learned.level===mon.level&&db.moves[learned.move]&&!mon.moves.some(m=>m.id===learned.move)){
      if(deferLearning){(mon.pendingMoves??=[]).push(learned.move);continue;}
      if(mon.moves.length===4){const forgotten=mon.moves.shift();log.push(`Forgot ${pretty(forgotten.id)}.`);}
      mon.moves.push({id:learned.move,pp:db.moves[learned.move].pp});log.push(`Learned ${pretty(learned.move)}!`);
    }
  }
  return log;
}
export function heal(db, party){for(const m of party){m.hp=m.stats.hp;m.status=null;clearVolatile(m);for(const move of m.moves)move.pp=db.moves[move.id]?.pp||0;}}
