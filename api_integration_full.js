// LUNAS SHOP — Backend integration - overrides localStorage stubs with server API, keeps design
(function(){
const API_BASE = window.API_BASE || localStorage.getItem('api_base') || '';
const RATES_LOCAL = {USD:1, EUR:0.92, RUB:95, KZT:540};
const SYMBOLS_LOCAL = {USD:'$', EUR:'\u20AC', RUB:'\u20BD', KZT:'\u20B8'};

async function apiRequest(path, opts={}){
  const token = localStorage.getItem('lunas_token');
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(token) headers['Authorization'] = 'Bearer '+token;
  const res = await fetch(API_BASE+path, Object.assign({}, opts, {headers}));
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||('HTTP '+res.status));
  return data;
}

// Override auth
window.getCurrent = function(){
  try{
    const token = localStorage.getItem('lunas_token');
    if(!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const cached = JSON.parse(localStorage.getItem('lunas_current')||'null');
    if(cached && cached.email) return cached;
    return {id:payload.id, email:payload.email, is_admin:payload.is_admin, balanceUSD:0};
  }catch{ return null }
};
window.setCurrent = function(u){
  if(u){
    if(u.token){
      localStorage.setItem('lunas_token', u.token);
      localStorage.setItem('lunas_current', JSON.stringify(u.user||u));
    } else if(u.email){
      localStorage.setItem('lunas_current', JSON.stringify(u));
    }
  } else {
    localStorage.removeItem('lunas_token');
    localStorage.removeItem('lunas_current');
  }
};

// Server balance
let serverBalanceUSD = null;
async function refreshServerBalance(){
  try{
    const b = await apiRequest('/api/me/balance');
    serverBalanceUSD = b.balance_usd;
    const cur = window.getCurrent();
    if(cur){
      cur.balanceUSD = serverBalanceUSD;
      localStorage.setItem('lunas_current', JSON.stringify(cur));
      if(window.renderAuth) renderAuth();
      if(window.updateCart) updateCart();
    }
  }catch(e){ console.log('balance refresh failed', e.message)}
}
setInterval(()=>{ if(getCurrent()) refreshServerBalance(); }, 5000);
window.refreshServerBalance = refreshServerBalance;

// Override checkout to use server
const origCheckout = window.checkout;
window.checkout = async function(){
  const cur=getCurrent();
  if(!cur){ toast('Сначала войди в аккаунт'); if(window.openAuth) openAuth('login'); return }
  const cart = window.cart || JSON.parse(localStorage.getItem('lunas_cart')||'[]');
  if(!cart || cart.length===0){ toast('Корзина пуста — добавь товар'); return }
  const map = {
    'Spoofer Lifetime': ['spoofer_lifetime','lifetime'],
    'Spoofer Temporary 1 день': ['spoofer_tmp_1d','1d'],
    'Spoofer 7 дней': ['spoofer_7d','7d'],
    'Spoofer Valorant Vanguard': ['spoofer_valorant','valorant'],
    'Spoofer EAC': ['spoofer_eac','eac'],
    'Spoofer BattlEye': ['spoofer_be','be'],
    'Morphine — 1 день': ['morphine_1d','1d'],
    'Morphine — 3 дня': ['morphine_3d','3d'],
    'Morphine — 7 дней': ['morphine_7d','7d'],
    'Morphine — 30 дней': ['morphine_30d','30d'],
    'Morphine': ['morphine_30d','30d'],
    'PUBG Full': ['pubg_full','30d'],
    'Apex Legends': ['apex_full','30d'],
  };
  const item = cart[0];
  let product_id, license_type;
  const key = Object.keys(map).find(k=> item.name.includes(k) || k===item.name);
  if(key && map[key]){ [product_id, license_type]=map[key]; }
  else if(item.name.includes('Morphine')){ product_id='morphine_30d'; license_type='30d'; }
  else if(item.name.includes('Spoofer')){ product_id='spoofer_lifetime'; license_type='lifetime'; }
  else { product_id='morphine_30d'; license_type='30d'; }
  const currency = window.getCurrency ? getCurrency() : 'USD';
  try{
    toast('Создаю заказ...');
    const orderRes = await apiRequest('/api/orders',{method:'POST', body:JSON.stringify({product_id, license_type, currency})});
    const orderId = orderRes.order.id;
    const payRes = await apiRequest('/api/payments/create',{method:'POST', body:JSON.stringify({order_id: orderId})});
    if(payRes.paymentUrl && payRes.paymentUrl.startsWith('/mock-pay/')){
      const bg=document.getElementById('modalBg');
      const curSym = SYMBOLS_LOCAL[currency]||'$';
      document.getElementById('modalTitle').textContent='Оплата — '+(payRes.amount/100)+' '+payRes.currency;
      document.getElementById('modalText').innerHTML=`<div style="text-align:left">
        <div style="font-size:12px;color:rgba(255,255,255,0.7)">Заказ <b style="color:#fff">${orderId.slice(0,8)}</b> на <b style="color:#fff">${product_id} ${license_type}</b> — <b style="color:#fff">${payRes.amount/100} ${payRes.currency}</b></div>
        <div style="margin-top:10px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px">
          <div style="font-size:12px">Mock оплата (для теста). В продакшене здесь будет Stripe/YooKassa/Kaspi страница.</div>
          <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5)">Нажми «Оплатил» — сервер проверит подпись, сумму, валюту, order_id и выдаст ключ атомарно.</div>
        </div>
      </div>`;
      bg.classList.add('open');
      document.getElementById('modalClose').onclick=()=>bg.classList.remove('open');
      bg.onclick=(e)=>{if(e.target===bg) bg.classList.remove('open')}
      const act=document.getElementById('modalAction');
      act.style.display='inline-flex';
      act.textContent='Проверить оплату';
      act.onclick=async ()=>{
        try{
          const check = await apiRequest('/api/orders/'+orderId);
          if(check.order.status==='paid'){
            const keyVal = check.key ? check.key.key_value : '—';
            bg.classList.remove('open');
            if(window.modal) modal('Оплачено ✓','Ключ: <b>'+keyVal+'</b><br>Заказ '+orderId.slice(0,8)+'<br>Отправлен на '+cur.email+' и в "Мои покупки"','Скопировать ключ',()=>{navigator.clipboard?.writeText(keyVal); toast('Ключ скопирован','ok')});
            window.cart=[]; localStorage.setItem('lunas_cart','[]'); if(window.updateCart) updateCart();
            if(window.loadPurchases) loadPurchases();
            refreshServerBalance();
            return;
          }
          if(check.order.status==='pending'){
            toast('Вы ещё не оплатили — переведите '+payRes.amount/100+' '+payRes.currency+' на реквизиты и дождитесь подтверждения');
            return;
          }
          if(check.order.status==='out_of_stock'){
            toast('Нет ключей — админ уведомлён');
            return;
          }
          toast('Статус: '+check.order.status);
        }catch(err){ toast(err.message||'Ошибка проверки') }
      };
      // For mock testing, admin can confirm via /api/mock/confirm-order/:id (not available to user)
      return;
    }
    window.location.href = payRes.paymentUrl;
  }catch(err){ toast(err.message||'Ошибка создания заказа') }
};

// Patch top-up to use server
const origOpenTopup = window.openTopup;
window.openTopup = function(){
  const cur=getCurrent();
  if(!cur){ toast('Сначала войди'); if(window.openAuth) openAuth('login'); return }
  if(origOpenTopup) origOpenTopup();
  // Override the modalAction for topup to use server
  setTimeout(()=>{
    const act=document.getElementById('modalAction');
    if(!act) return;
    act.onclick = async ()=>{
      const val=parseInt(document.getElementById('topupCustom').value||window._topupVal||10,10);
      if(!val || val<=0){ toast('Введи сумму'); return }
      const currency = window.getCurrency ? getCurrency() : 'USD';
      try{
        toast('Создаю пополнение...');
        const topupRes = await apiRequest('/api/topups',{method:'POST', body:JSON.stringify({amount:val, currency})});
        const topupId=topupRes.topup.id;
        const payRes = await apiRequest('/api/payments/create',{method:'POST', body:JSON.stringify({topup_id: topupId})});
        if(payRes.paymentUrl.startsWith('/mock-pay/')){
          const res = await fetch(API_BASE+'/api/mock/confirm-topup/'+topupId, {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('lunas_token')}});
          const data=await res.json();
          if(!res.ok) throw new Error(data.error||'Webhook failed');
          document.getElementById('modalBg').classList.remove('open');
          toast('Баланс пополнен на '+val+ (SYMBOLS_LOCAL[currency]||'$')+' ✓','ok');
          refreshServerBalance();
          return;
        }
        window.location.href=payRes.paymentUrl;
      }catch(err){ toast(err.message||'Ошибка пополнения') }
    };
  }, 100);
};

// Purchases section loader
window.loadPurchases = async function(){
  try{
    const data = await apiRequest('/api/me/purchases');
    const box=document.getElementById('purchasesList');
    if(!box) return;
    if(!data.purchases || data.purchases.length===0){ box.innerHTML='<div style="font-size:12px;color:rgba(255,255,255,0.5)">Пока нет покупок</div>'; return; }
    box.innerHTML=data.purchases.map(p=>`
      <div class="glass" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:800;font-size:13px">${p.product_id} <span style="font-size:11px;color:rgba(255,255,255,0.5)">${p.license_type}</span></div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5)">${(p.paid_at||'').slice(0,10)} • ${p.id.slice(0,8)} • ${p.status}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <code style="background:#fff;color:#000;padding:6px 8px;border-radius:8px;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.key_value||'—'}</code>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:11px" onclick="navigator.clipboard.writeText('${p.key_value||''}'); toast('Ключ скопирован','ok')">Копировать</button>
        </div>
      </div>
    `).join('');
  }catch(e){ console.error(e) }
};

// Inject purchases section after reviews
document.addEventListener('DOMContentLoaded', ()=>{
  const reviews=document.getElementById('reviews');
  if(reviews && !document.getElementById('purchasesSection')){
    const sec=document.createElement('section');
    sec.id='purchasesSection';
    sec.style.cssText='padding:24px 0 8px';
    sec.innerHTML=`
      <div class="container">
        <h2 style="font-size:22px;font-weight:900;letter-spacing:-0.02em">Мои покупки <span style="font-size:11px;font-family:JetBrains Mono,monospace;color:rgba(255,255,255,0.35)">только для владельца</span></h2>
        <p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px">Требуется вход. Ключи показываются только авторизованному владельцу.</p>
        <div id="purchasesList" style="margin-top:12px;display:grid;gap:8px"></div>
        <div style="margin-top:8px"><button class="btn btn-ghost" style="padding:6px 12px;font-size:11px" onclick="loadPurchases()">Обновить</button></div>
      </div>`;
    reviews.insertAdjacentElement('afterend', sec);
  }
  if(getCurrent()) loadPurchases();
  const origRenderAuth = window.renderAuth;
  window.renderAuth = function(){ if(origRenderAuth) origRenderAuth(); if(getCurrent()) loadPurchases(); };
  refreshServerBalance();
});

// Intercept auth form to use server
document.addEventListener('DOMContentLoaded', ()=>{
  const form=document.getElementById('authForm');
  if(!form) return;
  const clone=form.cloneNode(true);
  form.parentNode.replaceChild(clone, form);
  clone.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email=document.getElementById('authEmail').value.trim();
    const pass=document.getElementById('authPass').value;
    const pass2=document.getElementById('authPass2').value;
    let ok=true;
    const emailErr=document.getElementById('emailErr'), passErr=document.getElementById('passErr'), pass2Err=document.getElementById('pass2Err');
    emailErr.style.display='none'; passErr.style.display='none'; pass2Err.style.display='none';
    const isGmail = (em)=> /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) && /gmail\.com$/i.test(em);
    if(!isGmail(email)){ emailErr.style.display='block'; ok=false; toast('Нужна Gmail — @gmail.com') }
    if(pass.length<6){ passErr.style.display='block'; ok=false; }
    if(window.authMode==='register' && pass!==pass2){ pass2Err.style.display='block'; ok=false; }
    if(!ok) return;
    try{
      let res;
      if(window.authMode==='register'){
        res = await apiRequest('/api/auth/register',{method:'POST', body:JSON.stringify({email, password:pass})});
        toast('Аккаунт создан ✓','ok');
      } else {
        res = await apiRequest('/api/auth/login',{method:'POST', body:JSON.stringify({email, password:pass})});
        toast('Вход выполнен ✓','ok');
      }
      localStorage.setItem('lunas_token', res.token);
      localStorage.setItem('lunas_current', JSON.stringify(res.user));
      if(window.closeAuth) closeAuth();
      if(window.renderAuth) renderAuth();
      refreshServerBalance();
      document.getElementById('authEmail').value=''; document.getElementById('authPass').value=''; document.getElementById('authPass2').value='';
    }catch(err){
      toast(err.message||'Ошибка','');
    }
  });
});


// ADMIN KEYS — add/view/delete
async function loadAdminKeys(){
  try{
    const data = await apiRequest(API_BASE+'/api/admin/stats');
    const statsEl=document.getElementById('admKeysStats');
    if(statsEl){
      statsEl.innerHTML = data.stats.map(s=>`${s.product_id} ${s.license_type} — <b style="color:#fff">${s.available} free</b> / ${s.sold} sold — ${s.price_cents/100}$`).join('<br>');
    }
    // also populate product select
    const sel=document.getElementById('admKeyProduct');
    if(sel && sel.options.length===0){
      const prods = [...new Set(data.stats.map(s=>s.product_id))];
      sel.innerHTML = prods.map(p=>`<option value="${p}">${p}</option>`).join('');
      // update license input when product changes
      sel.addEventListener('change', ()=>{
        const cur = data.stats.find(s=>s.product_id===sel.value);
        if(cur) document.getElementById('admKeyLicense').value=cur.license_type;
      });
      if(data.stats[0]) document.getElementById('admKeyLicense').value=data.stats[0].license_type;
    }
    // load recent keys
    const keysData = await apiRequest(API_BASE+'/api/admin/keys?limit=20');
    const listEl=document.getElementById('admKeysList');
    if(listEl){
      listEl.innerHTML = keysData.keys.slice(0,20).map(k=>`
        <div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <span>${k.product_id} ${k.license_type} <b style="color:${k.status==='available'?'#10b981':'#fff'}">${k.status}</b> ${k.key_value.slice(0,16)}... ${k.order_id?'→'+k.order_id.slice(0,8):''} ${k.user_id?'('+k.user_id.slice(0,8)+')':''}</span>
          ${k.status==='available'?`<button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="deleteKey('${k.id}')">×</button>`:''}
        </div>
      `).join('') || '—';
    }
  }catch(e){ console.error(e); toast(e.message) }
}
async function deleteKey(id){
  if(!confirm('Удалить ключ '+id+'? Только свободные.')) return;
  try{
    await apiRequest(API_BASE+'/api/admin/keys/'+id, {method:'DELETE'});
    toast('Удалён','ok'); loadAdminKeys();
  }catch(e){ toast(e.message) }
}
window.deleteKey=deleteKey;
window.loadAdminKeys=loadAdminKeys;
// Hook into openAdmin to load keys
const _origOpenAdmin = window.openAdmin;
window.openAdmin = function(){
  if(typeof _origOpenAdmin==='function') _origOpenAdmin();
  setTimeout(loadAdminKeys, 100);
};
document.getElementById('admAddKey')?.addEventListener('click', async ()=>{
  const product_id=document.getElementById('admKeyProduct').value;
  const license_type=document.getElementById('admKeyLicense').value.trim();
  const key_value=document.getElementById('admKeySingle').value.trim();
  if(!product_id||!license_type||!key_value){ toast('Заполни все поля'); return }
  try{
    await apiRequest(API_BASE+'/api/admin/keys',{method:'POST', body:JSON.stringify({product_id, license_type, key_value})});
    toast('Ключ добавлен','ok'); document.getElementById('admKeySingle').value=''; loadAdminKeys();
  }catch(e){ toast(e.message) }
});
document.getElementById('admImportKeys')?.addEventListener('click', async ()=>{
  const product_id=document.getElementById('admKeyProduct').value;
  const license_type=document.getElementById('admKeyLicense').value.trim();
  const bulk=document.getElementById('admKeysBulk').value.trim().split('\n').map(s=>s.trim()).filter(Boolean);
  if(!bulk.length){ toast('Вставь ключи'); return }
  const keys=bulk.map(k=>({product_id, license_type, key_value:k}));
  try{
    await apiRequest(API_BASE+'/api/admin/keys/import',{method:'POST', body:JSON.stringify({keys})});
    toast('Импортировано '+keys.length,'ok'); document.getElementById('admKeysBulk').value=''; loadAdminKeys();
  }catch(e){ toast(e.message) }
});
document.getElementById('admRefreshKeys')?.addEventListener('click', loadAdminKeys);

console.log('LUNAS API integration loaded');
})();

  // Override topup to use server with REAL verification (no instant credit)
  window.openTopup = function(){
    const cur=getCurrent();
    if(!cur){ toast('Сначала войди'); if(window.openAuth) openAuth('login'); return }
    // Call original to show modal
    const orig = window._origOpenTopup || window.openTopup;
    // Actually we need to call the original openTopup that was saved before override
    // For now, trigger the original UI by dispatching
    if(window._origOpenTopup) window._origOpenTopup();
    else {
      // fallback: show modal directly
      const bg=document.getElementById('modalBg');
      document.getElementById('modalTitle').textContent='Пополнить баланс — '+ (window.SYMBOLS ? SYMBOLS[getCurrency()] : '$');
      bg.classList.add('open');
    }
    setTimeout(()=>{
      const act=document.getElementById('modalAction');
      const closeBtn=document.getElementById('modalClose');
      if(!act) return;
      // Replace with real verification flow
      act.textContent='Перейти к оплате';
      act.onclick = async ()=>{
        const valInput = document.getElementById('topupCustom');
        const val=parseInt((valInput && valInput.value) || window._topupVal||10,10);
        if(!val || val<=0){ toast('Введи сумму'); return }
        const currency = window.getCurrency ? getCurrency() : 'USD';
        const method = window._topupMethod || 'card';
        try{
          toast('Создаю счёт на '+val+ (window.SYMBOLS ? SYMBOLS[currency] : '$')+'...');
          const topupRes = await apiRequest('/api/topups',{method:'POST', body:JSON.stringify({amount:val, currency})});
          const topupId=topupRes.topup.id;
          const payRes = await apiRequest('/api/payments/create',{method:'POST', body:JSON.stringify({topup_id: topupId})});
          // Show payment instructions with QR and a "Проверить оплату" button
          const bg=document.getElementById('modalBg');
          const curSym = (window.SYMBOLS||{USD:'$'})[currency]||'$';
          const sellerInfo = {card:'****', kaspi:'****', sbpPhone:'****', crypto:'****'}; // SELLER removed, use backend paymentUrl
          let payHtml='';
          if(method==='card'){
            payHtml=`<b>Карта</b> <span style="font-weight:800">${sellerInfo.card}</span> <button onclick="navigator.clipboard.writeText('${sellerInfo.card}');toast('Карта скопирована','ok')" style="margin-left:6px;padding:3px 8px;border-radius:999px;background:#fff;color:#000;border:none;font-size:11px;font-weight:700;cursor:pointer">Копировать</button><br><span style="color:rgba(255,255,255,0.5)">Сумма: ${val}${curSym} — комментарий LUNAS ${topupId.slice(0,8)}</span><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sellerInfo.card)}" style="margin-top:10px;border-radius:10px;background:#fff;padding:6px" alt="QR">`;
          } else if(method==='sbp'){
            payHtml=`<b>СБП</b> ${sellerInfo.sbpPhone} <button onclick="navigator.clipboard.writeText('${sellerInfo.sbpPhone}');toast('Номер скопирован','ok')" style="margin-left:6px;padding:3px 8px;border-radius:999px;background:#fff;color:#000;border:none;font-size:11px;font-weight:700;cursor:pointer">Копировать</button><br><span style="color:rgba(255,255,255,0.5)">Сумма: ${val}${curSym}</span><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sellerInfo.sbpPhone)}" style="margin-top:10px;border-radius:10px;background:#fff;padding:6px" alt="QR">`;
          } else if(method==='kaspi'){
            payHtml=`<b style="color:#F14635">Kaspi Gold</b> ${sellerInfo.kaspi} <button onclick="navigator.clipboard.writeText('${sellerInfo.kaspi}');toast('Kaspi скопирован','ok')" style="margin-left:6px;padding:3px 8px;border-radius:999px;background:#F14635;color:#fff;border:none;font-size:11px;font-weight:700;cursor:pointer">Копировать</button><br><span style="color:rgba(255,255,255,0.5)">Сумма: ${val}${curSym}</span><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sellerInfo.kaspi)}" style="margin-top:10px;border-radius:10px;background:#fff;padding:6px" alt="QR">`;
          } else {
            payHtml=`<b>USDT TRC20</b><br><span style="font-size:11px;word-break:break-all;background:rgba(255,255,255,0.06);padding:6px 8px;border-radius:8px;display:inline-block">${sellerInfo.crypto}</span><br><span style="color:rgba(255,255,255,0.5)">Сумма: ${val} USDT</span><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(sellerInfo.crypto)}" style="margin-top:10px;border-radius:10px;background:#fff;padding:6px" alt="QR">`;
          }
          document.getElementById('modalTitle').textContent='Оплати ' + val + curSym + ' — ждём подтверждение';
          document.getElementById('modalText').innerHTML=`<div style="text-align:left">
            <div style="font-size:12px;color:rgba(255,255,255,0.7)">Заказ <b style="color:#fff">${topupId.slice(0,8)}</b> на <b style="color:#fff">${val}${curSym}</b> • <b style="color:#fff">${method}</b></div>
            <div style="margin-top:10px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px">${payHtml}</div>
            <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.45);text-align:center">После перевода нажми «Проверить оплату» — баланс зачислится только после подтверждения провайдера.</div>
          </div>`;
          act.textContent='Проверить оплату';
          // Remove old handler and set new one that checks status
          const newAct = act.cloneNode(true);
          act.parentNode.replaceChild(newAct, act);
          newAct.onclick = async ()=>{
            try{
              const check = await apiRequest('/api/topups/'+topupId);
              if(check.topup.status==='paid'){
                document.getElementById('modalBg').classList.remove('open');
                toast('Оплата подтверждена — баланс пополнен ✓','ok');
                refreshServerBalance();
                return;
              }
              if(check.topup.status==='pending'){
                toast('Вы ещё не оплатили — переведите '+val+curSym+' на реквизиты выше и дождитесь подтверждения');
                return;
              }
              toast('Статус: '+check.topup.status);
            }catch(e){ toast(e.message||'Ошибка проверки') }
          };
          // Also add a hidden "Симулировать оплату (тест)" for mock provider - only visible when PAYMENT_PROVIDER is mock
          // For demo, we will NOT auto-confirm. Admin must confirm via /api/mock/confirm-topup or webhook.
          // But for local test without real payment, you can use admin panel to confirm.
        }catch(err){ toast(err.message||'Ошибка') }
      };
    }, 150);
  };
  // Save original
  window._origOpenTopup = window.openTopup;
