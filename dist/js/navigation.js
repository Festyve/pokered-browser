// World geometry is separate from event scripts so maps can be edited independently.
export function connectionDestination(world, mapId, x, y) {
  const map=world.maps[mapId];
  const direction=x<0?'west':x>=map.width?'east':y<0?'north':y>=map.height?'south':null;
  if(!direction)return null;
  const connection=map.connections.find(c=>c.direction===direction);
  const target=connection&&world.maps[connection.target];if(!target)return null;
  if(direction==='north'||direction==='south'){x-=connection.offset*2;y=direction==='north'?target.height-1:0;}
  else {y-=connection.offset*2;x=direction==='west'?target.width-1:0;}
  if(x<0||y<0||x>=target.width||y>=target.height)return null;
  return {map:connection.target,x,y};
}
export function warpDestination(world,mapId,warp,lastOutdoor) {
  const source=world.maps[mapId];
  if(source.outdoor)lastOutdoor=mapId;
  const map=warp.target==='LAST_MAP'?lastOutdoor:warp.target;
  const target=world.maps[map],exit=target?.warps[warp.targetWarp-1];
  if(!exit)return null;
  let {x,y}=exit,dir=null;
  if(target.outdoor){y++;dir='down';}
  else if(y===target.height-1){y--;dir='up';}
  else if(y===0){y++;dir='down';}
  return {map,x,y,dir,lastOutdoor};
}
