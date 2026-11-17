import {initializeCampaign,meets,stageFor,applyStage,awardGym,setBlock,blockAt,cellAt,syncGeometry,objectVisible} from './campaign.js';
import {GridMotion,TextPager,STEP_MS,normalizeKey,directionForKey,hpAt,animationStyle,clamp} from './presentation.js';
import {MusicPlayer} from './music.js';
import {connectionDestination,warpDestination} from './navigation.js';
import {rng,makeMon,pretty,useMove,endTurn,addExperience,heal,stageMultiplier,statsFor,experience,clearVolatile} from './mechanics.js';
const $=s=>document.querySelector(s), canvas=$('#game'), ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;
const SAVE='pokered-browser-save-v1', MODS='pokered-browser-mods-v1';
const images=new Map(), held=new Set(), vectors={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
let world,db,events,original,s,random,dialogue=null,menu=null,battle=null,started=false,lastStep=0,loading=false,sound=true,exploreHome=null;
const motion=new GridMotion();
let introArt=null,fx=null,sceneBusy=false,sceneSprites=[],music=null,presentationClock=0,starterPreview=null;
const shownHp=new WeakMap();
let settings={textSpeed:'medium',protectedText:true,battleAnimations:true,music:true,volume:.13};
try{Object.assign(settings,JSON.parse(localStorage.getItem('pokered-settings-v2')||'{}'));}catch{}
sound=settings.music;
const loadImage=src=>{if(images.has(src))return images.get(src).promise;const image=new Image();const entry={image};entry.promise=new Promise((ok,no)=>{image.onload=()=>ok(image);image.onerror=()=>no(Error(`Image unavailable: ${src}`));});images.set(src,entry);image.src=src;return entry.promise;};
const img=src=>images.get(src)?.image;
const currentMap=()=>world.maps[s.map];
function status(text){$('#status').textContent=text;}
function note(text){s.log.unshift(text);s.log=s.log.slice(0,30);updatePanels();}
function beep(){music?.effect('confirm');}
function mapMusic(){if(!battle&&s&&music)music.play(music.data.mapMusic[s.map]||'Music_PalletTown');}
function clearInput(){held.clear();motion.pending=null;}
function focusGame(){canvas.focus({preventScroll:true});}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fresh(){return {version:1,map:'REDS_HOUSE_2F',x:3,y:6,dir:'down',lastOutdoor:'PALLET_TOWN',party:[],box:[],money:3000,bag:{POTION:1,POKE_BALL:0,ANTIDOTE:0},flags:{},defeated:{},collected:{},caught:[],seen:[],badges:[],log:['A new adventure begins in Pallet Town.'],seed:Date.now()>>>0,steps:0,modified:false,checkpoint:{map:'PALLET_TOWN',x:5,y:6}};}
function saveGame(){if(!started||battle||sceneBusy||fx){status('Finish the current scene before saving.');return;}try{const out=structuredClone(s);out.seed=random.seed;if(exploreHome)Object.assign(out,exploreHome);localStorage.setItem(SAVE,JSON.stringify(out));status('Game saved in this browser.');beep(660);}catch{status('Browser storage is unavailable. Use Export save to keep your progress.');}}
function loadSave(raw){const v=JSON.parse(raw);if(v.version!==1||!world.maps[v.map]||!Array.isArray(v.party)||v.party.length>6||!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.y<0||v.x>=world.maps[v.map].width||v.y>=world.maps[v.map].height)throw Error('This is not a compatible browser-rewrite save.');for(const m of [...v.party,...(v.box||[])]){if(!db.species[m.species]||!Number.isInteger(m.level)||m.level<1||m.level>100||!Array.isArray(m.moves)||m.moves.some(x=>!db.moves[x.id]))throw Error('The save contains invalid Pokémon data.');}return {...fresh(),...v};}
async function startGame(saved=false){try{s=saved?loadSave(localStorage.getItem(SAVE)):fresh();}catch(e){status(e.message);s=fresh();}initializeCampaign(s);syncGeometry(s,events);random=rng(s.seed);clearInput();motion.clear();sceneBusy=false;introArt=null;fx=null;sceneSprites=[];started=true;dialogue=null;menu=null;battle=null;exploreHome=null;if(sound)music?.enable(true).catch(()=>status('Tap MUSIC to enable audio.'));$('#overlay').hidden=true;await prepareMap();updatePanels();focusGame();if(!saved)introScene();}
function visibleObjects(){return currentMap().objects.filter(o=>{
  if(s.collected[o.objectId])return false;
  if(s.map==='OAKS_LAB'){
    if(o.objectId==='OAKSLAB_OAK1')return !!s.flags.metOak;
    if(o.objectId==='OAKSLAB_OAK2')return false;
    if(o.sprite==='SPRITE_POKEDEX'&&s.flags.pokedex)return false;
    if(o.sprite==='SPRITE_BLUE'&&s.flags.rival&&!sceneBusy)return false;
    if(o.sprite==='SPRITE_POKE_BALL'&&s.flags.starter&&(o.objectId.includes(s.flags.starter)||o.objectId.includes(rivalStarter())))return false;
  }
  if(s.map==='VIRIDIAN_CITY'&&/OLD_MAN/.test(o.objectId||''))return !o.defaultHidden&&!s.flags.pokedex;
  return objectVisible(s,o,s.map);
}).map(o=>({...o,...s.objectPositions?.[o.objectId]}));}
async function prepareMap(){loading=true;const m=currentMap();$('#location').textContent=m.displayName.toUpperCase();await Promise.all([loadImage(m.image),loadImage(m.borderImage),loadImage(world.tilesets[m.tileset].blockAtlas),...m.objects.map(o=>world.sprites[o.sprite]).filter(Boolean).map(p=>loadImage(p.image)),...m.connections.map(c=>world.maps[c.target]).filter(Boolean).map(m=>loadImage(m.image))]);loading=false;mapMusic();}
async function enterMap(id,x,y,dir=s.dir,keepHeld=false){
  if(!world.maps[id]){say('This destination is unavailable.');return false;}
  if(!keepHeld)clearInput();else motion.pending=null;motion.clear();
  const previous=s.map,wasSurfing=s.surfing;
  if(!exploreHome&&events.field.elevators[id])s.elevatorReturn={map:previous,x:s.x,y:s.y+1};
  s.map=id;s.x=x;s.y=y;s.dir=dir;initializeCampaign(s);
  if(!exploreHome){
    s.flags.strength=false;s.surfing=wasSurfing&&world.maps[id].collision[y]?.[x]===3;
    if(previous!==id){
      if(!id.startsWith('ROCK_TUNNEL'))s.flags.flashTunnel=false;
      for(const o of world.maps[id].objects)if(o.sprite==='SPRITE_BOULDER')delete s.objectPositions[o.objectId];
      for(const b of events.field.boulderSwitches.filter(b=>b.map===id)){delete s.flags[b.flag];setBlock(s,id,b.blockChange.x,b.blockChange.y,world.maps[id].blocks[b.blockChange.y][b.blockChange.x]);}
      for(const flag of events.field.resetFlagsOnMapEntry[id]||[])delete s.flags[flag];
    }
    if(!s.visited.includes(id))s.visited.push(id);
    if(previous.startsWith('SS_ANNE')&&id==='VERMILION_DOCK'&&s.bag.HM_CUT)s.flags.EVENT_SS_ANNE_LEFT=true;
    syncGeometry(s,events);
  }
  await prepareMap();updatePanels();
  if(!exploreHome){
    note(`Arrived at ${currentMap().displayName}.`);
    if(id==='VIRIDIAN_MART'&&s.flags.starter&&!s.flags.parcel&&!s.flags.pokedex){s.flags.parcel=true;s.bag.OAKS_PARCEL=1;say(storyText(['_ViridianMartClerkYouCameFromPalletTownText','_ViridianMartClerkParcelQuestText']),saveGame);}
  }
  return true;
}
function passable(x,y,ignoreObjects=false){const m=currentMap();if(x<0||y<0||x>=m.width||y>=m.height)return false;if(exploreHome&&$('#noclip').checked)return true;if(!ignoreObjects&&visibleObjects().some(o=>o.x===x&&o.y===y))return false;return [1,2,...(s.surfing?[3]:[])].includes(cellAt(world,s,s.map,x,y))||m.warps.some(w=>w.x===x&&w.y===y);}
function warp(w){if(events.field.elevators[s.map]&&s.elevatorReturn){const d=s.elevatorReturn;enterMap(d.map,d.x,d.y,'down');return;}const destination=warpDestination(world,s.map,w,s.lastOutdoor);if(!destination){say('This dynamic map exit is not yet translated.');return;}s.lastOutdoor=destination.lastOutdoor;beep(300,.1);enterMap(destination.map,destination.x,destination.y,destination.dir||s.dir);}
function boundary(x,y){const destination=connectionDestination(world,s.map,x,y);if(!destination)return;const m=world.maps[destination.map];if(![1,2].includes(m.collision[destination.y][destination.x])&&!(exploreHome&&$('#noclip').checked))return;enterMap(destination.map,destination.x,destination.y);}
function move(dir){
  if(!started||loading||dialogue||menu||battle||sceneBusy||fx||motion.step)return;
  s.dir=dir;const [dx,dy]=vectors[dir],m=currentMap();let x=s.x+dx,y=s.y+dy;
  if(!exploreHome&&s.map==='PALLET_TOWN'&&y<=0&&!s.flags.starter){meetOak();return;}
  if(x<0||y<0||x>=m.width||y>=m.height){
    const destination=connectionDestination(world,s.map,x,y);if(!destination)return;
    const target=world.maps[destination.map];
    if(![1,2,...(s.surfing?[3]:[])].includes(target.collision[destination.y][destination.x])&&!(exploreHome&&$('#noclip').checked))return;
    motion.begin(s,{x,y},dir,performance.now(),{destination});return;
  }
  if(!exploreHome&&!campaignBeforeMove(x,y))return;
  let jump=false;const tile=cellAt(world,s,s.map,x,y,'tileIds'),fromTile=cellAt(world,s,s.map,s.x,s.y,'tileIds');
  if(!(exploreHome&&$('#noclip').checked)&&world.tilePairCollisions.some(p=>p.tileset===m.tileset&&((p.a===fromTile&&p.b===tile)||(p.b===fromTile&&p.a===tile))))return;
  if(!passable(x,y)&&world.ledges.some(l=>l.direction===dir&&l.fromTile===fromTile&&l.toTile===tile)){if(passable(x+dx,y+dy)){x+=dx;y+=dy;jump=true;}}
  if(!passable(x,y))return;
  motion.begin(s,{x,y},dir,performance.now(),{jump});if(s.cycling&&!jump)motion.step.duration/=2;
}
function finishStep(step){
  if(step.destination){const d=step.destination;enterMap(d.map,d.x,d.y,step.direction,true);return;}
  s.x=step.toX;s.y=step.toY;s.steps++;if(s.repelSteps>0)s.repelSteps--;if(cellAt(world,s,s.map,s.x,s.y)!==3)s.surfing=false;
  const m=currentMap(),w=m.warps.find(w=>w.x===s.x&&w.y===s.y);
  if(w){clearInput();warp(w);return;}
  if(!exploreHome){
    if(storyStep()||trainerSight())return;
    if(s.party.some(p=>p.hp>0)&&[2,3].includes(cellAt(world,s,s.map,s.x,s.y))){
      const wild=db.wild[s.map],water=cellAt(world,s,s.map,s.x,s.y)===3,slots=water?wild?.water:wild?.grass;if(slots?.length&&random.int(256)<(water?wild.waterRate:wild.grassRate)){
        const weights=db.encounterWeights;let roll=random.int(256),index=0;
        while(index<9&&roll>=weights[index])roll-=weights[index++];
        const pick=slots[index]||slots[0];if(s.repelSteps>0&&pick.level<s.party[0].level)return;beginBattle([{species:pick.species,level:pick.level}],null);return;
      }
    }
  }
  if(s.steps%50===0)saveGame();
}
function tickMovement(now){
  const finished=motion.finish(now);if(finished)finishStep(finished);
  if(motion.step||loading||dialogue||menu||battle||sceneBusy||fx)return;
  if(now-lastStep<STEP_MS&&!motion.pending)return;
  const heldDirection=[...held].reverse().map(directionForKey).find(Boolean);
  const dir=motion.take(heldDirection);if(dir){lastStep=now;move(dir);}
}
function storyStep(){
  if(s.map==='OAKS_LAB'&&s.flags.metOak&&!s.flags.starter&&s.y>=8){s.y=7;say(storyText(['_OaksLabOakDontGoAwayYetText']));return true;}
  if(s.map==='OAKS_LAB'&&s.flags.starter&&!s.flags.rival&&s.y>=7){sceneText('rivalLabChallenge',()=>beginBattle([{species:rivalStarter(),level:5}],{key:'FIRST_RIVAL',name:'BLUE',rival:true}));return true;}
  return campaignStep();
}
function trainerSight(){if(!s.party.length)return false;for(const o of visibleObjects()){if(!o.trainer||s.defeated[o.objectId]||!o.sightRange)continue;const d=(o.direction||'DOWN').toLowerCase(),[dx,dy]=vectors[d]||vectors.down;for(let n=1;n<=o.sightRange;n++){if(o.x+dx*n===s.x&&o.y+dy*n===s.y){talkObject(o);return true;}if(!passable(o.x+dx*n,o.y+dy*n,true))break;}}return false;}
function interact(){if(fx||motion.step||loading)return;if(dialogue){advance();return;}if(menu){selectMenu(menu.index);return;}if(battle)return;if(!started)return;const [dx,dy]=vectors[s.dir],x=s.x+dx,y=s.y+dy;const object=visibleObjects().find(o=>o.x===x&&o.y===y)||visibleObjects().find(o=>o.x===x+dx&&o.y===y+dy&&['SPRITE_NURSE','SPRITE_CLERK'].includes(o.sprite));if(object){talkObject(object);return;}if(!exploreHome&&fieldInteract(x,y))return;const sign=currentMap().signs.find(p=>p.x===x&&p.y===y);if(sign){say(sign.text||'The writing here has not been translated.');return;}if(s.map==='REDS_HOUSE_2F'&&y<=2){say("A SNES!\n\nIt's time to go outside.");return;}beep(180,.025);}
function talkObject(o){
  if(exploreHome){say(o.text||`${pretty(o.objectId||o.sprite)}\n\nStory events are paused in exploration mode.`);return;}
  if(campaignObject(o))return;
  if(o.item){s.bag[o.item]=(s.bag[o.item]||0)+1;s.collected[o.objectId]=true;say(`RED found ${pretty(o.item)}!`,saveGame);return;}
  if(s.map==='OAKS_LAB'){
    if(o.sprite==='SPRITE_POKE_BALL'){if(s.flags.starter){say(storyText(['_OaksLabLastMonText']));return;}if(!s.flags.metOak){say(storyText(['_OaksLabThoseArePokeBallsText']));return;}const species=['CHARMANDER','SQUIRTLE','BULBASAUR'].find(k=>o.objectId.includes(k));chooseStarter(species);return;}
    if(o.sprite==='SPRITE_OAK'){if(s.flags.parcel){deliverParcel();return;}if(!s.flags.starter){say(storyText(['_OaksLabOak1WhichPokemonDoYouWantText']));return;}say(storyText([s.flags.pokedex?'_OaksLabOak1HowIsYourPokedexComingText':s.flags.rival?'_OaksLabOak1RaiseYourYoungPokemonText':'_OaksLabOak1YourPokemonCanFightText']));return;}
    if(o.sprite==='SPRITE_BLUE'){say(storyText([s.flags.starter?'_OaksLabRivalMyPokemonLooksStrongerText':s.flags.metOak?'_OaksLabRivalGoAheadAndChooseText':'_OaksLabRivalGrampsIsntAroundText']));return;}
  }
  if(o.sprite==='SPRITE_MOM'||o.sprite==='SPRITE_NURSE'){healScene(o);return;}
  if(o.sprite==='SPRITE_CLERK'){shop(o);return;}
  if(o.trainer&&s.party.length){if(s.defeated[o.objectId]){say(o.afterText||o.defeatText||'Train hard! There are strong trainers all over KANTO.');return;}const team=db.trainers[o.trainer.class]?.[o.trainer.party-1];if(team?.length){say(o.text||`${pretty(o.trainer.class)} wants to fight!`,()=>beginBattle(team,{key:o.objectId,name:pretty(o.trainer.class),class:o.trainer.class,defeatText:o.defeatText}));return;}}
  say(o.text||storyText(events.objectTextVariants[o.objectId]||[])||'There is nothing to do here yet.');
}
function questStage(quest,id,done){
  const stage=stageFor(events,quest,id);if(!stage){done?.();return;}
  const complete=async()=>{applyStage(s,quest,stage);syncGeometry(s,events);updatePanels();
    if(stage.warp){const w=stage.warp;s.lastOutdoor=w.lastMap||s.lastOutdoor;await enterMap(w.map,w.x,w.y,w.facing||'down');}
    saveGame();done?.();};
  const content=storyText(stage.text||[]);if(content)say(content,complete);else complete();
}
function yesNo(yes,no=()=>{}){openMenu([{label:'YES',action:yes},{label:'NO',action:no}],'YES / NO');}
function givePokemon(species,level,done){
  const mon=makeMon(db,species,level,random);(s.party.length<6?s.party:s.box).push(mon);
  s.seen=[...new Set([...s.seen,species])];s.caught=[...new Set([...s.caught,species])];
  say(`RED received ${pretty(species)}!${s.party.includes(mon)?'':'\n\nSent to the storage box.'}`,()=>{updatePanels();saveGame();done?.();});
}
function campaignObject(o){
  const id=o.objectId,gym=events.gyms.find(g=>g.objectId===id),elite=events.league.find(g=>g.objectId===id);
  if(gym||elite){const g=gym||elite;
    if(s.defeated[id]){say(storyText(g.after?.length?g.after:g.victory));return true;}
    if(!meets(s,g.requires)){say('You must complete the challenge before facing the GYM LEADER.');return true;}
    say(storyText(g.intro),()=>beginBattle(db.trainers[g.trainerClass][g.party-1],{key:id,name:pretty(g.trainerClass),class:g.trainerClass,gym:!!gym,elite:!!elite}));return true;
  }
  if(o.sprite==='SPRITE_BOULDER'){fieldMove('STRENGTH');return true;}
  if(id==='SAFARIZONEGATE_SAFARI_ZONE_WORKER1'){safariAdmission();return true;}
  if(id==='ROCKETHIDEOUTB4F_ROCKET3'&&s.defeated[id]){questStage('rocketHideout','liftKey');return true;}
  if(id==='CHAMPIONSROOM_RIVAL'){rivalEncounter(events.rivals.find(r=>r.id==='champion'));return true;}
  if(id==='BLUESHOUSE_DAISY1'||id==='BLUESHOUSE_DAISY2'){
    if(s.flags.pokedex&&!s.bag.TOWN_MAP){say(storyText(['_BluesHouseDaisyOfferMapText','_GotMapText']),()=>{s.bag.TOWN_MAP=1;saveGame();});return true;}
  }
  if(id==='ROUTE2GATE_OAKS_AIDE'&&!s.bag.HM_FLASH){if(s.caught.length<10)say('PROF. OAK’s AIDE: Catch 10 kinds of POKéMON and come see me for HM05!');else{ s.bag.HM_FLASH=1;say('RED received HM05!\n\nFLASH lights up dark caves.',saveGame);}return true;}
  if(/FISHING_GURU$/.test(id)&&['VERMILION_OLD_ROD_HOUSE','FUCHSIA_GOOD_ROD_HOUSE','ROUTE_12_SUPER_ROD_HOUSE'].includes(s.map)){
    const item=s.map.includes('OLD')?'OLD_ROD':s.map.includes('GOOD')?'GOOD_ROD':'SUPER_ROD';
    if(!s.bag[item])say(o.text,()=>yesNo(()=>{s.bag[item]=1;say(`RED received ${pretty(item)}!`,saveGame);}));else say('Try fishing wherever there is water!');return true;
  }
  if(id==='CELADONMANSION_ROOF_HOUSE_EEVEE_POKEBALL'){s.collected[id]=true;givePokemon('EEVEE',25);return true;}
  if(id==='SILPHCO7F_SILPH_WORKER_M1'&&!s.flags.gotLapras&&s.defeated.rivalSilph){say(o.text,()=>{s.flags.gotLapras=true;givePokemon('LAPRAS',15);});return true;}
  if(/FIGHTINGDOJO_HITMON(LEE|CHAN)_POKE_BALL/.test(id)){
    if(!s.defeated.FIGHTINGDOJO_KARATE_MASTER){say('Defeat the KARATE MASTER first!');return true;}
    if(s.flags.dojoGift){say('You may choose only one.');return true;}
    say(o.text,()=>yesNo(()=>{s.flags.dojoGift=true;s.collected[id]=true;givePokemon(id.includes('HITMONLEE')?'HITMONLEE':'HITMONCHAN',30);}));return true;
  }
  if(o.sprite==='SPRITE_FOSSIL'&&s.map==='MT_MOON_B2F'){
    if(!s.defeated.MTMOONB2F_SUPER_NERD){talkObject(currentMap().objects.find(p=>p.objectId==='MTMOONB2F_SUPER_NERD'));return true;}
    say(o.text,()=>yesNo(()=>{const item=id.includes('DOME')?'DOME_FOSSIL':'HELIX_FOSSIL';s.flags.fossil=item;s.bag[item]=1;s.objectPositions.MTMOONB2F_SUPER_NERD={x:12,y:7};say(`RED got the ${pretty(item)}!`,saveGame);}));return true;
  }
  const legendary={POWERPLANT_ZAPDOS:['ZAPDOS',50],SEAFOAMISLANDSB4F_ARTICUNO:['ARTICUNO',50],VICTORYROAD2F_MOLTRES:['MOLTRES',50],CERULEANCAVEB1F_MEWTWO:['MEWTWO',70]};
  if(legendary[id]){const [species,level]=legendary[id];say(`${pretty(species)}!`,()=>beginBattle([{species,level}],null,{stationary:id}));return true;}
  if(/ROUTE[5678]GATE_GUARD/.test(id)&&!s.flags.saffronOpen){
    const drink=['FRESH_WATER','SODA_POP','LEMONADE'].find(k=>s.bag[k]);if(drink){s.bag[drink]--;s.flags.saffronOpen=true;say(storyText(['_SaffronGateGuardImParchedText','_SaffronGateGuardYouCanGoOnThroughText'])||'Gee, thanks! You can go on through. I’ll share this with the other guards!',saveGame);}else say(o.text);return true;
  }
  if(s.map==='ROUTE_23'&&['SPRITE_GUARD','SPRITE_SWIMMER'].includes(o.sprite)){say(`You need all eight BADGEs to challenge the POKéMON LEAGUE.\n\nYou have ${s.badges.length} BADGEs.`);return true;}
  for(const [key,q]of Object.entries(events.quests)){
    if(q.map!==s.map||!q.objectIds.includes(id)||['secretKey','marowak','rocketHideout','silphGiovanni'].includes(key))continue;
    if(key==='bill'){
      if(s.flags.EVENT_GOT_SS_TICKET)questStage(key,'after');
      else if(s.flags.EVENT_USED_CELL_SEPARATOR_ON_BILL)questStage(key,'receiveTicket');
      else questStage(key,'askHelp',()=>yesNo(()=>questStage(key,'enterMachine'),()=>questStage(key,'refuse')));return true;
    }
    if(key==='bikeVoucher'){
      if(s.quests['bikeVoucher:story'])questStage(key,'after');else questStage(key,'intro',()=>yesNo(()=>questStage(key,'story'),()=>questStage(key,'refuse')));return true;
    }
    if(key.startsWith('snorlax')){
      if(!meets(s,q.requires)){say('A sleeping POKéMON blocks the way!');return true;}
      questStage(key,'wake',()=>beginBattle([q.battle],null,{quest:key,stationary:id}));return true;
    }
    const reward=q.stages.find(stage=>stage.rewards);
    if(reward&&s.quests[`${key}:${reward.id}`]){if(q.stages.some(t=>t.id==='after'))questStage(key,'after');else say(o.text||'Take good care of it!');return true;}
    if(!meets(s,q.requires)||q.requiresDefeated?.some(k=>!s.defeated[k])){
      if(key==='bicycle')questStage(key,'noVoucher');else if(key==='strength')questStage(key,'noTeeth');else say(o.text||'Please take care of TEAM ROCKET first!');return true;
    }
    questStage(key,key==='fujiRescue'?'rescue':reward?.id||'reward');return true;
  }
  return false;
}
function rivalEncounter(r){
  if(!r||s.defeated[r.id])return false;
  const team=db.trainers[r.trainerClass]?.[r.partyByStarter[s.flags.starter]-1];if(!team)return false;
  say(storyText(r.intro),()=>beginBattle(team,{key:r.id,name:'BLUE',class:r.trainerClass,campaignRival:r.id,champion:r.id==='champion'}));return true;
}
function campaignBeforeMove(x,y){
  for(const gate of events.field.mapGates){if(gate.map!==s.map||gate.x!==x||gate.y!==y)continue;
    if(gate.blockedByFlags?.some(k=>s.flags[k])){say(storyText(gate.departedText));return false;}
    if(!meets(s,[...(gate.requiresItems||[]),...(gate.requiresBadges||[]),...(gate.requiresFlags||[])])){say(storyText(gate.blockedText));return false;}
  }
  if(s.map==='ROUTE_22_GATE'&&y<3&&!s.badges.includes('BOULDER')){say('Only truly skilled trainers are allowed through.\n\nYou need the BOULDERBADGE!');return false;}
  if(s.map==='ROUTE_23'&&y<30&&s.badges.length<8){say('You may pass only if you have the EARTHBADGE and the other seven BADGEs!');return false;}
  if(['ROUTE_5_GATE','ROUTE_6_GATE','ROUTE_7_GATE','ROUTE_8_GATE'].includes(s.map)&&!s.flags.saffronOpen){
    const crossing=s.map==='ROUTE_5_GATE'?y>=3:s.map==='ROUTE_6_GATE'?y<=2:s.map==='ROUTE_7_GATE'?x>=4:x<=3;
    if(crossing){const guard=currentMap().objects.find(o=>o.sprite==='SPRITE_GUARD');campaignObject(guard);return !!s.flags.saffronOpen;}
  }
  const elite=events.league.find(l=>l.map===s.map);if(elite&&y<=1&&!s.defeated[elite.objectId]){campaignObject(currentMap().objects.find(o=>o.objectId===elite.objectId));return false;}
  if(s.map==='CHAMPIONS_ROOM'&&y<=3&&!s.flags.champion){rivalEncounter(events.rivals.find(r=>r.id==='champion'));return false;}
  const boulder=visibleObjects().find(o=>o.x===x&&o.y===y&&o.sprite==='SPRITE_BOULDER');
  if(boulder){if(s.flags.strength)pushBoulder(boulder);else fieldMove('STRENGTH');return false;}
  return true;
}
function campaignStep(){
  const fall=events.field.dungeonFalls.find(p=>p.map===s.map&&p.x===s.x&&p.y===s.y);
  if(fall){const d=fall.destination;playFx({type:'fade'},350).then(()=>enterMap(d.map,d.x,d.y));return true;}
  const spin=events.field.spinPaths[s.map]?.find(p=>p.x===s.x&&p.y===s.y);if(spin){spinPlayer(spin);return true;}
  const safari=events.field.safariGame;
  if(s.map===safari.map&&safari.admissionTriggers.some(p=>p.x===s.x&&p.y===s.y)&&!s.flags.EVENT_IN_SAFARI_ZONE){safariAdmission();return true;}
  if(s.flags.EVENT_IN_SAFARI_ZONE&&s.map.startsWith('SAFARI_ZONE_')&&s.map!==safari.map&&--s.safariSteps<=0){endSafari();return true;}
  const ghost=events.quests.marowak;if(s.map===ghost.map&&s.x===ghost.trigger.x&&s.y===ghost.trigger.y&&!s.flags.EVENT_BEAT_GHOST_MAROWAK){
    if(!s.bag.SILPH_SCOPE){s.y++;say(storyText(ghost.stages[0].text)+'\n\nThe ghost cannot be identified!');}
    else questStage('marowak','intro',()=>questStage('marowak','identified',()=>beginBattle([ghost.battle],null,{quest:'marowak',cannotCatch:true})));return true;
  }
  for(const r of events.rivals){if(r.map!==s.map||s.defeated[r.id])continue;
    if(r.id==='rivalRoute22Early'&&(s.badges.length||!s.flags.pokedex))continue;
    if(r.id==='rivalRoute22Late'&&s.badges.length<8)continue;
    if(r.trigger.some(([x,y])=>x===s.x&&y===s.y))return rivalEncounter(r);
  }
  return false;
}
async function spinPlayer(spin){
  sceneBusy=true;clearInput();let current=spin;const visited=new Set();
  while(current&&!visited.has(`${current.x},${current.y}`)){
    visited.add(`${current.x},${current.y}`);
    for(const segment of current.steps)for(let i=0;i<segment.count;i++){
      const [dx,dy]=vectors[segment.direction],to={x:s.x+dx,y:s.y+dy};s.dir=segment.direction;
      await playFx({type:'escort',from:{x:s.x,y:s.y},to},STEP_MS*.6);s.x=to.x;s.y=to.y;
    }
    current=events.field.spinPaths[s.map]?.find(p=>p.x===s.x&&p.y===s.y);
  }
  sceneBusy=false;saveGame();
}
function safariAdmission(){
  const q=events.field.safariGame;
  if(s.flags.EVENT_IN_SAFARI_ZONE){say(storyText(q.leavingEarly),()=>yesNo(endSafari,()=>say(storyText(q.stay))));return;}
  say(storyText(q.intro),()=>yesNo(()=>{if(s.money<q.price){s.y=3;say(storyText(q.notEnoughMoney));return;}
    s.money-=q.price;s.safariSteps=q.initialSteps;s.safariBalls=q.balls;s.flags.EVENT_IN_SAFARI_ZONE=true;say(storyText(q.paid),saveGame);
  },()=>{s.y=3;say(storyText(q.declined));}));
}
function endSafari(){s.flags.EVENT_IN_SAFARI_ZONE=false;s.safariBalls=0;say(storyText(events.field.safariGame.timesUp),()=>enterMap('SAFARI_ZONE_GATE',4,3,'down'));}
function fieldAvailable(move){return s.party.some(m=>m.moves.some(slot=>slot.id===move))&&s.badges.includes(events.field.badgeRequirements[move]);}
function fieldMove(move){
  if(!fieldAvailable(move)){say(`A POKéMON must know ${move}, and you need the ${events.field.badgeRequirements[move]}BADGE to use it here.`);return;}
  const [dx,dy]=vectors[s.dir],x=s.x+dx,y=s.y+dy;
  if(move==='STRENGTH'){s.flags.strength=true;say('RED used STRENGTH!\n\nPOKéMON can move boulders now!');return;}
  if(move==='SURF'){if(cellAt(world,s,s.map,x,y)!==3){say('There is no water to SURF on here.');return;}say('RED used SURF!',()=>{s.surfing=true;movePlayerAfterField('SURF');});return;}
  if(move==='CUT'){
    const block=blockAt(world,s,s.map,Math.floor(x/2),Math.floor(y/2));
    const swap=events.field.cutTreeBlockSwaps.find(p=>p.from===block);
    if(!swap||!['OVERWORLD','GYM'].includes(currentMap().tileset)||![0x3d,0x50].includes(cellAt(world,s,s.map,x,y,'tileIds'))){say('There is nothing to CUT here.');return;}
    say('RED used CUT!',async()=>{await playFx({type:'fade'},220);setBlock(s,s.map,Math.floor(x/2),Math.floor(y/2),swap.to);saveGame();});return;
  }
  if(move==='FLASH'){s.flags.flashTunnel=true;say('A blinding FLASH lights the area!');return;}
  if(move==='FLY'){openMenu([...s.visited.filter(id=>world.maps[id]?.outdoor&&/(TOWN|CITY|ISLAND|PLATEAU)$/.test(id)).map(id=>({label:world.maps[id].displayName,action:async()=>{await playFx({type:'fade'},500);const pos=safePosition(world.maps[id]);await enterMap(id,pos.x,pos.y,'down');saveGame();}})),{label:'CANCEL',action:()=>{}}],'FLY WHERE?');}
}
function movePlayerAfterField(){move(s.dir);}
async function pushBoulder(o){
  const [dx,dy]=vectors[s.dir],x=o.x+dx,y=o.y+dy;if(!passable(x,y))return;
  sceneBusy=true;const actor={...o};sceneSprites=[actor];
  await playFx({type:'escort',from:{x:s.x,y:s.y},to:{x:o.x,y:o.y},actors:[{sprite:actor,from:{x:o.x,y:o.y},to:{x,y}}]},STEP_MS*1.5);
  s.x=o.x;s.y=o.y;s.objectPositions[o.objectId]={x,y};sceneSprites=[];
  const fall=events.field.boulderFalls.find(p=>p.map===s.map&&p.x===x&&p.y===y);
  if(fall){s.flags[fall.flag]=true;s.visibility[fall.hide]=false;s.visibility[fall.show]=true;s.objectPositions[fall.show]={x:fall.destination.x,y:fall.destination.y};}
  const button=events.field.boulderSwitches.find(p=>p.map===s.map&&p.x===x&&p.y===y);if(button)s.flags[button.flag]=true;
  syncGeometry(s,events);sceneBusy=false;saveGame();
}
function fieldInteract(x,y){
  const q=events.quests.bill;
  if(s.map===q.map&&x===q.pc.x&&y===q.pc.y){
    if(s.flags.EVENT_BILL_SAID_USE_CELL_SEPARATOR&&!s.flags.EVENT_USED_CELL_SEPARATOR_ON_BILL)questStage('bill','runPC',async()=>{await playFx({type:'fade'},1400);saveGame();});else say(storyText(q.pc.idleText));return true;
  }
  const elevator=events.field.elevators[s.map];if(elevator){
    if(!meets(s,elevator.requires)){say('The elevator needs the LIFT KEY.');return true;}
    openMenu([...elevator.destinations.map(d=>({label:world.maps[d.map].displayName,action:()=>{const w=world.maps[d.map].warps[d.targetWarp-1];enterMap(d.map,w.x,w.y+1,'down');}})),{label:'CANCEL',action:()=>{}}],'WHICH FLOOR?');return true;
  }
  const puzzle=events.field.vermilionPuzzle,can=puzzle.cans.find(c=>c.x===x&&c.y===y);
  if(s.map===puzzle.map&&can){
    if(s.flags[puzzle.completeFlag]){say(storyText(puzzle.text.complete));return true;}
    s.trashFirst??=random.int(puzzle.cans.length);
    if(s.flags[puzzle.firstFlag]){
      if(can.argument===s.trashSecond){s.flags[puzzle.completeFlag]=true;syncGeometry(s,events);say(storyText(puzzle.text.complete),saveGame);}
      else{s.flags[puzzle.firstFlag]=false;delete s.trashFirst;say(storyText(puzzle.text.reset));}
    }else if(can.argument===s.trashFirst){s.flags[puzzle.firstFlag]=true;const candidates=puzzle.secondLockTables[can.argument].candidates;s.trashSecond=candidates[random.int(candidates.length)];say(storyText(puzzle.text.first));}
    else say(storyText(puzzle.text.empty));return true;
  }
  const quiz=events.field.cinnabarQuiz,gate=quiz.gates.find(g=>g.target.x===x&&g.target.y===y);
  if(s.map===quiz.map&&gate){if(s.flags[gate.flag]||s.defeated[gate.trainerObjectId])say(storyText(quiz.correct));else say(storyText([...quiz.intro,...gate.question]),()=>yesNo(()=>answerQuiz(gate,true),()=>answerQuiz(gate,false)));return true;}
  const mansion=events.field.mansionSwitch;
  if(mansion.maps[s.map]?.targets.some(p=>p.x===x&&p.y===y)){say(storyText(mansion.text.prompt),()=>yesNo(()=>{s.flags[mansion.flag]=!s.flags[mansion.flag];syncGeometry(s,events);say(storyText(mansion.text.pressed),saveGame);},()=>say(storyText(mansion.text.declined))));return true;}
  const door=events.field.silphDoorBlocks[s.map]?.find(p=>Math.floor(x/2)===p.x&&Math.floor(y/2)===p.y);
  if(door&&blockAt(world,s,s.map,door.x,door.y)!==door.openBlock){if(s.bag.CARD_KEY){setBlock(s,s.map,door.x,door.y,door.openBlock);say('Bingo! The CARD KEY opened the door!',saveGame);}else say('The door is locked. It needs a CARD KEY!');return true;}
  const sign=currentMap().signs.find(p=>p.x===x&&p.y===y);
  if(s.map==='GAME_CORNER'&&sign?.textId==='TEXT_GAMECORNER_POSTER'){
    if(!s.defeated.GAMECORNER_ROCKET){say('A ROCKET is guarding this poster.');return true;}s.flags.EVENT_FOUND_ROCKET_HIDEOUT=true;syncGeometry(s,events);say(storyText(['_GameCornerPosterSwitchBehindPosterText']),saveGame);return true;
  }
  if(s.map==='CELADON_MART_ROOF'&&s.dir==='up'&&y<=1){shopInventory(['FRESH_WATER','SODA_POP','LEMONADE']);return true;}
  if((s.map.includes('POKECENTER')||s.map==='REDS_HOUSE_2F')&&[0x93,0x1f].includes(cellAt(world,s,s.map,x,y,'tileIds'))){pcMenu();return true;}
  if(cellAt(world,s,s.map,x,y)===3){if(fieldAvailable('SURF'))say('The water is calm. Want to SURF?',()=>yesNo(()=>fieldMove('SURF')));else say('The water is deep blue.');return true;}
  if(['OVERWORLD','GYM'].includes(currentMap().tileset)&&[0x3d,0x50].includes(cellAt(world,s,s.map,x,y,'tileIds'))){fieldMove('CUT');return true;}
  return false;
}
function answerQuiz(gate,answer){const q=events.field.cinnabarQuiz;if(answer===gate.answerYes){s.flags[gate.flag]=true;syncGeometry(s,events);say(storyText(q.correct),saveGame);}else say(storyText(q.incorrect),()=>talkObject(currentMap().objects.find(o=>o.objectId===gate.trainerObjectId)));}
function pcMenu(){
  openMenu([{label:'DEPOSIT',action:()=>openMenu([...s.party.map((m,i)=>({label:pretty(m.species),disabled:s.party.length<=1,action:()=>{s.box.push(s.party.splice(i,1)[0]);heal(db,s.box);updatePanels();saveGame();pcMenu();}})),{label:'BACK',action:pcMenu}],'DEPOSIT POKéMON')},
    {label:'WITHDRAW',action:()=>openMenu([...s.box.map((m,i)=>({label:`${pretty(m.species)} L${m.level}`,disabled:s.party.length>=6,action:()=>{s.party.push(s.box.splice(i,1)[0]);updatePanels();saveGame();pcMenu();}})),{label:'BACK',action:pcMenu}],'WITHDRAW POKéMON')},{label:'CANCEL',action:()=>{}}],'POKéMON STORAGE');
}
function campaignVictory(trainer,done){
  syncGeometry(s,events);
  const gym=events.gyms.find(g=>g.objectId===trainer.key);if(gym){awardGym(s,gym);note(`Earned the ${gym.badge}BADGE.`);say(storyText(gym.victory),done);return;}
  const elite=events.league.find(g=>g.objectId===trainer.key);if(elite){say(storyText(elite.victory),done);return;}
  if(trainer.campaignRival){const r=events.rivals.find(r=>r.id===trainer.campaignRival);say(storyText(r.after),()=>{if(trainer.champion)hallOfFame();else done();});return;}
  if(trainer.key==='ROCKETHIDEOUTB4F_GIOVANNI'){questStage('rocketHideout','giovanniDefeated',done);return;}
  if(trainer.key==='SILPHCO11F_GIOVANNI'){questStage('silphGiovanni','defeated',done);return;}
  if(trainer.key==='CERULEANCITY_ROCKET'){s.bag.TM_DIG=(s.bag.TM_DIG||0)+1;say(storyText(['_CeruleanCityRocketReceivedTM28Text','_CeruleanCityRocketTM28ExplanationText'])||'RED recovered TM28!\n\nIt contains DIG!',done);return;}
  say(trainer.defeatText||`${trainer.name} was defeated!`,done);
}
function hallOfFame(){
  s.flags.champion=true;s.hallOfFame??=[];s.hallOfFame.push({party:structuredClone(s.party),steps:s.steps});
  music?.play('Music_HallOfFame');sceneText('hallOfFame',async()=>{
    await enterMap('HALL_OF_FAME',4,5,'up');music?.play('Music_Credits');
    say('POKéMON LEAGUE CHAMPION\n\nRED\n\n'+s.party.map(m=>`${pretty(m.species)} L${m.level}`).join('\n\n')+'\n\nTHE END',async()=>{heal(db,s.party);await enterMap('REDS_HOUSE_2F',3,6,'down');note('Entered the HALL OF FAME. Cerulean Cave is now open.');saveGame();});
  });
}
function campaignObjective(){
  if(s.flags.champion)return ['POKéMON LEAGUE CHAMPION','Explore Cerulean Cave, catch rare Pokémon, and fill your Pokédex.'];
  if(s.badges.length===8)return ['The Pokémon League.','Head west from Viridian through Route 22 and Victory Road. Challenge the Elite Four and your rival.'];
  if(!s.flags.EVENT_MET_BILL)return ['Beyond Mt. Moon.','Travel east from Pewter through Mt. Moon to Cerulean. Meet Bill north of Nugget Bridge.'];
  if(!s.bag.HM_CUT)return ['The S.S. Anne.','Take Bill’s ticket to Vermilion and visit the captain. Teach CUT from your bag.'];
  if(!s.bag.SILPH_SCOPE)return ['The Rocket hideout.','Explore Celadon’s Game Corner. Defeat the Rocket guarding the poster and find Giovanni.'];
  if(!s.bag.POKE_FLUTE)return ['The spirit in the tower.','Use the Silph Scope in Pokémon Tower. Rescue Mr. Fuji and visit his house.'];
  if(!s.bag.HM_SURF||!s.bag.HM_STRENGTH)return ['The Safari Zone.','Find the secret house and the Gold Teeth in Fuchsia’s Safari Zone. Visit the Warden.'];
  if(!s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI)return ['Save Silph Co.','Find the Card Key and confront Giovanni in Saffron City.'];
  const next=events.gyms.find(g=>!s.badges.includes(g.badge));return [`${s.badges.length} badges earned.`,`Your next badge is in ${world.maps[next.map].displayName}. Explore Kanto and prepare your team.`];
}

function rivalStarter(){return {BULBASAUR:'CHARMANDER',CHARMANDER:'SQUIRTLE',SQUIRTLE:'BULBASAUR'}[s.flags.starter];}
function storyText(keys,vars={}){
  return keys.map(key=>{
    let text=world.texts[key]||'';
    for(const [name,value] of Object.entries(vars))text=text.replaceAll('{'+name+'}',String(value));
    text=text.replace(/\{(?:wPlayerName|player)\}/g,'RED').replace(/\{(?:wRivalName|rival)\}/g,'BLUE').replace(/\{wStringBuffer\}/g,pretty(s?.flags.starter||'POKéMON'));
    return text;
  }).filter(Boolean).join('\n\n');
}
function sceneText(name,done){say(storyText(events.scenes[name]||[]),done);}
async function introScene(){
  sceneBusy=true;clearInput();await Promise.all([loadImage('assets/trainers/prof.oak.png'),loadImage(db.species.NIDORINO.front)]);
  introArt='assets/trainers/prof.oak.png';sceneBusy=true;music?.play('Music_Routes1');
  const stages=[{keys:['_OakSpeechText1']},{keys:['_OakSpeechText2A','_OakSpeechText2B'],art:db.species.NIDORINO.front},{keys:['_IntroducePlayerText','_IntroduceRivalText','_OakSpeechText3'],art:'assets/trainers/prof.oak.png'}];
  const next=()=>{const stage=stages.shift();if(!stage){introArt=null;sceneBusy=false;mapMusic();return;}if(stage.art)introArt=stage.art;say(storyText(stage.keys),next);};next();
}
function pathTo(from,to,ignoreObjects=false){
  const m=currentMap(),queue=[{x:from.x,y:from.y,path:[]}],seen=new Set([`${from.x},${from.y}`]);
  for(let i=0;i<queue.length;i++){
    const node=queue[i];if(node.x===to.x&&node.y===to.y)return node.path;
    for(const [dir,[dx,dy]]of Object.entries(vectors)){const x=node.x+dx,y=node.y+dy,key=`${x},${y}`;
      if(seen.has(key)||!passable(x,y,ignoreObjects))continue;
      if(m.warps.some(w=>w.x===x&&w.y===y)&&!(x===to.x&&y===to.y))continue;
      seen.add(key);queue.push({x,y,path:[...node.path,{x,y,dir}]});
    }
  }
  return [];
}
async function escortPlayer(to,actor=null){
  const path=pathTo(s,to,true);
  for(let i=0;i<path.length;i++){
    const next=path[i],lead=path[Math.min(i+1,path.length-1)];s.dir=next.dir;
    const actors=actor?[{sprite:actor,from:{x:actor.x,y:actor.y},to:lead}]:[];
    if(actor)actor.direction=lead.dir;
    await playFx({type:'escort',from:{x:s.x,y:s.y},to:next,actors},STEP_MS);
    s.x=next.x;s.y=next.y;if(actor){actor.x=lead.x;actor.y=lead.y;}
  }
}
function meetOak(){
  if(sceneBusy)return;clearInput();sceneBusy=true;music?.play('Music_MeetProfOak');
  const oak={objectId:'PALLETTOWN_OAK',sprite:'SPRITE_OAK',x:8,y:5,direction:'up'};sceneSprites=[oak];
  say(storyText(['_PalletTownOakHeyWaitDontGoOutText']),async()=>{
    const path=pathTo(oak,{x:s.x,y:s.y+1},true);
    for(const next of path){oak.direction=next.dir;await playFx({type:'escort',from:{x:s.x,y:s.y},to:{x:s.x,y:s.y},actors:[{sprite:oak,from:{x:oak.x,y:oak.y},to:next}]},STEP_MS);oak.x=next.x;oak.y=next.y;}
    s.dir='down';oak.direction='up';
    say(storyText(['_PalletTownOakItsUnsafeText']),async()=>{
      await escortPlayer({x:12,y:12},oak);sceneSprites=[];s.flags.metOak=true;
      await enterMap('OAKS_LAB',5,10,'up');await escortPlayer({x:5,y:6});
      sceneText('oakLabIntroduction',()=>{sceneBusy=false;note('Professor Oak offered you a partner.');saveGame();});
    });
  });
}
function chooseStarter(species){
  starterPreview=species;loadImage(db.species[species].front);
  const key='choose'+species[0]+species.slice(1).toLowerCase();
  sceneText(key,()=>openMenu([{label:'YES',action:()=>{
    starterPreview=null;sceneBusy=true;const mon=makeMon(db,species,5,random);s.party=[mon];s.flags.starter=species;s.caught.push(species);s.seen.push(species);
    note(`Chose ${pretty(species)} as a partner.`);
    say([storyText(['_OaksLabMonEnergeticText']),`RED received\na ${pretty(species)}!`,storyText(['_OaksLabRivalIllTakeThisOneText']),`BLUE received\na ${pretty(rivalStarter())}!`],()=>{sceneBusy=false;updatePanels();saveGame();});
  }},{label:'NO',action:()=>{starterPreview=null;}}],'CHOOSE PARTNER'));
}
function deliverParcel(){
  sceneBusy=true;sceneText('oakParcel',()=>{s.flags.parcel=false;s.flags.pokedex=true;s.flags.EVENT_GOT_POKEDEX=true;delete s.bag.OAKS_PARCEL;sceneBusy=false;note('Received the POKéDEX. Visit Daisy for a town map.');saveGame();});
}
function healScene(o){
  if(o.sprite==='SPRITE_MOM'){
    if(!s.party.length){say(storyText(['_RedsHouse1FMomWakeUpText']));return;}
    say(storyText(['_RedsHouse1FMomYouShouldRestText']),async()=>{music?.play('Music_PkmnHealed');await playFx({type:'fade'},1800);heal(db,s.party);mapMusic();say(storyText(['_RedsHouse1FMomLookingGreatText']),saveGame);updatePanels();});return;
  }
  say(storyText(['_PokemonCenterWelcomeText','_ShallWeHealYourPokemonText'])||'Welcome to our POKéMON CENTER!\n\nShall we heal your POKéMON?',()=>openMenu([{label:'YES',action:()=>{
    say(storyText(['_NeedYourPokemonText'])||'OK. We will need your POKéMON.',async()=>{music?.play('Music_PkmnHealed');await playFx({type:'fade'},2300);heal(db,s.party);s.checkpoint={map:s.map,x:s.x,y:s.y};mapMusic();say(storyText(['_PokemonFightingFitText','_PokemonCenterFarewellText'])||'Your POKéMON are fighting fit!\n\nWe hope to see you again!',saveGame);updatePanels();});
  }},{label:'NO',action:()=>say(storyText(['_PokemonCenterFarewellText'])||'We hope to see you again!')}],'HEAL POKéMON?'));
}
function say(text,done){
  clearInput();menu=null;
  dialogue=new TextPager(Array.isArray(text)?text.join('\n\n'):text,performance.now(),{speed:settings.textSpeed,protectedText:settings.protectedText});
  dialogue.done=done;$('#transcript').textContent=dialogue.pages[0].join(' ');
  actions([{label:'Continue · Z',action:advance}]);beep();
}
function advance(){
  if(!dialogue||fx)return;
  const result=dialogue.confirm(performance.now());
  if(result==='wait')return;beep();
  if(result==='done'){const done=dialogue.done;dialogue=null;$('#transcript').textContent='';actions([]);done?.();}
  else $('#transcript').textContent=dialogue.pages[dialogue.index].join(' ');
}
function actions(items){const el=$('#game-actions');el.replaceChildren();items.forEach(item=>{const b=document.createElement('button');b.textContent=item.label;b.disabled=!!item.disabled;b.onclick=()=>{if(!item.disabled)item.action();focusGame();};el.append(b);});}
function openMenu(items,title='MENU'){clearInput();dialogue=null;menu={items,index:0,title};actions(items);}
function selectMenu(index){if(!menu)return;const item=menu.items[index];if(!item||item.disabled)return;menu=null;actions([]);beep();item.action();}
function pauseMenu(){if(battle||dialogue||motion.step||sceneBusy||fx)return;clearInput();if(menu){menu=null;actions([]);return;}openMenu([{label:'POKéMON',action:()=>partyMenu()},{label:'BAG',action:()=>bagMenu()},{label:'PC STORAGE',disabled:!s.map.includes('POKECENTER')&&s.map!=='REDS_HOUSE_2F',action:pcMenu},{label:'POKéDEX',action:()=>say(`POKéMON seen: ${s.seen.length}\n\nPOKéMON owned: ${s.caught.length}`)},{label:'SAVE',action:()=>{saveGame();say('Your adventure has been saved.');}},{label:'CLOSE',action:()=>{}}]);}
async function beginBattle(team,trainer,options={}){
  if(!s.party.some(m=>m.hp>0)){say('Your POKéMON need rest. Visit a POKéMON CENTER.');return;}
  const frame=document.createElement('canvas');frame.width=160;frame.height=144;drawWorld(performance.now());frame.getContext('2d').drawImage(canvas,0,0);
  clearInput();menu=null;dialogue=null;motion.clear();sceneBusy=false;
  battle={team:team.map(m=>makeMon(db,m.species,m.level,random)),index:0,active:s.party.findIndex(m=>m.hp>0),trainer,turns:0,runAttempts:0,hidden:new Set(),safari:!!s.flags.EVENT_IN_SAFARI_ZONE,...options};
  for(const m of s.party){clearVolatile(m);shownHp.set(m,m.hp);}
  const e=battle.team[0],a=s.party[battle.active];shownHp.set(e,e.hp);s.seen=[...new Set([...s.seen,e.species])];
  await Promise.all([loadImage(db.species[e.species].front),loadImage(db.species[a.species].back)]);
  music?.play(trainer?.champion?'Music_FinalBattle':trainer?.gym?'Music_GymLeaderBattle':trainer?'Music_TrainerBattle':'Music_WildBattle');
  await playFx({type:'encounter',frame},850);await playFx({type:'entrance'},550);
  say(trainer?`${trainer.name} wants to fight!\n\n${trainer.name} sent out ${pretty(e.species)}!\n\nGo! ${pretty(a.species)}!`:`Wild ${pretty(e.species)} appeared!\n\nGo! ${pretty(a.species)}!`,battleMenu);updatePanels();
}
function battleMenu(){if(!battle)return;if(battle.safari){openMenu([{label:`BALL ×${s.safariBalls}`,action:()=>capture('SAFARI_BALL')},{label:'BAIT',action:()=>say('RED threw some BAIT!',safariTurn)},{label:'ROCK',action:()=>say('RED threw a ROCK!',safariTurn)},{label:'RUN',action:runBattle}],'SAFARI');return;}openMenu([{label:'FIGHT',action:moveMenu},{label:'BAG',action:()=>bagMenu(true)},{label:'POKéMON',action:()=>partyMenu(true)},{label:'RUN',action:runBattle}],'BATTLE');}
function moveMenu(){const mon=s.party[battle.active];openMenu([...mon.moves.map((m,i)=>({label:`${pretty(m.id)} ${m.pp}/${db.moves[m.id].pp}`,disabled:m.pp<=0&&mon.moves.some(x=>x.pp>0),action:()=>battleTurn(i)})),{label:'BACK',action:battleMenu}],'CHOOSE A MOVE');}
function speed(m){return m.stats.speed*stageMultiplier(m.stages.speed)*(m.status==='PAR'?.25:1);}
function battleTurn(index){if(!battle)return;const a=s.party[battle.active],e=battle.team[battle.index];a.flinched=false;e.flinched=false;const valid=e.moves.map((m,i)=>m.pp>0?i:-1).filter(x=>x>=0);const enemyIndex=valid[random.int(valid.length)]??0;const aPriority=a.moves[index]?.id==='QUICK_ATTACK',ePriority=e.moves[enemyIndex]?.id==='QUICK_ATTACK';const first=aPriority!==ePriority?aPriority:speed(a)===speed(e)?random.int(2)===0:speed(a)>speed(e);const turns=first?[[a,e,index],[e,a,enemyIndex]]:[[e,a,enemyIndex],[a,e,index]];runTurns(turns);}
function runTurns(turns){
  if(!battle)return;
  if(!turns.length){
    const a=s.party[battle.active],e=battle.team[battle.index],oldA=a.hp,oldE=e.hp;
    const logs=[...endTurn(a,e),...endTurn(e,a)];battle.turns++;
    animateHp([{mon:a,from:oldA,to:a.hp},{mon:e,from:oldE,to:e.hp}]).then(()=>{updatePanels();if(logs.length)say(logs,()=>checkFaint(battleMenu));else checkFaint(battleMenu);});return;
  }
  const [a,d,index]=turns.shift();if(a.hp<=0||d.hp<=0){checkFaint(battleMenu);return;}
  const oldA=a.hp,oldD=d.hp,move=db.moves[a.moves[index]?.id]||db.moves.STRUGGLE;
  const logs=useMove(db,a,d,index,random);shownHp.set(a,oldA);shownHp.set(d,oldD);
  say(logs[0],async()=>{
    if(logs[0].includes(' used ')){await playFx({type:'attack',actor:a,target:d,style:animationStyle(move),hit:d.hp<oldD},650);if(d.hp<oldD)music?.effect('hit');}
    await animateHp([{mon:a,from:oldA,to:a.hp},{mon:d,from:oldD,to:d.hp}]);updatePanels();
    const next=()=>{if(a.escapeRequested){delete a.escapeRequested;if(!battle.trainer&&!battle.cannotCatch){battle=null;mapMusic();say('The battle ended!',saveGame);return;}}if(a.hp<=0||d.hp<=0)checkFaint(battleMenu);else runTurns(turns);};
    if(logs.length>1)say(logs.slice(1),next);else next();
  });
}
function enemyTurn(){if(!battle)return;const e=battle.team[battle.index];const valid=e.moves.map((m,i)=>m.pp>0?i:-1).filter(i=>i>=0);runTurns([[e,s.party[battle.active],valid[random.int(valid.length)]??0]]);}
async function checkFaint(next){
  if(!battle)return;const a=s.party[battle.active],e=battle.team[battle.index];
  if(e.hp<=0){
    await playFx({type:'faint',mon:e},450);battle.hidden.add(e);
    const logs=[`${pretty(e.species)} fainted!`,...addExperience(db,a,e,!!battle.trainer,true)];
    shownHp.set(a,a.hp);say(logs,async()=>{battle.index++;if(battle.index<battle.team.length){
      const n=battle.team[battle.index];s.seen=[...new Set([...s.seen,n.species])];shownHp.set(n,n.hp);await loadImage(db.species[n.species].front);
      await playFx({type:'sendOut',mon:n},450);say(`${battle.trainer.name} sent out ${pretty(n.species)}!`,()=>checkFaint(battleMenu));
    }else finishBattle(true);});return;
  }
  if(a.hp<=0){await playFx({type:'faint',mon:a},450);battle.hidden.add(a);say(`${pretty(a.species)} fainted!`,()=>{if(s.party.some(m=>m.hp>0)){battle.forcedSwitch=true;partyMenu(true);}else finishBattle(false);});return;}
  next();
}
let currentShop=[];
function shop(o){if(!s.flags.pokedex&&s.map==='VIRIDIAN_MART'){say('Deliver the parcel to PROF.OAK first.');return;}shopInventory(events.marts[o?.objectId]||currentShop);}
function shopInventory(items){currentShop=items;openMenu([...items.map(item=>({label:`${pretty(item)} ¥${events.items[item]?.price||0}`,action:()=>buy(item,events.items[item]?.price||0)})),{label:'CANCEL',action:()=>{}}],'POKéMON MART');}
function buy(item,price){if(s.money<price){say("You don't have enough money!",()=>shopInventory(currentShop));return;}s.money-=price;s.bag[item]=(s.bag[item]||0)+1;say(`Bought ${pretty(item)}!\n\nYou have ${s.bag[item]}.`,()=>{saveGame();shopInventory(currentShop);});updatePanels();}
function bagMenu(inBattle=false){const items=Object.keys(s.bag).filter(k=>s.bag[k]>0).map(k=>({label:`${pretty(k)} ×${s.bag[k]}`,action:()=>useItem(k,inBattle)}));items.push({label:'CANCEL',action:()=>inBattle?battleMenu():null});openMenu(items,'BAG');}
function useItem(item,inBattle=false){
  if(/^(POKE|GREAT|ULTRA|MASTER|SAFARI)_BALL$/.test(item)){if(!inBattle){say('Use POKé BALLs in a wild battle.');return;}capture(item);return;}
  if(events.machines[item]){if(inBattle){say('This cannot be used in battle.',battleMenu);return;}teachMachine(item);return;}
  if(item==='POKE_FLUTE'){if(inBattle){for(const m of [...s.party,...battle.team])if(m.status==='SLP'){m.status=null;m.sleep=0;}say('The POKé FLUTE awakened sleeping POKéMON!',enemyTurn);}else{const [dx,dy]=vectors[s.dir],o=visibleObjects().find(o=>o.x===s.x+dx&&o.y===s.y+dy&&o.objectId.includes('SNORLAX'));if(o)campaignObject(o);else say('RED played the POKé FLUTE.\n\nThat’s a catchy tune!');}return;}
  if(inBattle&&['BICYCLE','TOWN_MAP','ESCAPE_ROPE','OLD_ROD','GOOD_ROD','SUPER_ROD'].includes(item)){say('This cannot be used here.',battleMenu);return;}
  if(item==='TOWN_MAP'){say(s.visited.filter(id=>world.maps[id]?.outdoor).map(id=>world.maps[id].displayName).join('\n\n'));return;}
  if(item==='BICYCLE'){if(!currentMap().outdoor){say('You cannot cycle here.');return;}s.cycling=!s.cycling;if(s.cycling)music?.play('Music_BikeRiding');else mapMusic();say(s.cycling?'RED got on the BICYCLE!':'RED got off the BICYCLE!');return;}
  if(item==='ESCAPE_ROPE'){if(currentMap().outdoor){say('You cannot use it here.');return;}s.bag[item]--;enterMap(s.checkpoint.map,s.checkpoint.x,s.checkpoint.y,'down');return;}
  if(['REPEL','SUPER_REPEL','MAX_REPEL'].includes(item)){s.bag[item]--;s.repelSteps={REPEL:100,SUPER_REPEL:200,MAX_REPEL:250}[item];say(`${pretty(item)} was used!`);return;}
  if(item.endsWith('_ROD')){const [dx,dy]=vectors[s.dir];if(cellAt(world,s,s.map,s.x+dx,s.y+dy)!==3){say('You can only fish by water.');return;}const pick=item==='OLD_ROD'?{species:'MAGIKARP',level:5}:item==='GOOD_ROD'?{species:random.int(2)?'GOLDEEN':'POLIWAG',level:10}:(db.wild[s.map]?.water||[{species:'GOLDEEN',level:15}])[random.int(10)]||{species:'GOLDEEN',level:15};say('Oh! It’s a bite!',()=>beginBattle([pick],null));return;}
  const healing={POTION:20,SUPER_POTION:50,HYPER_POTION:200,MAX_POTION:999,FULL_RESTORE:999,FRESH_WATER:50,SODA_POP:60,LEMONADE:80};
  const cures={ANTIDOTE:'PSN',BURN_HEAL:'BRN',ICE_HEAL:'FRZ',AWAKENING:'SLP',PARLYZ_HEAL:'PAR'};
  const vitamins={HP_UP:'hp',PROTEIN:'attack',IRON:'defense',CARBOS:'speed',CALCIUM:'special'};
  const usable=healing[item]||cures[item]||vitamins[item]||['FULL_HEAL','REVIVE','MAX_REVIVE','RARE_CANDY','ETHER','MAX_ETHER','ELIXER','MAX_ELIXER'].includes(item)||item.endsWith('_STONE');
  if(!usable){say('This is a key item. Keep it for your journey.',()=>inBattle?battleMenu():null);return;}
  openMenu([...s.party.map(m=>({label:`${pretty(m.species)} ${m.hp}/${m.stats.hp}`,action:()=>{
    const old=m.hp;let applied=false;
    if(healing[item]&&m.hp>0&&(m.hp<m.stats.hp||(item==='FULL_RESTORE'&&m.status))){m.hp=Math.min(m.stats.hp,m.hp+healing[item]);if(item==='FULL_RESTORE')m.status=null;applied=true;}
    if((cures[item]===m.status||item==='FULL_HEAL')&&m.status){m.status=null;m.sleep=0;applied=true;}
    if(['REVIVE','MAX_REVIVE'].includes(item)&&m.hp===0){m.hp=item==='REVIVE'?Math.max(1,Math.floor(m.stats.hp/2)):m.stats.hp;applied=true;}
    if(vitamins[item]&&(m.evs[vitamins[item]]||0)<25600){m.evs[vitamins[item]]=Math.min(25600,(m.evs[vitamins[item]]||0)+2560);const oldMax=m.stats.hp;m.stats=statsFor(db.species[m.species].stats,m.level,m.dvs,m.evs);m.hp+=m.stats.hp-oldMax;applied=true;}
    if(item==='RARE_CANDY'&&m.level<100){m.exp=experience(m.level+1,db.species[m.species].growth);const dummy={species:'MAGIKARP',level:0};addExperience(db,m,dummy,false,true);applied=true;}
    if(['ETHER','MAX_ETHER','ELIXER','MAX_ELIXER'].includes(item)){const targets=item.includes('ELIXER')?m.moves:m.moves.filter(move=>move.pp<db.moves[move.id].pp).slice(0,1);for(const slot of targets){const max=db.moves[slot.id].pp;if(slot.pp<max){slot.pp=Math.min(max,slot.pp+(item.startsWith('MAX')?max:10));applied=true;}}}
    const evo=db.species[m.species].evolutions.find(e=>e.method==='item'&&e.item===item);
    if(evo&&!inBattle){s.bag[item]--;evolveMon(m,evo.species,saveGame);return;}
    if(!applied){say("It won't have any effect.",()=>bagMenu(inBattle));return;}
    s.bag[item]--;shownHp.set(m,old);
    say(`${pretty(item)} was used on ${pretty(m.species)}!`,async()=>{await animateHp([{mon:m,from:old,to:m.hp}]);updatePanels();if(inBattle)enemyTurn();else processGrowth(saveGame);});
  }})),{label:'CANCEL',action:()=>bagMenu(inBattle)}],'USE ON WHICH?');
}
function teachMachine(item){
  const machine=events.machines[item];openMenu([...s.party.map(m=>({label:`${pretty(m.species)}${events.machineCompatibility[m.species]?.includes(machine.move)?'':' / UNABLE'}`,disabled:!events.machineCompatibility[m.species]?.includes(machine.move),action:()=>learnMove(m,machine.move,learned=>{if(learned&&!machine.reusable)s.bag[item]--;saveGame();})})),{label:'CANCEL',action:()=>{}}],`TEACH ${machine.move}`);
}
function learnMove(mon,id,done){
  if(mon.moves.some(m=>m.id===id)){say(`${pretty(mon.species)} already knows ${pretty(id)}.`,()=>done?.(false));return;}
  const learn=index=>{if(index!==undefined)mon.moves.splice(index,1);mon.moves.push({id,pp:db.moves[id].pp});say(`${pretty(mon.species)} learned ${pretty(id)}!`,()=>done?.(true));};
  if(mon.moves.length<4){learn();return;}
  say(`${pretty(mon.species)} wants to learn ${pretty(id)}!\n\nBut it already knows four moves. Forget a move?`,()=>yesNo(()=>openMenu([...mon.moves.map((m,i)=>({label:pretty(m.id),disabled:Object.values(events.machines).some(t=>t.reusable&&t.move===m.id),action:()=>learn(i)})),{label:'CANCEL',action:()=>done?.(false)}],'FORGET WHICH?'),()=>done?.(false)));
}
function processGrowth(done){
  for(const mon of s.party){if(mon.pendingMoves?.length){const id=mon.pendingMoves.shift();learnMove(mon,id,()=>processGrowth(done));return;}
    const evo=db.species[mon.species].evolutions.find(e=>e.method==='level'&&mon.level>=e.level);if(evo&&mon.hp>0){evolveMon(mon,evo.species,()=>processGrowth(done));return;}}
  done?.();
}
function evolveMon(mon,species,done){
  const before=mon.species;say(`What? ${pretty(before)} is evolving!`,async()=>{await loadImage(db.species[species].front);starterPreview=before;await loadImage(db.species[before].front);for(let i=0;i<6;i++){starterPreview=i%2?species:before;await playFx({type:'fade'},220);}starterPreview=null;
    const old=mon.stats.hp;mon.species=species;mon.stats=statsFor(db.species[species].stats,mon.level,mon.dvs,mon.evs);mon.hp=Math.max(1,mon.hp+mon.stats.hp-old);shownHp.set(mon,mon.hp);s.caught=[...new Set([...s.caught,species])];s.seen=[...new Set([...s.seen,species])];updatePanels();say(`Congratulations! Your ${pretty(before)} evolved into ${pretty(species)}!`,done);
  });
}
function partyMenu(inBattle=false){
  const opts=s.party.map((m,i)=>({label:`${pretty(m.species)} L${m.level} ${m.hp}/${m.stats.hp}`,disabled:m.hp<=0&&inBattle,action:async()=>{
    if(inBattle){const cost=battle.active!==i&&!battle.forcedSwitch;battle.active=i;battle.forcedSwitch=false;battle.hidden.delete(m);await loadImage(db.species[m.species].back);shownHp.set(m,m.hp);await playFx({type:'sendOut',mon:m},450);say(`Go! ${pretty(m.species)}!`,()=>cost?enemyTurn():battleMenu());}
    else openMenu([{label:'LEAD PARTY',action:()=>{[s.party[0],s.party[i]]=[s.party[i],s.party[0]];updatePanels();saveGame();}},...m.moves.filter(slot=>events.field.badgeRequirements[slot.id]).map(slot=>({label:slot.id,action:()=>fieldMove(slot.id)})),{label:'SUMMARY',action:()=>say(`${pretty(m.species)} L${m.level}\n\nHP ${m.hp}/${m.stats.hp}\n\n`+m.moves.map(slot=>`${pretty(slot.id)} ${slot.pp}/${db.moves[slot.id].pp}`).join('\n\n'))},{label:'BACK',action:()=>partyMenu()}],'POKéMON');
  }}));if(!battle?.forcedSwitch)opts.push({label:'CANCEL',action:()=>inBattle?battleMenu():null});openMenu(opts,'POKéMON');
}
function finishBattle(won){
  const ended=battle,trainer=ended.trainer;music?.play(trainer?.gym?'Music_DefeatedGymLeader':trainer?'Music_DefeatedTrainer':'Music_DefeatedWildMon');
  const highest=Math.max(...ended.team.map(m=>m.level));battle=null;menu=null;for(const m of s.party){clearVolatile(m);if(won){s.money+=m.payDay||0;m.payDay=0;}}
  const done=()=>processGrowth(()=>{mapMusic();saveGame();updatePanels();});
  if(trainer?.rival){s.flags.rival=true;heal(db,s.party);s.money+=won?175:-Math.min(s.money,175);sceneText(won?'rivalLabWon':'rivalLabLost',()=>{note('First rival battle completed. Visit Viridian City.');done();});}
  else if(!won){s.money=Math.floor(s.money/2);for(const l of events.league)delete s.defeated[l.objectId];say('RED is out of usable POKéMON!\n\nRED blacked out!',()=>{heal(db,s.party);enterMap(s.checkpoint.map,s.checkpoint.x,s.checkpoint.y,'down').then(saveGame);});}
  else if(trainer){s.defeated[trainer.key]=true;const reward=highest*(db.trainerMetadata[trainer.class||trainer.name.replaceAll(' ','_')]?.rewardPerLevel||10);s.money+=reward;campaignVictory(trainer,()=>say(`RED got ¥${reward} for winning!`,done));}
  else{if(ended.stationary)s.collected[ended.stationary]=true;if(ended.quest)questStage(ended.quest,ended.quest==='marowak'?'defeated':'after',done);else done();}
  updatePanels();
}
async function capture(item='POKE_BALL'){
  if(battle.trainer){say("You can't catch another trainer's POKéMON!",battleMenu);return;}
  if(battle.cannotCatch){say('The ghost cannot be caught!',battleMenu);return;}
  const safari=!!battle.safari;if(safari){if(s.safariBalls<=0){battle=null;endSafari();return;}s.safariBalls--;}else if(!s.bag[item]){battleMenu();return;}else s.bag[item]--;
  const e=battle.team[battle.index],rate=db.species[e.species].catchRate,multiplier={POKE_BALL:1,GREAT_BALL:1.5,ULTRA_BALL:2,SAFARI_BALL:1.5}[item]||1;
  const chance=Math.min(.95,rate/255*(1-e.hp/e.stats.hp*.65)*multiplier+(e.status ? .15 : 0));
  const caught=item==='MASTER_BALL'||random.next()<chance;
  await playFx({type:'capture',mon:e},1500);
  if(caught){const ended=battle,mon=structuredClone(e);mon.stages={};mon.seeded=false;const boxed=s.party.length>=6;(boxed?s.box:s.party).push(mon);s.caught=[...new Set([...s.caught,e.species])];if(ended.stationary)s.collected[ended.stationary]=true;battle=null;menu=null;mapMusic();say(`Gotcha! ${pretty(e.species)} was caught!${boxed?'\n\nSent to the storage box.':''}`,()=>{note(`Caught ${pretty(e.species)}.`);if(ended.quest)questStage(ended.quest,'after',saveGame);else saveGame();});updatePanels();}
  else say('Oh no! The POKéMON broke free!',()=>safari?safariTurn():enemyTurn());
}
function safariTurn(){if(random.int(4)===0){battle=null;say('The wild POKéMON fled!',()=>{mapMusic();if(!s.safariBalls)endSafari();});}else if(!s.safariBalls){battle=null;endSafari();}else battleMenu();}

function runBattle(){if(battle.trainer){say("No! There's no running from a TRAINER battle!",battleMenu);return;}battle.runAttempts++;const a=s.party[battle.active],e=battle.team[battle.index];const denom=Math.max(1,Math.floor(e.stats.speed/4)%256),odds=Math.floor(a.stats.speed*32/denom)+30*battle.runAttempts;if(random.int(256)<odds){battle=null;menu=null;mapMusic();say('Got away safely!',saveGame);}else say("Can't escape!",enemyTurn);}
function text(str,x,y){str=str.replaceAll('₽','¥').replaceAll('…','...');const font=img(world.font.image);for(const ch of str){const glyph=world.font.glyphs[ch]??world.font.glyphs[ch.toUpperCase()]??world.font.glyphs['?'];if(ch!==' '&&glyph!==undefined&&font?.complete)ctx.drawImage(font,(glyph%16)*8,Math.floor(glyph/16)*8,8,8,x,y,8,8);x+=8;}}
function box(x,y,w,h){ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,h-1);ctx.strokeRect(x+2.5,y+2.5,w-5,h-5);}
function drawSprite(sprite,x,y,dir='down',moving=false){const def=world.sprites[sprite]||world.sprites.SPRITE_RED,im=img(def.image);if(!im?.complete)return;let row={down:0,up:1,left:2,right:2}[dir]||0;if(moving&&def.frames>=6&&Math.floor(performance.now()/85)%2)row+=3;if(row>=def.frames)row=0;ctx.save();if(dir==='right'){ctx.translate(x+16,y);ctx.scale(-1,1);ctx.drawImage(im,0,row*16,16,16,0,0,16,16);}else ctx.drawImage(im,0,row*16,16,16,x,y,16,16);ctx.restore();}
function drawWorld(now){const m=currentMap();let sample=motion.sample(now);if(fx?.type==='escort'){const t=clamp((now-fx.at)/fx.duration);sample={x:fx.from.x+(fx.to.x-fx.from.x)*t,y:fx.from.y+(fx.to.y-fx.from.y)*t,jump:0};for(const actor of fx.actors||[]){actor.sprite.x=actor.from.x+(actor.to.x-actor.from.x)*t;actor.sprite.y=actor.from.y+(actor.to.y-actor.from.y)*t;}}const px=(sample?.x??s.x)*16,py=(sample?.y??s.y)*16,moving=!!sample,jump=sample?.jump||0;
  const cx=Math.round(px-72),cy=Math.round(py-64);ctx.fillStyle='#fff';ctx.fillRect(0,0,160,144);const border=img(m.borderImage);if(border?.complete){for(let y=-32-(cy%32);y<144;y+=32)for(let x=-32-(cx%32);x<160;x+=32)ctx.drawImage(border,x,y);}
  for(const c of m.connections){const n=world.maps[c.target],im=n&&img(n.image);if(!im?.complete)continue;let x=0,y=0;if(c.direction==='north'){x=c.offset*32;y=-n.height*16;}if(c.direction==='south'){x=c.offset*32;y=m.height*16;}if(c.direction==='west'){x=-n.width*16;y=c.offset*32;}if(c.direction==='east'){x=m.width*16;y=c.offset*32;}ctx.drawImage(im,x-cx,y-cy);}
  const image=img(m.image);if(image?.complete)ctx.drawImage(image,-cx,-cy);const atlas=img(world.tilesets[m.tileset].blockAtlas);if(atlas?.complete)for(const [key,block]of Object.entries(s.mapEdits?.[s.map]||{})){const [bx,by]=key.split(',').map(Number);ctx.drawImage(atlas,block%16*32,Math.floor(block/16)*32,32,32,bx*32-cx,by*32-cy,32,32);}
  const entities=visibleObjects().filter(o=>!sceneSprites.some(p=>p.objectId===o.objectId)).map(o=>({...o,player:false}));entities.push(...sceneSprites.map(p=>({...p,player:false})));entities.push({x:px/16,y:py/16,sprite:'SPRITE_RED',direction:s.dir,player:true});entities.sort((a,b)=>a.y-b.y);for(const o of entities)drawSprite(o.sprite,Math.round(o.x*16-cx),Math.round(o.y*16-cy-4-(o.player?jump:0)),String(o.direction||'DOWN').toLowerCase(),o.player&&moving);
  if(!exploreHome&&s.map.startsWith('ROCK_TUNNEL')&&!s.flags.flashTunnel){ctx.save();ctx.fillStyle='#000';ctx.beginPath();ctx.rect(0,0,160,144);ctx.ellipse(80,72,24,24,0,0,Math.PI*2);ctx.fill('evenodd');ctx.restore();}
}
function displayHp(mon,now=presentationClock){
  if(fx?.type==='hp'){const tween=fx.changes.find(c=>c.mon===mon);if(tween)return hpAt(tween.from,tween.to,fx.at,fx.duration,now);}
  return shownHp.get(mon)??mon.hp;
}
function hpBar(mon,x,y,w=48){ctx.fillStyle='#000';ctx.fillRect(x,y,w,4);ctx.fillStyle='#fff';ctx.fillRect(x+1,y+1,w-2,2);ctx.fillStyle='#000';ctx.fillRect(x+1,y+1,Math.max(0,Math.ceil((w-2)*displayHp(mon)/mon.stats.hp)),2);}
function playFx(effect,duration=600){
  clearInput();actions([]);
  if(!settings.battleAnimations&&['attack','encounter','entrance','sendOut','faint','capture'].includes(effect.type))return Promise.resolve();
  return new Promise(done=>{fx={...effect,at:performance.now(),duration,done};});
}
async function animateHp(changes){
  changes=changes.filter(c=>c.from!==c.to);if(!changes.length)return;
  for(const c of changes)shownHp.set(c.mon,c.from);
  await playFx({type:'hp',changes},Math.min(1100,300+Math.max(...changes.map(c=>Math.abs(c.to-c.from)))*12));
  for(const c of changes)shownHp.set(c.mon,c.to);
}
function drawBattle(now){
  ctx.fillStyle='#fff';ctx.fillRect(0,0,160,144);
  const e=battle.team[battle.index],a=s.party[battle.active];if(!e||!a)return;
  const progress=fx?clamp((now-fx.at)/fx.duration):1;
  text(pretty(e.species).slice(0,10),0,0);text(`:L${e.level}`,24,10);if(e.status)text(e.status,56,10);hpBar(e,18,22,62);
  function sprite(mon,enemy){
    if(battle.hidden?.has(mon))return;
    const im=img(db.species[mon.species][enemy?'front':'back']);if(!im?.complete)return;
    const w=enemy?im.width:im.width<=32?im.width*2:im.width,h=enemy?im.height:im.height<=32?im.height*2:im.height;
    let x=enemy?96+(56-w)/2:4+(64-w)/2,y=enemy?4+(56-h)/2:96-h;
    if(fx?.type==='entrance')x+=(enemy?1:-1)*100*(1-progress);
    if(fx?.type==='sendOut'&&fx.mon===mon){const scale=clamp(progress*1.6);ctx.drawImage(im,Math.round(x+w*(1-scale)/2),Math.round(y+h*(1-scale)),Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));return;}
    if(fx?.type==='capture'&&enemy){if(progress>.25)return;}
    if(fx?.type==='attack'){
      if(fx.actor===mon&&fx.style==='physical')x+=(enemy?-1:1)*Math.sin(Math.min(1,progress*2)*Math.PI)*12;
      if(fx.target===mon&&progress>.48&&fx.hit){if(Math.floor(progress*24)%2===0)return;x+=Math.sin(progress*70)*2;}
    }
    if(fx?.type==='faint'&&fx.mon===mon){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();y+=progress*h;ctx.drawImage(im,Math.round(x),Math.round(y),w,h);ctx.restore();return;}
    ctx.drawImage(im,Math.round(x),Math.round(y),w,h);
  }
  sprite(e,true);sprite(a,false);
  text(pretty(a.species).slice(0,10),80,54);text(`:L${a.level}`,104,64);if(a.status)text(a.status,80,64);hpBar(a,94,76,60);
  text(`${String(Math.ceil(displayHp(a,now))).padStart(3)} /${String(a.stats.hp).padStart(3)}`,88,84);box(0,96,160,48);
}
function drawFx(now){
  if(!fx)return;const t=clamp((now-fx.at)/fx.duration);
  if(fx.type==='encounter'){
    ctx.drawImage(fx.frame,0,0);ctx.fillStyle='#000';
    if(t<.3){ctx.globalAlpha=Math.sin(t/.3*Math.PI*3)**2*.8;ctx.fillRect(0,0,160,144);ctx.globalAlpha=1;}
    else for(let y=0;y<144;y+=8){const amount=clamp((t-.3)*2-(y/144)*.3);ctx.fillRect(y%16===0?0:160-160*amount,y,160*amount,8);}
  }else if(fx.type==='fade'){ctx.fillStyle='#000';ctx.globalAlpha=Math.sin(t*Math.PI);ctx.fillRect(0,0,160,144);ctx.globalAlpha=1;}
  else if(fx.type==='capture'){
    const travel=clamp(t/.3),x=20+travel*101,y=88-travel*48-Math.sin(travel*Math.PI)*44;
    const shake=travel===1?Math.sin(t*60)*Math.max(0,4*(1-t)):0;
    ctx.fillStyle='#fff';ctx.fillRect(Math.round(x+shake)-4,Math.round(y)-4,8,8);ctx.strokeStyle='#000';ctx.strokeRect(Math.round(x+shake)-4.5,Math.round(y)-4.5,9,9);ctx.fillStyle='#000';ctx.fillRect(Math.round(x+shake)-4,Math.round(y)-4,8,4);
  }else if(fx.type==='attack'&&battle){
    const enemy=fx.actor===battle.team[battle.index],from=enemy?[120,34]:[36,76],to=enemy?[36,76]:[120,34],flight=clamp(t*2),x=from[0]+(to[0]-from[0])*flight,y=from[1]+(to[1]-from[1])*flight;
    ctx.fillStyle='#000';ctx.strokeStyle='#000';ctx.lineWidth=1;
    if(fx.style==='physical'&&t>.42&&t<.8&&fx.hit){for(let i=0;i<8;i++){const angle=i*Math.PI/4;ctx.beginPath();ctx.moveTo(to[0]+Math.cos(angle)*3,to[1]+Math.sin(angle)*3);ctx.lineTo(to[0]+Math.cos(angle)*(8+Math.sin(t*30)*4),to[1]+Math.sin(angle)*(8+Math.sin(t*30)*4));ctx.stroke();}}
    if(['water','fire','grass','ice'].includes(fx.style)&&t<.75){for(let i=0;i<7;i++){const px=x+Math.sin(i*3+t*20)*9,py=y+Math.cos(i*2+t*15)*8;if(fx.style==='water'){ctx.beginPath();ctx.arc(px,py,2+(i%2),0,Math.PI*2);ctx.stroke();}else if(fx.style==='grass'){ctx.save();ctx.translate(px,py);ctx.rotate(i+t*12);ctx.fillRect(-1,-4,2,8);ctx.restore();}else if(fx.style==='ice'){ctx.fillRect(px-3,py,7,1);ctx.fillRect(px,py-3,1,7);}else {ctx.fillRect(px-2,py-5,4,8);ctx.fillRect(px-1,py-8,2,4);}}}
    if(fx.style==='electric'&&t<.8){ctx.beginPath();ctx.moveTo(from[0],from[1]);for(let i=1;i<=9;i++)ctx.lineTo(from[0]+(to[0]-from[0])*i/9,from[1]+(to[1]-from[1])*i/9+Math.sin(i*5+Math.floor(t*15))*8);ctx.stroke();}
    if(['status','psychic','ghost','beam'].includes(fx.style)&&t<.85){for(let i=0;i<3;i++){const radius=((t*30+i*8)%26)+2;ctx.beginPath();ctx.ellipse(to[0],to[1],radius,radius*.55,0,0,Math.PI*2);ctx.stroke();}}
  }
}
function render(now){
  presentationClock=now;
  if(world&&started){
    tickMovement(now);
    if(introArt){ctx.fillStyle='#fff';ctx.fillRect(0,0,160,144);const art=img(introArt);if(art?.complete)ctx.drawImage(art,Math.floor((160-art.width)/2),16);}else if(battle)drawBattle(now);else drawWorld(now);
    drawFx(now);
    if(starterPreview){box(96,0,64,64);const picture=img(db.species[starterPreview].front);if(picture?.complete)ctx.drawImage(picture,100+(56-picture.width)/2,4+(56-picture.height)/2);}
    if(menu){
      if(battle&&menu.title==='BATTLE'){
        box(48,96,112,48);text('FIGHT',64,104);text('BAG',64,120);text('PKMN',120,104);text('RUN',120,120);
        const positions=[[54,104],[54,120],[110,104],[110,120]];text('▶',...positions[menu.index]);
      }else{
        const visible=7,start=Math.max(0,menu.index-visible+1),items=menu.items.slice(start,start+visible),h=Math.min(136,16+items.length*16),y=144-h;
        box(0,y,160,h);items.forEach((item,i)=>text((i+start===menu.index?'▶':' ')+item.label.slice(0,18),4,y+8+i*16));
      }
    }
    if(dialogue){
      box(0,96,160,48);dialogue.visible(now).forEach((line,i)=>text(line,8,104+i*16));
      if(dialogue.ready(now)&&Math.floor(now/450)%2)text('▼',144,128);
    }
    if(fx&&now>=fx.at+fx.duration){const done=fx.done;fx=null;done?.();}
  }
  requestAnimationFrame(render);
}
function keyDir(key){return directionForKey(key);}
function keydown(key,repeat=false){
  if(!started)return;key=normalizeKey(key);
  if(fx||loading)return;
  const dir=keyDir(key);
  if(dir){
    if(menu&&!repeat){menu.index=(menu.index+(dir==='up'||dir==='left'?-1:1)+menu.items.length)%menu.items.length;beep();}
    else if(!menu&&!dialogue&&!sceneBusy&&!battle&&!repeat){motion.request(dir);tickMovement(performance.now());}
    return;
  }
  if(repeat)return;
  if(['z','Enter',' '].includes(key))interact();
  if(['x','Backspace'].includes(key)){if(dialogue)advance();else if(menu&&!battle?.forcedSwitch){menu=null;actions([]);if(battle)battleMenu();}}
  if(key==='Escape')pauseMenu();
}
function updatePanels(){if(!s)return;$('#party-count').textContent=`${s.party.length} / 6`;$('#money').textContent=`₽ ${s.money.toLocaleString()}`;$('#dex-count').textContent=`${s.caught.length} / 151`;$('#badges').textContent=`${s.badges.length} / 8`;$('#mode-badge').textContent=exploreHome?'EXPLORATION':s.modified?'MODIFIED':'STORY';
  const objectives=s.badges.length?campaignObjective():s.flags.pokedex?['The road to Pewter.','Head north from Viridian, through Route 2 and Viridian Forest. Brock awaits at Pewter Gym.']:s.flags.parcel?["A delivery for Oak.",'Bring the parcel back to Oak’s lab in Pallet Town.']:s.flags.rival?['A little farther north.','Travel along Route 1 to Viridian City. Stop by the Poké Mart.']:s.flags.starter?['Your first rival.','Leave the lab to put your new partner to the test.']:s.flags.metOak?['Choose your partner.','Talk to one of the three Poké Balls on the table in Oak’s lab.']:['It begins in Pallet Town.','Go downstairs, leave your house, and head north toward the tall grass.'];$('#objective').textContent=exploreHome?currentMap().displayName:objectives[0];$('#objective-detail').textContent=exploreHome?'You’re exploring imported world data. Return to your story position from the Workbench.':objectives[1];
  const party=$('#party');party.replaceChildren();if(!s.party.length)party.innerHTML='<p class="muted">Your first partner is waiting at Oak’s lab.</p>';for(const [i,m] of s.party.entries()){const row=document.createElement('div');row.className='party-mon';row.innerHTML=`<img src="${esc(db.species[m.species].front)}" alt="${esc(db.species[m.species].name)}"><div><strong>${esc(pretty(m.species))}</strong><div class="hp"><i style="width:${100*m.hp/m.stats.hp}%"></i></div><small>${m.hp} / ${m.stats.hp} HP ${m.status||''}</small></div><small>LV. ${m.level}</small>`;party.append(row);}$('#log').innerHTML=s.log.slice(0,12).map(t=>`<div>${esc(t)}</div>`).join('');}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safePosition(map){const preferred=map.warps[0];if(preferred){for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){const x=preferred.x+dx,y=preferred.y+dy;if([1,2].includes(map.collision[y]?.[x])&&!map.objects.some(o=>!o.defaultHidden&&o.x===x&&o.y===y))return {x,y};}}for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)if([1,2].includes(map.collision[y][x])&&!map.objects.some(o=>!o.defaultHidden&&o.x===x&&o.y===y))return {x,y};return {x:0,y:0};}
function populateMaps(query=''){$('#map-select').replaceChildren();for(const m of Object.values(world.maps).filter(m=>m.displayName.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.displayName.localeCompare(b.displayName))){const o=document.createElement('option');o.value=m.id;o.textContent=m.displayName;$('#map-select').append(o);}}
function editSpecies(){const v=db.species[$('#species-select').value];$('#species-editor').value=JSON.stringify({stats:v.stats,types:v.types,catchRate:v.catchRate,baseExp:v.baseExp,startingMoves:v.startingMoves,learnset:v.learnset},null,2);}
function storeMods(){try{const out={};for(const [key,value] of Object.entries(db.species))if(JSON.stringify(value)!==JSON.stringify(original.species[key]))out[key]=value;localStorage.setItem(MODS,JSON.stringify(out));}catch{status('Could not persist modifications in browser storage.');}}
function storeSettings(){try{localStorage.setItem('pokered-settings-v2',JSON.stringify(settings));}catch{}}
function setupUI(){document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||$('#guide').open)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Backspace'].includes(e.key))e.preventDefault();const key=normalizeKey(e.key),wasHeld=held.has(key);held.add(key);keydown(key,e.repeat||wasHeld);});document.addEventListener('keyup',e=>held.delete(normalizeKey(e.key)));window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',clearInput);
  document.querySelectorAll('[data-key]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);const key=normalizeKey(b.dataset.key),wasHeld=held.has(key);held.add(key);keydown(key,wasHeld);});b.addEventListener('pointerup',()=>held.delete(normalizeKey(b.dataset.key)));b.addEventListener('pointercancel',()=>held.delete(normalizeKey(b.dataset.key)));});
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab],.panel').forEach(el=>el.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.tab).classList.add('active');});
  $('#help').onclick=()=>{clearInput();$('#guide').showModal();};$('#close-guide').onclick=$('#guide-play').onclick=()=>{$('#guide').close();focusGame();};$('#save').onclick=saveGame;
  $('#sound').textContent=`♪ MUSIC ${sound?'ON':'OFF'}`;$('#sound').setAttribute('aria-pressed',String(sound));
  $('#sound').onclick=async()=>{sound=!sound;settings.music=sound;storeSettings();await music.enable(sound);if(battle)music.play(battle.trainer?'Music_TrainerBattle':'Music_WildBattle');else mapMusic();$('#sound').textContent=`♪ MUSIC ${sound?'ON':'OFF'}`;$('#sound').setAttribute('aria-pressed',String(sound));};
  $('#text-speed').value=settings.textSpeed;$('#protect-text').checked=settings.protectedText;$('#battle-scenes').checked=settings.battleAnimations;$('#music-volume').value=settings.volume;
  $('#text-speed').onchange=e=>{settings.textSpeed=e.target.value;storeSettings();};$('#protect-text').onchange=e=>{settings.protectedText=e.target.checked;storeSettings();};$('#battle-scenes').onchange=e=>{settings.battleAnimations=e.target.checked;storeSettings();};$('#music-volume').oninput=e=>{settings.volume=Number(e.target.value);music.setVolume(settings.volume);storeSettings();};
  let palette=0;$('#palette').onclick=()=>{palette=(palette+1)%3;canvas.className=['','green','gray'][palette];};
  $('#export-save').onclick=()=>{if(!started||battle||fx||sceneBusy||motion.step){status('Finish the current scene before exporting.');return;}const out=structuredClone(s);out.seed=random.seed;if(exploreHome)Object.assign(out,exploreHome);download(out,'pokered-save.json');};$('#import-save').onchange=async e=>{try{if(battle||sceneBusy||fx)throw Error('Finish the current scene before importing.');const file=e.target.files[0];if(!file)return;if(file.size>2e6)throw Error('Save file is too large.');const imported=loadSave(await file.text());localStorage.setItem(SAVE,JSON.stringify(imported));await startGame(true);status('Imported your saved adventure.');}catch(err){status(err.message);}e.target.value='';};
  populateMaps();$('#map-select').value='PALLET_TOWN';$('#map-search').oninput=e=>populateMaps(e.target.value);$('#travel').onclick=async()=>{if(!started){await startGame();dialogue=null;}if(battle||loading||sceneBusy||fx){status('Finish the current scene before traveling.');return;}const id=$('#map-select').value;if(!world.maps[id])return;exploreHome??={map:s.map,x:s.x,y:s.y,dir:s.dir,lastOutdoor:s.lastOutdoor};dialogue=null;menu=null;actions([]);const pos=safePosition(world.maps[id]);await enterMap(id,pos.x,pos.y,'down');status('Exploration mode. Story events and random battles are paused.');focusGame();};$('#return-story').onclick=async()=>{if(!exploreHome||fx||sceneBusy)return;clearInput();motion.clear();const home=exploreHome;exploreHome=null;Object.assign(s,home);dialogue=null;menu=null;actions([]);await prepareMap();updatePanels();status('Returned to your story position.');focusGame();};
  for(const p of Object.values(db.species).sort((a,b)=>a.dex-b.dex)){const o=document.createElement('option');o.value=p.id;o.textContent=`${String(p.dex).padStart(3,'0')} · ${p.name}`;$('#species-select').append(o);}$('#species-select').onchange=editSpecies;editSpecies();
  $('#apply-mod').onclick=()=>{try{const value=JSON.parse($('#species-editor').value),key=$('#species-select').value;for(const stat of ['hp','attack','defense','speed','special'])if(!Number.isInteger(value.stats?.[stat])||value.stats[stat]<1||value.stats[stat]>255)throw Error('Base stats must be integers from 1 to 255.');const types=new Set(Object.values(original.species).flatMap(p=>p.types));if(!Array.isArray(value.types)||value.types.length<1||value.types.length>2||value.types.some(t=>!types.has(t)))throw Error('Use one or two valid Gen I type names.');if(!Array.isArray(value.startingMoves)||value.startingMoves.length<1||value.startingMoves.length>4||value.startingMoves.some(m=>!db.moves[m]))throw Error('Use one to four valid move IDs.');if(!Array.isArray(value.learnset)||value.learnset.some(m=>!db.moves[m.move]||!Number.isInteger(m.level)||m.level<1||m.level>100))throw Error('Learnset entries need a level from 1–100 and a valid move.');if(!Number.isInteger(value.catchRate)||value.catchRate<1||value.catchRate>255||!Number.isInteger(value.baseExp)||value.baseExp<1||value.baseExp>255)throw Error('Catch rate and base EXP must be integers from 1 to 255.');db.species[key]={...db.species[key],stats:value.stats,types:value.types,startingMoves:value.startingMoves,learnset:value.learnset,catchRate:value.catchRate,baseExp:value.baseExp};storeMods();status(`Saved changes to ${pretty(key)}. They apply to newly created Pokémon.`);}catch(e){status(e.message);}};
  $('#reset-mod').onclick=()=>{const key=$('#species-select').value;db.species[key]=structuredClone(original.species[key]);storeMods();editSpecies();status('Restored original species data.');};$('#add-mon').onclick=()=>{if(!started||battle||sceneBusy||fx||s.party.length>=6){status('Start a game, finish any battle, and make room in your party first.');return;}const mon=makeMon(db,$('#species-select').value,10,random);s.party.push(mon);s.caught=[...new Set([...s.caught,mon.species])];s.seen=[...new Set([...s.seen,mon.species])];s.modified=true;note(`Workbench added ${pretty(mon.species)} at level 10.`);saveGame();};
}
async function boot(){try{let musicData;[world,db,events,musicData]=await Promise.all(['data/world.json','data/pokemon.json','data/events.json','data/music.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error(`Could not load ${url}`);return r.json();}));music=new MusicPlayer(musicData);music.setVolume(settings.volume);Object.assign(world.texts,events.texts||{});original=structuredClone(db);try{const mods=JSON.parse(localStorage.getItem(MODS)||'{}');for(const [k,v] of Object.entries(mods))if(db.species[k])db.species[k]=v;}catch{}await Promise.all([loadImage(world.font.image),loadImage(world.sprites.SPRITE_RED.image)]);setupUI();$('#data-counts').innerHTML=`<div><b>${Object.keys(world.maps).length}</b><small>MAPS</small></div><div><b>${Object.keys(db.species).length}</b><small>SPECIES</small></div><div><b>${Object.keys(db.moves).length}</b><small>MOVES</small></div>`;const overlay=$('#overlay');overlay.replaceChildren();const title=document.createElement('div');title.className='title-pokemon';title.textContent='POKéMON';overlay.append(title);const sub=document.createElement('h2');sub.textContent='RED VERSION';overlay.append(sub);const art=document.createElement('img');art.src=db.species.CHARIZARD.front;art.className='title-art';art.alt='Charizard';overlay.append(art);const tag=document.createElement('p');tag.textContent='A native browser rewrite. Explore Kanto, collect eight badges, and challenge the League.';overlay.append(tag);let exists=false;try{exists=!!localStorage.getItem(SAVE);}catch{}if(exists){const cont=document.createElement('button');cont.textContent='CONTINUE';cont.className='primary';cont.onclick=()=>startGame(true);overlay.append(cont);}const b=document.createElement('button');b.textContent='NEW GAME';if(!exists)b.className='primary';b.onclick=()=>{if(exists){b.textContent='START FRESH? CLICK AGAIN';b.onclick=()=>startGame();}else startGame();};overlay.append(b);$('#location').textContent='PALLET TOWN';status('Original assets loaded. Start an adventure, or inspect the build notes.');requestAnimationFrame(render);
  // Read-only snapshot for developer verification and future regression tooling.
  window.pokered={snapshot:()=>structuredClone({state:s,battle,dialogue:dialogue?{index:dialogue.index,pages:dialogue.pages}:null,menu:menu?{title:menu.title,index:menu.index,items:menu.items.map(i=>i.label)}:null,exploring:!!exploreHome}),source:world.source};
}catch(error){$('#overlay').textContent='Could not load the game. '+error.message;status(error.message);console.error(error);}}
boot();
