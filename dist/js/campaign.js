// Persistent campaign state and geometry, independent of rendering and browser APIs.
export function initializeCampaign(s) {
  for(const k of ['mapEdits','visibility','objectPositions','quests'])s[k]??={};
  s.visited??=['PALLET_TOWN'];s.flags??={};s.defeated??={};s.collected??={};
  if(s.flags.pokedex)s.flags.EVENT_GOT_POKEDEX=true;
  return s;
}
export function meets(s,requirements=[]){
  return requirements.every(key=>key==='CUT_ACCESS'?!!s.bag.HM_CUT:
    key==='TRASH_SWITCHES'?!!s.flags.EVENT_2ND_LOCK_OPENED:
    key==='SILPH_CO_LIBERATED'?!!s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI:
    key==='SEVEN_BADGES'?s.badges.length>=7:!!(s.flags[key]||s.bag[key]||s.badges.includes(key)));
}
export function stageFor(events,quest,id){return events.quests[quest]?.stages.find(s=>s.id===id);}
export function applyStage(s,quest,stage){
  initializeCampaign(s);if(!stage||s.quests[`${quest}:${stage.id}`])return false;
  if(!meets(s,stage.requires)||stage.requiresDefeated?.some(k=>!s.defeated[k]))return false;
  for(const [item,count]of Object.entries(stage.consume||{}))if((s.bag[item]||0)<count)return false;
  for(const [item,count]of Object.entries(stage.consume||{}))s.bag[item]-=count;
  for(const [item,count]of Object.entries(stage.rewards||{}))s.bag[item]=(s.bag[item]||0)+count;
  for(const flag of stage.setFlags||[])s.flags[flag]=true;
  for(const key of stage.hide||[])s.visibility[key]=false;
  for(const key of stage.show||[])s.visibility[key]=true;
  s.quests[`${quest}:${stage.id}`]=true;return true;
}
export function awardGym(s,gym){
  if(s.badges.includes(gym.badge))return false;
  s.badges.push(gym.badge);s.bag[gym.item]=(s.bag[gym.item]||0)+1;s.defeated[gym.objectId]=true;return true;
}
export function setBlock(s,map,x,y,block){initializeCampaign(s);(s.mapEdits[map]??={})[`${x},${y}`]=block;}
export function blockAt(world,s,map,x,y){return s.mapEdits?.[map]?.[`${x},${y}`]??world.maps[map]?.blocks[y]?.[x];}
export function cellAt(world,s,map,x,y,kind='collision'){
  const m=world.maps[map];if(!m||x<0||y<0||x>=m.width||y>=m.height)return 0;
  const edit=s.mapEdits?.[map]?.[`${Math.floor(x/2)},${Math.floor(y/2)}`];
  if(edit===undefined)return m[kind][y][x];
  return world.tilesets[m.tileset].blocks[edit]?.[kind]?.[y%2]?.[x%2]??0;
}
export function syncGeometry(s,events){
  initializeCampaign(s);
  for(const [map,doors]of Object.entries(events.field.silphDoorBlocks))for(const door of doors){
    if(s.mapEdits[map]?.[`${door.x},${door.y}`]===undefined)setBlock(s,map,door.x,door.y,door.closedBlock);
  }
  for(const [map,key,closed,open]of [['LORELEIS_ROOM','LORELEISROOM_LORELEI',36,5],['BRUNOS_ROOM','BRUNOSROOM_BRUNO',36,5],['AGATHAS_ROOM','AGATHASROOM_AGATHA',59,14]])setBlock(s,map,2,0,s.defeated[key]?open:closed);
  for(const gate of events.field.eventBlockChanges){
    if(gate.requiresDefeated?.every(k=>s.defeated[k]))s.flags[gate.flag]=true;
    setBlock(s,gate.map,gate.x,gate.y,s.flags[gate.flag]?gate.openBlock:gate.closedBlock);
  }
  const trash=events.field.vermilionPuzzle;if(s.flags[trash.completeFlag])setBlock(s,trash.map,trash.barrier.x,trash.barrier.y,trash.barrier.openBlock);
  for(const gate of events.field.cinnabarQuiz.gates)setBlock(s,events.field.cinnabarQuiz.map,gate.x,gate.y,s.flags[gate.flag]||s.defeated[gate.trainerObjectId]?gate.openBlock:gate.closedBlock);
  for(const [map,def]of Object.entries(events.field.mansionSwitch.maps))for(const b of def.blocks)setBlock(s,map,b.x,b.y,s.flags[events.field.mansionSwitch.flag]?b.on:b.off);
  for(const b of events.field.boulderSwitches)if(s.flags[b.flag])setBlock(s,b.map,b.blockChange.x,b.blockChange.y,b.blockChange.openBlock);
}
export function objectVisible(s,o,map){
  const id=o.objectId;if(s.collected[id])return false;
  if(s.visibility?.[id]!==undefined)return s.visibility[id];
  if(id==='CERULEANCITY_GUARD1')return !!s.flags.EVENT_MET_BILL;
  if(id==='CERULEANCITY_GUARD2')return !s.flags.EVENT_MET_BILL;
  if(id==='CERULEANCITY_SUPER_NERD3')return !s.flags.champion;
  if(id==='SAFFRONCITY_ROCKET8')return !s.flags.EVENT_RESCUED_MR_FUJI&&!s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI;
  if(id==='SAFFRONCITY_ROCKET9')return !!s.flags.EVENT_RESCUED_MR_FUJI&&!s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI;
  if(map==='SAFFRON_CITY'&&s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI)return o.sprite!=='SPRITE_ROCKET';
  if(map.startsWith('SILPH_CO_')&&s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI&&o.sprite==='SPRITE_ROCKET')return false;
  if(id==='GAMECORNER_ROCKET'&&s.defeated[id])return false;
  if(id==='CERULEANCITY_ROCKET'&&s.defeated[id])return false;
  if(o.sprite==='SPRITE_BLUE'&&map!=='OAKS_LAB')return false; // Triggered encounter actors are drawn by the scene runner.
  if(map==='MT_MOON_B2F'&&s.flags.fossil&&o.sprite==='SPRITE_FOSSIL')return false;
  return !o.defaultHidden;
}
