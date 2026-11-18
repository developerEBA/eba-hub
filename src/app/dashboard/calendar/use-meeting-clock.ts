"use client";
import { useEffect,useState } from "react";
// Presentation only. The protected Join route always enforces database times.
export function useMeetingClock(enabled=true){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  if(!enabled)return;
  const update=()=>setNow(Date.now());
  const timer=setInterval(update,1000);window.addEventListener("focus",update);
  return()=>{clearInterval(timer);window.removeEventListener("focus",update)};
 },[enabled]);
 return now;
}
