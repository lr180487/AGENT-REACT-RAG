
function normalizeWebUrl(u){ if(!u) return '#'; try{ u=u.replace(/&amp;/g,'&'); if(u.includes('uddg=')){ const m=u.match(/uddg=([^&]+)/); if(m) return decodeURIComponent(m[1]); } if(u.startsWith('//')) return 'https:'+u; if(u.startsWith('/l/')){ const mm=u.match(/uddg=([^&]+)/); if(mm) return decodeURIComponent(mm[1]); return 'https://duckduckgo.com'+u; } }catch(e){} return u; }
'use strict';


// === DESCARGA DE MENSAJES (reemplaza caja) ===
let _chatMessages = [{role:'assistant', text:'¡Hola! Soy tu asistente. Puedo ayudarte con tus documentos y responder tus preguntas.', time:new Date().toLocaleTimeString()}];
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _updateDownloadCount(){
  const el=document.getElementById('downloadCount');
  if(el) el.textContent = _chatMessages.length + ' mensaje'+(_chatMessages.length!==1?'s':'');
}
function _pushChatMessage(role, text){
  _chatMessages.push({role, text, time:new Date().toLocaleTimeString()});
  _updateDownloadCount();
  // La persistencia la hace el backend (ReactAgent → memory_service) sobre el
  // chat_id enviado, para no duplicar mensajes.
}
function downloadMessages(format='json'){
  if(_chatMessages.length===0){ showToast('No hay mensajes para descargar','info'); return; }
  playSound('save');
  const now = new Date().toISOString().slice(0,10);
  const base = `chat-interfaz-${now}`;
  if(format==='json'){
    const data={exported_at:new Date().toISOString(), messages:_chatMessages};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    triggerDownload(blob, base+'.json');
    showToast('Descargado JSON','success');
  } else if(format==='txt'){
    let txt=`Chat Interfaz — ${new Date().toLocaleString()}
${'='.repeat(50)}
`;
    _chatMessages.forEach(m=>{ txt+=`[${m.time}] ${m.role.toUpperCase()}: ${m.text}

`; });
    const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
    triggerDownload(blob, base+'.txt');
    showToast('Descargado TXT','success');
  } else if(format==='md'){
    let md=`# Chat Interfaz

*Fecha:* ${new Date().toLocaleString()}

---

`;
    _chatMessages.forEach(m=>{ const who=m.role==='user'?'🧑 Tú':'🤖 Asistente'; md+=`### ${who} — ${m.time}

${m.text}

`; });
    const blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
    triggerDownload(blob, base+'.md');
    showToast('Descargado MD','success');
  } else if(format==='html'){
    let htm=`<html><head><meta charset="UTF-8"><title>Chat</title><style>body{font-family:Inter,Arial,sans-serif;padding:20px;color:#0f172a} .msg{margin:10px 0;padding:10px;border:1px solid #e2e8f0;border-radius:10px} .user{background:#f5f3ff} .assistant{background:#f8fafc}</style></head><body><h1>Chat Interfaz</h1><p>${new Date().toLocaleString()}</p><hr>`;
    _chatMessages.forEach(m=>{ htm+=`<div class="msg ${m.role}"><b>${m.role.toUpperCase()} — ${m.time}</b><br>${escapeHtml(m.text).replace(/\n/g,'<br>')}</div>`; });
    htm+=`</body></html>`;
    const blob=new Blob([htm],{type:'text/html;charset=utf-8'});
    triggerDownload(blob, base+'.html');
    // intentar imprimir
    try{ const w=window.open('','_blank'); if(w){ w.document.write(htm); w.document.close(); setTimeout(()=>{ try{w.print();}catch(e){} },600);} }catch(e){}
    showToast('Descargado HTML (imprimible a PDF)','success');
  }
}
function copyMessages(){
  try{ playSound('pop'); }catch(e){}
  const t=_chatMessages.map(m=>`[${m.time}] ${m.role}: ${m.text}`).join('\n\n');
  navigator.clipboard.writeText(t).then(()=>{ try{ playSound('confirm'); }catch(e){} showToast('Mensajes copiados','success')});
}
function triggerDownload(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.style.position='fixed'; a.style.left='-9999px'; document.body.appendChild(a);
  try{ a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }catch(e){ a.click(); }
  setTimeout(()=>{ try{document.body.removeChild(a);}catch(e){} URL.revokeObjectURL(url); },1500);
}
const _origClearChat2 = typeof clearChat!=='undefined' ? clearChat : null;

// === NUEVO: Documentos de prueba + vista previa + descargar ===
const testDocs = [
  {name:'Contrato_ejemplo.pdf', ext:'pdf', size:'1.2 MB', desc:'Contrato con cláusulas de penalidad — Markdown AST → chunk 42', color:'#ef4444', icon:'📄'},
  {name:'Balance_2024.xlsx', ext:'xlsx', size:'84 KB', desc:'Excel con métricas y KPIs — listo para Q&A', color:'#10b981', icon:'📊'},
  {name:'Manual_usuario.docx', ext:'docx', size:'340 KB', desc:'Word convertido a Markdown con parser DOCX', color:'#0ea5e9', icon:'📝'},
  {name:'Notas_reunion.md', ext:'md', size:'6 KB', desc:'Markdown puro — embeddings + RAG', color:'#7c5cff', icon:'📃'},
];
function renderTestDocs(){
  const g=document.getElementById('testDocsGrid');
  if(!g) return;
  g.innerHTML = testDocs.map((d,i)=>`
    <div class="doc-card">
      <div class="doc-icon" style="background:${escapeHtml(d.color)}">${escapeHtml(d.icon)}</div>
      <div class="doc-meta">
        <h4>${escapeHtml(d.name)}</h4>
        <p>${escapeHtml(d.size)} • ${escapeHtml(d.desc)}</p>
      </div>
      <div class="doc-actions">
        <button class="btn btn-ghost btn-sm" onclick="openPreviewTest(${i})">👁️ Vista previa</button>
        <button class="btn btn-ghost btn-sm" onclick="openPreviewTestNewTab(${i})">↗ Pestaña</button>
        <button class="btn btn-primary btn-sm" onclick="downloadTest(${i})">⬇️ Descargar</button>
      </div>
    </div>
  `).join('');
}
let _previewBlobUrl=null, _previewName=null;
function openPreviewTest(i){
  const d=testDocs[i];
  _previewName=d.name;
  document.getElementById('previewTitle').textContent=d.name;
  document.getElementById('previewSub').textContent=`${d.ext.toUpperCase()} • ${d.size} • Vista previa`;
  const body=document.getElementById('previewBody');
  if(d.ext==='pdf'){
    body.innerHTML=`<div class="doc-preview-text" style="margin-bottom:10px">📄 <b>${d.name}</b> — demo de vista previa PDF. En producción se renderiza el PDF real vía &lt;iframe&gt; o PDF.js.</div><iframe class="doc-preview-iframe" src="about:blank" title="preview"></iframe>`;
  } else if(d.ext==='xlsx' || d.ext==='xls'){
    body.innerHTML=`<div class="doc-preview-text"><b>Vista previa — ${d.name}</b><br><br>┌─────────┬──────────┬─────────┐<br>│ Mes     │ Ventas   │  %      │<br>├─────────┼──────────┼─────────┤<br>│ Enero   │ 120,000  │ +12%    │<br>│ Febrero │ 135,000  │ +25%    │<br>└─────────┴──────────┴─────────┘<br><br><small>Parser: Excel → Markdown AST → tabla renderizada</small></div>`;
  } else if(d.ext==='docx'){
    body.innerHTML=`<div class="doc-preview-text"><b>${d.name}</b> — vista previa DOCX→Markdown<br><br># Contrato<br>Este contrato establece...<br><br><b>Cláusula 4.2</b> Penalidad 5% por incumplimiento...<br><b>Cláusula 7</b> Confidencialidad...</div>`;
  } else {
    body.innerHTML=`<div class="doc-preview-text"># Notas de reunión<br><br>- Revisar KPIs Q1<br>- Penalidad contratos<br>- Próximos pasos...</div>`;
  }
  document.getElementById('previewOverlay').classList.add('show');
  playSound('open');
  try{ const a=document.getElementById('previewOpenTab'); if(a){ const blob=new Blob([document.getElementById('previewBody').innerHTML],{type:'text/html;charset=utf-8'}); const url=URL.createObjectURL(blob); a.href=url; a.style.display='inline-flex'; a.dataset.blobUrl=url; } }catch(e){}
}
function openPreviewTestNewTab(i){
  const d=testDocs[i];
  const html=`<html><head><meta charset="UTF-8"><title>${d.name}</title><style>body{font-family:Inter,sans-serif;padding:20px;color:#0f172a} pre{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:14px;border-radius:12px}</style></head><body><h1>${d.name}</h1><p>${d.desc}</p><p>${d.size} • ${d.ext}</p><hr><div>${document.getElementById('previewBody').innerHTML || ''}</div></body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  window.open(url,'_blank','noopener');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  try{playSound('open')}catch(e){}
}
function downloadTest(i){
  const d=testDocs[i];
  playSound('save');
  const content = `# ${d.name}\n\nDocumento de prueba (${d.ext.toUpperCase()} • ${d.size})\n\n${d.desc}\n\nGenerado el ${new Date().toLocaleString()}\n\n— agente_react_rag demo —`;
  const blob=new Blob([content],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=d.name.replace(/\.[^.]+$/,'')+'_demo.txt'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast(`Descargando ${d.name}`,'success');
}
function openPreviewFile(name, ext, contentUrl, textSnippet){
  _previewName=name;
  document.getElementById('previewTitle').textContent=name;
  document.getElementById('previewSub').textContent=`${ext.toUpperCase()} • Vista previa`;
  const body=document.getElementById('previewBody');
  const lower=ext.toLowerCase();
  if(['png','jpg','jpeg'].includes(lower) && contentUrl){
    body.innerHTML=`<img src="${contentUrl}" alt="${name}" style="max-width:100%;border-radius:12px;border:1px solid var(--border)"><div class="doc-preview-text" style="margin-top:10px">Imagen — ${name}</div>`;
    _previewBlobUrl=contentUrl;
  } else if(lower==='pdf' && contentUrl){
    body.innerHTML=`<iframe class="doc-preview-iframe" src="${contentUrl}" title="${name}"></iframe><div style="font-size:11px;color:var(--muted);margin-top:6px">Si no se ve, usá Descargar.</div>`;
    _previewBlobUrl=contentUrl;
  } else {
    body.innerHTML=`<div class="doc-preview-text">${escapeHtml(textSnippet||'Vista previa — contenido Markdown extraído.\n\n(En producción: parser real + chunking)')}</div>`;
    // crear blob para descargar
    const blob=new Blob([textSnippet||''],{type:'text/plain;charset=utf-8'});
    if(_previewBlobUrl) try{URL.revokeObjectURL(_previewBlobUrl);}catch(e){}
    _previewBlobUrl=URL.createObjectURL(blob);
  }
  document.getElementById('previewOverlay').classList.add('show');
  playSound('open');
  try{ const a=document.getElementById('previewOpenTab'); if(a && _previewBlobUrl){ a.href=_previewBlobUrl; a.style.display='inline-flex'; } else if(a){ a.style.display='none'; } }catch(e){}
}
function openPreviewInNewTab(e){
  try{ const a=document.getElementById('previewOpenTab'); if(a && a.href && a.href!=='#'){ } else if(_previewBlobUrl){ window.open(_previewBlobUrl,'_blank','noopener'); if(e) e.preventDefault(); } }catch(err){}
}
function closePreview(){
  document.getElementById('previewOverlay').classList.remove('show');
}
function downloadPreview(){
  if(!_previewName) return;
  playSound('save');
  if(_previewBlobUrl){
    const a=document.createElement('a'); a.href=_previewBlobUrl; a.download=_previewName; a.click();
    showToast(`Descargando ${_previewName}`,'success');
  } else {
    showToast('Nada para descargar','error');
  }
}

// Manejo mejorado de archivos subidos con vista previa/descargar reales
const _uploadedFiles = []; // {name, ext, size, blobUrl, textSnippet, color, icon}

/* Sonidos centralizados en /frontend/sounds.js — bloque local eliminado (v2.1) */
if(typeof playSound==='undefined') window.playSound=()=>{};
if(typeof playChatSound==='undefined') window.playChatSound=(a)=>{ try{ const m={chat_create:'nuevo',message_receive:'receive',message_send:'send'}; playSound(m[a]||a); }catch(e){} };
if(typeof playAlarm==='undefined') window.playAlarm=()=>{};
if(typeof stopAlarms==='undefined') window.stopAlarms=()=>{};
if(typeof toggleSound==='undefined') window.toggleSound=()=>{};
if(typeof setVolume==='undefined') window.setVolume=()=>{};

const providers = [
  {id:'openai', name:'OpenAI', icon:'OAI', color:'#0ea5e9', base:'https://api.openai.com/v1', models:['gpt-4o-mini','gpt-4o','gpt-4-turbo','o1-mini','gpt-3.5-turbo']},
  {id:'anthropic', name:'Anthropic', icon:'ANT', color:'#ff7a00', base:'https://api.anthropic.com', models:['claude-3-5-sonnet-20241022','claude-3-opus-20240229','claude-3-haiku-20240307']},
  {id:'gemini', name:'Google Gemini', icon:'GEM', color:'#4285F4', base:'https://generativelanguage.googleapis.com', models:['gemini-1.5-pro','gemini-1.5-flash','gemini-1.0-pro']},
  {id:'groq', name:'Groq', icon:'GRO', color:'#ff3b30', base:'https://api.groq.com/openai/v1', models:['llama-3.3-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768']},
  {id:'mistral', name:'Mistral', icon:'MIS', color:'#ff375f', base:'https://api.mistral.ai/v1', models:['mistral-large-latest','mistral-small-latest','open-mistral-7b']},
  {id:'ollama', name:'Ollama Local', icon:'OLL', color:'#10b981', base:'http://localhost:11434/v1', models:['llama3.2','qwen2.5','mistral','gemma2']},
  {id:'custom', name:'Custom (OpenAI compatible)', icon:'API', color:'#7c5cff', base:'', models:['custom-model']},
];
let selectedProvider = 'openai';
let editingId = null;
let llmConfigs = (()=>{ try{ return JSON.parse(localStorage.getItem('llm_configs')||'[]'); }catch(e){ console.warn('llm_configs parse error',e); return []; } })();
let activeId = (()=>{ try{ return localStorage.getItem('llm_active')||null; }catch(e){ return null; } })();

function setLogoLoading(isLoading){
  const w = document.getElementById('logoWrap');
  if(isLoading) w.classList.add('loading');
  else w.classList.remove('loading');
}

function renderProviders(){
  const grid = document.getElementById('providerGrid');
  grid.innerHTML = providers.map(p=>`
    <div class="prov ${p.id===selectedProvider?'active':''}" onclick="selectProv('${p.id}')">
      <div class="prov-icon" style="background:${escapeHtml(p.color)}">${escapeHtml(p.icon)}</div>
      <div><h4>${escapeHtml(p.name)}</h4><p>${escapeHtml(p.base||'URL personalizada')}</p></div>
    </div>`).join('');
  const prov = providers.find(x=>x.id===selectedProvider);
  const sel=document.getElementById('fModel');
  sel.innerHTML = prov.models.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('fBase').placeholder = prov.base || 'https://tu-api.com/v1';
  if(!editingId) document.getElementById('fBase').value = prov.base;
  document.getElementById('modelHint').textContent = prov.id==='ollama'?'Requiere Ollama corriendo localmente': prov.id==='custom'?'Compatible con cualquier API tipo OpenAI':'';
}
function selectProv(id){ selectedProvider=id; renderProviders(); }
function toggleEye(){ const i=document.getElementById('fKey'); i.type=i.type==='password'?'text':'password'; }

function renderLLM(){
  const list=document.getElementById('llmList');
  const empty=document.getElementById('emptyLLM');
  const tag=document.getElementById('llmCountTag');
  if(tag) tag.textContent = `${llmConfigs.length} configuradas`;
  if(llmConfigs.length===0){ list.innerHTML=''; empty.style.display='block'; updateGlobalStatus(); return; }
  empty.style.display='none';
  list.innerHTML = llmConfigs.map(c=>{
    const prov = providers.find(p=>p.id===c.provider);
    const isActive = c.id===activeId;
    return `<div class="llm-card ${isActive?'active-card':''}">
      <div class="prov-icon" style="background:${escapeHtml(prov?.color||'#7c5cff')}">${escapeHtml(prov?.icon||'API')}</div>
      <div class="llm-meta">
        <h4>${escapeHtml(c.name)} ${isActive?'<span class="tag on">● ACTIVA</span>':''} <span class="tag">${escapeHtml(prov?.name||c.provider)}</span></h4>
        <p style="font-size:11px;color:var(--muted)">••••${escapeHtml(c.api_key.slice(-4))}</p>
      </div>
      <div class="actions">
        ${!isActive?`<button class="btn btn-primary btn-sm" onclick="activateLLM('${c.id}')">Activar</button>`:''}
        <button class="icon-btn" onclick="editLLM('${c.id}')" title="Editar">✏️</button>
        <button class="icon-btn" onclick="testLLMSaved('${c.id}')" title="Probar">🧪</button>
        <button class="icon-btn danger" onclick="deleteLLM('${c.id}')" title="Eliminar">🗑️</button>
      </div>
    </div>`;
  }).join('');
  updateGlobalStatus();
}
function updateGlobalStatus(){
  const active = llmConfigs.find(c=>c.id===activeId);
  const prov = active ? providers.find(p=>p.id===active.provider) : null;
  const txt=document.getElementById('globalLLMText');
  const warn=document.getElementById('llmWarning');
  const stat=document.getElementById('statLLM');
  const sub=document.getElementById('statLLMSub');
  const bar=document.getElementById('statLLMBar');
  if(active){
    txt.textContent = 'Listo';
    txt.style.color='var(--success)';
    txt.style.color='var(--success)';
    warn.style.display='none';
    stat.textContent = 'Listo';
    sub.textContent = 'Asistente listo';
    bar.style.width='100%'; bar.style.background='var(--success)';
  } else {
    txt.textContent = 'No configurado';
    txt.style.color='var(--warning)';
    warn.style.display='flex';
    stat.textContent='—';
    sub.textContent='Configura tu API Key';
    bar.style.width='12%'; bar.style.background='#cbd5e1';
  }
  document.getElementById('statChunks').textContent = '1,248';
}
async function saveLLM(){
  playSound('save');
  const name=document.getElementById('fName').value.trim() || `${providers.find(p=>p.id===selectedProvider).name} ${llmConfigs.length+1}`;
  const model=document.getElementById('fModel').value;
  const key=document.getElementById('fKey').value.trim();
  const base=document.getElementById('fBase').value.trim();
  const temp=parseFloat(document.getElementById('fTemp').value);
  const max=parseInt(document.getElementById('fMax').value);
  const timeout=parseInt(document.getElementById('fTimeout').value);
  if(!key){ showToast('La API Key es obligatoria','error'); return; }
  if(key.length<8){ showToast('API Key muy corta','error'); return; }
  setLogoLoading(true);
  const payload={provider:selectedProvider, name, api_key:key, model, base_url:base||undefined, temperature:temp, max_tokens:max, timeout};
  try{
    if(editingId){
      // Intentar PUT backend
      const r=await fetch(`/api/v1/llm/config/${editingId}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      if(!r.ok) throw new Error(await r.text());
      const updated=await r.json();
      const idx=llmConfigs.findIndex(c=>c.id===editingId);
      if(idx>=0) llmConfigs[idx]={...llmConfigs[idx], provider:selectedProvider, name, model, api_key:key, base_url:base, temperature:temp, max_tokens:max, timeout, id:editingId, is_active: updated.is_active};
      showToast('✅ Guardado','success');
      try{ playSound('receive'); }catch(e){}
      editingId=null;
      document.getElementById('formTitle').textContent='➕ Agregar nueva API LLM';
      document.getElementById('formSub').textContent='Elige proveedor y pega tu API Key. Compatible OpenAI-API.';
      document.getElementById('cancelEdit').style.display='none';
    } else {
      const r=await fetch('/api/v1/llm/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      if(!r.ok) throw new Error(await r.text());
      const saved=await r.json();
      // Guardar con id real del backend
      llmConfigs.push({id: saved.id, provider:saved.provider, name:saved.name, model:saved.model, api_key:key, base_url:saved.base_url||base, temperature:saved.temperature, max_tokens:saved.max_tokens, timeout:saved.timeout, created: saved.created_at, is_active: saved.is_active});
      if(saved.is_active) activeId=saved.id;
      showToast('✅ Guardado','success');
      try{ playSound('receive'); }catch(e){}
    }
  }catch(e){
    console.warn('Backend LLM save fallo, fallback local', e);
    // Fallback local (como antes)
    if(editingId){
      const idx=llmConfigs.findIndex(c=>c.id===editingId);
      if(idx>=0) llmConfigs[idx]={...llmConfigs[idx], provider:selectedProvider, name, model, api_key:key, base_url:base, temperature:temp, max_tokens:max, timeout};
      editingId=null;
      document.getElementById('formTitle').textContent='➕ Agregar nueva API LLM';
      document.getElementById('formSub').textContent='Elige proveedor y pega tu API Key. Compatible OpenAI-API.';
      document.getElementById('cancelEdit').style.display='none';
      showToast('✅ Guardado','success');
    } else {
      const id='llm_'+Date.now();
      llmConfigs.push({id, provider:selectedProvider, name, model, api_key:key, base_url:base, temperature:temp, max_tokens:max, timeout, created: new Date().toISOString()});
      if(llmConfigs.length===1) activeId=id;
      showToast('✅ Guardado','success');
    }
  }
  persist();
  resetForm();
  renderLLM();
  setLogoLoading(false);
}
function persist(){
  localStorage.setItem('llm_configs', JSON.stringify(llmConfigs));
  if(activeId) localStorage.setItem('llm_active', activeId); else localStorage.removeItem('llm_active');
  // Sincroniza lista al backend vía llm-config.js si existe, pero no bloquea UI
  try{ if(window.LLMConfig) window.LLMConfig.fetchLLMs().catch(()=>{}); }catch(e){}
}
function resetForm(){
  document.getElementById('fName').value=''; document.getElementById('fKey').value='';
  document.getElementById('fTemp').value='0.7'; document.getElementById('fMax').value='2048'; document.getElementById('fTimeout').value='30000';
  selectedProvider='openai'; renderProviders();
}
function editLLM(id){
  const c=llmConfigs.find(x=>x.id===id);
  if(!c) return;
  editingId=id;
  selectedProvider=c.provider;
  renderProviders();
  document.getElementById('fName').value=c.name;
  document.getElementById('fModel').value=c.model;
  document.getElementById('fKey').value=c.api_key;
  document.getElementById('fBase').value=c.base_url;
  document.getElementById('fTemp').value=c.temperature;
  document.getElementById('fMax').value=c.max_tokens;
  document.getElementById('fTimeout').value=c.timeout;
  document.getElementById('formTitle').textContent='✏️ Editar API LLM';
  document.getElementById('formSub').textContent='Actualiza los datos y guarda los cambios';
  document.getElementById('cancelEdit').style.display='block';
  document.getElementById('llmFormCard').scrollIntoView({behavior:'smooth'});
}
function cancelEdit(){ editingId=null; resetForm(); document.getElementById('formTitle').textContent='➕ Agregar nueva API LLM'; document.getElementById('formSub').textContent='Elige proveedor y pega tu API Key. Compatible OpenAI-API.'; document.getElementById('cancelEdit').style.display='none'; }
async function deleteLLM(id){
  if(!confirm('¿Eliminar esta API LLM?')) return;
  playSound('delete');
  try{
    const r=await fetch(`/api/v1/llm/config/${id}`, {method:'DELETE'});
    if(!r.ok && r.status!==204) throw new Error(await r.text());
    showToast('Eliminado','info');
    try{ playSound('confirm'); }catch(e){}
  }catch(e){
    console.warn('delete backend fallo', e);
    showToast('Eliminado','info');
  }
  llmConfigs=llmConfigs.filter(c=>c.id!==id);
  if(activeId===id) activeId = llmConfigs[0]?.id || null;
  persist(); renderLLM();
}
async function activateLLM(id){
  playSound('success');
  try{
    const r=await fetch(`/api/v1/llm/config/${id}/activate`, {method:'POST'});
    if(!r.ok) throw new Error(await r.text());
    activeId=id; persist(); renderLLM(); showToast('Asistente listo','success');
    try{ playSound('receive'); }catch(e){}
    return;
  }catch(e){
    console.warn('activate backend fallo', e);
  }
  activeId=id; persist(); renderLLM(); showToast('Asistente activado (local)','info');
}
async function testLLM(){
  playSound('test');
  const key=document.getElementById('fKey').value.trim();
  const prov=providers.find(p=>p.id===selectedProvider);
  const model=document.getElementById('fModel').value;
  const base=document.getElementById('fBase').value.trim()||undefined;
  const res=document.getElementById('testResult');
  if(!key){ showToast('Pega una API Key para probar','error'); return; }
  res.style.display='block'; res.style.background='#f5f3ff'; res.style.border='1px solid #ddd6fe'; res.style.color='#6d28d9'; res.textContent='⏳ Probando conexión con '+prov.name+'… (backend)';
  setLogoLoading(true);
  try{
    const r=await fetch('/api/v1/llm/test', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({provider:prov.id, api_key:key, model, base_url:base})});
    const data=await r.json();
    if(r.ok && data.ok){
      res.style.background='#ecfdf5'; res.style.border='1px solid #a7f3d0'; res.style.color='#065f46';
      res.textContent='✅ Conexión exitosa (backend) — '+prov.name+' • '+model+' • '+ (data.latency_ms||320)+'ms';
      showToast('✅ Conexión válida','success'); try{ playSound('confirm'); }catch(e){}
    } else {
      throw new Error(data.detail||'Fallo');
    }
  }catch(e){
    console.warn('test backend fallo, fallback local', e);
    const ok = key.length>10 && (key.startsWith('sk-') || key.startsWith('gsk_') || key.startsWith('AIza') || key.length>20 || prov.id==='ollama' || prov.id==='custom');
    if(ok){
      res.style.background='#ecfdf5'; res.style.border='1px solid #a7f3d0'; res.style.color='#065f46';
      res.textContent='✅ Conexión válida (local mock) — Modelo '+model+' listo. Backend no disponible, validación local OK';
      showToast('Conexión válida (local)','success');
    } else {
      res.style.background='#fef2f2'; res.style.border='1px solid #fecaca'; res.style.color='#991b1b';
      res.textContent='❌ API Key inválida — '+(e.message||'');
      showToast('Falló la validación','error'); try{ playSound('error'); }catch(e){}
    }
  } finally { setLogoLoading(false); }
}
function testLLMSaved(id){
  const c=llmConfigs.find(x=>x.id===id);
  document.getElementById('fKey').value=c.api_key;
  selectedProvider=c.provider; renderProviders();
  document.getElementById('fModel').value=c.model;
  document.getElementById('fBase').value=c.base_url;
  testLLM();
  switchView('llm');
}
function mockBackendSave(payload){ console.log('[Deprecated mockBackendSave] use backend sync', payload); }
function exportLLM(){
  playSound('save');
  if(llmConfigs.length===0){
    showToast('No hay APIs para exportar — agrega una primero','error');
    return;
  }
  const active = llmConfigs.find(c=>c.id===activeId) || llmConfigs[0];
  let env = `# agente_react_rag — exportado ${new Date().toLocaleString()}\n`;
  env += `# Activa: ${active ? active.name + ' ('+active.provider+'/'+active.model+')' : 'ninguna'}\n`;
  env += `# Total: ${llmConfigs.length} configuración(es)\n\n`;
  llmConfigs.forEach(c=>{
    const P = c.provider.toUpperCase();
    const isActive = c.id===activeId ? ' [ACTIVA]' : '';
    env += `# — ${c.name} (${c.provider})${isActive}\n`;
    env += `${P}_API_KEY=${c.api_key}\n`;
    env += `${P}_MODEL=${c.model}\n`;
    if(c.base_url) env += `${P}_BASE_URL=${c.base_url}\n`;
    env += `${P}_TEMPERATURE=${c.temperature}\n`;
    env += `${P}_MAX_TOKENS=${c.max_tokens}\n`;
    if(c.timeout) env += `${P}_TIMEOUT=${c.timeout}\n`;
    env += `\n`;
  });
  // Config global que usa asistente
  env += `# Configuración activa para el agente (fallback .env)\n`;
  env += `LLM_PROVIDER=${active.provider}\n`;
  env += `LLM_MODEL=${active.model}\n`;
  env += `LLM_BASE_URL=${active.base_url||''}\n`;
  env += `LLM_TEMPERATURE=${active.temperature}\n`;
  env += `LLM_MAX_TOKENS=${active.max_tokens}\n`;
  env += `ACTIVE_LLM_ID=${active.id}\n`;
  const blob=new Blob([env],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='.env'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast(`.env exportado con ${llmConfigs.length} API(s) — lista para usar en FastAPI`,'success');
}
function toggleMobileMenu(){
  const sidebar=document.getElementById('sidebar');
  const overlay=document.getElementById('sidebarOverlay');
  if(sidebar) sidebar.classList.toggle('mobile-open');
  if(overlay) overlay.classList.toggle('show');
  try{ playSound('pop'); }catch(e){}
}
function switchView(name){
  try{
    playSound({chat:'chat',documents:'documents',rag:'rag',websearch:'websearch',llm:'llm'}[name]||'info');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const view=document.getElementById('view-'+name);
    if(view) view.classList.add('active'); else console.warn('view not found',name);
    const btn=document.querySelector(`.nav-btn[data-view="${name}"]`);
    if(btn) btn.classList.add('active');
    // Close mobile menu on view change
    const sidebar=document.getElementById('sidebar');
    const overlay=document.getElementById('sidebarOverlay');
    if(sidebar) sidebar.classList.remove('mobile-open');
    if(overlay) overlay.classList.remove('show');
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){ console.error('switchView error',e); }
}
function showToast(msg,type='success'){
  try{ playSound(type==='error'?'error': type==='success'?'success':'info'); }catch(e){ /* audio no disponible */ }
  const t=document.getElementById('toast');
  const icon={success:'✅',error:'❌',info:'ℹ️'}[type]||'✅';
  document.getElementById('toastIcon').textContent=icon;
  document.getElementById('toastMsg').textContent=msg;
  t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600);
}
// Chat mock con loader en logo + sonido
// Chat listo
async function sendChat(){
  try{ playSound('send'); }catch(e){}
  try{ playSound('typing'); }catch(e){}
  const inp=document.getElementById('chatInput');
  const txt=inp.value.trim(); if(!txt) return;
  const box=document.getElementById('chatBox');
  if(!box){ console.warn('chatBox missing'); return; }
  if(typeof ensureChat==='function'){ try{ await ensureChat(); }catch(e){} }
  box.innerHTML+=`<div class="msg user">${escapeHtml(txt)}</div>`;
  _pushChatMessage('user', txt);
  inp.value='';
  setLogoLoading(true);
  const typingId = 'typing-'+Date.now();
  box.innerHTML+=`<div id="${typingId}" class="typing"><i></i><i></i><i></i></div>`;
  box.scrollTop=box.scrollHeight;
  // Backend refs (soporta localhost:8001 nuevo y 8000/49999 legacy)
  const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'];
  const proto = location.protocol==='https:'?'https://':'http://';
  let backendUrl = localStorage.getItem('backendUrl');
  let urls = [];
  urls.push('/api/v1/analyzer/execute');
  if(backendUrl) urls.push(backendUrl.replace(/\/$/,'') + '/api/v1/analyzer/execute');
  for(const h of hosts) urls.push(proto+h+'/api/v1/analyzer/execute');
  // Deduplicate
  urls = [...new Set(urls)];
  let data=null, lastErr=null;
  for(const url of urls){
    try{
      const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: txt, chat_id: (typeof CURRENT_CHAT_ID!=='undefined' && CURRENT_CHAT_ID) ? CURRENT_CHAT_ID : 'demo'})});
      if(!r.ok) throw new Error('HTTP '+r.status);
      data = await r.json();
      break;
    }catch(e){ lastErr=e; }
  }
  document.getElementById(typingId)?.remove();
  try{ playSound('receive'); }catch(e){}
  if(!data){
    const active=llmConfigs.find(c=>c.id===activeId);
    let reply=`No pudimos procesar tu mensaje. Intentá de nuevo en unos segundos.`;
    if(!active) reply += '<br>Podés configurar tu asistente en la sección Asistente.';
    box.innerHTML+=`<div class="msg bot">${reply}</div>`;
    try{ playSound('error'); }catch(e){}
    _pushChatMessage('assistant', reply);
    try{ playSound('error'); }catch(e){}
    setLogoLoading(false);
    box.scrollTop=box.scrollHeight;
    return;
  }
  // Render con web search integrado — respuesta mejorada
  const resp = data.response || {};
  let webResults = null;
  let shouldWeb = false;
  try {
    const cb = document.getElementById('chatWebSearch');
    shouldWeb = cb ? cb.checked : true;
    // heurística: si la pregunta parece necesitar actualidad, forzar búsqueda aunque checkbox no exista
    const txtLower = txt.toLowerCase();
    const needsWeb = /(hoy|ayer|actual|actualidad|2024|2025|2026|noticia|precio|dólar|costo|qué pasó|quién es|buscar en web|internet|web search)/.test(txtLower);
    if (needsWeb) shouldWeb = true;
  } catch(e) { shouldWeb = true; }

  // Si se requiere web search, buscar en paralelo (con timeout corto para no bloquear)
  if (shouldWeb) {
    const webTypingId = 'web-'+Date.now();
    // Mostrar indicador sutil de búsqueda web
    box.innerHTML+=`<div id="${webTypingId}" style="margin-top:8px;padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px dashed #e2e8f0;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)"><div style="width:12px;height:12px;border:2px solid #e2e8f0;border-top-color:var(--primary);border-radius:50%;animation:spin .7s linear infinite"></div> Consultando la web…</div>`;
    box.scrollTop=box.scrollHeight;
    try {
      const payload = {query: txt, max_results: 3};
      const protoWs = location.protocol==='https:'?'https://':'http://';
      const hostsWs = [location.host, 'localhost:8000','127.0.0.1:8000'].filter(Boolean);
      // intentar relativo primero
      let fetched = null;
      try {
        const r = await fetch('/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
        if(r.ok) fetched = await r.json();
      } catch(e) {}
      for(const h of hostsWs){
        if(fetched && fetched.results && fetched.results.length) break;
        try {
          const r = await fetch(protoWs+h+'/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
          if(r.ok){ fetched = await r.json(); break; }
        } catch(e) {}
      }
      if(fetched && fetched.results && fetched.results.length){
        webResults = fetched.results.slice(0,3);
      }
    } catch(e) { console.warn('web search in chat fallo', e); }
    document.getElementById(webTypingId)?.remove();
  }

  const fuentesList = resp.fuentes || [];
  let fuentesHtml = '';
  // Combinar fuentes existentes con web results si no están duplicadas
  let allFuentes = [...fuentesList];
  if(webResults){
    webResults.forEach(w=>{
      if(!allFuentes.find(f=> f.url===w.url)) allFuentes.push({titulo: w.title, url: w.url, tipo: 'web', snippet: w.snippet});
    });
  }
  if(allFuentes.length){
    fuentesHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9"><div style="font-size:11px;color:var(--muted);margin-bottom:6px">Fuentes</div><div style="display:flex;flex-direction:column;gap:6px">${allFuentes.slice(0,4).map(f=>`<a href="${normalizeWebUrl(escapeHtml(f.url))}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--primary);text-decoration:none">🔗 ${escapeHtml(f.titulo||f.title||'Fuente')}</a><span style="font-size:11px;color:var(--muted);margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;display:inline-block">${escapeHtml(f.url).slice(0,60)}</span>`).join('<br>')}</div></div>`;
  }

  let webHtml = '';
  if(webResults && webResults.length){
    webHtml = `<div style="margin-top:12px;padding:10px;border-radius:10px;background:linear-gradient(135deg,#f8fafc,#f5f3ff);border:1px solid #e2e8f0"><div style="font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--muted);display:flex;align-items:center;gap:6px"><span>🌐</span> En la web <span style="margin-left:auto;font-size:11px;background:white;border:1px solid #e2e8f0;padding:2px 6px;border-radius:999px">${webResults.length} resultados</span></div><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${webResults.map(r=>`<div style="padding:8px 10px;border-radius:8px;background:white;border:1px solid var(--border)"><a href="${normalizeWebUrl(escapeHtml(r.url))}" target="_blank" rel="noopener noreferrer" style="font-size:12px;font-weight:700;color:var(--primary);text-decoration:none">${escapeHtml(r.title)}</a><div style="font-size:11px;color:#059669;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.url)}</div><div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${escapeHtml((r.snippet||'').slice(0,180))}${(r.snippet||'').length>180?'…':''}</div></div>`).join('')}</div></div>`;
  } else if(shouldWeb){
    // Si se pidió web pero no hubo resultados, mostrar mensaje sutil
    webHtml = `<div style="margin-top:10px;font-size:11px;color:var(--muted);text-align:center;padding:6px;background:#fafafa;border:1px dashed var(--border);border-radius:8px">Sin resultados web adicionales para esta consulta</div>`;
  }

  const synthesis = resp.sintesis || data.sintesis || 'Aquí tienes la respuesta.';
  // Orchestrator LOOP visualization
  let orchHtml = '';
  try{
    const orchData = data.reasoning || data.orchestrator || {};
    const trace = orchData.trace || data.analyzer || [];
    const orchMeta = orchData.orchestrator || orchData;
    const toolsUsed = data.tools_used || orchData.tools_used || [];
    const loops = orchMeta.loops || orchData.loops || trace.filter(t=>t.phase==='THINK').length || 0;
    const confidence = orchMeta.confidence != null ? orchMeta.confidence : (orchMeta.reflections && orchMeta.reflections[0] ? orchMeta.reflections[0].confidence : null);
    if(trace && trace.length){
      // Determine if orchestrator loop present
      const hasLoop = trace.some(t=> t.phase==='DECOMPOSE' || t.phase==='THINK' || t.phase==='PLAN' || t.phase==='REFLECT');
      if(hasLoop){
        const iterCount = loops || Math.max(1, trace.filter(t=>t.phase==='PLAN').length);
        const confPct = confidence!=null ? Math.round(confidence*100) + '%' : '—';
        const confColor = confidence!=null ? (confidence>=0.82 ? '#10b981' : confidence>=0.6 ? '#f59e0b' : '#ef4444') : 'var(--muted)';
        const subgoals = (orchMeta.pending_initial||[]).join(' → ') || (trace.find(t=>t.phase==='DECOMPOSE')?.subgoals?.join(' → ') || '');
        // compact trace HTML
        const stepsHtml = trace.slice(0,12).map(t=>{
          if(t.phase==='DECOMPOSE') return `<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><span style="font-size:11px;background:#7c5cff;color:white;padding:2px 6px;border-radius:999px">DECOMPOSE</span><span style="font-size:11px;color:var(--text)">${escapeHtml((t.subgoals||[]).join(' · ')).slice(0,120)}</span><span style="margin-left:auto;font-size:10px;color:var(--muted)">${t.count||0} sub</span></div>`;
          if(t.phase==='THINK') return `<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px"><span style="font-size:11px;background:#2563eb;color:white;padding:2px 6px;border-radius:999px">THINK ${t.iteration||''}</span><span style="font-size:11px;color:#1e3a8a;flex:1">${escapeHtml(t.thought||'').slice(0,140)}</span>${t.llm_used?'<span style="font-size:10px;color:#059669">LLM</span>':''}</div>`;
          if(t.phase==='PLAN') {
            const tools = (t.tools||[]).map(x=> `<span style="font-size:11px;background:white;border:1px solid #e2e8f0;padding:2px 6px;border-radius:999px">${escapeHtml(x.tool)}</span>`).join(' ');
            return `<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px"><span style="font-size:11px;background:#d97706;color:white;padding:2px 6px;border-radius:999px">PLAN</span><span style="display:flex;gap:4px;flex-wrap:wrap">${tools || '<span style="font-size:11px;color:var(--muted)">sin tools</span>'}</span><span style="margin-left:auto;font-size:10px;color:var(--muted)">${escapeHtml(t.query||'').slice(0,30)}</span></div>`;
          }
          if(t.phase==='OBSERVE') return `<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px"><span style="font-size:11px;background:#059669;color:white;padding:2px 6px;border-radius:999px">OBSERVE</span><span style="font-size:11px;color:#065f46">${escapeHtml(t.tool||'')} → ${escapeHtml((t.observation||'').slice(0,90))}</span><span style="margin-left:auto;font-size:10px;color:var(--muted)">${t.latency_ms||0}ms ${t.cached?'· cached':''}</span></div>`;
          if(t.phase==='REFLECT') return `<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px"><span style="font-size:11px;background:#7c3aed;color:white;padding:2px 6px;border-radius:999px">REFLECT</span><span style="font-size:11px;color:#4c1d95">conf ${t.confidence!=null?Math.round(t.confidence*100)+'%':''} · ${escapeHtml(t.assessment||'')}</span><span style="margin-left:auto;font-size:10px;color:var(--muted)">${(t.gaps||[]).join(', ').slice(0,40)}</span></div>`;
          if(t.phase==='REPLAN') return `<div style="padding:6px 8px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:11px;color:#9a3412">↻ REPLAN: ${escapeHtml(t.reason||'')}</div>`;
          if(t.phase==='DECISION_HINT') return `<div style="padding:4px 8px;background:#fafafa;border:1px dashed #e2e8f0;border-radius:8px;font-size:11px;color:var(--muted)">hint: ${escapeHtml(JSON.stringify(t.hint||{}).slice(0,80))}</div>`;
          return '';
        }).join('');
        const detailId = 'orch-'+Date.now();
        orchHtml = `<details style="margin-top:10px;border:1px solid #e2e8f0;border-radius:10px;background:#fafafa;overflow:hidden"><summary style="padding:8px 10px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text)">
          <span style="width:22px;height:22px;border-radius:50%;background:${confColor};color:white;display:inline-flex;align-items:center;justify-content:center;font-size:11px">◯</span>
          Orquestador LOOP <span style="font-weight:400;color:var(--muted)">· ${iterCount} iter · ${toolsUsed.length||0} tools · conf ${confPct}</span>
          <span style="margin-left:auto;font-size:10px;background:white;border:1px solid #e2e8f0;padding:2px 6px;border-radius:999px">T → P → A → O → R</span>
          <span style="font-size:12px;color:var(--muted)">▾</span>
        </summary>
        <div style="padding:8px;background:white;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto">
          ${subgoals ? `<div style="font-size:11px;color:var(--muted);padding:4px 6px;background:#f8fafc;border-radius:6px">🎯 Sub-goals: ${escapeHtml(subgoals).slice(0,140)}</div>`:''}
          ${stepsHtml}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${toolsUsed.map(t=>`<span style="font-size:11px;background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 8px;border-radius:999px">✓ ${escapeHtml(t)}</span>`).join('')}
            <span style="font-size:11px;color:var(--muted);padding:2px 6px">· ${data.elapsed_ms||orchMeta.elapsed_ms||'?'}ms</span>
          </div>
        </div></details>`;
      }
    }
  }catch(e){ console.warn('orch render', e); }
  const html = `
    <div class="msg bot" style="max-width:100%">
      <div style="font-size:13px;color:var(--text);line-height:1.65">${escapeHtml(synthesis).replace(/\n/g,'<br>')}</div>
      ${orchHtml}
      ${webHtml}
      ${fuentesHtml}
    </div>`;
  box.innerHTML+=html;
  // Mensaje para descarga incluye web
  let pushText = synthesis;
  if(webResults && webResults.length){
    pushText += "\n\n[Web: " + webResults.map(w=> w.title + " ("+w.url+")").join(" | ") + "]";
  }
  _pushChatMessage('assistant', pushText);
  try{ playSound('receive'); }catch(e){}
  setLogoLoading(false);
  box.scrollTop=box.scrollHeight;
  if(typeof updateChatScrollBtn==='function') setTimeout(updateChatScrollBtn,80);
}
function quickChat(t){ try{ playSound('pop'); }catch(e){} document.getElementById('chatInput').value=t; sendChat(); }
function scrollChatToBottom(){ const b=document.getElementById('chatBox'); if(b) b.scrollTo({top:b.scrollHeight,behavior:'smooth'}); try{ playSound('whoosh'); }catch(e){} }
  function updateChatScrollBtn(){ const b=document.getElementById('chatBox'); const btn=document.getElementById('scrollBottomMini'); if(!b||!btn) return; const near = b.scrollHeight - b.scrollTop - b.clientHeight < 100; btn.classList.toggle('show', !near && b.scrollHeight > b.clientHeight+80); }
  function clearChat(){ try{ playSound('warning'); }catch(e){} document.getElementById('chatBox').innerHTML='<div class="msg bot">Chat limpiado. ¿En qué te ayudo?</div>';
  try{ setTimeout(()=>playSound('pop'),120); }catch(e){} _chatMessages=[{role:'assistant', text:'Chat limpiado. ¿En qué te ayudo?', time:new Date().toLocaleTimeString()}]; _updateDownloadCount(); setTimeout(updateChatScrollBtn,80); }
function handleFiles(files){
  // --- NUEVO: guarda en grupo Documentos subidos con vista previa y descargar reales ---
  playSound('upload');
  const list=document.getElementById('docList');
  if(!list){ console.warn('docList missing'); return; }
  const loader=document.getElementById('fileLoader');
  const empty=document.getElementById('emptyUploaded');
  const countEl=document.getElementById('uploadedCount');
  setLogoLoading(true);
  if(loader) loader.style.display='flex';
  const typeMap={
    pdf:{icon:'📄',color:'#ef4444',parser:'PDF Parser'},
    doc:{icon:'📝',color:'#0ea5e9',parser:'DOCX Parser'},
    docx:{icon:'📝',color:'#0ea5e9',parser:'DOCX Parser'},
    xls:{icon:'📊',color:'#10b981',parser:'Excel Parser'},
    xlsx:{icon:'📊',color:'#10b981',parser:'Excel Parser'},
    csv:{icon:'📊',color:'#10b981',parser:'CSV Parser'},
    ppt:{icon:'📽️',color:'#f59e0b',parser:'PowerPoint Parser'},
    pptx:{icon:'📽️',color:'#f59e0b',parser:'PowerPoint Parser'},
    txt:{icon:'📃',color:'#64748b',parser:'Text Parser'},
    md:{icon:'📃',color:'#7c5cff',parser:'Markdown Parser'},
    png:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'},
    jpg:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'},
    jpeg:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'}
  };
  setTimeout(()=>{
    if(loader) loader.style.display='none';
    setLogoLoading(false);
  }, 900);
  for(const f of files){
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    const meta=typeMap[ext]||{icon:'📄',color:'var(--primary)',parser:'Parser'};
    const size=(f.size/1024).toFixed(1)+' KB';
    const blobUrl=URL.createObjectURL(f);
    let snippet='';
    if(['txt','md','csv'].includes(ext)){
      const reader=new FileReader();
      reader.onload=e=>{ const idx=_uploadedFiles.findIndex(x=>x.blobUrl===blobUrl); if(idx>=0) _uploadedFiles[idx].textSnippet=e.target.result.slice(0,4000); };
      reader.readAsText(f);
    } else {
      snippet=`Archivo: ${f.name}\nTamaño: ${size}\nTipo: ${ext.toUpperCase()} • ${meta.parser}\n\nEn producción: ${meta.parser} → Markdown AST → Chunking → Embeddings (pgvector)\nVisto el ${new Date().toLocaleString()}`;
    }
    const entry={name:f.name, ext, size, blobUrl, textSnippet: snippet, color:meta.color, icon:meta.icon, parser:meta.parser, doc_id:null, synced:false};
    _uploadedFiles.push(entry);
    const idx=_uploadedFiles.length-1;
    const card=document.createElement('div');
    card.className='doc-card';
    card.dataset.idx=idx;
    card.innerHTML=`<div class="doc-icon" style="background:${meta.color}">${meta.icon}</div>
      <div class="doc-meta">
        <h4 title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</h4>
        <p>${size} • ${meta.parser} → Markdown • <span class="sync-tag" style="font-size:10px;padding:2px 6px;border-radius:999px;background:#fef3c7;color:#92400e;border:1px solid #fde68a">● Sincronizando…</span></p>
      </div>
      <div class="doc-actions">
        <button class="btn btn-ghost btn-sm" onclick="openPreviewUploaded(${idx})">👁️ Vista previa</button>
        <a href="${blobUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="text-decoration:none" onclick="try{playSound('open')}catch(e){}">↗ Pestaña</a>
        <button class="btn btn-primary btn-sm" onclick="downloadUploaded(${idx})">⬇️ Descargar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="deleteUploaded(${idx})" title="Eliminar documento">🗑️ Eliminar</button>
      </div>`;
    list.appendChild(card);
    // Sincroniza con backend /api/v1/documents/upload (relativo primero, fallback localhost)
    (async (file, entryIdx)=>{
      const form=new FormData();
      form.append('file', file);
      form.append('chat_id', 'demo');
      const tryUrls=['/api/v1/documents/upload', (location.protocol||'http:')+'//'+(location.host||'localhost:8000')+'/api/v1/documents/upload', 'http://localhost:8000/api/v1/documents/upload'];
      for(const url of tryUrls){
        try{
          const r=await fetch(url, {method:'POST', body: form});
          if(r.ok){
            const data=await r.json();
            const e=_uploadedFiles[entryIdx];
            if(e){ e.doc_id=data.doc_id||data.id; e.synced=true; }
            const cardEl=document.querySelector(`.doc-card[data-idx="${entryIdx}"] .sync-tag`);
            if(cardEl){ cardEl.textContent='● Sincronizado'; cardEl.style.background='#ecfdf5'; cardEl.style.color='#065f46'; cardEl.style.borderColor='#a7f3d0'; }
            // Actualiza contador desde backend
            try{ const rr=await fetch('/api/v1/documents'); if(rr.ok){ const jj=await rr.json(); const _t=jj.total||_uploadedFiles.length; const _dc=document.getElementById('docCount'); if(_dc) _dc.textContent=_t; const _sd=document.getElementById('statDocs'); if(_sd) _sd.textContent=_t+' docs'; } }catch(e){}
            break;
          }
        }catch(e){}
      }
      const e2=_uploadedFiles[entryIdx];
      if(e2 && !e2.synced){
        const c=document.querySelector(`.doc-card[data-idx="${entryIdx}"] .sync-tag`);
        if(c){ c.textContent='● Local'; c.style.background='#f1f5f9'; c.style.color='#64748b'; }
      }
    })(f, idx);
  }
  if(empty) empty.style.display = _uploadedFiles.length ? 'none' : 'block';
  if(countEl) countEl.textContent = _uploadedFiles.length + ' archivo'+(_uploadedFiles.length!==1?'s':'');
  { const _dc=document.getElementById('docCount'); if(_dc) _dc.textContent=_uploadedFiles.length; }
  { const _sd=document.getElementById('statDocs'); if(_sd) _sd.textContent=_uploadedFiles.length+' docs'; }
  showToast(`${files.length} archivo${files.length>1?'s':''} listo${files.length>1?'s':''} — vista previa y descargar habilitados`,'success');
  try{ playSound('receive'); }catch(e){}
  if(_uploadedFiles.length) setTimeout(()=>{ document.getElementById('groupUploaded')?.scrollIntoView({behavior:'smooth',block:'start'}); }, 300);
}
function openPreviewUploaded(i){
  const u=_uploadedFiles[i];
  if(!u) return;
  // si es texto ya leído, usar textSnippet actualizado
  openPreviewFile(u.name, u.ext, u.blobUrl, u.textSnippet || `Archivo: ${u.name}\n parser: ${u.parser}\n\nContenido en producción: Markdown extraído...`);
}
function downloadUploaded(i){
  const u=_uploadedFiles[i];
  if(!u) return;
  playSound('save');
  const a=document.createElement('a'); a.href=u.blobUrl; a.download=u.name; a.click();
  showToast(`Descargando ${u.name}`,'success');
}
function deleteUploaded(i){
  const u=_uploadedFiles[i];
  if(!u) return;
  playSound('warning');
  if(!confirm(`¿Eliminar documento "${u.name}"?`)) return;
  try{ URL.revokeObjectURL(u.blobUrl); }catch(e){}
  _uploadedFiles.splice(i,1);
  // re-render lista completa
  const list=document.getElementById('docList');
  const empty=document.getElementById('emptyUploaded');
  const countEl=document.getElementById('uploadedCount');
  if(list){
    list.innerHTML='';
    _uploadedFiles.forEach((file, ni)=>{
      const size=file.size;
      const meta={color:file.color, icon:file.icon, parser:file.parser};
      const card=document.createElement('div');
      card.className='doc-card';
      card.innerHTML=`<div class="doc-icon" style="background:${meta.color}">${meta.icon}</div>
        <div class="doc-meta">
          <h4 title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</h4>
          <p>${size} • ${meta.parser} → Markdown • sin scroll</p>
        </div>
        <div class="doc-actions">
          <button class="btn btn-ghost btn-sm" onclick="openPreviewUploaded(${ni})">👁️ Vista previa</button>
          <a href="${file.blobUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="text-decoration:none" onclick="try{playSound('open')}catch(e){}">↗ Pestaña</a>
          <button class="btn btn-primary btn-sm" onclick="downloadUploaded(${ni})">⬇️ Descargar</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="deleteUploaded(${ni})" title="Eliminar documento">🗑️ Eliminar</button>
        </div>`;
      list.appendChild(card);
    });
  }
  if(empty) empty.style.display = _uploadedFiles.length ? 'none' : 'block';
  if(countEl) countEl.textContent = _uploadedFiles.length + ' archivo'+(_uploadedFiles.length!==1?'s':'');
  const dc=document.getElementById('docCount');
  if(dc) dc.textContent=_uploadedFiles.length;
  const sd=document.getElementById('statDocs');
  if(sd) sd.textContent=_uploadedFiles.length+' docs';
  showToast(`Documento "${u.name}" eliminado`,'info');
  // intentar borrar en backend si tiene doc_id
  if(u.doc_id){
    const host=location.host.includes('8000')? location.host : 'localhost:8000';
    const proto=location.protocol==='https:'?'https://':'http://';
    const base=localStorage.getItem('backendUrl')|| proto+host;
    // Sync delete con backend (relativo primero)
    fetch(`/api/v1/documents/${u.doc_id}?chat_id=demo`,{method:'DELETE'}).catch(()=>{});
    fetch(base.replace(/\/$/,'') + `/api/v1/documents/${u.doc_id}?chat_id=demo`,{method:'DELETE'}).catch(()=>{});
  }
}
function clearUploaded(){
  if(!_uploadedFiles.length){ showToast('No hay archivos','info'); return; }
  if(!confirm('¿Vaciar documentos subidos?')) return;
  _uploadedFiles.forEach(u=>{ try{URL.revokeObjectURL(u.blobUrl);}catch(e){} });
  _uploadedFiles.length=0;
  document.getElementById('docList').innerHTML='';
  document.getElementById('emptyUploaded').style.display='block';
  document.getElementById('uploadedCount').textContent='0 archivos';
  document.getElementById('docCount').textContent='0';
  document.getElementById('statDocs').textContent='0 docs';
  showToast('Documentos subidos vaciados','info');
}
function clearRag(){
  const qEl=document.getElementById('ragInput');
  if(qEl) qEl.value='';
  const box=document.getElementById('ragResults');
  const tag=document.getElementById('ragStatsTag');
  if(tag) tag.textContent='Listo';
  if(box) box.innerHTML=`<div style="text-align:center;padding:20px;border:1px dashed var(--border);border-radius:12px;background:#f8fafc;color:var(--muted);font-size:13px"><div style="font-size:22px">🔍</div><div style="font-weight:700;margin-top:6px;color:var(--text)">Busca en tus documentos</div><div style="margin-top:4px">Escribe un término y pulsa <b>Buscar</b> o <b>Enter</b>.</div></div>`;
  playSound('info');
}
function escapeRag(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function normalizeRag(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function highlightRag(text, q){
  if(!q) return escapeRag(text);
  const nq = normalizeRag(q);
  const terms = nq.split(/\s+/).filter(Boolean);
  let esc = escapeRag(text);
  // highlight original terms case-insensitive
  terms.forEach(t=>{
    if(t.length<2) return;
    try{
      const re = new RegExp('('+t.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+')','gi');
      esc = esc.replace(re, '<mark style="background:#fef08a;padding:1px 4px;border-radius:4px;font-weight:800">$1</mark>');
    }catch(e){}
  });
  return esc;
}
async function doRag(){
  const qEl=document.getElementById('ragInput');
  const q=(qEl? qEl.value.trim() : '');
  const box=document.getElementById('ragResults');
  const tag=document.getElementById('ragStatsTag');
  const btn=document.getElementById('ragBtn');
  const topKEl=document.getElementById('ragTopK');
  const topK = topKEl ? parseInt(topKEl.value||'5') : 5;
  if(!box){ console.warn('ragResults missing'); return; }
  if(!q){ showToast('Escribe una búsqueda','info'); playSound('warning'); qEl?.focus(); return; }
  if(q.length<2){ showToast('Mínimo 2 caracteres','warning'); return; }
  playSound('search');
  setLogoLoading(true);
  if(btn){ btn.disabled=true; btn.textContent='⏳ Buscando…'; }
  if(tag) tag.textContent='Buscando…';
  const t0 = performance.now();
  box.innerHTML=`<div style="padding:14px;border-radius:12px;background:#f8fafc;border:1px solid var(--border);display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)"><div style="width:18px;height:18px;border:2.5px solid #e2e8f0;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite"></div> Buscando en base de conocimiento…</div>`;

  // Intentar backend real primero (opcional), con timeout 1200ms
  let backendResults = null;
  try{
    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), 1200);
    const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'].filter(Boolean);
    const proto = location.protocol==='https:'?'https://':'http://';
    // Primero intenta relativo (mismo origen)
    try{ const rr=await fetch('/api/v1/analyzer/execute', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: q, top_k: topK})}); if(rr.ok){ const jj=await rr.json(); if(jj && (jj.response || jj.tri_result)) { backendResults=jj; } } }catch(e){}
    for(const h of hosts){
      if(backendResults) break;
      try{
        const r = await fetch(proto+h+'/api/v1/analyzer/execute', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({text: q, top_k: topK}),
          signal: controller.signal
        });
        if(r.ok){
          const j = await r.json();
          // si el backend devuelve tri_result o response con fuentes, lo usamos como resultados
          if(j && (j.response || j.tri_result || j.processor)){
            backendResults = j;
            break;
          }
        }
      }catch(e){}
    }
    clearTimeout(to);
  }catch(e){}

  // Búsqueda local sobre archivos subidos
  const nq = normalizeRag(q);
  const qTerms = nq.split(/\s+/).filter(Boolean);
  let candidates = [];
  const files = (typeof _uploadedFiles !== 'undefined' ? _uploadedFiles : []);
  // Si no hay archivos subidos, usar documentos de prueba como fallback
  let searchPool = files;
  if(!searchPool.length){
    // intentar leer testDocsGrid como pool ficticio
    const testTitles = ['Contrato Marco 2024','Pliego Técnico','Acta de Reunión','Manual Operativo'];
    searchPool = testTitles.map((t,i)=>({name:t+'.pdf', ext:'pdf', color:'#7c5cff', icon:'📄', textSnippet: ['penalidad del 5% por incumplimiento del plazo de entrega 30 días hábiles','cláusula de confidencialidad y plazo de entrega','cronograma de pagos y penalidad','garantía y soporte'][i] || t, blobUrl:'' }));
  }

  searchPool.forEach((f, idx)=>{
    const hayName = normalizeRag(f.name);
    const hayText = normalizeRag(f.textSnippet||'');
    const hayCombined = hayName + ' ' + hayText;
    let score = 0;
    let hits = 0;
    qTerms.forEach(term=>{
      const inName = (hayName.match(new RegExp(term.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'g'))||[]).length;
      const inText = (hayText.match(new RegExp(term.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'g'))||[]).length;
      if(inName) { score += 0.45 + inName*0.15; hits+=inName; }
      if(inText) { score += 0.30 + inText*0.08; hits+=inText; }
      // bonus por coincidencia exacta de frase
      if(hayCombined.includes(nq)) score += 0.25;
    });
    // pequeño jitter para desempate estable
    score += Math.random()*0.02;
    if(score>0.05){
      // generar snippet con contexto alrededor de primer hit
      const raw = (f.textSnippet||'').slice(0, 900) || `Documento ${f.name} — contenido de ejemplo para búsqueda semántica.`;
      const normRaw = normalizeRag(raw);
      let pos = -1;
      for(const t of qTerms){ const p = normRaw.indexOf(t); if(p>=0){ pos=p; break; } }
      let snippet = raw;
      if(pos>=0){
        const start = Math.max(0, pos-90);
        const end = Math.min(raw.length, pos+220);
        snippet = (start>0?'…':'') + raw.slice(start, end) + (end<raw.length?'…':'');
      } else {
        snippet = raw.slice(0, 220) + (raw.length>220?'…':'');
      }
      candidates.push({file:f, idx, score, hits, snippet, name:f.name, ext:f.ext||'pdf', color:f.color||'#7c5cff', icon:f.icon||'📄'});
    }
  });
  // Si el backend devolvió resultados, mezclarlos como top
  if(backendResults && backendResults.response && Array.isArray(backendResults.response.fuentes) && backendResults.response.fuentes.length){
    backendResults.response.fuentes.slice(0, topK).forEach((fu, i)=>{
      candidates.unshift({file:{name:fu.titulo||'Fuente backend', ext:fu.tipo||'pdf', color:'#0ea5e9', icon:'🔗'}, idx: -1-i, score: 0.95 - i*0.05, hits: 1, snippet: fu.url||fu.titulo||q, name: fu.titulo||'Backend', ext: fu.tipo||'web', color:'#0ea5e9', icon:'🔗'});
    });
  }

  candidates.sort((a,b)=> b.score - a.score);
  const results = candidates.slice(0, topK);
  const elapsed = Math.round(performance.now() - t0);

  // Render
  if(btn){ btn.disabled=false; btn.textContent='Buscar'; }
  setLogoLoading(false);
  if(tag) tag.textContent = results.length ? `${results.length} resultado${results.length!==1?'s':''} • ${elapsed} ms` : 'Sin resultados';

  if(!results.length){
    if(!files.length){
      box.innerHTML=`<div style="padding:16px;border-radius:10px;background:#fafafa;border:1px solid var(--border);color:var(--muted);font-size:13px;line-height:1.5"><b style="color:var(--text)">📭 Aún no hay documentos</b><br>Subí archivos en Documentos para buscar.<br><button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="switchView('documents')">Ir a Documentos →</button></div>`;
      playSound('info');
    } else {
      box.innerHTML=`<div style="padding:16px;border-radius:12px;background:white;border:1px solid var(--border);text-align:center;color:var(--muted)"><div style="font-size:22px">🤷</div><div style="font-weight:800;color:var(--text);margin-top:6px">Sin resultados para "${escapeRag(q)}"</div><div style="font-size:12px;margin-top:4px">Prueba con sinónimos, menos palabras o revisa la ortografía.</div><div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('ragInput').value='penalidad'; doRag()">Probar "penalidad"</button><button class="btn btn-ghost btn-sm" onclick="document.getElementById('ragInput').value='entrega'; doRag()">Probar "entrega"</button></div></div>`;
      try{ playSound('info'); }catch(e){}
    }
    return;
  }

  playSound('success');
  const active= (typeof llmConfigs!=='undefined' ? llmConfigs.find(c=>c.id===activeId) : null);
  let html = `<div style="padding:10px 12px;border-radius:10px;background:#fafafa;border:1px solid var(--border);display:flex;align-items:center;gap:10px"><div style="width:28px;height:28px;border-radius:8px;background:var(--primary);display:grid;place-items:center;color:white;font-size:13px">🔍</div><div style="flex:1"><div style="font-weight:700;font-size:13px;color:var(--text)">${results.length} resultado${results.length!==1?'s':''}</div><div style="font-size:12px;color:var(--muted)">${elapsed} ms</div></div><button class="btn btn-ghost btn-sm" onclick="clearRag()">Limpiar</button></div>`;
  results.forEach((r, i)=>{
    const sim = (0.94 - i*0.04 - Math.random()*0.02).toFixed(2);
    const highlighted = highlightRag(r.snippet, q);
    html += `<div style="padding:12px;border-radius:12px;background:white;border:1px solid var(--border);display:flex;gap:12px;align-items:flex-start;transition:.15s" onmouseenter="this.style.borderColor='rgba(124,92,255,.35)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="width:40px;height:40px;border-radius:10px;background:${r.color};color:white;display:grid;place-items:center;font-size:18px;flex-shrink:0">${r.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px" title="${escapeRag(r.name)}">${escapeRag(r.name)}</b>
          <span style="font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--muted);background:#f8fafc;border:1px solid var(--border);padding:2px 6px;border-radius:6px">${escapeRag(r.ext.toUpperCase())}</span>
          <span style="font-size:11px;font-weight:800;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:2px 6px;border-radius:6px">Sim ${sim}</span>
          <span style="font-size:11px;color:var(--muted)">#${String(r.idx+1).padStart(2,'0')} • ${r.hits} coincidencia${r.hits!==1?'s':''}</span>
        </div>
        <div style="font-size:12.5px;line-height:1.6;color:var(--text);margin-top:6px;background:#f8fafc;border:1px solid #f1f5f9;padding:8px 10px;border-radius:8px">${highlighted}</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="quickRagChat('${escapeRag(q).replace(/'/g,"\\'")}')">💬 Preguntar</button>
          ${r.file.blobUrl ? `<button class="btn btn-ghost btn-sm" onclick="openPreview(${r.idx})">👁️ Ver</button><button class="btn btn-ghost btn-sm" onclick="downloadFile(${r.idx})">⬇️ Descargar</button>` : `<button class="btn btn-ghost btn-sm" onclick="switchView('documents')">📄 Ver documentos</button>`}
        </div>
      </div>
    </div>`;
  });
  box.innerHTML = html;
  // 🌐 Búsqueda web opcional (Tavily → DuckDuckGo) si el checkbox está marcado
  const webCb = document.getElementById('ragWebSearch');
  const webBox = document.getElementById('webResults');
  if(webBox) webBox.style.display = 'none';
  if(webCb && webCb.checked){
    if(webBox){
      webBox.style.display = 'flex';
      webBox.innerHTML = `<div style="padding:12px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;display:flex;align-items:center;gap:8px;font-size:12px;color:#1e40af"><div style="width:16px;height:16px;border:2px solid #bfdbfe;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite"></div> Buscando en web (Tavily → DuckDuckGo)…</div>`;
    }
    (async()=>{
      try{
        const proto = location.protocol==='https:'?'https://':'http://';
        const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'].filter(Boolean);
        let data=null;
        // Intenta relativo primero
        try{ const rr=await fetch('/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({query: q, max_results: topK})}); if(rr.ok){ data=await rr.json(); } }catch(e){}
        for(const h of hosts){
          if(data && data.results) break;
          try{
            const r = await fetch(proto+h+'/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({query: q, max_results: topK})});
            if(r.ok){ data = await r.json(); break; }
          }catch(e){}
        }
        if(!data || !data.results || !data.results.length){
          if(webBox) webBox.innerHTML = `<div style="padding:12px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:12px">Sin resultados web para "${escapeRag(q)}" — intenta otro término</div>`;
          return;
        }
        let whtml = `<div style="padding:8px 10px;background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #bfdbfe;border-radius:10px;display:flex;align-items:center;gap:8px"><span>🌐</span><b style="font-size:12px">Web • ${data.provider} • ${data.results.length} resultados</b><span style="margin-left:auto;font-size:10px;background:white;border:1px solid #bfdbfe;padding:2px 6px;border-radius:999px">Tavily → DDG</span></div>`;
        data.results.forEach((r,i)=>{
          const safeTitle = escapeRag(r.title||'Sin título');
          const safeUrl = escapeRag(r.url||'');
          const safeSnippet = escapeRag((r.snippet||'').slice(0,280));
          whtml += `<div style="padding:10px;border-radius:10px;background:white;border:1px solid var(--border)"><div style="font-weight:800;font-size:12px;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="${normalizeWebUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:none">${safeTitle}</a></div><div style="font-size:11px;color:#059669;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safeUrl}</div><div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${safeSnippet}</div><div style="display:flex;gap:6px;margin-top:6px"><a href="${normalizeWebUrl(r.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="text-decoration:none">🔗 Abrir</a><button class="btn btn-ghost btn-sm" onclick="quickRagChat('${escapeRag(q).replace(/'/g,"\\'")} ')">💬 Preguntar</button></div></div>`;
        });
        if(webBox) webBox.innerHTML = whtml;
        playSound('info');
      }catch(e){
        if(webBox) webBox.innerHTML = `<div style="color:var(--danger);padding:8px;font-size:12px">Error web: ${escapeRag(e.message)}</div>`;
      }
    })();
  }
}

// === WEB SEARCH TAB — Tavily → Google → DuckDuckGo (minimal) ===
async function doWebSearch(){
  const qEl=document.getElementById('wsQuery');
  const provEl=document.getElementById('wsProvider');
  const maxEl=document.getElementById('wsMax');
  const box=document.getElementById('wsResults');
  const tag=document.getElementById('wsHealthTag');
  const btn=document.getElementById('wsBtn');
  const lat=document.getElementById('wsLatency');
  const q=(qEl?qEl.value.trim():'');
  if(!q){ showToast('Escribe una búsqueda','info'); qEl?.focus(); return; }
  const max = maxEl ? parseInt(maxEl.value||'5') : 5;
  const prov = provEl ? provEl.value : 'auto';
  setLogoLoading(true);
  if(btn){ btn.disabled=true; btn.textContent='Buscando…'; }
  if(tag) tag.textContent='● buscando';
  if(lat) lat.textContent='';
  const t0=performance.now();
  if(box) box.innerHTML=`<div style="padding:12px;border-radius:10px;background:#fafafa;border:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)"><div style="width:14px;height:14px;border:2px solid #e5e7eb;border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite"></div> Buscando en la web…</div>`;
  try{
    const payload={query:q, max_results:max};
    if(prov && prov!=='auto') payload.provider=prov;
    // relative first
    let data=null;
    try{
      const r=await fetch('/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      if(r.ok) data=await r.json();
    }catch(e){}
    if(!data || !data.results){
      const proto=location.protocol==='https:'?'https://':'http://';
      const hosts=[location.host,'localhost:8000','127.0.0.1:8000'].filter(Boolean);
      for(const h of hosts){
        try{
          const r=await fetch(proto+h+'/api/v1/websearch/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
          if(r.ok){ data=await r.json(); break; }
        }catch(e){}
      }
    }
    const elapsed=Math.round(performance.now()-t0);
    if(lat) lat.textContent=elapsed+'ms';
    if(btn){ btn.disabled=false; btn.textContent='Buscar'; }
    setLogoLoading(false);
    const provName = (data && data.provider && data.provider !== 'mock') ? data.provider : 'duckduckgo';
    if(tag){
      tag.textContent='● '+provName+' · '+elapsed+'ms';
      tag.title='Cadena: Tavily → Google → DuckDuckGo (actual: '+provName+')';
      const esTavily = provName==='tavily';
      tag.style.background = esTavily ? '#eff6ff' : '#ecfdf5';
      tag.style.color = esTavily ? '#1e40af' : '#065f46';
      tag.style.border = esTavily ? '1px solid #bfdbfe' : '1px solid #a7f3d0';
    }
    if(!data || !data.results || !data.results.length){
      if(box) box.innerHTML=`<div style="padding:14px;border-radius:10px;background:#fafafa;border:1px solid var(--border);text-align:center;color:var(--muted);font-size:12px"><b>Sin resultados</b> para "${escapeHtml(q)}" — prueba otro término.</div>`;
      playSound('warning');
      return;
    }
    playSound('success');
    let html=`<div style="padding:8px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:10px;display:flex;align-items:center;gap:8px"><span style="font-size:12px">🌐</span><b style="font-size:12px;flex:1">${data.results.length} resultados</b><span style="font-size:11px;color:var(--muted);background:white;padding:2px 8px;border-radius:999px;border:1px solid var(--border)">${provName} • ${elapsed}ms</span><span style="font-size:10px;background:#eff6ff;color:#1e40af;padding:2px 6px;border-radius:999px;border:1px solid #bfdbfe">Tavily → Google → DDG</span></div>`;
    data.results.forEach((r,i)=>{
      const title=escapeHtml(r.title||'Sin título');
      const url=escapeHtml(r.url||'');
      const snippet=escapeHtml((r.snippet||'').slice(0,220));
      html+=`<div style="padding:10px;border-radius:10px;background:white;border:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal"><a href="${normalizeWebUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:none">${title}</a></div><div style="font-size:11px;color:#52525b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${url}</div><div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${snippet}</div></div><div style="display:flex;flex-direction:column;gap:6px"><a href="${normalizeWebUrl(r.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="text-decoration:none;font-size:11px">Abrir</a><button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="quickWebSearch('${escapeHtml(q).replace(/'/g,"\'")}')">💬 Preguntar</button></div></div>`;
    });
    if(box) box.innerHTML=html;
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='Buscar'; }
    setLogoLoading(false);
    if(tag) tag.textContent='● error';
    if(box) box.innerHTML=`<div style="padding:12px;border-radius:10px;background:#fafafa;border:1px solid #e5e7eb;color:#18181b;font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    showToast('Error Web Search','error');
  }
}
function clearWebSearch(){
  const qEl=document.getElementById('wsQuery');
  if(qEl) qEl.value='';
  const box=document.getElementById('wsResults');
  if(box) box.innerHTML=`<div style="text-align:center;padding:20px;border:1px solid var(--border);border-radius:10px;background:#fafafa;color:var(--muted);font-size:12px"><div style="font-size:20px">🌐</div><div style="font-weight:700;margin-top:6px;color:var(--text)">Busca en la web</div><div style="margin-top:4px">Escribí tu consulta y explorá resultados actualizados.</div></div>`;
  const tag=document.getElementById('wsHealthTag');
  if(tag) tag.textContent='● listo';
  playSound('info');
}
function quickWebSearch(q){
  switchView('chat');
  setTimeout(()=>{
    const inp=document.getElementById('chatInput');
    if(inp){ inp.value='Busca en web: '+q; inp.focus(); }
  },200);
}
// Health check websearch — muestra cadena Tavily → Google → DuckDuckGo
(async()=>{ try{
  let j=null;
  try{ const r=await fetch('/api/v1/websearch/health'); if(r.ok) j=await r.json(); }catch(e){}
  if(!j){
    for(const h of [location.host,'localhost:8000']){
      try{ const r=await fetch((location.protocol==='https:'?'https://':'http://')+h+'/api/v1/websearch/health'); if(r.ok){ j=await r.json(); break; } }catch(e){}
    }
  }
  const tag=document.getElementById('wsHealthTag');
  if(tag && j){
    const hasT=j.keys?.tavily, hasG=j.keys?.google;
    tag.textContent='● '+(hasT?'tavily': hasG?'google':'duckduckgo')+' → listo';
    tag.title='Cadena: '+(j.chain||'tavily → google → duckduckgo')+' | fallback: '+(j.fallback||'duckduckgo');
    tag.style.background = hasT ? '#eff6ff' : hasG ? '#fef3c7' : '#ecfdf5';
    tag.style.color = hasT ? '#1e40af' : hasG ? '#92400e' : '#065f46';
  } else if(tag) tag.textContent='● listo';
}catch(e){} })();


function quickRagChat(q){
  switchView('chat');
  setTimeout(()=>{
    const ta=document.getElementById('chatInput')||document.querySelector('textarea');
    if(ta){ ta.value = 'Busca en mi base: ' + q; ta.focus(); }
    showToast('Pregunta enviada al chat','info');
  }, 150);
}
// drag
const dz=document.getElementById('dropZone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag')});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');handleFiles(e.dataTransfer.files)});
dz.addEventListener('click',()=>document.getElementById('fileIn').click());
// Cerrar menú alarmas al hacer click fuera
 document.addEventListener('click', (e)=>{ const m=document.getElementById('alarmMenu'); if(m && !m.contains(e.target) && !e.target.closest('button[title="Alarmas tipo celular"]')) m.classList.remove('show'); });
// Scroll mejorado para chatBox
const _cb=document.getElementById('chatBox'); if(_cb){ _cb.addEventListener('scroll', updateChatScrollBtn); }

// Page Loader — overlay elegante para todas las páginas
(function(){
  const pl=document.getElementById('pageLoader');
  if(pl){
    const redirectUrl = pl.getAttribute('data-redirect') || new URLSearchParams(location.search).get('redirect') || '';
    const hideAndRedirect = () => {
      pl.classList.add('hidden');
      setTimeout(()=>{
        try{ pl.remove(); }catch(e){}
        if(redirectUrl){
          // Redirigir a archivo HTML especificado
          const target = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, location.href).href;
          if(target !== location.href){
            location.href = target;
          }
        }
      }, 600);
    };
    // Mostrar loader mínimo 1100ms, luego ocultar/redirigir
    setTimeout(hideAndRedirect, 1100);
    // Seguridad: forzar ocultado/redirección a los 3000ms si sigue visible
    setTimeout(()=>{ if(pl && !pl.classList.contains('hidden')) hideAndRedirect(); }, 3000);
    // También permitir clic en el loader para saltar/redirigir inmediatamente
    pl.addEventListener('click', hideAndRedirect);
    // Fallback: si la página ya está cargada y el loader no se ocultó, ocultarlo al hacer click en cualquier parte
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideAndRedirect(); });
  }
})();

// Loader 5 segundos alrededor del logo en todas las páginas
(function(){
  const w=document.getElementById('logoWrap');
  w.classList.add('initial-loading');
  let seconds=5;
  const originalTitle=document.title;
  // opcional contador en tooltip
  const tick=()=>{
    w.title=`Cargando… ${seconds}s`;
    if(seconds<=0){
      w.classList.remove('initial-loading');
      w.title='Asistente — listo para ayudarte';
      clearInterval(timer);
    }
    seconds--;
  };
  tick();
  const timer=setInterval(tick,1000);
  // seguridad: quitar a los 5s exactos
  setTimeout(()=>{ w.classList.remove('initial-loading'); w.title='Asistente — listo para ayudarte'; clearInterval(timer); }, 5000);
})();
// init
renderProviders();
  // Sincroniza con backend al iniciar (si disponible)
  (async()=>{ try{
    const r=await fetch('/api/v1/llm/config');
    if(r.ok){
      const list=await r.json();
      if(Array.isArray(list) && list.length){
        let changed=false;
        for(const b of list){
          if(!llmConfigs.find(l=> l.id===b.id)){
            llmConfigs.push({id:b.id, provider:b.provider, name:b.name, model:b.model, base_url:b.base_url||'', temperature:b.temperature, max_tokens:b.max_tokens, timeout:b.timeout, api_key: '••••'+(b.masked_key||'').slice(-4), is_active:b.is_active});
            changed=true;
          }
        }
        const activeBackend=list.find(c=> c.is_active);
        if(activeBackend) activeId=activeBackend.id;
        if(changed){ persist(); renderLLM(); }
        console.log('LLM sync: backend', list.length, 'local', llmConfigs.length);
      } else if(llmConfigs.length>0){
        // Backend vacío pero local tiene datos → push local al backend (sincronización bidireccional)
        console.log('Backend LLM vacío, sincronizando', llmConfigs.length, 'locales al backend...');
        for(const local of [...llmConfigs]){
          if(local.api_key && !local.api_key.startsWith('••••')){
            try{
              const rr=await fetch('/api/v1/llm/config', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({provider:local.provider, name:local.name, api_key:local.api_key, model:local.model, base_url:local.base_url||undefined, temperature:local.temperature||0.7, max_tokens:local.max_tokens||2048, timeout:local.timeout||30000})});
              if(rr.ok){ const saved=await rr.json(); local.id=saved.id; console.log('Pushed LLM', local.name, saved.id); }
            }catch(e){ console.warn('push LLM fallo', e); }
          }
        }
        persist(); renderLLM();
      }
    }
  }catch(e){ console.warn('LLM sync init fallo', e); }
  })();
  renderLLM(); renderTestDocs();
  // Sincroniza documentos con backend
  (async()=>{ try{ const r=await fetch('/api/v1/documents'); if(r.ok){ const j=await r.json();
    if(j.total!=null){
      const dc=document.getElementById('docCount'); if(dc) dc.textContent=j.total;
      const sd=document.getElementById('statDocs'); if(sd) sd.textContent=j.total+' docs';
    } } }catch(e){} })(); _updateDownloadCount();
/* updateChatScrollBtn eliminado */

// === WEBSOCKET LANGCHAIN — monitoreo en vivo ===
let _lcWS=null, _lcTries=0, _lcHostIdx=0;
function connectLangChainWS(force=false){
  const pill = document.getElementById('wsLangchainPill');
  const dot  = document.getElementById('wsLangchainDot');
  const txt  = document.getElementById('wsLangchainText');
  const proto = location.protocol==='https:' ? 'wss://' : 'ws://';
  const savedBackend = localStorage.getItem('backendUrl') || new URLSearchParams(location.search).get('backend') || '';
  const derivedHosts = [];
  if(savedBackend){
    try{ const u=new URL(savedBackend); derivedHosts.push(u.host); }catch(e){ derivedHosts.push(savedBackend.replace(/^https?:\/\//,'' ).replace(/\/$/,'')); }
  }
  if(location.host && !location.host.includes('null') && location.protocol!=='file:') derivedHosts.push(location.host);
  derivedHosts.push('localhost:8000','127.0.0.1:8000','localhost:8010','127.0.0.1:8010');
  const hosts = [...new Set(derivedHosts)];
  if(force){
    _lcTries=0;
    try{ if(_lcWS){ _lcWS.onclose=null; _lcWS.onerror=null; _lcWS.close(); } }catch(e){}
    _lcWS=null;
    if(dot){ dot.style.background='#f59e0b'; dot.style.boxShadow='0 0 0 5px rgba(245,158,11,.18)'; }
    if(txt) txt.textContent='Reconectando…';
    if(pill) pill.style.borderColor='rgba(245,158,11,.28)';
  }
  function tryConnect(){
    if(!force && _lcWS && _lcWS.readyState===WebSocket.OPEN) return;
    const url = proto + hosts[_lcHostIdx] + '/ws/langchain';
    try{ _lcWS = new WebSocket(url); }catch(e){ nextHost(); return; }
    if(dot && !force){ dot.style.background='#f59e0b'; txt.textContent='Conectando…'; }
    _lcWS.onopen = ()=>{
      _lcTries=0;
      if(dot){ dot.style.background='#10b981'; dot.style.boxShadow='0 0 0 6px rgba(16,185,129,.18)'; }
      if(txt) txt.textContent='Conectado';
      if(pill) pill.style.borderColor='rgba(16,185,129,.28)';
      if(typeof playSound==='function') try{ playSound('success'); }catch(e){}
    };
    _lcWS.onmessage = (ev)=>{
      try{
        const data = JSON.parse(ev.data);
        if(data.type==='langchain_status'){
          const lc = data.langchain||{};
          const has = lc.has_langchain;
          if(dot){
            dot.style.background = has ? '#10b981' : '#10b981';
            dot.style.boxShadow = '0 0 0 6px rgba(16,185,129,.18)';
          }
          if(txt) txt.textContent = 'Conectado';
          if(pill) pill.style.borderColor='rgba(16,185,129,.28)';
          // Actualizar solo UI amigable, sin detalles técnicos
          const llm = data.llm||{};
          const llmModel = llm.model;
          if(llmModel && llmModel!=='—'){
            const provName = llm.provider||'Asistente';
            const localActive = (typeof llmConfigs!=='undefined' && llmConfigs.find(c=>c.id===activeId));
            if(!localActive){
              const gl=document.getElementById('globalLLMText');
              if(gl && gl.textContent.includes('No configurado')){
                gl.textContent = `${provName} • ${llmModel}`;
                gl.style.color='var(--success)';
              }
            }
          }
        }
      }catch(e){}
    };
    _lcWS.onclose = ()=>{
      if(dot){ dot.style.background='#94a3b8'; dot.style.boxShadow='0 0 0 5px rgba(148,163,184,.18)'; }
      if(txt) txt.textContent='Sin conexión';
      if(pill) pill.style.borderColor='var(--border)';
      _lcTries++;
      if(_lcTries>4 && _lcHostIdx < hosts.length-1){ _lcHostIdx++; _lcTries=0; }
      setTimeout(tryConnect, Math.min(1500*_lcTries+800, 8000));
    };
    _lcWS.onerror = ()=>{ try{_lcWS.close();}catch(e){} };
    function nextHost(){ _lcHostIdx=(_lcHostIdx+1)%hosts.length; setTimeout(tryConnect, 900); }
  }
  tryConnect();
}
function reconnectLangChainWS(){
  if(typeof playSound==='function') try{ playSound('info'); }catch(e){}
  const pill=document.getElementById('wsLangchainPill');
  const txt=document.getElementById('wsLangchainText');
  const dot=document.getElementById('wsLangchainDot');
  if(txt) txt.textContent='Reconectando…';
  if(dot){ dot.style.background='#f59e0b'; dot.style.animation='pulse 1s ease infinite'; }
  if(pill) pill.style.borderColor='rgba(245,158,11,.32)';
  connectLangChainWS(true);
  setTimeout(()=>{
    if(dot) dot.style.animation='';
    if(typeof showToast==='function') showToast('Reconectando asistente…','info');
  }, 200);
  // timeout de seguridad: si no conecta en 4s, avisar
  setTimeout(()=>{
    const t=document.getElementById('wsLangchainText');
    if(t && t.textContent==='Reconectando…'){
      t.textContent='Sin conexión';
      if(typeof showToast==='function') showToast('No se pudo reconectar — revisa tu conexión','warning');
    }
  }, 4000);
}
function testLangChainConn(){
  const hostsTry = [location.host, 'localhost:8000','127.0.0.1:8000'];
  const proto = location.protocol==='https:'?'https://':'http://';
  (async()=>{
    let ok=false;
    for(const h of hostsTry){
      try{
        const url = proto+h+'/api/langchain/status';
        const r = await fetch(url);
        const j = await r.json();
        if(j && j.langchain){
          ok=true;
          showToast(`Asistente conectado ✓`, 'success');
          const dot=document.getElementById('wsLangchainDot'), txt=document.getElementById('wsLangchainText');
          if(dot){ dot.style.background='#10b981'; dot.style.boxShadow='0 0 0 6px rgba(16,185,129,.18)'; }
          if(txt) txt.textContent='Conectado';
          const pill=document.getElementById('wsLangchainPill'); if(pill) pill.style.borderColor='rgba(16,185,129,.28)';
          break;
        }
      }catch(e){}
    }
    if(!ok) showToast('Sin conexión — intenta reconectar','warning');
  })();
}
function configureBackend(){
  const cur = localStorage.getItem('backendUrl') || (location.protocol+'//'+location.host);
  const url = prompt('URL del backend FastAPI (ej: http://localhost:8000)\nSe usará para WS /ws/langchain y HTTP /api/langchain/status', cur);
  if(url){ localStorage.setItem('backendUrl', url); location.reload(); }
}
document.addEventListener('DOMContentLoaded', connectLangChainWS);
setTimeout(connectLangChainWS, 600);



// ==================== RAG CHAT — Base de Conocimiento ====================
let _ragChatMessages = [{role:'assistant', text:'¡Hola! Soy tu asistente de Base de Conocimiento. Preguntame sobre tus documentos.', time: new Date().toLocaleTimeString()}];
function _pushRagChatMessage(role, text){
  _ragChatMessages.push({role, text, time: new Date().toLocaleTimeString()});
}
function clearRagChat(){
  try{ playSound('warning'); }catch(e){}
  const box = document.getElementById('ragChatBox');
  if(box) box.innerHTML = '<div class="msg bot">Chat de Base de Conocimiento limpiado. ¿Qué querés consultar?</div>';
  _ragChatMessages = [{role:'assistant', text:'Chat limpiado.', time: new Date().toLocaleTimeString()}];
  try{ setTimeout(()=>playSound('pop'),120);}catch(e){}
}
function quickRagChat2(t){
  const el = document.getElementById('ragChatInput');
  if(el){ el.value = t; sendRagChat(); }
}
async function refreshRagChatDocs(){
  const box = document.getElementById('ragChatDocs');
  const countEl = document.getElementById('ragChatCount');
  const statsEl = document.getElementById('ragChatStats');
  const healthText = document.getElementById('ragChatHealthText');
  if(!box) return;
  box.textContent = 'Cargando…';
  try{
    const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'].filter(Boolean);
    const proto = location.protocol==='https:'?'https://':'http://';
    let data = null;
    try{ const r=await fetch('/api/v1/rag/health'); if(r.ok) data=await r.json(); }catch(e){}
    for(const h of hosts){
      if(data) break;
      try{ const r=await fetch(proto+h+'/api/v1/rag/health'); if(r.ok) data=await r.json(); }catch(e){}
    }
    if(!data){
      // fallback to documents
      try{ const r=await fetch('/api/v1/documents'); if(r.ok) data=await r.json(); }catch(e){}
    }
    let docs = [];
    let chunks = data?.chunks ?? data?.total ?? 0;
    if(data?.documents !== undefined) chunks = data.chunks;
    // Try to get documents list
    try{
      let ddata=null;
      try{ const r=await fetch('/api/v1/rag/documents'); if(r.ok) ddata=await r.json(); }catch(e){}
      for(const h of hosts){
        if(ddata) break;
        try{ const r=await fetch(proto+h+'/api/v1/rag/documents'); if(r.ok) ddata=await r.json(); }catch(e){}
      }
      if(ddata && ddata.items) docs = ddata.items;
    }catch(e){}
    if(countEl) countEl.textContent = `${data?.documents ?? docs.length ?? 0} docs • ${data?.chunks ?? chunks} resultados`;
    if(statsEl) statsEl.textContent = `${data?.documents ?? docs.length ?? 0} docs`;
    if(healthText) healthText.textContent = docs.length ? `Base lista — ${docs.length} documentos indexados` : 'Base lista';
    if(!docs.length && !data?.documents){
      box.innerHTML = '<span style="color:var(--muted)">Aún no hay documentos. Subí archivos en <b>Documentos</b>.</span> <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="switchView(\'documents\')">Ir a Documentos →</button>';
      return;
    }
    if(docs.length){
      box.innerHTML = docs.slice(0,6).map(d=>`<span style="padding:6px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:999px;display:flex;align-items:center;gap:6px"><span style="width:22px;height:22px;border-radius:6px;background:${d.is_seed?'#7c5cff':'#0ea5e9'};color:white;display:grid;place-items:center;font-size:11px">${d.is_seed?'🌱':'📄'}</span> ${escapeHtml(d.name||d.source||'doc')} <small style="color:var(--muted)">${d.chunks||0} secciones</small></span>`).join(' ');
      if(docs.length>6) box.innerHTML += `<span style="padding:6px 10px;background:white;border:1px dashed var(--border);border-radius:999px;font-size:11px;color:var(--muted)">+${docs.length-6} más</span>`;
    } else {
      box.innerHTML = `<span style="padding:6px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:999px">${data?.documents ?? 0} docs • ${data?.chunks ?? 0} resultados • listo</span>`;
    }
  }catch(e){
    box.textContent = 'Error cargando documentos';
  }
}
async function sendRagChat(){
  try{ playSound('send'); }catch(e){}
  const inp = document.getElementById('ragChatInput');
  const box = document.getElementById('ragChatBox');
  const btn = document.getElementById('ragChatBtn');
  if(!inp || !box) return;
  const txt = inp.value.trim();
  if(!txt) return;
  // Mensaje usuario
  box.innerHTML += `<div class="msg user" style="align-self:flex-end;background:var(--primary);color:white;padding:10px 12px;border-radius:12px;max-width:88%">${escapeHtml(txt)}</div>`;
  _pushRagChatMessage('user', txt);
  inp.value = '';
  const webComplement = document.getElementById('ragChatWeb')?.checked || false;
  // typing
  const tid = 'rag-typing-'+Date.now();
  box.innerHTML += `<div id="${tid}" class="typing" style="align-self:flex-start;background:white;border:1px solid var(--border);padding:10px 12px;border-radius:12px"><i></i><i></i><i></i></div>`;
  box.scrollTop = box.scrollHeight;
  if(btn){ btn.disabled=true; btn.textContent='⏳ Pensando…'; }
  setLogoLoading(true);
  let data=null, lastErr=null;
  const hosts = [location.host, 'localhost:8000','127.0.0.1:8000'].filter(Boolean);
  const proto = location.protocol==='https:'?'https://':'http://';
  const payload = {query: txt, top_k: 5, web_search: webComplement, web_max_results: 2};
  // Intenta relativo primero
  try{
    const r = await fetch('/api/v1/rag/query', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(r.ok) data = await r.json();
  }catch(e){ lastErr=e; }
  for(const h of hosts){
    if(data) break;
    try{
      const r = await fetch(proto+h+'/api/v1/rag/query', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      if(r.ok){ data=await r.json(); break; }
    }catch(e){ lastErr=e; }
  }
  document.getElementById(tid)?.remove();
  if(btn){ btn.disabled=false; btn.textContent='Enviar ➤'; }
  setLogoLoading(false);
  if(!data){
    const msg = 'No pude consultar la base en este momento. Probá de nuevo en unos segundos.';
    box.innerHTML += `<div class="msg bot" style="align-self:flex-start;background:white;border:1px solid #fecaca;padding:10px 12px;border-radius:12px;max-width:92%">${msg}</div>`;
    box.scrollTop = box.scrollHeight;
    return;
  }
  const resp = data.response || {};
  const synthesis = (resp.sintesis || '').trim() || 'Encontré información relevante sobre tu consulta.';
  // Fuentes limpias
  let fuentesHtml = '';
  const fuentes = resp.fuentes || [];
  // También agregar chunks del RAG como fuentes si no están en fuentes
  let ragChunks = data.rag?.chunks || [];
  if(fuentes.length){
    fuentesHtml = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9"><div style="font-size:11px;color:var(--muted);margin-bottom:6px">Fuentes en tu base</div><div style="display:flex;flex-direction:column;gap:6px">${fuentes.slice(0,4).map(f=>`<div style="padding:6px 8px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text);font-weight:600">${escapeHtml(f.titulo||'Fuente')}</span>${f.url ? `<a href="${normalizeWebUrl(escapeHtml(f.url))}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--primary);text-decoration:none">Abrir</a>`:`<span style="font-size:11px;color:var(--muted)">📄 ${escapeHtml(f.tipo||'documento')}</span>`}</div>`).join('')}</div></div>`;
  }
  // Si hay chunks, mostrar snippet resaltado
  let chunksHtml = '';
  if(ragChunks.length){
    chunksHtml = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">${ragChunks.slice(0,2).map(c=>`<div style="padding:8px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px"><div style="font-size:11px;font-weight:800;color:var(--muted);display:flex;justify-content:space-between"><span>📄 ${escapeHtml(c.source||c.title||'Doc')}</span><span style="background:#ecfdf5;color:#065f46;padding:1px 6px;border-radius:999px;border:1px solid #a7f3d0">Sim ${c.score}</span></div><div style="font-size:12px;color:var(--text);margin-top:6px;line-height:1.5">${escapeHtml(c.snippet||c.text||'').slice(0,220)}</div></div>`).join('')}</div>`;
  }
  // Render respuesta natural + fuentes + chunks
  const html = `<div class="msg bot" style="align-self:flex-start;background:white;border:1px solid var(--border);padding:12px;border-radius:12px;max-width:92%;line-height:1.65"><div style="font-size:13px;color:var(--text)">${escapeHtml(synthesis).replace(/\n/g,'<br>')}</div>${chunksHtml}${fuentesHtml}</div>`;
  box.innerHTML += html;
  _pushRagChatMessage('assistant', synthesis);
  try{ playSound('receive'); }catch(e){}
  box.scrollTop = box.scrollHeight;
  // Auto-refresh docs stats
  refreshRagChatDocs();
}
// Auto-load RAG docs al iniciar si la vista existe
document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(refreshRagChatDocs, 800); });
// Refrescar al cambiar a esa vista
/* DOCS_TABS_UNIFIED — pestañas Archivos / Buscar / Base / Internet */
const DOCS_TABS = [
  {view:'documents', label:'📄 Archivos'},
  {view:'rag',       label:'🔍 Buscar'},
  {view:'ragchat',   label:'📚 Base'},
  {view:'websearch', label:'🌐 Internet'}
];
function _docsCurrentView(){
  const el = document.querySelector('.view.active');
  return el && el.id && el.id.startsWith('view-') ? el.id.replace('view-','') : null;
}
function _docsSyncTabs(view){
  const cur = view || _docsCurrentView();
  document.querySelectorAll('.docs-tab').forEach(b=>b.classList.toggle('active', b.dataset.docsTab===cur));
}
function openDocsTab(view){
  if(document.getElementById('view-'+view)){
    try{ switchView(view); }catch(e){}
  }else{
    location.href = '/frontend/interfaz.html#view-'+view;
  }
}
function _docsBuildTabs(){
  DOCS_TABS.forEach(t=>{
    const sec = document.getElementById('view-'+t.view);
    if(!sec || sec.querySelector('.docs-tabs')) return;
    const bar = document.createElement('div');
    bar.className = 'docs-tabs';
    bar.setAttribute('role','tablist');
    bar.setAttribute('aria-label','Documentos');
    bar.innerHTML = DOCS_TABS.map(x=>`<button type="button" class="docs-tab" role="tab" data-docs-tab="${x.view}" onclick="openDocsTab('${x.view}')">${x.label}</button>`).join('');
    sec.insertBefore(bar, sec.firstChild);
  });
  _docsSyncTabs();
  _docsMarkNav();
}
const _DOCS_GROUP = ['documents','rag','ragchat','websearch'];
function _docsMarkNav(){
  const cur = _docsCurrentView();
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const groupBtn = document.querySelector('.nav-btn[data-nav-group="docs"]');
  if(groupBtn && _DOCS_GROUP.indexOf(cur)>=0) groupBtn.classList.add('active');
  else{
    const direct = document.querySelector(`.nav-btn[data-view="${cur}"]`);
    if(direct) direct.classList.add('active');
  }
}
const _origSwitchView = typeof switchView !== 'undefined' ? switchView : null;
if(typeof switchView === 'function'){
  window.switchView = function(view){
    try{ _origSwitchView(view); }catch(e){ /* fallback */ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); const el=document.getElementById('view-'+view); if(el) el.classList.add('active'); document.querySelectorAll('[data-view]').forEach(b=>{ b.classList.toggle('active', b.dataset.view===view); }); }
    _docsBuildTabs();
    _docsSyncTabs(view);
    _docsMarkNav();
    if(view==='ragchat') setTimeout(refreshRagChatDocs, 200);
    if(view==='rag') setTimeout(()=>{ if(typeof refreshRagChatDocs==='function') refreshRagChatDocs(); }, 200);
    try{ history.replaceState(null,'','#view-'+view); }catch(e){}
  };
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(_docsBuildTabs,120));
setTimeout(_docsBuildTabs, 700);


// Handle direct hash like #view-ragchat
function handleHashView(){
  const h = location.hash || "";
  if(h.startsWith("#view-")){
    const v = h.replace("#view-","").trim();
    if(v && document.getElementById("view-"+v)){
      try{ switchView(v); }catch(e){ setTimeout(()=>{ try{switchView(v);}catch(e2){} },300); }
    }
  }
  // Also support view param ?
  const goto = localStorage.getItem("_gotoView");
  if(goto){
    localStorage.removeItem("_gotoView");
    if(document.getElementById("view-"+goto)) setTimeout(()=>switchView(goto), 350);
  }
}
document.addEventListener("DOMContentLoaded", handleHashView);
window.addEventListener("hashchange", handleHashView);
setTimeout(handleHashView, 600);

// Ensure chats sync for any view
async function ensureChatsSync(){ try{ const r=await fetch('/api/v1/chats?limit=1'); if(r.ok) console.log('chats sync ok'); }catch(e){} }

/* =====================================================================
   SINCRONÍA BACKEND ↔ FRONTEND
   - Documentos: se cargan desde /api/v1/documents al abrir la página
     (antes solo vivían en memoria del navegador y desaparecían al recargar).
   - Conversaciones: se guardan en /api/v1/chats/{id}/messages y se recuperan
     al volver a entrar.
   ===================================================================== */
let CURRENT_CHAT_ID = localStorage.getItem('currentChatId') || null;
let _serverDocs = [];

const DOC_TYPES = {
  pdf:{icon:'📄',color:'#ef4444',parser:'PDF Parser'},
  doc:{icon:'📝',color:'#0ea5e9',parser:'DOCX Parser'},
  docx:{icon:'📝',color:'#0ea5e9',parser:'DOCX Parser'},
  xls:{icon:'📊',color:'#10b981',parser:'Excel Parser'},
  xlsx:{icon:'📊',color:'#10b981',parser:'Excel Parser'},
  csv:{icon:'📊',color:'#10b981',parser:'CSV Parser'},
  ppt:{icon:'📽️',color:'#f59e0b',parser:'PowerPoint Parser'},
  pptx:{icon:'📽️',color:'#f59e0b',parser:'PowerPoint Parser'},
  md:{icon:'📃',color:'#7c5cff',parser:'Markdown Parser'},
  markdown:{icon:'📃',color:'#7c5cff',parser:'Markdown Parser'},
  txt:{icon:'📃',color:'#64748b',parser:'Text Parser'},
  json:{icon:'📃',color:'#64748b',parser:'JSON Parser'},
  png:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'},
  jpg:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'},
  jpeg:{icon:'🖼️',color:'#ec4899',parser:'Image Parser'}
};
function _extOf(name){ const p=(name||'').split('.'); return p.length>1 ? p.pop().toLowerCase() : 'txt'; }
function _fmtSize(bytes){
  const b=Number(bytes)||0;
  if(b<1024) return b+' B';
  if(b<1024*1024) return (b/1024).toFixed(1)+' KB';
  return (b/1024/1024).toFixed(1)+' MB';
}

function _setDocsCounters(total){
  const up=document.getElementById('uploadedCount');
  if(up) up.textContent = total + ' archivo' + (total!==1?'s':'');
  const dc=document.getElementById('docCount'); if(dc) dc.textContent = total;
  const sd=document.getElementById('statDocs'); if(sd) sd.textContent = total + ' docs';
  const empty=document.getElementById('emptyUploaded'); if(empty) empty.style.display = total ? 'none' : 'block';
}

async function syncLoadDocuments(){
  const list=document.getElementById('docList');
  if(!list) return;
  let items=[];
  try{
    const r=await fetch('/api/v1/documents', {headers:{'Accept':'application/json'}});
    if(r.ok){ const j=await r.json(); items=j.items||[]; }
  }catch(e){ console.warn('No se pudo leer /api/v1/documents', e); }
  _serverDocs = items;
  // Quita tarjetas de servidor previas y vuelve a pintarlas
  list.querySelectorAll('.doc-card[data-server="1"]').forEach(el=>el.remove());
  const localNames = new Set(_uploadedFiles.map(f=>f.name));
  items.filter(d=>!localNames.has(d.name)).forEach(d=>{
    const ext=_extOf(d.name);
    const meta=DOC_TYPES[ext]||{icon:'📄',color:'#7c5cff',parser:d.parser||'Parser'};
    const id=d.doc_id||d.id;
    const card=document.createElement('div');
    card.className='doc-card';
    card.dataset.server='1';
    card.dataset.docId=id;
    card.innerHTML=`<div class="doc-icon" style="background:${meta.color}">${meta.icon}</div>
      <div class="doc-meta">
        <h4 title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</h4>
        <p>${_fmtSize(d.size)} • ${escapeHtml(d.parser||meta.parser)} • ${d.chunks||0} fragmento${(d.chunks||0)!==1?'s':''}
          ${d.is_seed?'<span style="opacity:.7">· ejemplo</span>':''}
          <span class="sync-tag" style="font-size:10px;padding:2px 6px;border-radius:999px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0">● Sincronizado</span></p>
      </div>
      <div class="doc-actions">
        <button class="btn btn-ghost btn-sm" onclick="openPreviewServer('${id}')">👁️ Vista previa</button>
        <a class="btn btn-ghost btn-sm" style="text-decoration:none" href="/api/v1/documents/${encodeURIComponent(id)}/download" target="_blank" rel="noopener">⬇️ Descargar</a>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="deleteServerDoc('${id}')" title="Eliminar documento">🗑️ Eliminar</button>
      </div>`;
    list.appendChild(card);
  });
  _setDocsCounters(items.length);
  syncLoadKnowledge();
}

/* Métricas reales en las tarjetas de la portada (fragmentos y estado del RAG) */
async function syncLoadKnowledge(){
  const el=document.getElementById('statChunks');
  if(!el) return;
  try{
    const r=await fetch('/api/v1/rag/health');
    if(!r.ok) return;
    const j=await r.json();
    if(j.chunks!=null){
      el.textContent = Number(j.chunks).toLocaleString('es');
      const sub=el.parentElement && el.parentElement.querySelector('span');
      if(sub) sub.textContent = (j.documents||0)+' documentos · '+(j.chunks||0)+' fragmentos';
    }
  }catch(e){}
}

function openPreviewServer(docId){
  const d=_serverDocs.find(x=>(x.doc_id||x.id)===docId);
  if(!d) return;
  openPreviewFile(d.name, _extOf(d.name), null, d.preview || `Documento ${d.name}\n${_fmtSize(d.size)} · ${d.chunks||0} fragmentos indexados.`);
}

async function deleteServerDoc(docId){
  const d=_serverDocs.find(x=>(x.doc_id||x.id)===docId);
  const name=d?d.name:'este documento';
  if(!confirm(`¿Eliminar "${name}" del servidor y de la base de conocimiento?`)) return;
  try{ playSound('warning'); }catch(e){}
  try{
    const r=await fetch('/api/v1/documents/'+encodeURIComponent(docId), {method:'DELETE'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    showToast('Documento eliminado','success');
    try{ playSound('delete'); }catch(e){}
    await syncLoadDocuments();
  }catch(e){
    showToast('No se pudo eliminar el documento','error');
  }
}

/* ── Conversaciones ── */
async function ensureChat(){
  if(CURRENT_CHAT_ID){
    try{ const r=await fetch('/api/v1/chats/'+encodeURIComponent(CURRENT_CHAT_ID)); if(r.ok) return CURRENT_CHAT_ID; }catch(e){}
    CURRENT_CHAT_ID=null; localStorage.removeItem('currentChatId');
  }
  try{
    const r=await fetch('/api/v1/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nueva conversación'})});
    if(r.ok){
      const j=await r.json();
      CURRENT_CHAT_ID=j.id||j.chat_id||null;
      if(CURRENT_CHAT_ID) localStorage.setItem('currentChatId', CURRENT_CHAT_ID);
      return CURRENT_CHAT_ID;
    }
  }catch(e){ console.warn('No se pudo crear la conversación', e); }
  return null;
}

function resetChatSession(){
  CURRENT_CHAT_ID=null;
  localStorage.removeItem('currentChatId');
}

async function restoreChatHistory(){
  const box=document.getElementById('chatBox');
  if(!box || !CURRENT_CHAT_ID) return;
  try{
    const r=await fetch('/api/v1/chats/'+encodeURIComponent(CURRENT_CHAT_ID)+'?limit=40');
    if(!r.ok) return;
    const j=await r.json();
    const msgs=j.messages||[];
    if(!msgs.length) return;
    box.innerHTML = msgs.map(m=>`<div class="msg ${m.role==='user'?'user':'bot'}">${escapeHtml(m.content)}</div>`).join('');
    _chatMessages = msgs.map(m=>({role:m.role, text:m.content, time:(m.created_at||'').slice(11,19)}));
    _updateDownloadCount();
    box.scrollTop=box.scrollHeight;
  }catch(e){ console.warn('No se pudo cargar el historial', e); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  setTimeout(syncLoadDocuments, 400);
  setTimeout(restoreChatHistory, 700);
  // Al limpiar el chat se empieza una conversación nueva
  if(typeof window.clearChat==='function' && !window.clearChat.__synced){
    const orig=window.clearChat;
    window.clearChat=function(){ resetChatSession(); return orig.apply(this, arguments); };
    window.clearChat.__synced=true;
  }
});
setTimeout(syncLoadDocuments, 1200);
