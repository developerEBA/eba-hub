"use client";
import { useEffect } from "react";
let context: AudioContext | null = null;
// Brief, clearer two-note chime; independent of the quiet game background music.
export function playNotificationTone(audio:AudioContext) {
  [659.25,880].forEach((frequency,index)=>{
    const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+index*.18;
    oscillator.type="triangle";oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.22,at+.02);
    gain.gain.exponentialRampToValueAtTime(.0001,at+.38);
    oscillator.connect(gain);gain.connect(audio.destination);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
    oscillator.start(at);oscillator.stop(at+.4);
  });
}
export function NotificationChime({latestUnreadId}:{latestUnreadId?:number}) {
  useEffect(()=>{
    const unlock=()=>{try{context??=new AudioContext();void context.resume().catch(()=>{})}catch{}};
    document.addEventListener("pointerdown",unlock);
    document.addEventListener("keydown",unlock);
    return ()=>{document.removeEventListener("pointerdown",unlock);document.removeEventListener("keydown",unlock)};
  },[]);
  useEffect(()=>{
    if(latestUnreadId===undefined)return;
    try{
      const key="eba-notification-last-sound",previous=sessionStorage.getItem(key);
      const prior=Number(previous??latestUnreadId);
      if(latestUnreadId>prior || previous===null)sessionStorage.setItem(key,String(latestUnreadId));
      // Initial visit, mark-read, edits and reconnects must not replay old alerts.
      if(previous!==null&&latestUnreadId>prior&&context?.state==="running")playNotificationTone(context);
    }catch{ /* Sound/storage availability never blocks the private inbox. */ }
  },[latestUnreadId]);
  return null;
}
