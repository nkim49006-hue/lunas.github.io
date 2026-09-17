// LUNAS SHOP — Backend integration - overrides localStorage stubs with server API, keeps design
(function(){
const API = window.API_BASE || ''; // Task requirement: all auth via ${API}/api/auth/*
const RATES_LOCAL = {USD:1, EUR:0.92, RUB:95, KZT:540};
const SYMBOLS_LOCAL = {USD:'$', EUR:'\u20AC', RUB:'\u20BD', KZT:'\u20B8'};

async function apiRequest(path, opts={}){
  const token = localStorage.getItem('lunas_token');
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(token) headers['Authorization'] = 'Bearer '+token;
  const base = (typeof API !== 'undefined' ? API : '') || window.API_BASE || '';
  if(!base && location.hostname.includes('github.io')){
    throw new Error('Бэкенд не подключен — на GitHub Pages нужен деплой сервера. Локально открой http://127.0.0.1:3000 или задай localStorage.setItem(\'api_base\',\'https://твой-бэкенд.onrender.com\')');
  }
  const res = await fetch(base+path, Object.assign({}, opts, {headers}));
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

// Гостевой checkout — без регистрации, сразу оплата
const origCheckout = window.checkout;
window.checkout = async function(){
  const cur=getCurrent();
  let guestEmail = cur?.email || localStorage.getItem('lunas_guest_email') || document.getElementById('buyEmail')?.value?.trim() || '';
  if(!guestEmail){
    guestEmail = prompt('Введи email для получения ключа:') || '';
    guestEmail = guestEmail.trim();
    if(!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)){ toast('Введи корректный email'); return; }
    localStorage.setItem('lunas_guest_email', guestEmail);
  }
  const cart = window.cart || JSON.parse(localStorage.getItem('lunas_cart')||'[]');
  if(!cart || cart.length===0){ toast('Корзина пуста — добавь товар'); return }
  // если бэкенда нет — сразу в демо-режим (index.html уже имеет демо-логику, но дублируем тут для совместимости)
  const hasBackend = !!(window.API_BASE || localStorage.getItem('api_base'));
  const isNoBackendHost = location.hostname.includes('github.io') && !hasBackend;
  if(isNoBackendHost){
    // делегируем демо-чекауту из index.html (он уже определён как window.checkout до этого переопределения — но мы его перехватили)
    // поэтому вызываем демо-логику напрямую
    if(typeof window.renderDemoPurchases==='function' && origCheckout){
      try{ return await origCheckout(); }catch(e){ console.log('fallback to orig demo', e); }
    }
    // если origCheckout — демо, он уже покажет ключ; если нет — делаем минимум
    const item = cart[0];
    const fakeKey = 'LUNAS-' + Math.random().toString(36).slice(2,10).toUpperCase() + '-' + Math.random().toString(36).slice(2,10).toUpperCase();
    const purchases = JSON.parse(localStorage.getItem('lunas_demo_purchases')||'[]');
    purchases.unshift({id: 'demo_'+Date.now(), product_id: item.id||item.name, license_type: item.license||'lifetime', key_value: fakeKey, paid_at: new Date().toISOString(), status:'paid', email: guestEmail});
    localStorage.setItem('lunas_demo_purchases', JSON.stringify(purchases));
    window.cart=[]; localStorage.setItem('lunas_cart','[]'); if(window.updateCart) updateCart();
    toast('Оплата прошла ✓ (демо-режим)','ok');
    return;
  }
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
    const orderRes = await apiRequest('/api/orders',{method:'POST', body:JSON.stringify({product_id, license_type, currency, email: guestEmail})});
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
          // For mock, don't auto-confirm — show payment instructions and let user check status
          // In production, provider will call webhook; here we just show QR and a "Проверить" button
          const bg=document.getElementById('modalBg');
          bg.classList.remove('open');
          // Show payment modal with QR and check button
          const payUrl = payRes.paymentUrl;
          // Create a simple payment check modal
          const checkModal = document.createElement('div');
          checkModal.id='topupCheckModal';
          checkModal.style.cssText='position:fixed;inset:0;z-index:80;background:rgba(0,0,0,0.82);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px';
          checkModal.innerHTML=`
            <div style="background:#121214;border:1px solid rgba(255,255,255,0.14);border-radius:20px;max-width:480px;width:100%;padding:22px;text-align:center">
              <div style="font-weight:900;font-size:16px">Оплати ${val}${SYMBOLS_LOCAL[currency]||'$'} — ${currency}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px">Переведи точную сумму на реквизиты выше. Ключ/баланс зачислится только после подтверждения провайдера.</div>
              <div style="margin-top:12px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px">
                <div style="font-size:12px">Заказ <b>${topupId.slice(0,8)}</b> — статус: <b id="topupStatus">pending</b></div>
                <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5)">Нажми «Проверить оплату» после перевода. Если не оплатил — увидишь «Вы ещё не оплатили».</div>
              </div>
              <div style="margin-top:14px;display:flex;gap:8px">
                <button class="btn btn-ghost" style="flex:1" onclick="document.getElementById('topupCheckModal').remove()">Закрыть</button>
                <button class="btn btn-white" style="flex:1;background:#fff;color:#000" id="checkTopupBtn">Проверить оплату</button>
              </div>
              <div style="margin-top:8px;font-size:10px;color:rgba(255,255,255,0.25)">Mock: админ может подтвердить в /api/mock/confirm-topup/${topupId} (только если PAYMENT_PROVIDER=mock)</div>
            </div>
          `;
          document.body.appendChild(checkModal);
          document.getElementById('checkTopupBtn').onclick = async ()=>{
            try{
              const check = await apiRequest('/api/topups/'+topupId);
              if(check.topup.status==='paid'){
                checkModal.remove();
                toast('Оплата подтверждена — баланс пополнен ✓','ok');
                refreshServerBalance();
                return;
              }
              if(check.topup.status==='pending'){
                toast('Вы ещё не оплатили — переведите '+val+(SYMBOLS_LOCAL[currency]||'$')+' и дождитесь подтверждения');
                return;
              }
              toast('Статус: '+check.topup.status);
            }catch(e){ toast(e.message) }
          };
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
      const msg = err.message||'';
      // На github.io без бэкенда — fallback в демо-режим (localStorage), чтобы кнопки реально работали
      const isNoBackend = msg.includes('Бэкенд не подключен') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed');
      if(isNoBackend && location.hostname.includes('github.io')){
        try{
          const users = JSON.parse(localStorage.getItem('lunas_users')||'[]');
          if(window.authMode==='register'){
            if(users.find(u=>u.email===email)){ toast('Email уже зарегистрирован',''); return; }
            users.push({email, pass, balanceUSD:0});
            localStorage.setItem('lunas_users', JSON.stringify(users));
            localStorage.setItem('lunas_current', JSON.stringify({email, balanceUSD:0}));
            toast('Аккаунт создан ✓ (демо-режим, без сервера)','ok');
          } else {
            const u = users.find(u=>u.email===email && u.pass===pass);
            if(!u){ toast('Неверный email или пароль',''); return; }
            localStorage.setItem('lunas_current', JSON.stringify(u));
            toast('Вход выполнен ✓ (демо-режим)','ok');
          }
          if(window.closeAuth) closeAuth();
          if(window.renderAuth) renderAuth();
          document.getElementById('authEmail').value=''; document.getElementById('authPass').value=''; document.getElementById('authPass2').value='';
          return;
        }catch(_e){ /* fallthrough */ }
      }
      if(isNoBackend){
        toast(msg.includes('Бэкенд не подключен') ? msg : 'Сервер авторизации недоступен — запусти npm start в server/ или задеплой бэкенд','');
      } else {
        toast(msg||'Ошибка','');
      }
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


// PROMO CODE — 10% (LUNAS10 etc.)
let appliedPromo = null; // {code, discount_percent}
let appliedCartPromo = null;

async function validatePromo(code, product_id, license_type){
  const currency = getCurrency ? getCurrency() : 'USD';
  try{
    const res = await fetch((window.API_BASE||'')+'/api/promo/validate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code, product_id, license_type, currency})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||'Invalid');
    return data;
  }catch(e){ throw e }
}

// Buy modal promo
document.getElementById('buyPromoBtn')?.addEventListener('click', async ()=>{
  const codeEl=document.getElementById('buyPromo');
  const statusEl=document.getElementById('buyPromoStatus');
  const priceEl=document.getElementById('buyPriceDisplay');
  const code=codeEl.value.trim().toUpperCase();
  if(!code){ toast('Введи промокод'); return }
  if(!buyState.product_id){ toast('Сначала выбери товар'); return }
  try{
    const data = await validatePromo(code, buyState.product_id, buyState.license_type);
    appliedPromo = {code: data.promo.code, discount_percent: data.promo.discount_percent};
    statusEl.style.color='#10b981';
    statusEl.textContent='✓ ' + data.promo.code + ' — -' + data.promo.discount_percent + '% (-'+(data.discount_cents/100)+ (data.currency==='USD'?'$': data.currency==='EUR'?'€': data.currency==='RUB'?'₽':'₸')+')';
    const sym = SYMBOLS[data.currency]||'$';
    priceEl.innerHTML = '<span style="text-decoration:line-through;color:rgba(255,255,255,0.35)">'+(data.original_cents/100)+sym+'</span> <span style="color:#10b981">'+(data.final_cents/100)+sym+'</span> <span style="font-size:10px;color:#10b981">-'+data.promo.discount_percent+'%</span>';
    // store for order creation
    buyState.promo_code = data.promo.code;
    toast('Промокод применён — 10%','ok');
  }catch(e){
    statusEl.style.color='#ff6b6b';
    statusEl.textContent='✗ '+(e.message||'Неверный промокод');
    appliedPromo=null;
    buyState.promo_code=null;
  }
});

// Cart promo
window.applyCartPromo = async function(){
  const inp=document.getElementById('cartPromo');
  const status=document.getElementById('cartPromoStatus');
  const code=inp.value.trim().toUpperCase();
  if(!code){ toast('Введи промокод'); return }
  // For cart, we need to validate against first item or total? For now, validate generally
  try{
    const data = await validatePromo(code, 'morphine_1d','1d'); // dummy product to check code exists; server will validate any product later
    // Actually we should just check if code exists, not tied to product yet
    const check = await fetch((window.API_BASE||'')+'/api/promo/'+code).then(r=>r.json().then(d=>({ok:r.ok, data:d})));
    if(!check.ok) throw new Error(check.data.error||'Invalid');
    appliedCartPromo = {code, discount_percent: check.data.promo.discount_percent};
    status.textContent='✓ '+code+' -'+check.data.promo.discount_percent+'%';
    status.style.color='#10b981';
    // Update cart total display with discount
    const cart = window.cart || JSON.parse(localStorage.getItem('lunas_cart')||'[]');
    const sumUSD = cart.reduce((s,c)=>s+c.price,0);
    const cur = getCurrency ? getCurrency() : 'USD';
    const totalEl=document.getElementById('cartTotal');
    if(totalEl && sumUSD){
      const RATES={USD:1,EUR:0.92,RUB:95,KZT:540};
      const orig = Math.round(sumUSD * (RATES[cur]||1));
      const disc = Math.round(orig * check.data.promo.discount_percent/100);
      const fin = orig - disc;
      const sym = (typeof SYMBOLS!=='undefined'?SYMBOLS[cur]:'$');
      totalEl.innerHTML = '<span style="text-decoration:line-through;opacity:0.5">'+orig+sym+'</span> <span style="color:#10b981">'+fin+sym+' -10%</span>';
      document.getElementById('cartDiscount').textContent='-'+disc+sym;
      document.getElementById('cartDiscount').style.display='inline';
      // store for checkout
      window._cartPromoCode = code;
    }
    toast('Промокод '+code+' — 10%','ok');
  }catch(e){
    status.textContent='✗ '+(e.message||'Неверный');
    status.style.color='#ff6b6b';
    appliedCartPromo=null;
    window._cartPromoCode=null;
  }
};

// Patch checkout and buyNow to send promo_code
const _origBuyPay = document.getElementById('buyPayBtn')?.onclick;
// Instead, we will wrap the buyPay logic to include promo_code
// Find the buyPayBtn handler in the file and patch it to include promo_code in the fetch


// ADMIN PROMO — управление промокодами
async function loadAdminPromo(){
  try{
    const data = await apiRequest(API_BASE+'/api/admin/promo');
    const box=document.getElementById('admPromoList');
    if(!box) return;
    box.innerHTML = data.promo.map(pr=>`
      <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-family:JetBrains Mono,monospace;font-size:11px">
        <span><b style="color:#fff">${pr.code}</b> — ${pr.discount_percent}% • ${pr.used_count}/${pr.max_uses||'∞'} • ${pr.is_active?'активен':'выкл'}</span>
        <button class="btn btn-ghost" style="padding:2px 6px;font-size:10px" onclick="deletePromo('${pr.code}')">×</button>
      </div>
    `).join('') || '<div style="font-size:11px;color:rgba(255,255,255,0.4)">Нет промокодов</div>';
  }catch(e){ console.error(e) }
}
async function deletePromo(code){
  if(!confirm('Удалить промокод '+code+'?')) return;
  try{ await apiRequest(API_BASE+'/api/admin/promo/'+code, {method:'DELETE'}); toast('Удалён','ok'); loadAdminPromo(); }catch(e){ toast(e.message) }
}
window.deletePromo=deletePromo;
window.loadAdminPromo=loadAdminPromo;
document.getElementById('admAddPromo')?.addEventListener('click', async ()=>{
  const code=document.getElementById('admPromoCode').value.trim().toUpperCase();
  const disc=parseInt(document.getElementById('admPromoDisc').value,10);
  const max=document.getElementById('admPromoMax').value.trim();
  if(!code || !disc){ toast('Заполни код и скидку'); return }
  try{
    await apiRequest(API_BASE+'/api/admin/promo',{method:'POST', body:JSON.stringify({code, discount_percent:disc, max_uses: max?parseInt(max,10):null})});
    toast('Промокод создан','ok'); document.getElementById('admPromoCode').value=''; loadAdminPromo();
  }catch(e){ toast(e.message) }
});
// Hook into openAdmin
const _origOpenAdmin2 = window.openAdmin;
window.openAdmin = function(){
  if(typeof _origOpenAdmin2==='function') _origOpenAdmin2();
  setTimeout(()=>{ loadAdminKeys(); loadAdminPromo(); }, 150);
};

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
