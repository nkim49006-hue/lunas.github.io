// LUNAS SHOP — Backend integration (keeps design, replaces localStorage stubs with server)
const API = {
  async request(path, opts={}){
    const token = localStorage.getItem('lunas_token');
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if(token) headers['Authorization'] = 'Bearer '+token;
    const res = await fetch(path, Object.assign({}, opts, {headers}));
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||('HTTP '+res.status));
    return data;
  },
  register(email,password){ return this.request('/api/auth/register',{method:'POST', body:JSON.stringify({email,password})}) },
  login(email,password){ return this.request('/api/auth/login',{method:'POST', body:JSON.stringify({email,password})}) },
  me(){ return this.request('/api/auth/me') },
  createOrder(product_id, license_type, currency){ return this.request('/api/orders',{method:'POST', body:JSON.stringify({product_id, license_type, currency, email: getCurrent()?.email})}) },
  createPayment(order_id, topup_id){
    const body = order_id ? {order_id} : {topup_id};
    return this.request('/api/payments/create',{method:'POST', body:JSON.stringify(body)})
  },
  getOrder(id){ return this.request('/api/orders/'+id) },
  createTopup(amount,currency){ return this.request('/api/topups',{method:'POST', body:JSON.stringify({amount,currency})}) },
  getTopup(id){ return this.request('/api/topups/'+id) },
  getPurchases(){ return this.request('/api/me/purchases') },
  getBalance(){ return this.request('/api/me/balance') },
};
