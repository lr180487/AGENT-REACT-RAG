
// Hamburger helper for nuevo-chat (close on nav)
if(typeof closeMobileMenu==='undefined'){ window.closeMobileMenu=()=>{ const sb=document.getElementById('sidebar'); const ov=document.getElementById('sidebarOverlay'); if(sb) sb.classList.remove('mobile-open'); if(ov) ov.classList.remove('show'); try{document.body.style.overflow='';}catch(e){} }; }
if(typeof toggleMobileMenu==='undefined'){ window.toggleMobileMenu=()=>{ const sb=document.getElementById('sidebar'); const ov=document.getElementById('sidebarOverlay'); if(sb) sb.classList.toggle('mobile-open'); if(ov) ov.classList.toggle('show'); try{document.body.style.overflow=sb&&sb.classList.contains('mobile-open')?'hidden':'';}catch(e){} }; }

function normalizeWebUrl(u){ if(!u) return '#'; try{ u=u.replace(/&amp;/g,'&'); if(u.includes('uddg=')){ const m=u.match(/uddg=([^&]+)/); if(m) return decodeURIComponent(m[1]); } if(u.startsWith('//')) return 'https:'+u; if(u.startsWith('/l/')){ const mm=u.match(/uddg=([^&]+)/); if(mm) return decodeURIComponent(mm[1]); return 'https://duckduckgo.com'+u; } }catch(e){} return u; }
'use strict';

  /* Sonidos centralizados en /frontend/sounds.js — bloque local eliminado (v2.1) */
if(typeof playSound==='undefined') window.playSound=()=>{};
if(typeof playChatSound==='undefined') window.playChatSound=(a)=>{ try{ playSound(a); }catch(e){} };
if(typeof playAlarm==='undefined') window.playAlarm=()=>{};
if(typeof stopAlarms==='undefined') window.stopAlarms=()=>{};
if(typeof toggleSound==='undefined') window.toggleSound=()=>{};
if(typeof setVolume==='undefined') window.setVolume=()=>{};

  const API_BASE = "/api/v1/chats";
  const USE_DB = true; // intenta BD, fallback a localStorage
  const PAGE_SIZE = 30;

  const providers = [
    {id:'openai', name:'OpenAI', models:['gpt-4o-mini','gpt-4o','gpt-4-turbo','o1-mini']},
    {id:'anthropic', name:'Anthropic', models:['claude-3-5-sonnet-20241022','claude-3-opus-20240229']},
    {id:'gemini', name:'Gemini', models:['gemini-1.5-pro','gemini-1.5-flash']},
    {id:'groq', name:'Groq', models:['llama-3.3-70b-versatile','llama-3.1-8b-instant']},
    {id:'mistral', name:'Mistral', models:['mistral-large-latest']},
    {id:'ollama', name:'Ollama', models:['llama3.2','qwen2.5']},
  ];
  
  // Sincroniza LLM con backend (/api/v1/llm/config) y merge a localStorage
  async function syncLLMsFromBackend(){
    try{
      const r=await fetch('/api/v1/llm/config');
      if(!r.ok) throw new Error(''+r.status);
      const list=await r.json();
      if(Array.isArray(list) && list.length){
        const local = JSON.parse(localStorage.getItem('llm_configs')||'[]');
        let changed=false;
        for(const b of list){
          if(!local.find(l=> l.id===b.id)){
            local.push({id:b.id, provider:b.provider, name:b.name, model:b.model, base_url:b.base_url||'', temperature:b.temperature??0.7, max_tokens:b.max_tokens??2048, timeout:b.timeout??30000, api_key: '••••'+(b.masked_key||'').slice(-4), is_active:b.is_active});
            changed=true;
          }
        }
        const activeBackend=list.find(c=> c.is_active);
        if(activeBackend){ localStorage.setItem('llm_active', activeBackend.id); }
        if(changed){ localStorage.setItem('llm_configs', JSON.stringify(local)); console.log('chat.js LLM sync', list.length); }
        return true;
      }
    }catch(e){ console.warn('chat LLM sync fallo', e.message); }
    return false;
  }

  function getActiveLLM(){
    try{
      const cfgs = JSON.parse(localStorage.getItem('llm_configs')||'[]');
      const activeId = localStorage.getItem('llm_active');
      return cfgs.find(c=>c.id===activeId) || cfgs[0] || null;
    }catch(e){ return null; }
  }
  function fillModelSelect(){
    const active = getActiveLLM();
    const sel = document.getElementById('modelSelect');
    let opts=[];
    if(active){
      const prov = providers.find(p=>p.id===active.provider);
      opts.push(`<option selected>${prov?prov.name:active.provider} • ${active.model} ✓</option>`);
    }
    providers.forEach(p=> p.models.forEach(m=>{
      if(active && m===active.model && p.id===active.provider) return;
      opts.push(`<option>${p.name} • ${m}</option>`);
    }));
    sel.innerHTML = opts.join('');
    document.getElementById('emptyLLM').textContent = active ? `${active.provider} • ${active.model}` : 'No configurado (mock)';
    document.getElementById('composerInfo').textContent = active ? `Asistente: ${active.model}` : 'Asistente listo para ayudarte';
  }

  // --- Estado ---
  let chats = []; // {id,title,created_at,message_count}
  let activeChatId = null;
  let messages = []; // mensajes del chat activo (paginados)
  let totalMessages = 0;
  let loadedOffset = 0; // para scroll paginado
  let scrollPositions = JSON.parse(localStorage.getItem('scroll_pos')||'{}');
  let dbAvailable = false;

  // --- API helpers con fallback ---
  async function apiFetch(url, opts={}){
    try{
      const r = await fetch(url, {headers:{'Content-Type':'application/json'}, ...opts});
      if(!r.ok) throw new Error(await r.text());
      dbAvailable = true;
      document.getElementById('dbBadge').textContent='● Sincronizado';
      document.getElementById('dbBadge').className='badge db';
      return r.json();
    }catch(e){
      dbAvailable = false;
      document.getElementById('dbBadge').textContent='● Listo';
      document.getElementById('dbBadge').className='badge local';
      throw e;
    }
  }
  async function loadChats(){
    if(USE_DB){
      try{
        const data = await apiFetch(`${API_BASE}?limit=100`);
        chats = data.items || data;
        if(!Array.isArray(chats)) chats=[chats];
        if(chats.length===0) throw new Error('empty');
        chats = chats.map(c=>({...c, id: c.id||c.chat_id, created_at: c.created_at||c.created||new Date().toISOString(), title: c.title||'Nuevo chat', message_count: c.message_count||c.messages?.length||0 }));
        return;
      }catch(e){
        // Si backend vacío pero local tiene chats, intenta sincronizar locales al backend
        try{
          const local = JSON.parse(localStorage.getItem('react_chats')||'[]');
          if(Array.isArray(local) && local.length>0){
            console.log('Backend chats vacío, intentando push', local.length, 'locales...');
            for(const lc of local.slice(0,5)){
              try{
                await apiFetch(API_BASE, {method:'POST', body: JSON.stringify({title: lc.title||'Sincronizado', provider: lc.provider||null, model: lc.model||null})});
              }catch(ee){}
            }
            // Reintenta cargar tras push
            try{
              const data2 = await apiFetch(`${API_BASE}?limit=100`);
              chats = data2.items || data2;
              if(Array.isArray(chats) && chats.length>0){
                chats = chats.map(c=>({...c, id: c.id||c.chat_id, created_at: c.created_at||c.created||new Date().toISOString(), title: c.title||'Nuevo chat', message_count: c.message_count||c.messages?.length||0 }));
                return;
              }
            }catch(ee){}
          }
        }catch(ee){}
      }
    }
    // fallback localStorage
    chats = JSON.parse(localStorage.getItem('react_chats')||'[]');
    if(!Array.isArray(chats)) chats=[];
    chats = chats.map(c=>({...c, id: c.id||c.chat_id||('chat_'+Date.now()), created_at: c.created_at||c.created||new Date().toISOString(), title: c.title||'Nuevo chat', message_count: c.message_count||0 }));
  }
  async function createChat(title){
    const llm = getActiveLLM();
    if(USE_DB){
      try{
        const sRaw = await apiFetch(API_BASE, {method:'POST', body: JSON.stringify({title, provider: llm?.provider, model: llm?.model})});
        const s = {...sRaw, id: sRaw.id||sRaw.chat_id, created_at: sRaw.created_at||new Date().toISOString(), title: sRaw.title||title, message_count: sRaw.message_count||0 };
        chats.unshift(s);
        return s;
      }catch(e){}
    }
    const id='chat_'+Date.now();
    const s={id,title,created_at:new Date().toISOString(), updated_at:new Date().toISOString(), message_count:0, messages:[]};
    chats.unshift(s);
    localStorage.setItem('react_chats', JSON.stringify(chats));
    // guardar mensajes aparte para compatibilidad vieja
    let all = JSON.parse(localStorage.getItem('react_chats_full')||'{}');
    all[id]=[];
    localStorage.setItem('react_chats_full', JSON.stringify(all));
    return s;
  }
  async function fetchMessages(sessionId, limit=PAGE_SIZE, offset=0){
    if(USE_DB && dbAvailable!==false){
      // probar ambos routers: historial (/chats/{id}?limit) y oficial (/chats/{id}/messages?limit)
      try{
        const data = await apiFetch(`${API_BASE}/${sessionId}?limit=${limit}&offset=${offset}`);
        if(data && (data.messages || data.session)) return data;
      }catch(e){}
      try{
        const data2 = await apiFetch(`${API_BASE}/${sessionId}/messages?limit=${limit}&offset=${offset}`);
        // normalizar a {session,messages,total,has_more} para compat
        if(data2){
          return {session: data2.session || data2.chat || chats.find(c=> (c.id||c.chat_id)===sessionId),
                  messages: data2.messages || data2.items || [],
                  total: data2.total ?? (data2.messages?data2.messages.length:0),
                  has_more: data2.has_more ?? false };
        }
      }catch(e){}
    }
    // fallback
    let all = JSON.parse(localStorage.getItem('react_chats_full')||'{}');
    // migrar si viene de viejo formato
    if(!all[sessionId]){
      const c = chats.find(x=>x.id===sessionId);
      all[sessionId] = c?.messages || [];
      localStorage.setItem('react_chats_full', JSON.stringify(all));
    }
    const msgs = all[sessionId]||[];
    const total = msgs.length;
    const start = Math.max(0, total - offset - limit);
    const end = total - offset;
    return {session: chats.find(c=>c.id===sessionId), messages: msgs.slice(start,end), total, has_more: start>0};
  }
  async function saveMessage(sessionId, role, content){
    if(USE_DB){
      try{
        const m = await apiFetch(`${API_BASE}/${sessionId}/messages`, {method:'POST', body: JSON.stringify({role, content})});
        return m;
      }catch(e){}
    }
    let all = JSON.parse(localStorage.getItem('react_chats_full')||'{}');
    if(!all[sessionId]) all[sessionId]=[];
    const m={id:'msg_'+Date.now()+Math.random().toString(36).slice(2,5), session_id:sessionId, role, content, created_at:new Date().toISOString()};
    all[sessionId].push(m);
    localStorage.setItem('react_chats_full', JSON.stringify(all));
    // actualizar chats count
    const c=chats.find(x=>x.id===sessionId);
    if(c){ c.message_count=all[sessionId].length; c.updated_at=new Date().toISOString(); if(all[sessionId].length===1 && role==='user') c.title=content.slice(0,38); localStorage.setItem('react_chats', JSON.stringify(chats));}
    return m;
  }
  async function editMessageAPI(sessionId, messageId, newContent){
    if(USE_DB){
      try{ return await apiFetch(`${API_BASE}/${sessionId}/messages/${messageId}`, {method:'PUT', body: JSON.stringify({content:newContent})}); }catch(e){}
    }
    let all=JSON.parse(localStorage.getItem('react_chats_full')||'{}');
    const msgs=all[sessionId]||[];
    const m=msgs.find(x=>x.id===messageId);
    if(m){ m.content=newContent; localStorage.setItem('react_chats_full', JSON.stringify(all)); }
    return m;
  }
  async function deleteMessageAPI(sessionId, messageId){
    if(USE_DB){
      try{ await apiFetch(`${API_BASE}/${sessionId}/messages/${messageId}`, {method:'DELETE'}); return true;}catch(e){}
    }
    let all=JSON.parse(localStorage.getItem('react_chats_full')||'{}');
    all[sessionId]=(all[sessionId]||[]).filter(x=>x.id!==messageId);
    localStorage.setItem('react_chats_full', JSON.stringify(all));
    const c=chats.find(x=>x.id===sessionId); if(c) c.message_count=all[sessionId].length;
    localStorage.setItem('react_chats', JSON.stringify(chats));
    return true;
  }
  async function updateTitleAPI(sessionId, newTitle){
    if(USE_DB){
      try{ return await apiFetch(`${API_BASE}/${sessionId}`, {method:'PUT', body: JSON.stringify({title:newTitle})}); }catch(e){}
      try{ return await apiFetch(`${API_BASE}/${sessionId}`, {method:'PATCH', body: JSON.stringify({title:newTitle})}); }catch(e){}
    }
    const c=chats.find(x=>(x.id||x.chat_id)===sessionId); if(c) c.title=newTitle;
    localStorage.setItem('react_chats', JSON.stringify(chats));
    return c;
  }
  async function deleteChatAPI(sessionId){
    if(USE_DB){
      try{ await apiFetch(`${API_BASE}/${sessionId}`, {method:'DELETE'}); }catch(e){}
    }
    chats=chats.filter(x=> (x.id||x.chat_id)!==sessionId);
    localStorage.setItem('react_chats', JSON.stringify(chats));
    let all=JSON.parse(localStorage.getItem('react_chats_full')||'{}'); delete all[sessionId]; localStorage.setItem('react_chats_full', JSON.stringify(all));
  }

  // --- UI ---
  function persistScroll(){
    const el=document.getElementById('chatScroll');
    if(activeChatId) scrollPositions[activeChatId]=el.scrollTop;
    localStorage.setItem('scroll_pos', JSON.stringify(scrollPositions));
  }

  async function newChat(){
    playSound('nuevo');
    const title='Nuevo chat '+(chats.length+1);
    const s=await createChat(title);
    activeChatId=s.id;
    localStorage.setItem('react_active_chat', activeChatId);
    loadedOffset=0; messages=[]; totalMessages=0;
    await refreshList(); await openChat(activeChatId);
    document.getElementById('msgInput').focus();
  }
  async function refreshList(){
    await loadChats();
    renderList();
  }
  function renderList(){
    const q=(document.getElementById('searchInput').value||'').toLowerCase();
    const list=document.getElementById('chatList');
    const filtered=chats.filter(c=> !q || c.title.toLowerCase().includes(q));
    if(filtered.length===0){
      list.innerHTML=`<div style="text-align:center;padding:18px;color:var(--muted);font-size:12px">Sin chats<br><small>Crea uno con “Nuevo Chat”</small></div>`;
      return;
    }
    setTimeout(updateChatsScrollBtn, 80);
    list.innerHTML=filtered.map(c=>{
      const last = c.message_count ? `${c.message_count} mensajes` : 'Sin mensajes';
      const time=new Date(c.created_at||c.created).toLocaleDateString();
      return `<div class="chat-item ${c.id===activeChatId?'active':''}" onclick="openChat('${c.id}')">
        <div class="chat-item-top">
          <strong title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</strong>
          <div class="item-actions" onclick="event.stopPropagation()">
            <div class="mini-icon" title="Editar título" onclick="editTitlePrompt('${c.id}')">✏️</div>
            <div class="mini-icon danger" title="Eliminar" onclick="deleteChatPrompt('${c.id}')">🗑️</div>
          </div>
        </div>
        <p>${last}</p>
        <small>${time} • ${c.message_count||0} msgs</small>
      </div>`;
    }).join('');
  }
  async function openChat(id){
    playSound('open');
    // guardar scroll del anterior
    if(activeChatId) persistScroll();
    activeChatId=id;
    localStorage.setItem('react_active_chat', id);
    loadedOffset=0;
    renderList();
    await loadMessages(true);
    updateHeader();
    // restaurar scroll propio de este chat
    setTimeout(()=>{
      const el=document.getElementById('chatScroll');
      const saved=scrollPositions[id];
      if(saved!=null) el.scrollTop=saved;
      else el.scrollTop=el.scrollHeight;
      setTimeout(updateScrollBtn, 100);
    }, 30);
    if(window.innerWidth<900) document.querySelector('.sidebar').classList.remove('mobile-open');
  }
  async function loadMessages(reset=false){
    if(!activeChatId) { renderChat(); _updateNuevoCount(); return; }
    if(reset){ loadedOffset=0; messages=[]; }
    const data=await fetchMessages(activeChatId, PAGE_SIZE, loadedOffset);
    // data.messages son del más antiguo al más nuevo dentro de la página
    if(reset) messages=data.messages;
    else messages=[...data.messages, ...messages];
    totalMessages=data.total;
    loadedOffset=messages.length;
    renderChat(); _updateNuevoCount();
    document.getElementById('loadMoreBtn').classList.toggle('show', loadedOffset < totalMessages);
  }
  function loadMore(){ try{ playSound('whoosh'); }catch(e){} loadMessages(false).then(()=>{ const el=document.getElementById('chatScroll'); el.scrollTop=200; try{ playSound('pop'); }catch(e){} }); }

  function updateHeader(){
    const c=chats.find(x=>x.id===activeChatId);
    const box=document.getElementById('chatHeaderMini');
    if(!c){ box.style.display='none'; return; }
    box.style.display='flex';
    document.getElementById('chatTitleText').textContent=c.title;
    document.getElementById('chatTitleMeta').textContent=`• ${totalMessages} msgs • ${new Date(c.created_at||c.created).toLocaleDateString()}`;
  }
  function startEditTitle(){
    const c=chats.find(x=>x.id===activeChatId); if(!c) return;
    const el=document.getElementById('chatTitleText');
    const input=document.createElement('input');
    input.value=c.title; input.id='titleEditInput';
    input.onkeydown=e=>{ if(e.key==='Enter') saveTitle(); if(e.key==='Escape') updateHeader(); };
    input.onblur=saveTitle;
    el.replaceWith(input); input.focus(); input.select();
    async function saveTitle(){
      const newTitle=input.value.trim()||'Nuevo chat';
      await updateTitleAPI(activeChatId, newTitle);
      await refreshList(); updateHeader();
    }
  }
  async function editTitlePrompt(id){
    playSound('edit');
    const c=chats.find(x=>x.id===id); const t=prompt('Editar título:', c.title);
    if(t && t.trim()){ await updateTitleAPI(id, t.trim()); try{ playSound('confirm'); }catch(e){} await refreshList(); if(id===activeChatId) updateHeader(); }
  }
  async function deleteChatPrompt(id){
    playSound('delete');
    if(!confirm('¿Eliminar este chat y todos sus mensajes?')) return;
    await deleteChatAPI(id);
    if(activeChatId===id){ activeChatId=chats[0]?.id||null; if(activeChatId) localStorage.setItem('react_active_chat', activeChatId); else localStorage.removeItem('react_active_chat'); }
    await refreshList();
    if(activeChatId) await openChat(activeChatId); else { messages=[]; renderChat(); _updateNuevoCount(); updateHeader(); }
  }
  async function deleteActiveChat(){ if(activeChatId) deleteChatPrompt(activeChatId); }

  function renderChat(){
    const scroll=document.getElementById('chatScroll');
    const loadBtn=document.getElementById('loadMoreBtn');
    // preservar loadBtn
    const empty=document.getElementById('emptyState');
    if(!activeChatId || messages.length===0){
      // mantener loadBtn + empty
      const existing = scroll.querySelectorAll('.msg-row, .typing');
      existing.forEach(e=>e.remove());
      if(!scroll.contains(empty)){
        // ya está en DOM si reset
      }
      empty.style.display='grid';
      loadBtn.style.display='none';
      return;
    }
    empty.style.display='none';
    // render mensajes
    // conservar loadBtn al inicio
    const html = messages.map(m=>`
      <div class="msg-row ${m.role==='user'?'user':''}" data-id="${m.id}">
        ${m.role==='user'?'':`<div class="avatar bot">⚡</div>`}
        <div class="bubble ${m.role==='user'?'user':'bot'}" id="bubble-${m.id}">
          <div class="bubble-text">${escapeHtml(m.content).replace(/\n/g,'<br>')}</div>
          ${m.meta?`<small>${escapeHtml(typeof m.meta==='string'?m.meta: JSON.stringify(m.meta))}</small>`:`<small>${new Date(m.created_at).toLocaleTimeString()}</small>`}
          <div class="bubble-actions">
            <button title="Editar" onclick="startEditMsg('${m.id}')">✏️</button>
            <button title="Eliminar" class="danger" onclick="deleteMsg('${m.id}')">🗑️</button>
            <button title="Copiar" onclick="copyMsg('${m.id}')">⎘</button>
          </div>
        </div>
        ${m.role==='user'?`<div class="avatar user">TÚ</div>`:''}
      </div>
    `).join('');
    // reconstruir manteniendo loadBtn arriba y anchor abajo
    const anchor = document.getElementById('messagesAnchor');
    // limpiar mensajes previos (except loadBtn, empty, anchor)
    scroll.querySelectorAll('.msg-row, .typing').forEach(e=>e.remove());
    anchor.insertAdjacentHTML('beforebegin', html);
    // scroll al fondo si es nuevo mensaje (no paginación)
    if(loadedOffset <= PAGE_SIZE) scroll.scrollTop = scroll.scrollHeight;
    setTimeout(updateScrollBtn, 80);
  }

  
// === DESCARGA MENSAJES (reemplaza caja) ===
function _updateNuevoCount(){
  const el=document.getElementById('downloadCountNuevo');
  if(el) el.textContent = (messages?.length||0) + ' mensaje'+(messages?.length!==1?'s':'');
}
function downloadNuevo(format='json'){
  if(!messages || messages.length===0){ showToast('No hay mensajes','info'); return; }
  const chat = chats.find(c=>c.id===activeChatId);
  const title = (chat?.title||'chat').replace(/[^a-z0-9]/gi,'_').slice(0,20);
  const now=new Date().toISOString().slice(0,10);
  const base=`chat-${title}-${now}`;
  if(format==='json'){
    const data={exported_at:new Date().toISOString(), chat_id:activeChatId, title:chat?.title, messages};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
    triggerDownload(blob, base+'.json'); showToast('JSON descargado','success');
  } else if(format==='txt'){
    let txt=`Chat: ${chat?.title||''}
Fecha: ${new Date().toLocaleString()}
${'='.repeat(40)}
`;
    messages.forEach(m=>{ txt+=`[${new Date(m.created_at).toLocaleString()}] ${m.role.toUpperCase()}: ${m.content}

`; });
    const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
    triggerDownload(blob, base+'.txt'); showToast('TXT descargado','success');
  } else if(format==='md'){
    let md=`# ${chat?.title||'Chat'}

*Fecha:* ${new Date().toLocaleString()}

---

`;
    messages.forEach(m=>{ md+=`### ${m.role==='user'?'🧑 Tú':'🤖 Asistente'} — ${new Date(m.created_at).toLocaleString()}

${m.content}

`; });
    const blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
    triggerDownload(blob, base+'.md'); showToast('MD descargado','success');
  } else if(format==='html'){
    let h=`<html><head><meta charset="UTF-8"><title>${chat?.title}</title><style>body{font-family:Inter,Arial,sans-serif;padding:20px;color:#0f172a} .msg{margin:10px 0;padding:10px;border:1px solid #e2e8f0;border-radius:10px} .user{background:#f5f3ff} .assistant{background:#f8fafc}</style></head><body><h1>${chat?.title}</h1><p>${new Date().toLocaleString()}</p><hr>`;
    messages.forEach(m=>{ h+=`<div class="msg ${m.role}"><b>${m.role.toUpperCase()} — ${new Date(m.created_at).toLocaleString()}</b><br>${escapeHtml(m.content).replace(/\n/g,'<br>')}</div>`; });
    h+=`</body></html>`;
    const blob=new Blob([h],{type:'text/html;charset=utf-8'});
    triggerDownload(blob, base+'.html');
    try{ const w=window.open('','_blank'); if(w){ w.document.write(h); w.document.close(); setTimeout(()=>{ try{w.print();}catch(e){} },600);} }catch(e){}
    showToast('HTML descargado','success');
  }
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function autoGrow(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
  function handleKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }
  function quick(t){ if(!activeChatId) newChat().then(()=>{ document.getElementById('msgInput').value=t; send(); }); else { document.getElementById('msgInput').value=t; send(); } }
  function handleFile(f){
    playSound('upload');
    if(!f) return;
    const ext=f.name.split('.').pop().toLowerCase();
    const parsers={pdf:'PDF Parser',docx:'DOCX Parser',doc:'DOCX Parser',xlsx:'Excel Parser',xls:'Excel Parser',csv:'CSV Parser',ppt:'PowerPoint Parser',pptx:'PowerPoint Parser',txt:'Text Parser',md:'Markdown Parser',png:'Image Parser',jpg:'Image Parser',jpeg:'Image Parser'};
    const parser=parsers[ext]||'Parser';
    const icons={pdf:'📄',docx:'📝',doc:'📝',xlsx:'📊',xls:'📊',csv:'📊',ppt:'📽️',pptx:'📽️',txt:'📃',md:'📃',png:'🖼️',jpg:'🖼️',jpeg:'🖼️'};
    const icon=icons[ext]||'📎';
    if(!activeChatId) { newChat().then(()=> handleFile(f)); return; }
    // mostrar loader 5s en logo + spinner inline
    document.getElementById('logoWrap').classList.add('loading');
    document.getElementById('statusHint').textContent=`Procesando ${f.name}…`;
    saveMessage(activeChatId,'user', `${icon} Adjuntado: ${f.name} (${(f.size/1024).toFixed(1)} KB)`).then(()=>{
      loadMessages(true);
      setTimeout(()=>{
        saveMessage(activeChatId,'bot', `✅ ${icon} Recibí **${f.name}** (${ext.toUpperCase()}). Ya está listo. Podés preguntar lo que quieras sobre su contenido.`).then(()=> { loadMessages(true); document.getElementById('logoWrap').classList.remove('loading'); document.getElementById('statusHint').textContent='Escribí tu mensaje y presioná Enter'; try{ playSound('receive'); }catch(e){} });
      }, 900);
    });
  }
  function copyMsg(id){
    try{ playSound('pop'); }catch(e){}
    const m=messages.find(x=>x.id===id); if(!m) return;
    navigator.clipboard.writeText(m.content); showToast('Copiado','success');
  }
  function showToast(msg,type='success'){
    playSound(type==='error'?'error':type==='success'?'success':'info');
    let t=document.getElementById('_toast');
    if(!t){ t=document.createElement('div'); t.id='_toast'; t.style.cssText='position:fixed;bottom:16px;right:16px;background:white;border:1px solid #e2e8f0;padding:10px 14px;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.12);font-size:13px;font-weight:700;z-index:99;transition:.2s;transform:translateY(10px)'; document.body.appendChild(t); }
    t.textContent=msg; t.style.opacity='1'; t.style.transform='none'; setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(10px)'; },1800);
  }
  async function startEditMsg(id){
    playSound('edit');
    const m=messages.find(x=>x.id===id); if(!m) return;
    const bubble=document.getElementById('bubble-'+id);
    const orig=bubble.querySelector('.bubble-text').innerHTML;
    bubble.innerHTML=`<textarea class="msg-edit" id="edit-${id}">${m.content}</textarea><div class="edit-actions"><button class="btn btn-primary btn-sm" onclick="saveEditMsg('${id}')">Guardar</button><button class="btn btn-ghost btn-sm" onclick="cancelEditMsg('${id}')">Cancelar</button></div>`;
    document.getElementById('edit-'+id).focus();
    bubble._orig=orig;
  }
  async function saveEditMsg(id){
    const txt=document.getElementById('edit-'+id).value.trim(); if(!txt) return;
    try{ playChatSound('message_save'); }catch(e){}
    await editMessageAPI(activeChatId, id, txt);
    await loadMessages(true);
    try{ playSound('confirm'); }catch(e){}
  }
  function cancelEditMsg(id){ try{ playSound('cancel'); }catch(e){} loadMessages(true); }
  async function deleteMsg(id){
    playSound('warning');
    if(!confirm('¿Eliminar este mensaje?')) return;
    await deleteMessageAPI(activeChatId, id);
    await loadMessages(true);
    await refreshList();
  }
  async function send(){
    playSound('send');
    const input=document.getElementById('msgInput');
    const text=input.value.trim(); if(!text) return;
    if(!activeChatId){ await newChat(); }
    // guardar user
    input.value=''; autoGrow(input);
    await saveMessage(activeChatId,'user', text);
    await loadMessages(true);
    await refreshList(); updateHeader();
    // typing
    const scroll=document.getElementById('chatScroll');
    const typing=document.createElement('div'); typing.className='msg-row'; typing.id='typing'; typing.innerHTML=`<div class="avatar bot">⚡</div><div class="typing"><i></i><i></i><i></i></div>`;
    document.getElementById('messagesAnchor').before(typing);
    scroll.scrollTop=scroll.scrollHeight;
    document.getElementById('logoWrap').classList.add('loading');
    document.getElementById('sendBtn').disabled=true;
    document.getElementById('statusHint').textContent='Pensando tu respuesta…';
    // Llamada sincronizada al backend 
    const hosts=[location.host,'localhost:8000','127.0.0.1:8000'];
    const proto=location.protocol==='https:'?'https://':'http://';
    let backendUrl=localStorage.getItem('backendUrl');
    let urls=[];
    // Prioridad 1: relativo (mismo origen, funciona cuando frontend se sirve desde backend /frontend)
    urls.push('/api/v1/analyzer/execute');
    if(backendUrl) urls.push(backendUrl.replace(/\/$/,'')+'/api/v1/analyzer/execute');
    for(const h of hosts) urls.push(proto+h+'/api/v1/analyzer/execute');
    urls=[...new Set(urls)];
    let data=null, lastErr=null;
    for(const url of urls){
      try{
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text, chat_id: activeChatId})});
        if(!r.ok) throw new Error('HTTP '+r.status);
        data=await r.json();
        break;
      }catch(e){ lastErr=e; }
    }
    typing.remove();
    try{ playSound('receive'); }catch(e){}
    let reply='', meta='';
    if(!data){
      const llm=getActiveLLM();
      reply=`⚠️ Backend no disponible (${lastErr?lastErr.message:'sin conexión'}).\nIntenta ${urls[0]}.\n` + (llm?`Tu consulta: "${text}"`:`Sin API LLM activa — configura en Interfaz → API LLM.`);
      meta='Error backend';
      try{ playSound('error'); }catch(e){}
    } else {
      const resp=data.response||{};
      const fuentes=(resp.fuentes||[]).map(f=>`🔗 ${f.titulo} (${f.tipo}) ${f.url}`).join('\n');
      const recs=(resp.recomendaciones||[]).join('\n• ');
      const acts=(resp.acciones_propuestas||[]).map(a=>`${a.accion}: ${a.detalle}`).join('\n• ');
            // Render web results + fuentes like script.js
      const webResults = (resp.web_results || data.web_results || resp.webSources || []);
      let webHtml = '';
      if(webResults.length){
        webHtml = `<div style="margin-top:12px;padding:10px;border-radius:10px;background:linear-gradient(135deg,#f8fafc,#f5f3ff);border:1px solid #e2e8f0"><div style="font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--muted);display:flex;align-items:center;gap:6px"><span>🌐</span> En la web <span style="margin-left:auto;font-size:11px;background:white;border:1px solid #e2e8f0;padding:2px 6px;border-radius:999px">${webResults.length} resultados</span></div><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${webResults.map(r=>`<div style="padding:8px 10px;border-radius:8px;background:white;border:1px solid var(--border)"><a href="${normalizeWebUrl(escapeHtml(r.url||'#'))}" target="_blank" rel="noopener" style="font-size:12px;font-weight:700;color:var(--primary);text-decoration:none">${escapeHtml(r.title||'Fuente')}</a><div style="font-size:11px;color:#059669;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.url||'')}</div><div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.5">${escapeHtml((r.snippet||'').slice(0,180))}${(r.snippet||'').length>180?'…':''}</div></div>`).join('')}</div></div>`;
      } else if(data.web_search || resp.web_search){
        webHtml = `<div style="margin-top:10px;font-size:11px;color:var(--muted);text-align:center;padding:6px;background:#fafafa;border:1px dashed var(--border);border-radius:8px">Sin resultados web adicionales para esta consulta</div>`;
      }
      const allFuentes = (resp.fuentes||[]).concat(webResults.map(w=>({titulo:w.title, url:w.url, tipo:'web'})));
      let fuentesHtml = '';
      if(allFuentes.length){
        fuentesHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9"><div style="font-size:11px;color:var(--muted);margin-bottom:6px">Fuentes</div><div style="display:flex;flex-direction:column;gap:6px">${allFuentes.slice(0,4).map(f=>`<a href="${normalizeWebUrl(escapeHtml(f.url||'#'))}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);text-decoration:none">🔗 ${escapeHtml(f.titulo||f.title||'Fuente')}</a><span style="font-size:11px;color:var(--muted);margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;display:inline-block">${escapeHtml(f.url||'').slice(0,60)}</span>`).join('<br>')}</div></div>`;
      }
      reply=`<div style="font-size:13px;line-height:1.6">${(resp.sintesis||data.sintesis||'').replace(/\\n/g,'<br>')}</div>` + (webHtml||'') + (fuentesHtml||'');
      meta=''; // oculto: info técnica removida
    }
    await saveMessage(activeChatId,'bot', reply);
    await loadMessages(true);
    await refreshList();
    document.getElementById('logoWrap').classList.remove('loading');
    document.getElementById('sendBtn').disabled=false;
    document.getElementById('statusHint').textContent='Escribí tu mensaje y presioná Enter';
    try{ if(!data) playSound('error'); else if(meta.includes('Error')) playSound('warning'); else playSound('receive'); }catch(e){}
  }
  function toggleExportMenu(){
    try{ playSound('pop'); }catch(e){}
    const m=document.getElementById('exportMenu');
    m.classList.toggle('show');
  }
  document.addEventListener('click', (e)=>{ const m2=document.getElementById('alarmMenu2'); if(m2 && !m2.contains(e.target) && !e.target.closest('button[title="Alarmas tipo celular"]')) m2.classList.remove('show');
 const m=document.getElementById('alarmMenu'); if(m && !m.contains(e.target) && !e.target.closest('button[title="Alarmas tipo celular"]')) m.classList.remove('show'); 
    const menu=document.getElementById('exportMenu');
    const btn=document.getElementById('exportBtn');
    if(menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) menu.classList.remove('show');
  });
  function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.position='fixed'; a.style.left='-9999px'; a.style.top='-9999px'; a.style.opacity='0'; a.style.pointerEvents='none';
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    try{ a.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window})); }catch(e){ a.click(); }
    setTimeout(()=>{
      try{ document.body.removeChild(a); }catch(e){}
      URL.revokeObjectURL(url);
    }, 2000);
  }
  async function exportChats(format='json'){
    playSound('save');
    const btn=document.getElementById('exportBtn');
    const origText=btn?btn.textContent:'';
    if(btn){ btn.textContent='⏳ Exportando…'; btn.disabled=true; }
    if(chats.length===0){
      showToast('No hay chats para exportar','error');
      if(btn){ btn.textContent=origText; btn.disabled=false; }
      const m=document.getElementById('exportMenu'); if(m) m.classList.remove('show');
      return;
    }
    const active = chats.find(c=>c.id===activeChatId);
    try{
      let allMsgs = {};
      if(dbAvailable && USE_DB){
        for(const c of chats){
          const cid=c.id||c.chat_id;
          let fetched=false;
          try{
            const data = await apiFetch(`${API_BASE}/${cid}/messages?limit=1000&offset=0`);
            const msgs = data.messages || data.items || [];
            if(msgs && msgs.length>=0){ allMsgs[cid]=msgs; fetched=true; }
          }catch(e){}
          if(!fetched){
            try{
              const data2 = await apiFetch(`${API_BASE}/${cid}?limit=1000&offset=0`);
              const msgs2 = data2.messages || data2.items || [];
              if(msgs2){ allMsgs[cid]=msgs2; fetched=true; }
            }catch(e2){}
          }
          if(!fetched){
            const localAll = JSON.parse(localStorage.getItem('react_chats_full')||'{}');
            allMsgs[cid] = localAll[cid]||[];
          }
        }
      } else {
        allMsgs = JSON.parse(localStorage.getItem('react_chats_full')||'{}');
      }
      // Si hay chat activo, exportar solo ese para PDF/TXT/MD/DOC (más legible), si es JSON exportar todo
      const targetChats = (format!=='json' && active) ? [active] : chats;
      const targetMsgs = {};
      targetChats.forEach(c=>{ const cid=c.id||c.chat_id; targetMsgs[cid]=allMsgs[cid]||[]; });

      if(format==='json'){
        const exportData = {
          exported_at: new Date().toISOString(),
          app: "agente_react_rag",
          total_chats: targetChats.length,
          active_chat_id: activeChatId,
          chats: targetChats.map(c=>{
            const cid=c.id||c.chat_id;
            const msgs = targetMsgs[cid] || [];
            return {
              chat_id: cid,
              title: c.title,
              provider: c.provider,
              model: c.model,
              created_at: c.created_at,
              updated_at: c.updated_at,
              message_count: msgs.length,
              messages: msgs.map(m=>({
                message_id: m.id||m.message_id,
                role: m.role,
                content: m.content,
                created_at: m.created_at,
                meta: m.meta||null
              }))
            };
          }),
          scrollPositions
        };
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], {type:'application/json;charset=utf-8'});
        const safeTitle = active ? (active.title.replace(/[^a-z0-9]/gi,'_').slice(0,20) || 'chat') : 'chats';
        const name = active ? `chat-${safeTitle}-${new Date().toISOString().slice(0,10)}.json` : `chats-${new Date().toISOString().slice(0,10)}.json`;
        triggerDownload(blob, name);
        showToast(`Descargado JSON: ${targetChats.length} chat(s) · ${Object.values(targetMsgs).reduce((s,a)=>s+a.length,0)} mensajes`,'success');
        return;
      }

      if(format==='txt'){
        let txt = `Asistente — Exportación TXT\nFecha: ${new Date().toLocaleString()}\nChats: ${targetChats.length}\n${'='.repeat(60)}\n\n`;
        targetChats.forEach(c=>{
          const cid=c.id||c.chat_id; const msgs=targetMsgs[cid]||[];
          txt += `CHAT: ${c.title} (${cid})\nFecha: ${c.created_at}\nMensajes: ${msgs.length}\n${'-'.repeat(60)}\n`;
          msgs.forEach(m=>{ txt += `[${new Date(m.created_at).toLocaleString()}] ${m.role.toUpperCase()}: ${m.content}\n\n`; });
          txt += `\n${'='.repeat(60)}\n\n`;
        });
        const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
        const safeTxt = active ? (active.title.replace(/[^a-z0-9]/gi,'_').slice(0,20) || 'chat') : 'chats';
        const nameTxt = `${active?`chat-${safeTxt}`:'chats'}-${new Date().toISOString().slice(0,10)}.txt`;
        triggerDownload(blob, nameTxt);
        showToast('Descargado TXT','success'); return;
      }

      if(format==='md'){
        let md = `# Asistente — Exportación\n\n**Fecha:** ${new Date().toLocaleString()}  \n**Chats:** ${targetChats.length}\n\n---\n\n`;
        targetChats.forEach(c=>{
          const cid=c.id||c.chat_id; const msgs=targetMsgs[cid]||[];
          md += `## ${c.title}\n\n*ID:* \`${cid}\`  \n*Fecha:* ${c.created_at}  \n*Mensajes:* ${msgs.length}\n\n`;
          msgs.forEach(m=>{
            const role = m.role==='user' ? '🧑 Usuario' : '🤖 Assistant';
            md += `### ${role} — ${new Date(m.created_at).toLocaleString()}\n\n${m.content}\n\n`;
            if(m.meta) md += `*Meta:* \`${typeof m.meta==='string'?m.meta:JSON.stringify(m.meta)}\`\n\n`;
          });
          md += `---\n\n`;
        });
        const blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
        const safeMd = active ? (active.title.replace(/[^a-z0-9]/gi,'_').slice(0,20) || 'chat') : 'chats';
        const nameMd = `${active?`chat-${safeMd}`:'chats'}-${new Date().toISOString().slice(0,10)}.md`;
        triggerDownload(blob, nameMd);
        showToast('Descargado MD','success'); return;
      }

      if(format==='doc'){
        let html = `<html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;color:#0f172a} h1{color:#7c5cff} h2{border-bottom:2px solid #e2e8f0;padding-bottom:6px} .msg{margin:12px 0;padding:10px;border:1px solid #e2e8f0;border-radius:8px} .user{background:#f5f3ff} .assistant{background:#f8fafc}
  /* Mejoras de diseño — más cálido y minimal */
  .header{height:60px;padding:0 18px}
  .brand h1{font-size:15px}
  .side-top{padding:14px}
  .chat-item{border-radius:14px}
  .chat-item.active{background:linear-gradient(135deg,rgba(124,92,255,.08),rgba(46,197,255,.06));border-color:rgba(124,92,255,.18)}
  .bubble{border-radius:18px}
  .bubble.user{border-radius:18px 18px 6px 18px}
  .bubble.bot{border-radius:18px 18px 18px 6px}
  .composer-inner{border-radius:18px}
  .btn{border-radius:14px}
  .empty-card{border-radius:20px}
  .export-menu{border-radius:14px}
  .icon-btn{border-radius:10px}
  /* Suavizar fondos */
  .chat-main{background: radial-gradient(700px 320px at 50% 0%, rgba(124,92,255,.05), transparent 65%), var(--bg)}
  .chat-list{gap:8px}

  
</style></head><body>`;
        html += `<h1>Asistente — Exportación</h1><p><b>Fecha:</b> ${new Date().toLocaleString()}<br><b>Chats:</b> ${targetChats.length}</p><hr>`;
        targetChats.forEach(c=>{
          const cid=c.id||c.chat_id; const msgs=targetMsgs[cid]||[];
          html += `<h2>${c.title}</h2><p><b>ID:</b> ${cid}<br><b>Mensajes:</b> ${msgs.length}</p>`;
          msgs.forEach(m=>{
            const cls=m.role==='user'?'user':'assistant';
            html += `<div class="msg ${cls}"><b>${m.role.toUpperCase()} — ${new Date(m.created_at).toLocaleString()}</b><br>${m.content.replace(/\n/g,'<br>')}</div>`;
          });
          html += `<hr>`;
        });
        html += `  
</body></html>`;
        const blob=new Blob([html],{type:'application/msword;charset=utf-8'});
        const safeDoc = active ? (active.title.replace(/[^a-z0-9]/gi,'_').slice(0,20) || 'chat') : 'chats';
        const nameDoc = `${active?`chat-${safeDoc}`:'chats'}-${new Date().toISOString().slice(0,10)}.doc`;
        triggerDownload(blob, nameDoc);
        showToast('Descargado DOC (Word)','success'); return;
      }

      if(format==='pdf'){
        // Intentar jsPDF si está disponible, sino fallback a impresión
        const activeChat = active || chats[0];
        const cid=activeChat.id||activeChat.chat_id;
        const msgs=targetMsgs[cid]||[];
        try{
          if(window.jspdf && window.jspdf.jsPDF){
            const {jsPDF}=window.jspdf;
            const doc=new jsPDF({unit:'mm',format:'a4'});
            let y=14;
            doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(124,92,255);
            doc.text('Asistente — Exportacion',14,y); y+=7;
            doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100,116,139);
            doc.text(`Fecha: ${new Date().toLocaleString()}  |  Chat: ${activeChat.title}  |  Mensajes: ${msgs.length}`,14,y); y+=6;
            doc.setDrawColor(226,232,240); doc.line(14,y,196,y); y+=6;
            doc.setFontSize(10);
            msgs.forEach(m=>{
              const role = m.role==='user' ? 'Usuario' : 'Assistant';
              const text = `${role} [${new Date(m.created_at).toLocaleString()}]: ${m.content}`;
              const lines = doc.splitTextToSize(text, 182);
              if(y + lines.length*5 > 282){ doc.addPage(); y=14; }
              doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
              doc.text(lines[0],14,y); y+=5;
              if(lines.length>1){
                doc.setFont('helvetica','normal'); doc.setTextColor(51,65,85);
                for(let i=1;i<lines.length;i++){ if(y>285){doc.addPage();y=14;} doc.text(lines[i],14,y); y+=5; }
              }
              y+=2;
            });
            const safePdf=(activeChat.title.replace(/[^a-z0-9]/gi,'_').slice(0,20)||'chat');
            doc.save(`${safePdf}-${new Date().toISOString().slice(0,10)}.pdf`);
            showToast('Exportado PDF','success');
            return;
          }
        }catch(e){ console.warn('jsPDF fallo, fallback',e); }
        // Fallback robusto: descargar HTML imprimible + intentar abrir ventana de impresión
        let html = `<html><head><meta charset="UTF-8"><title>Export PDF — ${activeChat.title}</title><style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#0f172a} h1{color:#7c5cff} .msg{margin:10px 0;padding:10px;border:1px solid #e2e8f0;border-radius:8px} .user{background:#f5f3ff} .assistant{background:#f8fafc} @media print{body{padding:0}}
  /* Mejoras de diseño — más cálido y minimal */
  .header{height:60px;padding:0 18px}
  .brand h1{font-size:15px}
  .side-top{padding:14px}
  .chat-item{border-radius:14px}
  .chat-item.active{background:linear-gradient(135deg,rgba(124,92,255,.08),rgba(46,197,255,.06));border-color:rgba(124,92,255,.18)}
  .bubble{border-radius:18px}
  .bubble.user{border-radius:18px 18px 6px 18px}
  .bubble.bot{border-radius:18px 18px 18px 6px}
  .composer-inner{border-radius:18px}
  .btn{border-radius:14px}
  .empty-card{border-radius:20px}
  .export-menu{border-radius:14px}
  .icon-btn{border-radius:10px}
  /* Suavizar fondos */
  .chat-main{background: radial-gradient(700px 320px at 50% 0%, rgba(124,92,255,.05), transparent 65%), var(--bg)}
  .chat-list{gap:8px}

  
</style></head><body>`;
        html += `<h1>Agente ReAct RAG — ${activeChat.title}</h1><p>Fecha: ${new Date().toLocaleString()} | Mensajes: ${msgs.length}</p><hr>`;
        msgs.forEach(m=>{ html += `<div class="msg ${m.role}"><b>${m.role.toUpperCase()} — ${new Date(m.created_at).toLocaleString()}</b><br>${m.content.replace(/\n/g,'<br>')}</div>`; });
        html += `<hr><p style="font-size:11px;color:#64748b">Generado por agente_react_rag — usa Imprimir → Guardar como PDF para obtener PDF final</p>  
</body></html>`;
        // Descarga directa del HTML (se puede imprimir a PDF)
        const blobHtml = new Blob([html], {type:'text/html;charset=utf-8'});
        const safeHtml=(activeChat.title.replace(/[^a-z0-9]/gi,'_').slice(0,20)||'chat');
        const nameHtml = `${safeHtml}-${new Date().toISOString().slice(0,10)}.html`;
        triggerDownload(blobHtml, nameHtml);
        // Intentar abrir ventana de impresión (no bloqueante, opcional)
        try{
          const w=window.open('','_blank');
          if(w){ w.document.write(html); w.document.close(); setTimeout(()=>{ try{ w.print(); }catch(e){} }, 600); }
        }catch(e){}
        showToast('Descargado HTML para PDF — abre el archivo e imprime como PDF','info');
        return;
      }

    }catch(e){
      console.error(e);
      showToast('Error al exportar chat','error');
    } finally {
      if(btn){ btn.textContent=origText; btn.disabled=false; }
      const m=document.getElementById('exportMenu'); if(m) m.classList.remove('show');
    }
  }
  async function clearAll(){
    try{ playSound('warning'); }catch(e){}
    if(!confirm('¿Borrar TODO el historial de todos los chats?')) { try{ playSound('cancel'); }catch(e){} return; }
    if(USE_DB){
      for(const c of [...chats]) await deleteChatAPI(c.id);
    } else {
      chats=[]; localStorage.setItem('react_chats', '[]'); localStorage.setItem('react_chats_full','{}');
    }
    activeChatId=null; localStorage.removeItem('react_active_chat'); messages=[]; try{ playSound('delete'); }catch(e){} await refreshList(); renderChat(); _updateNuevoCount(); updateHeader(); try{ playSound('success'); }catch(e){}
  }

  // --- Scroll por chat: guardar al hacer scroll + cargar más al llegar arriba ---
  function scrollToBottom(){ const el=document.getElementById('chatScroll'); if(el) el.scrollTo({top:el.scrollHeight,behavior:'smooth'}); try{ playSound('whoosh'); }catch(e){} }
  function updateScrollBtn(){ const el=document.getElementById('chatScroll'); const btn=document.getElementById('scrollBottomBtn'); if(!el||!btn) return; const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120; const needsScroll = el.scrollHeight > el.clientHeight + 100; btn.classList.toggle('show', !nearBottom && needsScroll); }
  document.getElementById('chatScroll')?.addEventListener('scroll', (e)=>{
    persistScroll();
    updateScrollBtn();
    if(e.target.scrollTop < 40 && loadedOffset < totalMessages){
      loadMore();
    }
  });
  function scrollChatsToTop(){ const el=document.getElementById('chatList'); if(el) el.scrollTo({top:0,behavior:'smooth'}); try{ playSound('scroll'); }catch(e){} }
  function scrollChatsToBottom(){ const el=document.getElementById('chatList'); if(el) el.scrollTo({top:el.scrollHeight,behavior:'smooth'}); try{ playSound('scroll'); }catch(e){} }
  function updateChatsScrollBtn(){ const el=document.getElementById('chatList'); const btn=document.getElementById('scrollChatsBtn'); if(!el||!btn) return; const showTop = el.scrollTop > 120; const showBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 80; // mostrar si hay scroll
    if(showTop) { btn.textContent='↑'; btn.title='Ir arriba'; btn.onclick=scrollChatsToTop; btn.classList.add('show'); }
    else if(showBottom) { btn.textContent='↓'; btn.title='Ir abajo'; btn.onclick=scrollChatsToBottom; btn.classList.add('show'); }
    else btn.classList.remove('show');
  }
  document.getElementById('chatList')?.addEventListener('scroll', ()=>{ updateChatsScrollBtn(); });

  
// Page Loader — overlay elegante
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

  // Actualizar botón scroll al cargar
  setTimeout(updateScrollBtn, 400);
  window.addEventListener('resize', updateScrollBtn);
  window.addEventListener('resize', updateChatsScrollBtn);
  setTimeout(updateChatsScrollBtn, 600);
  // Loader 5s alrededor del logo — todas las páginas
  (function(){
    const w=document.getElementById('logoWrap');
    if(w){
      w.classList.add('initial-loading');
      setTimeout(()=> w.classList.remove('initial-loading'), 5000);
    }
  })();
  // Init
  // Sincronizar LLM antes de pintar selector
  syncLLMsFromBackend().then(()=> fillModelSelect());
  fillModelSelect();
  (async()=>{
    await refreshList();
    activeChatId = localStorage.getItem('react_active_chat') || chats[0]?.id || null;
    if(activeChatId) await openChat(activeChatId); else renderChat(); _updateNuevoCount();
    // probar BD al inicio
    try{ await apiFetch(`${API_BASE}?limit=1`); }catch(e){}
  })();
  if(window.innerWidth<900) document.getElementById('menuBtn').style.display='inline-flex';
  window.addEventListener('storage', fillModelSelect);
  const _fillInterval=setInterval(fillModelSelect, 2000);
  window.addEventListener('beforeunload', ()=>clearInterval(_fillInterval));
