import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {rng,makeMon,statsFor,experience,typeEffect,damage,useMove,addExperience,heal} from '../dist/js/mechanics.js';
import {connectionDestination,warpDestination} from '../dist/js/navigation.js';
const db=JSON.parse(readFileSync(new URL('../dist/data/pokemon.json',import.meta.url)));
const world=JSON.parse(readFileSync(new URL('../dist/data/world.json',import.meta.url)));

test('complete imported data cardinalities and move references',()=>{
  assert.equal(Object.keys(world.maps).length,223);assert.equal(Object.keys(db.species).length,151);assert.equal(Object.keys(db.moves).length,165);
  const dex=new Set();for(const p of Object.values(db.species)){dex.add(p.dex);for(const id of [...p.startingMoves,...p.learnset.map(l=>l.move)])assert.ok(db.moves[id],`${p.id}: ${id}`);assert.ok(existsSync(new URL('../dist/'+p.front,import.meta.url)));assert.ok(existsSync(new URL('../dist/'+p.back,import.meta.url)));}assert.equal(dex.size,151);
});
test('map images, geometry dimensions and static exits are valid',()=>{
  for(const m of Object.values(world.maps)){assert.equal(m.collision.length,m.height);assert.ok(m.collision.every(r=>r.length===m.width));assert.ok(existsSync(new URL('../dist/'+m.image,import.meta.url)));for(const c of m.connections)assert.ok(world.maps[c.target]);for(const w of m.warps){assert.equal(m.collision[w.y][w.x],1);if(!['LAST_MAP','UNUSED_MAP_ED'].includes(w.target))assert.ok(world.maps[w.target],w.target);}}
});
test('route connections respect original block offsets in both directions',()=>{
  assert.deepEqual(connectionDestination(world,'ROUTE_1',8,-1),{map:'VIRIDIAN_CITY',x:18,y:35});
  assert.deepEqual(connectionDestination(world,'VIRIDIAN_CITY',18,36),{map:'ROUTE_1',x:8,y:0});
  assert.deepEqual(connectionDestination(world,'VIRIDIAN_CITY',18,-1),{map:'ROUTE_2',x:8,y:71});
  assert.equal(connectionDestination(world,'REDS_HOUSE_2F',0,-1),null);
});
test('interior chains retain the last outdoor map across Viridian Forest',()=>{
  const route=world.maps.ROUTE_2;
  const a=warpDestination(world,'ROUTE_2',route.warps[5],'PALLET_TOWN');assert.equal(a.map,'VIRIDIAN_FOREST_SOUTH_GATE');assert.equal(a.lastOutdoor,'ROUTE_2');
  const b=warpDestination(world,a.map,world.maps[a.map].warps[0],a.lastOutdoor);assert.equal(b.map,'VIRIDIAN_FOREST');assert.equal(b.lastOutdoor,'ROUTE_2');
  const c=warpDestination(world,b.map,world.maps[b.map].warps[0],b.lastOutdoor);assert.equal(c.map,'VIRIDIAN_FOREST_NORTH_GATE');
  const d=warpDestination(world,c.map,world.maps[c.map].warps.find(w=>w.target==='LAST_MAP'),c.lastOutdoor);assert.equal(d.map,'ROUTE_2');assert.equal(d.y,12);
});
test('original Gen I base stats and individual values produce expected level-5 stats',()=>{
  assert.deepEqual(statsFor(db.species.BULBASAUR.stats,5,{hp:15,attack:15,defense:15,speed:15,special:15}),{hp:21,attack:11,defense:11,speed:11,special:13});
  const mon=makeMon(db,'BULBASAUR',5,rng(42));assert.deepEqual(mon.moves.map(m=>m.id),['TACKLE','GROWL']);assert.equal(mon.hp,mon.stats.hp);assert.equal(mon.exp,135);
});
test('experience growth boundaries and deterministic random state',()=>{
  assert.equal(experience(100,'MEDIUM_SLOW'),1059860);assert.equal(experience(100,'FAST'),800000);assert.equal(experience(100,'SLOW'),1250000);assert.equal(experience(100,'MEDIUM_FAST'),1000000);
  const a=rng(1234),b=rng(1234);for(let i=0;i<100;i++)assert.equal(a.int(256),b.int(256));const restored=rng(a.seed);assert.equal(a.next(),restored.next());
});
test('Gen I type chart preserves immunities and deduplicates single types',()=>{
  assert.equal(typeEffect(db,'ELECTRIC',['GROUND','GROUND']),0);assert.equal(typeEffect(db,'NORMAL',['GHOST','POISON']),0);assert.equal(typeEffect(db,'WATER',['ROCK','GROUND']),4);assert.equal(typeEffect(db,'FIRE',['GRASS','GRASS']),2);assert.equal(typeEffect(db,'GHOST',['PSYCHIC_TYPE','PSYCHIC_TYPE']),0);
});
test('damage uses level, type, STAB, defense, and bounded randomness',()=>{
  const a=makeMon(db,'SQUIRTLE',10,rng(1)),e=makeMon(db,'GEODUDE',12,rng(2));
  const random={int:n=>n===256?255:38};const result=damage(db,a,e,{...db.moves.WATER_GUN,id:'WATER_GUN'},random);assert.equal(result.critical,false);assert.equal(result.effectiveness,4);assert.ok(result.amount>=30&&result.amount<=50);
  const immune=damage(db,a,e,{...db.moves.THUNDERSHOCK,id:'THUNDERSHOCK'},random);assert.equal(immune.amount,0);
});
test('status moves use PP and modify stages; healing restores HP, PP and status',()=>{
  const a=makeMon(db,'BULBASAUR',5,rng(3)),e=makeMon(db,'CHARMANDER',5,rng(4));useMove(db,a,e,1,{int:()=>0});assert.equal(e.stages.attack,-1);assert.equal(a.moves[1].pp,39);a.hp=1;a.status='PSN';heal(db,[a]);assert.equal(a.hp,a.stats.hp);assert.equal(a.status,null);assert.equal(a.moves[1].pp,40);
});
test('100 percent accuracy retains the original 1-in-256 miss',()=>{
  const a=makeMon(db,'CHARMANDER',5,rng(1)),b=makeMon(db,'BULBASAUR',5,rng(2)),hp=b.hp;const log=useMove(db,a,b,0,{int:()=>255});assert.ok(log.some(s=>s.includes('missed')));assert.equal(b.hp,hp);
});
test('rival victory grants experience, a level and learned moves at thresholds',()=>{
  const a=makeMon(db,'BULBASAUR',5,rng(7)),b=makeMon(db,'CHARMANDER',5,rng(8));addExperience(db,a,b,true);assert.equal(a.level,6);a.exp=experience(7,'MEDIUM_SLOW')-1;addExperience(db,a,b);assert.equal(a.level,7);assert.ok(a.moves.some(m=>m.id==='LEECH_SEED'));assert.ok(a.hp<=a.stats.hp);
});
