'use strict';
/* sounds.js — v2.5 SONIDO POR CADA ACCIÓN DEL CHAT + REVERB + COLORES
   - Volumen +40% (gain 0.38-0.70), lowpass 12000, compresor dinámico
   - Reverb convolver, eco delay, boost — configurables y persistentes
   - NUEVO: sonidos dedicados para cada acción de chat/mensaje (receive, typing, whoosh, pop, confirm, cancel, scroll)
   - Unlock robusto, feedback y banner */
let audioCtx = null;
let masterGain = null;
let compNode = null;
let convolver = null;
let reverbGain = null;
let delayNode = null;
let delayGain = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let soundVolume = parseFloat(localStorage.getItem('soundVolume') || '0.92');
if (isNaN(soundVolume) || soundVolume < 0.08) soundVolume = 0.92;
soundVolume = Math.max(0, Math.min(1, soundVolume));
// Fix: forzar sonido activado si venía silenciado por defecto en pruebas
if (localStorage.getItem('soundEnabled') === null) { soundEnabled = true; localStorage.setItem('soundEnabled','true'); }
let alertConfig = (()=>{ try{ return JSON.parse(localStorage.getItem('alertConfig')||'{}'); }catch(e){ return {}; } })();
alertConfig = {
  defaultAlarm: alertConfig.defaultAlarm || 'alarm_phone',
  loops: alertConfig.loops != null ? alertConfig.loops : 3,
  vibration: alertConfig.vibration !== false,
  alertVolume: alertConfig.alertVolume != null ? alertConfig.alertVolume : 0.95
};
let soundFX = (()=>{ try{ return JSON.parse(localStorage.getItem('soundFX')||'{}'); }catch(e){ return {}; } })();
soundFX = {
  reverb: soundFX.reverb !== false, // por defecto sí
  reverbLevel: soundFX.reverbLevel != null ? soundFX.reverbLevel : 0.38,
  echo: !!soundFX.echo,
  echoDelay: soundFX.echoDelay != null ? soundFX.echoDelay : 0.22,
  boost: soundFX.boost !== false
};
let alarmTimers = [];
let activeOscs = [];
let _audioUnlocked = false;

function saveAlertConfig(){ localStorage.setItem('alertConfig', JSON.stringify(alertConfig)); }
function saveFX(){ localStorage.setItem('soundFX', JSON.stringify(soundFX)); syncFXUI(); }
function getAlertConfig(){ return {...alertConfig}; }
function getFX(){ return {...soundFX}; }
function setAlertConfig(patch){
  Object.assign(alertConfig, patch);
  if(alertConfig.loops) alertConfig.loops = Math.max(1, Math.min(6, parseInt(alertConfig.loops)||3));
  if(alertConfig.alertVolume!=null) alertConfig.alertVolume = Math.max(0, Math.min(1, parseFloat(alertConfig.alertVolume)));
  saveAlertConfig(); syncSoundConfigUI();
}
function setFX(patch){
  Object.assign(soundFX, patch);
  if(soundFX.reverbLevel!=null) soundFX.reverbLevel = Math.max(0, Math.min(1, parseFloat(soundFX.reverbLevel)));
  saveFX();
  buildReverb();
}
function setSoundEnabled(v){
  soundEnabled = !!v;
  localStorage.setItem('soundEnabled', String(soundEnabled));
  if(!soundEnabled) stopAlarms();
  updateSoundIcon(); syncSoundConfigUI(); syncFXUI();
  if(soundEnabled){ unlockAudio(true); setTimeout(()=> playSound('success'), 140); }
  else { try{ if(navigator.vibrate) navigator.vibrate(0); }catch(e){} if(typeof showToast==='function') showToast('🔇 Sonidos desactivados','info'); }
}
function buildReverb(){
  if(!audioCtx || !convolver || !reverbGain) return;
  try{
    const len = Math.floor(audioCtx.sampleRate * (0.9 + soundFX.reverbLevel*1.8)); // 0.9-2.7s
    const impulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for(let c=0;c<2;c++){
      const ch = impulse.getChannelData(c);
      for(let i=0;i<len;i++){
        const t = i / audioCtx.sampleRate;
        // reverberación plate: ruido con decaimiento exponencial + early reflections
        const decay = Math.exp(-t * (2.2 - soundFX.reverbLevel*0.8)) * (1 - t/len*0.3);
        ch[i] = (Math.random()*2-1) * decay * 0.55;
        if(i < 400) ch[i] += Math.sin(i*0.08)*0.04*decay;
      }
    }
    convolver.buffer = impulse;
    reverbGain.gain.value = soundFX.reverb ? soundFX.reverbLevel*0.55 : 0;
  }catch(e){}
}
function unlockAudio(showFeedback){
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = soundVolume * 1.25; // boost +25% CORREGIDO
      // Compresor para volumen fuerte sin clipping
      try{
        compNode = audioCtx.createDynamicsCompressor();
        compNode.threshold.value = -20;
        compNode.knee.value = 20;
        compNode.ratio.value = 3;
        compNode.attack.value = 0.005;
        compNode.release.value = 0.20;
      }catch(e){ compNode=null; }
      convolver = audioCtx.createConvolver();
      reverbGain = audioCtx.createGain();
      reverbGain.gain.value = soundFX.reverb ? soundFX.reverbLevel*0.35 : 0;
      delayNode = audioCtx.createDelay(0.6);
      delayNode.delayTime.value = soundFX.echoDelay;
      delayGain = audioCtx.createGain();
      delayGain.gain.value = soundFX.echo ? 0.22 : 0;
      // Cadena corregida: master -> destination, convolver y delay en paralelo
      try{ convolver.connect(reverbGain).connect(masterGain); }catch(e){}
      try{ delayNode.connect(delayGain).connect(masterGain); }catch(e){}
      if(compNode){
        try{ masterGain.connect(compNode).connect(audioCtx.destination); }catch(e){ masterGain.connect(audioCtx.destination); }
      } else {
        masterGain.connect(audioCtx.destination);
      }
      buildReverb();
    }
    // Intentar resumir si está suspendido
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(()=>{
        _audioUnlocked = true;
        if(showFeedback && typeof showToast==='function') showToast('🔊 Audio activado • Volumen '+Math.round(soundVolume*100)+'%','success');
        buildReverb();
        updateSoundIcon(); syncSoundConfigUI();
      }).catch((e)=>{
        console.warn('[sounds] resume bloqueado, requiere gesto', e);
        _audioUnlocked = false;
        if(showFeedback && typeof showToast==='function') showToast('👆 Haz clic de nuevo para activar sonido','info');
      });
      // No marcar como desbloqueado hasta que resume tenga éxito
      if(audioCtx.state === 'suspended') return false;
    } else {
      _audioUnlocked = true;
    }
    // actualizar gains según config
    if(reverbGain) try{ reverbGain.gain.value = soundFX.reverb ? soundFX.reverbLevel*0.35 : 0; }catch(e){}
    if(delayGain) try{ delayGain.gain.value = soundFX.echo ? 0.22 : 0; }catch(e){}
    if(masterGain) try{ masterGain.gain.value = soundVolume * (soundFX.boost ? 1.22 : 1.0); }catch(e){ masterGain.gain.value = soundVolume; }
    if(_audioUnlocked) { updateSoundIcon(); syncSoundConfigUI(); }
    return _audioUnlocked;
  } catch(e) {
    console.warn('[sounds] unlock failed', e);
    if(!window.__audioFailNotified){
      window.__audioFailNotified = true;
      if(typeof showToast==='function') showToast('Audio no disponible: '+e.message,'error');
    }
    return false;
  }
}
function initAudio(){ return unlockAudio(false); }
function updateSoundIcon(){
  const _toggles = ['soundToggle','soundToggle2','soundToggle3']
    .map(id=>document.getElementById(id))
    .concat(Array.from(document.querySelectorAll('[data-sound-toggle]')))
    .filter(Boolean);
  _toggles.forEach(b=>{
    {
      b.textContent = soundEnabled ? '🔊' : '🔇';
      b.style.opacity = soundEnabled ? '1' : '0.45';
      b.style.filter = soundEnabled ? 'none' : 'grayscale(0.6)';
      b.title = soundEnabled ? `Sonidos ACTIVADOS · Vol ${Math.round(soundVolume*100)}%${soundFX.reverb?' · Reverb':''}${soundFX.echo?' · Eco':''} (clic para silenciar)` : 'Sonidos SILENCIADOS — clic para activar';
    }
  });
  document.querySelectorAll('[data-sound-toggle]').forEach(function(b){
    b.textContent = soundEnabled ? '🔊' : '🔇';
    b.style.opacity = soundEnabled ? '1' : '0.45';
  });
  const s=document.getElementById('soundVolume'); if(s) s.value = Math.round(soundVolume*100);
  const l=document.getElementById('soundVolumeLabel'); if(l) l.textContent = Math.round(soundVolume*100)+'%';
  const s2=document.getElementById('soundVolume2'); if(s2) s2.value = Math.round(soundVolume*100);
  const l2=document.getElementById('soundVolumeLabel2'); if(l2) l2.textContent = Math.round(soundVolume*100)+'%';
}
function syncSoundConfigUI(){
  const en=document.getElementById('cfgSoundEnabled'); if(en) en.checked = soundEnabled;
  const st=document.getElementById('cfgSoundStatus'); if(st){ st.textContent = soundEnabled ? '● ACTIVADO' : '○ SILENCIADO'; st.style.background = soundEnabled ? '#10b981' : '#94a3b8'; st.style.color='white'; st.style.padding='2px 8px'; st.style.borderRadius='999px'; st.style.fontSize='11px'; st.style.fontWeight='800'; }
  const mv=document.getElementById('cfgMasterVol'); if(mv) mv.value = Math.round(soundVolume*100);
  const ml=document.getElementById('cfgVolLabel'); if(ml) ml.textContent = Math.round(soundVolume*100)+'%';
  const mv2=document.getElementById('cfgMasterVol2'); if(mv2) mv2.value = Math.round(soundVolume*100);
  const ml2=document.getElementById('cfgVolLabel2'); if(ml2) ml2.textContent = Math.round(soundVolume*100)+'%';
  const da=document.getElementById('cfgDefaultAlarm'); if(da) da.value = alertConfig.defaultAlarm;
  const lo=document.getElementById('cfgLoops'); if(lo) lo.value = alertConfig.loops;
  const vib=document.getElementById('cfgVibration'); if(vib) vib.checked = !!alertConfig.vibration;
  const av=document.getElementById('cfgAlertVol'); if(av) av.value = Math.round(alertConfig.alertVolume*100);
  const avl=document.getElementById('cfgAlertVolLabel'); if(avl) avl.textContent = Math.round(alertConfig.alertVolume*100)+'%';
  const banner=document.getElementById('soundUnlockBanner'); if(banner) banner.style.display = (soundEnabled && !_audioUnlocked) ? 'flex' : 'none';
  const banner2=document.getElementById('soundUnlockBanner_dup'); if(banner2) banner2.style.display = (soundEnabled && !_audioUnlocked) ? 'flex' : 'none';
  updateSoundIcon();
}
function syncFXUI(){
  const rv=document.getElementById('fxReverb'); if(rv) rv.checked = !!soundFX.reverb;
  const rl=document.getElementById('fxReverbLevel'); if(rl) rl.value = Math.round(soundFX.reverbLevel*100);
  const rll=document.getElementById('fxReverbLevelLabel'); if(rll) rll.textContent = Math.round(soundFX.reverbLevel*100)+'%';
  const ec=document.getElementById('fxEcho'); if(ec) ec.checked = !!soundFX.echo;
  const bs=document.getElementById('fxBoost'); if(bs) bs.checked = !!soundFX.boost;
  const tgl=document.getElementById('fxStatusTag'); if(tgl){
    const parts=[]; if(soundFX.reverb) parts.push('Reverb'); if(soundFX.echo) parts.push('Eco'); if(soundFX.boost) parts.push('Boost');
    tgl.textContent = parts.length? parts.join(' • ') : 'Seco';
  }
  if(reverbGain) reverbGain.gain.value = soundFX.reverb ? soundFX.reverbLevel*0.55 : 0;
  if(delayGain) delayGain.gain.value = soundFX.echo ? 0.28 : 0;
  if(masterGain) masterGain.gain.value = soundVolume * (soundFX.boost ? 1.18 : 1.0);
}
function setVolume(v){
  const n = typeof v === 'string' ? parseInt(v,10) : v;
  const wasZero = soundVolume < 0.04;
  soundVolume = Math.max(0, Math.min(1, (isNaN(n)?92:n)/100));
  localStorage.setItem('soundVolume', String(soundVolume));
  if(masterGain && audioCtx){ try{ masterGain.gain.setValueAtTime(soundVolume * (soundFX.boost?1.18:1.0), audioCtx.currentTime); }catch(e){ masterGain.gain.value = soundVolume * (soundFX.boost?1.18:1.0); } }
  else if(soundEnabled) unlockAudio(false);
  updateSoundIcon(); syncSoundConfigUI();
  if(soundEnabled){
    unlockAudio(false);
    if(audioCtx && audioCtx.state==='suspended') audioCtx.resume().then(()=> tone(880,0.22,'sine',0.40)).catch(()=>{});
    else tone(880,0.22,'sine',0.40);
    if(wasZero && soundVolume>0.04 && typeof showToast==='function') showToast('🔊 Volumen '+Math.round(soundVolume*100)+'%','success');
  }
}
function setAlertVolume(v){
  const n = typeof v === 'string' ? parseInt(v,10) : v;
  alertConfig.alertVolume = Math.max(0, Math.min(1, (isNaN(n)?95:n)/100));
  saveAlertConfig(); syncSoundConfigUI();
}
function toggleSound(){ setSoundEnabled(!soundEnabled); }
['click','touchstart','keydown'].forEach(ev=>{ document.addEventListener(ev, ()=>{ if(!soundEnabled) return; if(!audioCtx) unlockAudio(false); else if(audioCtx.state==='suspended') audioCtx.resume().catch(()=>{}); }, {passive:true}); });
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && audioCtx && audioCtx.state==='suspended' && soundEnabled) audioCtx.resume().catch(()=>{}); });
window.addEventListener('storage', (e)=>{
  if(e.key==='soundEnabled'){ soundEnabled = e.newValue !== 'false'; if(!soundEnabled) stopAlarms(); updateSoundIcon(); syncSoundConfigUI(); syncFXUI(); }
  if(e.key==='soundVolume'){ const v=parseFloat(e.newValue||'0.92'); if(!isNaN(v)){ soundVolume=Math.max(0,Math.min(1,v)); if(masterGain && audioCtx) try{ masterGain.gain.setValueAtTime(soundVolume*(soundFX.boost?1.18:1.0), audioCtx.currentTime);}catch(_){ masterGain.gain.value=soundVolume; } updateSoundIcon(); syncSoundConfigUI(); } }
  if(e.key==='alertConfig'){ try{ const c=JSON.parse(e.newValue||'{}'); Object.assign(alertConfig, c); syncSoundConfigUI(); }catch(_){} }
  if(e.key==='soundFX'){ try{ const c=JSON.parse(e.newValue||'{}'); Object.assign(soundFX, c); syncFXUI(); buildReverb(); }catch(_){} }
});

const soundMap={
  nuevo:{freq:[392,523,659,880],dur:0.50,type:'sine',arpeggio:true,gain:0.42, label:'Nuevo chat', icon:'💬'},
  send:{freq:[840,1120],dur:0.20,type:'sine',chord:true,gain:0.40, label:'Enviar', icon:'📤'},
  receive:{freq:[659,784,1046,1318],dur:0.55,type:'sine',arpeggio:true,gain:0.44, label:'Mensaje recibido', icon:'📥'},
  typing:{freq:[520,620],dur:0.20,type:'sine',chord:true,gain:0.28, label:'Escribiendo', icon:'⌨️'},
  whoosh:{freq:[300,600,900],dur:0.28,type:'sine',arpeggio:true,gain:0.34, label:'Deslizar', icon:'🌊'},
  pop:{freq:880,dur:0.12,type:'sine',gain:0.30,slide:80, label:'Pop', icon:'💫'},
  confirm:{freq:[523,659],dur:0.22,type:'sine',chord:true,gain:0.36, label:'Confirmar', icon:'✅'},
  cancel:{freq:[659,523],dur:0.22,type:'sine',arpeggio:true,gain:0.30, label:'Cancelar', icon:'↩️'},
  scroll:{freq:[400,550],dur:0.14,type:'sine',arpeggio:true,gain:0.26, label:'Scroll', icon:'↕️'},
  upload:{freq:[550,750,1050],dur:0.34,type:'sine',arpeggio:true,gain:0.38, label:'Subir doc', icon:'📎'},
  success:{freq:[523,659,784,1046,1318],dur:0.64,type:'sine',arpeggio:true,gain:0.38, label:'Éxito', icon:'✅'},
  error:{freq:[340,280,220],dur:0.44,type:'triangle',arpeggio:true,gain:0.36, label:'Error', icon:'❌'},
  warning:{freq:[500,620],dur:0.36,type:'sine',chord:true,gain:0.37, label:'Advertencia', icon:'⚠️'},
  info:{freq:740,dur:0.18,type:'sine',gain:0.38,slide:40, label:'Info', icon:'ℹ️'},
  open:{freq:700,dur:0.16,type:'sine',gain:0.36,slide:60, label:'Abrir', icon:'📂'},
  edit:{freq:660,dur:0.17,type:'sine',gain:0.36,slide:30, label:'Editar', icon:'✏️'},
  delete:{freq:[220,180,140],dur:0.36,type:'triangle',arpeggio:true,gain:0.32, label:'Eliminar', icon:'🗑️'},
  save:{freq:[523,659,880],dur:0.44,type:'sine',arpeggio:true,gain:0.38, label:'Guardar', icon:'💾'},
  search:{freq:[620,820,1100,1480],dur:0.44,type:'sine',arpeggio:true,gain:0.38, label:'Buscar', icon:'🔍'},
  chat:{freq:[600,800,1000],dur:0.30,type:'sine',arpeggio:true,gain:0.38, label:'Chat', icon:'💬'},
  documents:{freq:[480,700,920],dur:0.32,type:'sine',arpeggio:true,gain:0.38, label:'Documentos', icon:'📄'},
  rag:{freq:[520,780,1050],dur:0.32,type:'sine',arpeggio:true,gain:0.38, label:'RAG', icon:'🧠'},
  llm:{freq:[523,659,880,1174],dur:0.40,type:'sine',arpeggio:true,gain:0.38, label:'LLM', icon:'🤖'},
  documentacion:{freq:[523,698,880,1046],dur:0.46,type:'sine',arpeggio:true,gain:0.34, label:'Documentación', icon:'📚'},
  espacio:{freq:[466,622,784],dur:0.40,type:'sine',arpeggio:true,gain:0.34, label:'Mi espacio', icon:'🗂️'},
  ayuda:{freq:[587,740,988],dur:0.42,type:'sine',arpeggio:true,gain:0.34, label:'Ayuda', icon:'❓'},
  test:{freq:[540,720,960],dur:0.34,type:'sine',arpeggio:true,gain:0.40, label:'Prueba', icon:'🧪'},
  alarm_phone:{freq:1000,dur:0.18,type:'sine',gain:0.48, label:'Alarma teléfono', icon:'📱'},
  alarm_classic:{freq:880,dur:0.20,type:'sine',gain:0.45, label:'Alarma clásica', icon:'⏰'},
  alarm_urgent:{freq:1200,dur:0.18,type:'sine',gain:0.48, label:'Alarma urgente', icon:'🚨'},
  alarm_soft:{freq:700,dur:0.22,type:'sine',gain:0.42, label:'Alarma suave', icon:'🔔'},
  alarm_nokia:{freq:1318,dur:0.12,type:'sine',gain:0.45, label:'Alarma Nokia', icon:'🎵'}
};
function tone(freq,dur,type='sine',gain=0.40,slide=0){
  if(!soundEnabled){
    if(typeof showToast==='function') showToast('🔇 Sonido silenciado — clic en 🔊 para activar','info');
    // Auto-activar si el usuario intenta sonar
    // setSoundEnabled(true); // no auto, solo aviso
    return;
  }
  if(!audioCtx || !masterGain){
    const ok = unlockAudio(false);
    if(!ok){
      // Si aún bloqueado, mostrar banner y no intentar sonar
      const b=document.getElementById('soundUnlockBanner');
      if(b) b.style.display='flex';
      console.warn('[tone] AudioContext bloqueado, espera gesto');
      return;
    }
  }
  if(audioCtx.state==='suspended'){
    audioCtx.resume().then(()=> tone(freq,dur,type,gain,slide)).catch((e)=>{
      console.warn('[tone] resume fallo', e);
      const b=document.getElementById('soundUnlockBanner');
      if(b) b.style.display='flex';
    });
    return;
  }
  try{
    const now=audioCtx.currentTime;
    const o=audioCtx.createOscillator();
    const g=audioCtx.createGain();
    const f=audioCtx.createBiquadFilter();
    f.type='lowpass'; f.frequency.value=12000; f.Q.value=0.2;
    o.type=type;
    o.frequency.setValueAtTime(freq, now);
    if(slide) o.frequency.linearRampToValueAtTime(freq+slide, now+dur*0.5);
    const isAlarm = gain>=0.42;
    const volScale = isAlarm ? alertConfig.alertVolume : 1;
    // CORREGIDO: ganancia más alta y sin depender de reverb
    const base = gain * (0.75 + soundVolume*1.0) * volScale * (soundFX.boost?1.18:1.0);
    const finalGain = Math.min(0.85, Math.max(0.32, base));
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(finalGain, now+0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now+dur);
    // Conexión simple y robusta: osc -> filter -> gain -> master
    o.connect(f); f.connect(g); g.connect(masterGain);
    // Reverb/echo opcionales en paralelo (no bloquean si fallan)
    try{
      if(soundFX.reverb && convolver && reverbGain && reverbGain.gain.value>0.01){
        const sendGain = audioCtx.createGain();
        sendGain.gain.value = 0.30;
        g.connect(sendGain).connect(convolver);
      }
    }catch(e){}
    try{
      if(soundFX.echo && delayNode && delayGain && delayGain.gain.value>0.01){
        const echoSend = audioCtx.createGain();
        echoSend.gain.value = 0.25;
        g.connect(echoSend).connect(delayNode);
      }
    }catch(e){}
    o.start(now); o.stop(now+dur+0.08);
    activeOscs.push(o);
    o.onended = ()=>{ activeOscs=activeOscs.filter(x=>x!==o); try{o.disconnect(); g.disconnect(); f.disconnect();}catch(_){} };
  }catch(e){ console.warn('[tone] error',e); }
}
function playSound(name){
  if(!soundEnabled){
    if(typeof showToast==='function') showToast('🔇 Sonido silenciado — activa con 🔊','info');
    // Mostrar banner
    const b=document.getElementById('soundUnlockBanner'); if(b) b.style.display='flex';
    const b2=document.getElementById('soundUnlockBanner_dup'); if(b2) b2.style.display='flex';
    return;
  }
  if(!audioCtx || audioCtx.state==='suspended'){
    const ok=unlockAudio(false);
    if(!ok || !audioCtx || audioCtx.state==='suspended'){
      // Si aún suspendido, intentar resume y reintentar una vez
      if(audioCtx && audioCtx.state==='suspended'){
        audioCtx.resume().then(()=> playSound(name)).catch(()=>{
          const b=document.getElementById('soundUnlockBanner'); if(b) b.style.display='flex';
        });
      } else {
        const b=document.getElementById('soundUnlockBanner'); if(b) b.style.display='flex';
      }
      return;
    }
  }
  const c=soundMap[name]||soundMap.info;
  const g=c.gain||0.38;
  if(c.arpeggio && Array.isArray(c.freq)){ c.freq.forEach((f,i)=> setTimeout(()=> tone(f, c.dur/c.freq.length+0.07, c.type, g), i*72)); }
  else if(c.chord && Array.isArray(c.freq)){ c.freq.forEach(f=> tone(f,c.dur,c.type,g*0.72)); }
  else { tone(c.freq,c.dur,c.type,g,c.slide||0); if(c.rise) setTimeout(()=> tone(c.freq+c.rise,0.14,'sine',g*0.78), 80); }
}
window.testSound = ()=>{ setSoundEnabled(true); setVolume(92); unlockAudio(true); setTimeout(()=>playSound('success'),120); };

// FIX: Desbloqueo garantizado en primer gesto del usuario
(function(){
  let unlockedOnce = false;
  function firstUnlock(){
    if(unlockedOnce) return;
    if(!soundEnabled) return;
    if(_audioUnlocked && audioCtx && audioCtx.state==='running') { unlockedOnce=true; return; }
    const ok = unlockAudio(false);
    if(ok && audioCtx && audioCtx.state==='running'){
      unlockedOnce = true;
      try{ tone(880,0.18,'sine',0.35); }catch(e){}
      console.log('[sounds] desbloqueado en primer gesto');
      document.removeEventListener('click', firstUnlock);
      document.removeEventListener('touchstart', firstUnlock);
      document.removeEventListener('keydown', firstUnlock);
    }
  }
  document.addEventListener('click', firstUnlock, {passive:true});
  document.addEventListener('touchstart', firstUnlock, {passive:true});
  document.addEventListener('keydown', firstUnlock, {passive:true});
  // También intentar desbloquear al cargar si ya hubo interacción previa (localStorage)
  setTimeout(()=>{ if(soundEnabled && !_audioUnlocked) unlockAudio(false); }, 800);
})();

window.unlockAudio = unlockAudio;
function stopAlarms(){
  alarmTimers.forEach(t=>clearTimeout(t)); alarmTimers=[];
  activeOscs.forEach(o=>{ try{o.stop(); o.disconnect();}catch(_){} }); activeOscs=[];
  if(navigator.vibrate) try{ navigator.vibrate(0); }catch(_){}
  _audioUnlocked = !!audioCtx;
  document.getElementById('bellBtn')?.classList.remove('bell-ringing');
  document.getElementById('bellBtn2')?.classList.remove('bell-ringing');
}
function playAlarm(name, loops){
  if(name==null) name = alertConfig.defaultAlarm;
  if(loops==null) loops = alertConfig.loops;
  if(!soundEnabled){ if(typeof showToast==='function') showToast('🔇 Activa 🔊 para alarmas','info'); setSoundEnabled(true); return; }
  if(!unlockAudio(true)) return;
  if(audioCtx.state==='suspended'){ audioCtx.resume().then(()=> playAlarm(name, loops)).catch(()=>{}); return; }
  stopAlarms();
  const patterns={
    alarm_phone:   {seq:[1000,1000,1000,1000], durs:[0.18,0.18,0.18,0.38], gap:0.18, pause:0.65},
    alarm_classic: {seq:[880,880,880], durs:[0.20,0.20,0.34], gap:0.14, pause:0.55},
    alarm_urgent:  {seq:[1200,900,1200,900,1200], durs:[0.14,0.14,0.14,0.14,0.28], gap:0.10, pause:0.40},
    alarm_soft:    {seq:[700,700], durs:[0.22,0.22], gap:0.20, pause:0.90},
    alarm_nokia:   {seq:[1318,987,1318,987,659,880], durs:[0.12,0.12,0.12,0.12,0.26,0.30], gap:0.08, pause:0.50}
  };
  const pat=patterns[name]||patterns.alarm_phone;
  let totalDelay=0;
  for(let l=0;l<loops;l++){
    for(let i=0;i<pat.seq.length;i++){
      const f=pat.seq[i], d=pat.durs[i];
      const t=setTimeout(()=> tone(f,d,'sine',0.52,0), totalDelay*1000);
      alarmTimers.push(t);
      totalDelay += d + pat.gap;
    }
    totalDelay += pat.pause;
  }
  if(alertConfig.vibration && navigator.vibrate) try{ navigator.vibrate([180,120,180,120,380]); }catch(_){}
  const bellEl = document.getElementById('bellBtn') || document.getElementById('bellBtn2');
  if(bellEl){ bellEl.classList.remove('bell-ringing'); void bellEl.offsetWidth; bellEl.classList.add('bell-ringing'); setTimeout(()=> bellEl.classList.remove('bell-ringing'), (totalDelay*1000)+800); }
  if(typeof showToast==='function') showToast('🔔 Alarma: '+name+' ×'+loops,'warning');
  updateBellDefaultBadge();
}
// === CAMPANA helpers ===
function toggleBell(id){
  const m=document.getElementById(id);
  const btnId = id==='alarmMenu' ? 'bellBtn' : 'bellBtn2';
  const btn=document.getElementById(btnId);
  if(!m) return;
  const isOpen=m.classList.contains('show');
  closeAllBells();
  if(!isOpen){ m.classList.add('show'); if(btn) btn.setAttribute('aria-expanded','true'); updateBellDefaultBadge(); try{ playSound('info'); }catch(e){} }
}
function closeBell(id){
  const m=document.getElementById(id);
  const btnId = id==='alarmMenu' ? 'bellBtn' : 'bellBtn2';
  const btn=document.getElementById(btnId);
  if(m) m.classList.remove('show');
  if(btn) btn.setAttribute('aria-expanded','false');
}
function closeAllBells(){
  ['alarmMenu','alarmMenu2'].forEach(id=>{ const m=document.getElementById(id); if(m) m.classList.remove('show'); });
  document.querySelectorAll('#bellBtn,#bellBtn2').forEach(el=> el.setAttribute('aria-expanded','false'));
}
function setBellDefault(name){ setAlertConfig({defaultAlarm:name}); updateBellDefaultBadge(); if(typeof showToast==='function') showToast('🔔 Por defecto: '+name,'info'); }
function updateBellDefaultBadge(){
  const cfg=getAlertConfig();
  const map={alarm_phone:'📱 Teléfono',alarm_classic:'⏰ Clásica',alarm_urgent:'🚨 Urgente',alarm_soft:'🔔 Suave',alarm_nokia:'🎵 Nokia'};
  const label=map[cfg.defaultAlarm]||cfg.defaultAlarm;
  const b1=document.getElementById('bellDefaultBadge'); if(b1) b1.textContent=label;
  const b2=document.getElementById('bellDefaultBadge2'); if(b2) b2.textContent=label;
  document.querySelectorAll('[data-alarm]').forEach(btn=>{
    const isDef=btn.getAttribute('data-alarm')===cfg.defaultAlarm;
    btn.style.background=isDef?'#f5f3ff':''; btn.style.borderColor=isDef?'#ddd6fe':''; btn.style.fontWeight=isDef?'800':'600';
    const dot=btn.querySelector('.def-dot'); if(dot) dot.style.display=isDef?'inline':'none';
  });
}
(function(){
  if(document.getElementById('bellRingStyle')) return;
  const s=document.createElement('style');
  s.id='bellRingStyle';
  s.textContent='@keyframes bellRing{0%,100%{transform:rotate(0)}15%{transform:rotate(-14deg)}30%{transform:rotate(14deg)}45%{transform:rotate(-8deg)}60%{transform:rotate(8deg)}75%{transform:rotate(-4deg)}} .bell-ringing{animation:bellRing 0.7s ease 2; transform-origin:top center} #bellBtn[aria-expanded="true"],#bellBtn2[aria-expanded="true"]{background:rgba(124,92,255,.10);border-color:rgba(124,92,255,.22)}';
  document.head.appendChild(s);
})();
/* Helper: sonido por acción de chat — mapeo semántico */
const chatSoundMap={
  chat_create:'nuevo', chat_open:'open', chat_delete:'delete', chat_rename:'edit',
  message_send:'send', message_receive:'receive', message_edit:'edit', message_save:'confirm',
  message_delete:'delete', message_copy:'pop', typing_start:'typing', scroll:'whoosh',
  load_more:'whoosh', export:'save', clear:'warning', error:'error', success:'success', info:'info'
};
function playChatSound(action){
  const key = chatSoundMap[action] || action;
  playSound(key);
}
window.playChatSound = playChatSound;

function renderSoundTestGrid(){
  const grid=document.getElementById('soundTestGrid');
  if(!grid) return;
  const order=['success','error','warning','info','nuevo','send','receive','typing','whoosh','pop','confirm','cancel','scroll','upload','save','open','edit','delete','search','chat','documents','rag','llm','test'];
  const alarms=['alarm_phone','alarm_classic','alarm_urgent','alarm_soft','alarm_nokia'];
  let html='';
  html+=`<div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
    <button class="btn btn-primary btn-sm" onclick="setSoundEnabled(true); unlockAudio(true); playSound('success')" style="flex:1">🔊 ACTIVAR Y PROBAR — VOLUMEN AL MÁXIMO</button>
    <button class="btn btn-ghost btn-sm" onclick="setVolume(92); unlockAudio(true); playSound('test')" style="border:1px dashed var(--border)">🧪 Test fuerte</button>
  </div>`;
  order.forEach(k=>{
    const c=soundMap[k];
    if(!c) return;
    html+=`<button class="btn btn-ghost btn-sm" style="justify-content:flex-start;gap:8px" onclick="playSound('${k}')"><span>${c.icon||'🔊'}</span> ${c.label||k}</button>`;
  });
  html+=`<div style="grid-column:1/-1;height:1px;background:var(--border);margin:6px 0"></div>`;
  alarms.forEach(k=>{
    const c=soundMap[k];
    html+=`<button class="btn btn-ghost btn-sm" style="justify-content:flex-start;gap:8px;border-style:dashed" onclick="playAlarm('${k}', document.getElementById('cfgLoops')?parseInt(document.getElementById('cfgLoops').value||3):3)"><span>${c.icon}</span> ${c.label}</button>`;
  });
  grid.innerHTML=html;
}
document.addEventListener('click', (e)=>{
  const isBellBtn = e.target.closest('#bellBtn, #bellBtn2');
  if(isBellBtn) return;
  ['alarmMenu','alarmMenu2'].forEach(id=>{
    const m=document.getElementById(id);
    const btnId = id==='alarmMenu' ? 'bellBtn' : 'bellBtn2';
    const btn=document.getElementById(btnId);
    if(m && !m.contains(e.target) && !e.target.closest('[title="Alarmas tipo celular"]')){
      m.classList.remove('show');
      if(btn) btn.setAttribute('aria-expanded','false');
    }
  });
});
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeAllBells(); });
setTimeout(()=>{ updateSoundIcon(); syncSoundConfigUI(); syncFXUI(); renderSoundTestGrid(); updateBellDefaultBadge(); if(soundEnabled && !audioCtx) unlockAudio(false); setTimeout(()=>{ const b=document.getElementById('soundUnlockBanner'); if(b && soundEnabled && (!_audioUnlocked || (audioCtx && audioCtx.state==='suspended'))) b.style.display='flex'; },1500); }, 0);
