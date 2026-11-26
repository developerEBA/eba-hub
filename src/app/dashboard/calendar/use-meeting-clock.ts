"use client";
import { useEffect,useState } from "react";
let anchor:{server:number;mono:number}|null=null,inflight:Promise<void>|null=null;
export function meetingClockNow(){return anchor?anchor.server+performance.now()-anchor.mono:Date.now()}
function synchronize(){
 if(inflight)return inflight;
 if(anchor&&performance.now()-anchor.mono<30_000)return Promise.resolve();
 inflight=(async()=>{try{
  const response=await fetch("/dashboard/calendar/api/clock",{cache:"no-store",signal:AbortSignal.timeout(5000)});
  const result=await response.json();if(response.ok&&Number.isFinite(result.now))anchor={server:result.now,mono:performance.now()};
 }catch{}finally{inflight=null}})();
 return inflight;
}

export function useMeetingClock(enabled=true){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  if(!enabled)return;
  const update=()=>{setNow(meetingClockNow());void synchronize().then(()=>setNow(meetingClockNow()))};
  update();
  const timer=setInterval(update,1000);window.addEventListener("focus",update);
  return()=>{clearInterval(timer);window.removeEventListener("focus",update)};
 },[enabled]);
 return now;
}
