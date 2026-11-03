const API="/api";
let activeList=2;
let currentPage="watchlist";
let selectedSymbol="";
let selectedQuote=null;
let allOrders=[];
let allLedger=[];
let allDeposits=[];
let allWithdrawals=[];
let currentPeriod="TODAY";
let currentOrderFilter="ALL";
let currentTradeSubtab="ALL";
let withdrawMode="upi";
let settingsState={hide:false,sounds:true,bold:false,size:"S",theme:"light"};
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));

const money=(n,dec=2)=>`₹${Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:dec,maximumFractionDigits:dec})}`;
const four=n=>Number(n||0).toFixed(4);
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove("show"),2200)}
async function api(url,options={}){
  const r=await fetch(API+url,{credentials:"include",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.message||"Request failed");
  return d;
}
function savePrefs(){localStorage.setItem("tb_prefs",JSON.stringify(settingsState))}
function loadPrefs(){
  try{settingsState={...settingsState,...JSON.parse(localStorage.getItem("tb_prefs")||"{}")}}catch{}
  applyPrefs();
}
function applyPrefs(){
  document.body.classList.toggle("hide-balances",!!settingsState.hide);
  document.body.classList.toggle("bold-numbers",!!settingsState.bold);
  document.body.classList.remove("size-S","size-M","size-L","size-XL");
  document.body.classList.add("size-"+settingsState.size);
  document.body.classList.toggle("dark",settingsState.theme==="dark");
  const hs=$("#hideBalances"),ts=$("#tradeSounds"),bs=$("#boldNumbers");
  if(hs)hs.classList.toggle("on",settingsState.hide);
  if(ts)ts.classList.toggle("on",settingsState.sounds);
  if(bs)bs.classList.toggle("on",settingsState.bold);
  $$(".theme-segment button").forEach(b=>b.classList.toggle("active",b.dataset.theme===settingsState.theme));
  $$(".number-segment button").forEach(b=>b.classList.toggle("active",b.dataset.size===settingsState.size));
}
function playTone(){
  if(!settingsState.sounds)return;
  try{
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
    const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=720;g.gain.value=.045;
    o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.08);
  }catch{}
}
function setClock(){
  const d=new Date();
  const t=d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  if($("#headerClock"))$("#headerClock").textContent=t;
}
setClock();setInterval(setClock,1000);

async function loadMe(){
  const d=await api("/me"),u=d.user;
  const name=u.name||u.user_id||"User";
  const initial=name.charAt(0).toUpperCase();
  $("#headerUserName").textContent=name;$("#settingsUserName").textContent=name;
  $("#headerUserInitial").textContent=initial;$("#settingsUserInitial").textContent=initial;
  const b=money(u.balance);
  ["balance","settingsBalance","depositBalance","withdrawBalance","tradeFunds"].forEach(id=>{const e=$("#"+id);if(e)e.textContent=id==="settingsBalance"?four(u.balance):b});
  $("#positionBalance").textContent=money(u.balance,0);
  $("#accountSub").textContent=u.user_id;
}
async function loadHeader(){
  try{
    const d=await api(`/watchlist?list=${activeList}`);
    $("#headerCenter").textContent=`${d.symbols.length} scripts · Watchlist ${activeList}`;
  }catch{}
}
function displayInstrument(symbol){
  const clean=String(symbol||"").toUpperCase();
  const m=clean.match(/^(NIFTY|BANKNIFTY)(\d+)(CE|PE)$/i);
  if(m) return {name:`${m[1]}${m[2]}${m[3].toUpperCase()}`,sub:"NSE · F&O"};
  if(clean==="NIFTY FUT" || clean==="NIFTY 50") return {name:"NIFTY 50",sub:"NSE · FUTURES"};
  if(clean==="BANKNIFTY FUT" || clean==="BANK NIFTY") return {name:"BANK NIFTY",sub:"NSE · FUTURES"};
  return {name:clean,sub:"NSE"};
}
function fmtCompact(n){
  if(n==null||n==="") return "—";
  const v=Number(n);
  return Number.isFinite(v)?v.toLocaleString("en-IN",{maximumFractionDigits:2}):"—";
}
function getCachedOptionQuote(symbol){
  try{
    const cache=JSON.parse(localStorage.getItem("trade_bazzar_option_quotes")||"{}");
    return cache[String(symbol).toUpperCase()]||null;
  }catch{return null}
}
function cacheOptionQuote(meta){
  if(!meta||!meta.symbol)return;
  try{
    const cache=JSON.parse(localStorage.getItem("trade_bazzar_option_quotes")||"{}");
    cache[String(meta.symbol).toUpperCase()]={...meta};
    localStorage.setItem("trade_bazzar_option_quotes",JSON.stringify(cache));
  }catch{}
}
function loadWatchlist(){
  return api(`/watchlist?list=${activeList}`).then(async d=>{
    const rows=await Promise.all(d.symbols.map(async symbol=>{
      let q=null;try{q=(await api("/quote/"+encodeURIComponent(symbol))).data}catch{}
      const cached=getCachedOptionQuote(symbol);
      if(!q && cached) q=cached;
      else if(q && cached) q={...cached,...q};
      const inst=displayInstrument(symbol);
      const price=q&&q.price!=null?money(q.price):"₹—";
      const ch=q&&q.change_percent!=null?`${q.change_percent>=0?"▲":"▼"} ${Number(q.change_percent).toFixed(2)}%`:"—";
      const bid=q&&q.bid!=null?fmtCompact(q.bid):"—";
      const ask=q&&q.ask!=null?fmtCompact(q.ask):"—";
      const low=q&&q.low!=null?`L: ${fmtCompact(q.low)}`:"";
      const high=q&&q.high!=null?`H: ${fmtCompact(q.high)}`:"";
      const expiry=q&&q.expiry?`<span class="contract-meta">${esc(q.expiry)}</span>`:"";
      const isFno=/CE$|PE$|FUT$/i.test(inst.name);
      return `<div class="watch-row" data-symbol="${esc(symbol)}">
        <div class="instrument">
          <div class="instrument-title"><b>${esc(inst.name)}</b>${expiry}${isFno?'<span class="fno-badge">FO</span>':''}</div>
          <small>${esc(inst.sub)}</small>
          <div class="instrument-market"><span class="ltp ${q&&q.change_percent>=0?"positive":"negative"}">${price}</span><span class="change ${q&&q.change_percent>=0?"positive":"negative"}">${ch}</span><button class="remove-script" data-remove="${esc(symbol)}" aria-label="Remove">×</button></div>
        </div>
        <div class="quote-cell bid"><strong>${bid}</strong>${low?`<small>${low}</small>`:""}</div>
        <div class="quote-cell ask"><strong>${ask}</strong>${high?`<small>${high}</small>`:""}</div>
      </div>`;
    }));
    $("#watchlist").innerHTML=rows.join("");
    $("#watchEmpty").style.display=rows.length?"none":"block";
    $("#headerCenter").textContent=`${d.symbols.length} scripts · Watchlist ${activeList}`;
  });
}
async function loadSummary(){
  const [p,o]=await Promise.all([api("/positions"),api("/orders")]);
  $("#positionCount").textContent=p.positions.length;
  $("#orderCount").textContent=o.orders.length;
  const booked=o.orders.reduce((a,x)=>a+Number(x.pnl||0),0);
  $("#bookedPnl").textContent=booked?money(booked):"—";
  $("#positionBooked").textContent=(booked>=0?"+":"")+money(booked,0).replace("₹","");
}
async function loadNews(){
  try{
    const d=await api("/news");
    const text=d.news.map(n=>n.headline).join("  •  ");
    $("#newsTicker").textContent=text||"TRADE BAZZAR · Market update";
  }catch{}
}
async function loadQuote(symbol){
  try{return (await api("/quote/"+encodeURIComponent(symbol))).data}catch{return null}
}
async function openDetail(symbol){
  selectedSymbol=symbol;
  selectedQuote=await loadQuote(symbol);
  $("#detailSymbol").textContent=symbol;
  $("#detailPrice").textContent=selectedQuote?money(selectedQuote.price):"₹—";
  const c=selectedQuote?.change||0,p=selectedQuote?.change_percent||0;
  $("#detailChange").textContent=`${c>=0?"+":""}${money(c)}   ${p>=0?"+":""}${p.toFixed(2)}%`;
  $("#detailChange").className="detail-change "+(c>=0?"positive":"negative");
  navigate("detail");
}
function openTradeOrder(side){
  $("#tradeOrderSymbol").textContent=selectedSymbol||"RELIANCE";
  $("#tradeSideTitle").textContent=side;
  $("#placeOrder").textContent=side;
  $("#placeOrder").dataset.side=side;
  $("#placeOrder").style.background=side==="BUY"?"var(--green)":"var(--red)";
  $("#tradeLtp").textContent=selectedQuote?money(selectedQuote.price):"₹—";
  $("#tradePrice").value=selectedQuote?selectedQuote.price:"";
  $("#tradeQty").value="";
  updateOrderValue();
  navigate("trade-order");
}
function updateOrderValue(){
  const q=Number($("#tradeQty").value||0),p=Number($("#tradePrice").value||0);
  $("#orderValue").textContent=money(q*p);
}
async function placeOrder(){
  const side=$("#placeOrder").dataset.side,symbol=$("#tradeOrderSymbol").textContent;
  const quantity=Number($("#tradeQty").value),price=Number($("#tradePrice").value);
  if(!quantity||quantity<1||!price||price<=0)return toast("Enter valid quantity and price");
  try{
    await api("/orders",{method:"POST",body:JSON.stringify({symbol,side,quantity,price})});
    playTone();toast("Order executed");await Promise.all([loadMe(),loadSummary(),loadOrdersData(),loadPositions()]);
    navigate("orders");
  }catch(e){toast(e.message)}
}
async function loadPositions(){
  const d=await api("/positions");
  let live=0;
  d.positions.forEach(x=>live+=Number(x.unrealized_pnl||0));
  $("#livePnl").textContent=(live>=0?"+":"")+money(live,0).replace("₹","");
  if(!d.positions.length){
    $("#positionsList").innerHTML=`<div class="empty-position"><strong>No open positions</strong><span>Open a position from watchlist to start trading</span></div>`;
    return;
  }
  $("#positionsList").className="positions-empty-card";
  $("#positionsList").innerHTML=d.positions.map(x=>`<div class="position-row"><div><b>${esc(x.symbol)}</b><small>Qty ${x.quantity} · Avg ${money(x.avg_price)} · LTP ${money(x.ltp)}</small></div><b class="${x.unrealized_pnl>=0?"positive":"negative"}">${x.unrealized_pnl>=0?"+":""}${money(x.unrealized_pnl)}</b></div>`).join("");
}
async function loadOrdersData(){
  const d=await api("/orders");allOrders=d.orders||[];
  $("#ordersTotal").textContent=allOrders.length;
  $("#tradeCounter").textContent=`${allOrders.length} txns · P&L ...`;
  renderOrders();renderTrade();
}
function orderMatches(o){
  if(currentOrderFilter==="ALL")return true;
  if(currentOrderFilter==="PENDING")return String(o.status).toUpperCase()==="PENDING";
  if(currentOrderFilter==="EXEC")return ["EXECUTED","EXEC"].includes(String(o.status).toUpperCase());
  return ["REJ","REJECTED"].includes(String(o.status).toUpperCase());
}
function renderOrders(){
  const rows=allOrders.filter(orderMatches);
  if(!rows.length){$("#ordersList").innerHTML=`<div class="empty-orders">No orders to show.</div>`;return}
  $("#ordersList").innerHTML=rows.map(o=>`<div class="order-row"><div><b>${esc(o.symbol)}</b><small>${o.side} · Qty ${o.quantity}<br>Price ${money(o.price)}</small></div><div class="order-status ${o.status==="EXECUTED"?"exec":"rej"}>${esc(o.status==="EXECUTED"?"EXEC":o.status)}</div></div>`).join("");
}
function periodStart(period){
  const d=new Date(),now=d.getTime();
  if(period==="TODAY")d.setHours(0,0,0,0);
  if(period==="WEEK")d.setDate(d.getDate()-7);
  if(period==="MONTH")d.setMonth(d.getMonth()-1);
  return period==="CUSTOM"?0:d.getTime();
}
async function loadLedgerData(){
  const d=await api("/transactions");allLedger=d.transactions||[];
  $("#ledgerSub").textContent=`${allLedger.length} transactions`;
  $("#settingsDeposits").textContent=four(allLedger.filter(x=>x.entry_type==="DEPOSIT").reduce((a,x)=>a+Number(x.amount),0));
  $("#settingsWithdrawals").textContent=four(Math.abs(allLedger.filter(x=>x.entry_type==="WITHDRAWAL").reduce((a,x)=>a+Number(x.amount),0)));
  renderTrade();
  renderLedger();
}
function renderTrade(){
  const start=periodStart(currentPeriod);
  const orders=allOrders.filter(o=>start===0||new Date(String(o.created_at).replace(" ","T")+"Z").getTime()>=start);
  const ledger=allLedger.filter(x=>start===0||new Date(String(x.created_at).replace(" ","T")+"Z").getTime()>=start);
  const pnl=orders.reduce((a,x)=>a+Number(x.pnl||0),0);
  const volume=orders.reduce((a,x)=>a+Number(x.quantity||0)*Number(x.price||0),0);
  $("#realizedPnl").textContent=(pnl>=0?"+":"")+Number(pnl).toFixed(4);
  $("#txnCount").textContent=orders.length+ledger.length;
  $("#tradeCount").textContent=orders.length;
  $("#ledgerCount").textContent=ledger.length;
  $("#tradeVolume").textContent=Number(volume).toFixed(4);
  if(currentTradeSubtab==="LEDGER"){
    if(!ledger.length){$("#tradeActivity").innerHTML=`<div class="empty-activity"><strong>No transactions</strong><span>Trades and charges will appear here after you trade.</span></div>`;return}
    $("#tradeActivity").innerHTML=ledger.map(x=>`<div class="ledger-row"><div><b>${esc(x.entry_type)}</b><small>${esc(x.note||"")} · ${esc(x.created_at||"")}</small></div><strong class="${Number(x.amount)>=0?"positive":"negative"}">${Number(x.amount)>=0?"+":""}${money(x.amount)}</strong></div>`).join("");
  }else{
    if(!orders.length){$("#tradeActivity").innerHTML=`<div class="empty-activity"><strong>No transactions</strong><span>Trades and charges will appear here after you trade.</span></div>`;return}
    $("#tradeActivity").innerHTML=orders.map(o=>`<div class="ledger-row"><div><b>${esc(o.symbol)}</b><small>${o.side} · Qty ${o.quantity} · ${esc(o.created_at||"")}</small></div><strong class="${Number(o.pnl)>=0?"positive":"negative"}">${Number(o.pnl)>=0?"+":""}${money(o.pnl)}</strong></div>`).join("");
  }
}
function renderLedger(){
  const rows=allLedger;
  if(!rows.length){$("#ledgerList").innerHTML=`<div class="empty-activity"><strong>No transactions</strong><span>Trades and charges will appear here after you trade.</span></div>`;return}
  $("#ledgerList").innerHTML=rows.map(x=>`<div class="ledger-row"><div><b>${esc(x.entry_type)}</b><small>${esc(x.note||"")}</small></div><strong class="${Number(x.amount)>=0?"positive":"negative"}">${Number(x.amount)>=0?"+":""}${money(x.amount)}</strong></div>`).join("");
}
async function loadSettingsExtras(){
  try{
    const [deps,wds,rejs]=await Promise.all([api("/deposits"),api("/withdrawals"),api("/rejections")]);
    allDeposits=deps.deposits||[];allWithdrawals=wds.withdrawals||[];
    $("#rejectSub").textContent=`${rejs.rejections.length} rejected order${rejs.rejections.length===1?"":"s"}`;
    $("#settingsDeposits").textContent=four(allDeposits.filter(x=>x.status==="APPROVED").reduce((a,x)=>a+Number(x.amount),0));
    $("#settingsWithdrawals").textContent=four(allWithdrawals.filter(x=>x.status==="APPROVED").reduce((a,x)=>a+Number(x.amount),0));
    renderDepositHistory();renderWithdrawHistory();renderRejections(rejs.rejections||[]);
  }catch{}
}
async function loadDepositPage(){
  await loadMe();
  const d=await api("/settings"),s=d.settings||{};
  $("#depositUpi").textContent=s.upi_id||"Not configured";
  const img=$("#depositQr"),ph=$("#qrPlaceholder");
  if(s.qr_image){img.src=s.qr_image;img.style.display="block";ph.style.display="none"}else{img.removeAttribute("src");img.style.display="none";ph.style.display="block"}
  renderDepositHistory();
}
function renderDepositHistory(){
  if(!allDeposits.length){$("#depHistory").innerHTML="";return}
  $("#depHistory").innerHTML=`<h3>Deposit History</h3>`+allDeposits.map(x=>`<div class="history-item"><div><b>${money(x.amount)}</b><small>UTR: ${esc(x.utr||"—")}</small></div><span class="status ${x.status}">${x.status}</span></div>`).join("");
}
function renderWithdrawHistory(){
  if(!allWithdrawals.length){$("#wdHistory").innerHTML="";return}
  $("#wdHistory").innerHTML=`<h3>Withdrawal History</h3>`+allWithdrawals.map(x=>`<div class="history-item"><div><b>${money(x.amount)}</b><small>${esc(x.upi_id||x.bank_name||"—")}</small></div><span class="status ${x.status}">${x.status}</span></div>`).join("");
}
async function submitDeposit(){
  const amount=Number($("#depAmount").value),utr=$("#depUtr").value.trim();
  if(amount<=0)return toast("Enter a valid deposit amount");
  if(!utr)return toast("Enter payment reference / UTR");
  try{
    await api("/deposits",{method:"POST",body:JSON.stringify({amount,utr})});
    toast("Deposit request submitted");$("#depAmount").value="";$("#depUtr").value="";
    await loadSettingsExtras();await loadDepositPage();
  }catch(e){toast(e.message)}
}
async function submitWithdraw(){
  const amount=Number($("#wdAmount").value);
  if(amount<=0)return toast("Enter a valid withdrawal amount");
  const body={amount};
  if(withdrawMode==="upi"){body.upi_id=$("#wdUpi").value.trim();if(!body.upi_id)return toast("Enter UPI ID")}
  else{body.bank_name=$("#wdBank").value.trim();body.account_no=$("#wdAccount").value.trim();body.ifsc=$("#wdIfsc").value.trim();if(!body.bank_name||!body.account_no||!body.ifsc)return toast("Enter bank details")}
  try{
    await api("/withdrawals",{method:"POST",body:JSON.stringify(body)});
    toast("Withdrawal submitted");$("#wdAmount").value="";await loadSettingsExtras();await loadMe();
  }catch(e){toast(e.message)}
}
async function loadAccount(){
  const u=(await api("/account")).user;
  $("#accountUserId").textContent=u.user_id||"—";
  const vals=[["AADHAAR",u.aadhaar],["PAN",u.pan],["MOBILE NUMBER",u.mobile],["DATE OF BIRTH",u.dob],["EMAIL",u.email]];
  $("#accountDetails").innerHTML=vals.map(([k,v])=>`<div class="profile-row"><span>${k}</span><strong>${esc(v||"—")}</strong></div>`).join("");
}
function renderRejections(rows){
  $("#rejectionList").innerHTML=rows.length?rows.map(x=>`<div class="rejection-row"><div><b>${esc(x.type||"ORDER")}</b><small>${esc(x.reason||"Rejected")}</small></div><div><b class="negative">Rejected</b><small>${esc(x.created_at||"")}</small></div></div>`).join(""):`<div class="empty-activity"><strong>No rejection logs</strong><span>Rejected requests will appear here.</span></div>`;
}
async function loadRejectionsPage(){const d=await api("/rejections");renderRejections(d.rejections||[])}
async function loadBills(){
  if(!allOrders.length)await loadOrdersData();
  $("#billList").innerHTML=allOrders.length?allOrders.map(o=>`<div class="bill-row"><div><b>${esc(o.symbol)} · ${o.side}</b><small>Qty ${o.quantity} · Price ${money(o.price)} · ${esc(o.status)}</small></div><button data-bill="${o.id}">DOWNLOAD</button></div>`).join(""):`<div class="empty-activity"><strong>No bills</strong><span>Your trade statements will appear here.</span></div>`;
}
async function downloadBill(id){
  try{
    const d=await api("/bill/"+id),b=d.bill;
    const w=window.open("","_blank");if(!w)return;
    w.document.write(`<html><head><title>Trade Bazzar Bill #${b.id}</title></head><body style="font-family:Arial;padding:35px"><h1>TRADE BAZZAR</h1><h2>Trade Bill #${b.id}</h2><p>User: ${esc(b.user_id)}</p><hr><p>Symbol: ${esc(b.symbol)}</p><p>Side: ${esc(b.side)}</p><p>Quantity: ${b.quantity}</p><p>Price: ${money(b.price)}</p><p>Status: ${esc(b.status)}</p><p>P&L: ${money(b.pnl)}</p><button onclick="print()">Print / Save PDF</button></body></html>`);w.document.close();
    setTimeout(()=>w.print(),300);
  }catch(e){toast(e.message)}
}
async function loadWithdrawPage(){await loadMe();renderWithdrawHistory()}
function navigate(page){
  if(page==="bill")page="bill";
  currentPage=page;
  $$(".screen").forEach(s=>s.classList.remove("active"));
  const v=$("#view-"+page);if(v)v.classList.add("active");
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const actions={
    watchlist:()=>{loadWatchlist();loadSummary();loadHeader()},
    forex:()=>{loadForexPage()},
    fo:()=>{loadHeader();const active=document.querySelector("[data-fo-index].active");loadFoIndexQuote(active?.dataset.foIndex||"NIFTY 50");loadFoCandlestickChart();loadFoOptionChain(false)},
    trade:()=>{loadOrdersData();loadLedgerData()},
    positions:()=>{loadMe();loadPositions();loadSummary()},
    orders:()=>loadOrdersData(),
    settings:()=>{loadMe();loadLedgerData();loadSettingsExtras()},
    deposit:()=>loadDepositPage(),
    withdraw:()=>loadWithdrawPage(),
    account:()=>loadAccount(),
    ledger:()=>loadLedgerData(),
    rejections:()=>loadRejectionsPage(),
    bill:()=>loadBills()
  };
  if(actions[page])actions[page]();
  window.scrollTo({top:0,behavior:"smooth"});
}
async function loadFoIndexQuote(name){
  const priceEl=document.getElementById("foIndexPrice");
  const changeEl=document.getElementById("foIndexChange");
  const selectedEl=document.getElementById("foSelectedName");
  const chainEl=document.getElementById("foChainName");
  if(selectedEl)selectedEl.textContent=name;
  if(chainEl)chainEl.textContent=name;
  if(priceEl)priceEl.textContent="Loading…";
  if(changeEl)changeEl.textContent="Checking index quote…";
  try{
    const d=await api(`/market?symbols=${encodeURIComponent(name)}`);
    const q=(d.data||[]).find(x=>String(x.symbol||"").toUpperCase()===name.toUpperCase());
    if(!q || q.price==null) throw new Error("Quote unavailable");
    if(priceEl)priceEl.textContent=money(q.price);
    const change=Number(q.change||0),pct=Number(q.change_percent||0);
    if(changeEl){
      changeEl.textContent=`${change>=0?"▲ +":"▼ "}${money(change)} (${pct>=0?"+":""}${pct.toFixed(2)}%) · Index quote`;
      changeEl.className=change>=0?"positive":"negative";
    }
  }catch(e){
    if(priceEl)priceEl.textContent="—";
    if(changeEl)changeEl.textContent="Index quote unavailable";
  }
}
let foChartInterval="1m";
let foChartRequest=0;
let foChartCandles=[];
function chartSymbolForIndex(name){
  return String(name||"").toUpperCase().includes("BANK") ? "BANK NIFTY" : "NIFTY 50";
}
function setFoChartMessage(message){
  const el=document.getElementById("foChartMessage");
  if(el){el.textContent=message;el.hidden=false;}
}
function drawFoCandles(candles){
  const canvas=document.getElementById("foCandlestickChart");
  const message=document.getElementById("foChartMessage");
  const axis=document.getElementById("foChartAxis");
  if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  const width=Math.max(280,Math.floor(rect.width||320));
  const height=Math.max(190,Math.floor(rect.height||230));
  const dpr=Math.max(1,window.devicePixelRatio||1);
  canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);
  if(!Array.isArray(candles)||candles.length<2){
    if(message){message.textContent="Not enough real candle data for this interval.";message.hidden=false;}
    if(axis)axis.innerHTML="<span>—</span><span>—</span><span>—</span><span>—</span>";
    return;
  }
  if(message)message.hidden=true;
  const pad={top:12,right:48,bottom:12,left:6};
  const plotW=width-pad.left-pad.right,plotH=height-pad.top-pad.bottom;
  const values=candles.flatMap(c=>[Number(c.high),Number(c.low)]).filter(Number.isFinite);
  const min=Math.min(...values),max=Math.max(...values);
  const spread=Math.max(max-min,Math.abs(max)*0.0005,0.01),lo=min-spread*0.08,hi=max+spread*0.08;
  const y=v=>pad.top+(hi-v)/(hi-lo)*plotH;
  // Subtle horizontal grid and right-side price labels.
  ctx.font="10px Arial";ctx.textAlign="left";ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){
    const val=hi-(hi-lo)*i/4, yy=pad.top+plotH*i/4;
    ctx.strokeStyle="#e8ebef";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(width-pad.right+2,yy);ctx.stroke();
    ctx.fillStyle="#77808c";ctx.fillText(val.toLocaleString("en-IN",{maximumFractionDigits:2}),width-pad.right+7,yy);
  }
  const step=plotW/candles.length,bodyW=Math.max(2,Math.min(9,step*0.62));
  candles.forEach((c,i)=>{
    const o=Number(c.open),h=Number(c.high),l=Number(c.low),cl=Number(c.close);
    if(![o,h,l,cl].every(Number.isFinite))return;
    const x=pad.left+step*(i+0.5),up=cl>=o,color=up?"#16a34a":"#ef4444";
    ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y(h));ctx.lineTo(x,y(l));ctx.stroke();
    const top=Math.min(y(o),y(cl)),bh=Math.max(1,Math.abs(y(o)-y(cl)));
    ctx.fillStyle=color;ctx.fillRect(x-bodyW/2,top,bodyW,bh);
  });
  // Current/last close marker.
  const last=Number(candles[candles.length-1].close),ly=y(last);
  ctx.setLineDash([3,3]);ctx.strokeStyle="#b7792c";ctx.beginPath();ctx.moveTo(pad.left,ly);ctx.lineTo(width-pad.right+2,ly);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="#b7792c";ctx.fillRect(width-pad.right+3,Math.max(0,Math.min(height-17,ly-8)),pad.right-3,16);
  ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="bold 9px Arial";ctx.fillText(last.toLocaleString("en-IN",{maximumFractionDigits:2}),width-pad.right/2,Math.max(8,Math.min(height-9,ly)));
  if(axis){
    const fmt=t=>{const d=new Date(Number(t)*1000);if(!Number.isFinite(d.getTime()))return "—";return foChartInterval==="1d"?d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});};
    const ix=[0,Math.floor((candles.length-1)/3),Math.floor((candles.length-1)*2/3),candles.length-1];
    axis.innerHTML=ix.map(i=>`<span>${fmt(candles[i].time)}</span>`).join("");
  }
}
async function loadFoCandlestickChart(){
  const requestId=++foChartRequest;
  const active=document.querySelector("[data-fo-index].active");
  const symbol=chartSymbolForIndex(active?.dataset.foIndex||"NIFTY 50");
  const status=document.getElementById("foChartStatus");
  if(status)status.textContent=`Loading ${foChartInterval} candles…`;
  setFoChartMessage("Loading historical price candles…");
  try{
    const d=await api(`/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(foChartInterval)}`);
    if(requestId!==foChartRequest)return;
    const candles=d.candles||[];
    if(!candles.length)throw new Error(d.message||"No candle data available");
    foChartCandles=candles;
    drawFoCandles(candles);
    if(status)status.textContent=`${d.interval||foChartInterval} · ${candles.length} candles · ${d.source||"market data"}`;
  }catch(e){
    if(requestId!==foChartRequest)return;
    const canvas=document.getElementById("foCandlestickChart");
    const ctx=canvas?.getContext("2d");if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);
    setFoChartMessage("Real candle data is currently unavailable. Try again shortly.");
    if(status)status.textContent="Data unavailable";
    const axis=document.getElementById("foChartAxis");if(axis)axis.innerHTML="<span>—</span><span>—</span><span>—</span><span>—</span>";
  }
}
let foOptionRequest=0;
function fmtChainNumber(value, decimals=2){
  if(value===null || value===undefined || value==="" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-IN",{maximumFractionDigits:decimals});
}
function activeFoUnderlying(){
  const name=document.querySelector("[data-fo-index].active")?.dataset.foIndex||"NIFTY 50";
  return name.toUpperCase().includes("BANK")?"BANKNIFTY":"NIFTY";
}
function renderFoOptionChain(contracts){
  const table=document.querySelector(".fo-chain-table");
  if(!table)return;
  const rowsByStrike=new Map();
  (contracts||[]).forEach(c=>{
    const strike=Number(c.strike); if(!Number.isFinite(strike))return;
    if(!rowsByStrike.has(strike))rowsByStrike.set(strike,{});
    rowsByStrike.get(strike)[c.type]=c;
  });
  const rows=[...rowsByStrike.entries()].sort((a,b)=>a[0]-b[0]);
  const spotText=document.getElementById("foIndexPrice")?.textContent||"";
  const spot=Number(spotText.replace(/[₹,\s]/g,""));
  let atmStrike=null;
  if(Number.isFinite(spot)&&spot>0&&rows.length)atmStrike=rows.reduce((best,item)=>Math.abs(item[0]-spot)<Math.abs(best-spot)?item[0]:best,rows[0][0]);
  const header='<div class="fo-chain-row fo-chain-label"><span>LTP · OI</span><b>STRIKE</b><span>OI · LTP</span></div>';
  const body=rows.map(([strike,legs])=>{
    const ce=legs.CE||{},pe=legs.PE||{},atm=strike===atmStrike;
    const ceLtp=fmtChainNumber(ce.ltp),peLtp=fmtChainNumber(pe.ltp);
    const ceOi=fmtChainNumber(ce.oi,0),peOi=fmtChainNumber(pe.oi,0);
    return `<button type="button" class="fo-chain-row ${atm?'fo-atm':''}" data-fo-strike="${strike}" data-fo-ce="${esc(ce.symbol||'')}" data-fo-pe="${esc(pe.symbol||'')}"><span><strong>${ceLtp}</strong><small>OI ${ceOi}</small></span><b>${fmtChainNumber(strike,0)}${atm?' <small>ATM</small>':''}</b><span><small>OI ${peOi}</small><strong>${peLtp}</strong></span></button>`;
  }).join("");
  table.innerHTML=header+body;
}
async function loadFoOptionChain(expiryChanged=false){
  const requestId=++foOptionRequest;
  const underlying=activeFoUnderlying();
  const select=document.getElementById("foExpiry");
  const requested=expiryChanged&&select?select.value:"";
  try{
    const query=`/fno?symbol=${encodeURIComponent(underlying)}${requested?`&expiry=${encodeURIComponent(requested)}`:""}`;
    const d=await api(query);
    if(requestId!==foOptionRequest)return;
    if(select){
      const old=requested||select.value;
      const expiries=d.expiry_dates||[];
      select.innerHTML=expiries.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
      if(expiries.length){select.value=expiries.includes(old)?old:(d.selected_expiry||expiries[0]);}
      else select.innerHTML="";
    }
    // If the selected expiry differs from the API's default, fetch that expiry explicitly.
    const chosen=select?.value||"";
    if(chosen && chosen!==d.selected_expiry && !expiryChanged){
      const d2=await api(`/fno?symbol=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(chosen)}`);
      if(requestId!==foOptionRequest)return;
      renderFoOptionChain(d2.contracts||[]);return;
    }
    renderFoOptionChain(d.contracts||[]);
  }catch(e){
    if(requestId!==foOptionRequest)return;
    // Keep the interface quiet; no error banner and no fabricated quotes.
    renderFoOptionChain([]);
  }
}

function initFoPreview(){
  document.querySelectorAll("[data-fo-index]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-fo-index]").forEach(b=>b.classList.toggle("active",b===btn));
    loadFoIndexQuote(btn.dataset.foIndex);
    loadFoCandlestickChart();
    loadFoOptionChain(false);
  }));
  const expirySelect=document.getElementById("foExpiry");
  if(expirySelect)expirySelect.addEventListener("change",()=>loadFoOptionChain(true));
  loadFoOptionChain(false);
  document.querySelectorAll(".fo-chart-controls button").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".fo-chart-controls button").forEach(b=>b.classList.toggle("active",b===btn));
    foChartInterval=btn.dataset.interval||"1m";
    loadFoCandlestickChart();
  }));
  window.addEventListener("resize",()=>{if(foChartCandles.length)drawFoCandles(foChartCandles);});
}
async function boot(){
  loadPrefs();
  try{
    await loadMe();
    await Promise.all([loadWatchlist(),loadSummary(),loadNews(),loadOrdersData(),loadLedgerData(),loadSettingsExtras()]);
    navigate("watchlist");
  }catch(e){location.href="/"}
}

initFoPreview();

/* Events */
document.addEventListener("click",async e=>{
  const pageBtn=e.target.closest("[data-page]");
  if(pageBtn){e.preventDefault();navigate(pageBtn.dataset.page);return}
  const remove=e.target.closest("[data-remove]");
  if(remove){
    e.stopPropagation();
    try{await api(`/watchlist?symbol=${encodeURIComponent(remove.dataset.remove)}&list=${activeList}`,{method:"DELETE"});await loadWatchlist();toast("Script removed")}catch(x){toast(x.message)}
    return;
  }
  const row=e.target.closest(".watch-row");
  if(row&&!e.target.closest(".remove-script")){openDetail(row.dataset.symbol);return}
  const bill=e.target.closest("[data-bill]");
  if(bill){downloadBill(bill.dataset.bill);return}
  const close=e.target.closest("[data-close]");
  if(close){$("#"+close.dataset.close).classList.remove("open");return}
});
$$(".watch-tabs button").forEach(b=>b.onclick=async()=>{activeList=Number(b.dataset.list);$$(".watch-tabs button").forEach(x=>x.classList.toggle("active",x===b));await loadWatchlist()});
$(".search-open").onclick=()=>openScriptModal();
$("#addScriptBtn").onclick=()=>openScriptModal();
$("#quickAddBtn").onclick=()=>openScriptModal();
$("#tvBtn").onclick=()=>{$("#tvBtn").classList.toggle("active");toast("TV ticker "+($("#tvBtn").classList.contains("active")?"ON":"OFF"))};
function openScriptModal(){
  $("#scriptModal").classList.add("open");$("#scriptSearch").value="";renderScriptResults("");
  setTimeout(()=>$("#scriptSearch").focus(),80);
}
let activeScriptTab="EQUITY";
const scriptCatalog=[
 ["RELIANCE","RELIANCE","NSE","EQUITY"],["TCS","TCS","NSE","EQUITY"],
 ["HDFCBANK","HDFCBANK","NSE","EQUITY"],["INFY","INFY","NSE","EQUITY"],
 ["ICICIBANK","ICICIBANK","NSE","EQUITY"],["SBIN","SBIN","NSE","EQUITY"],
 ["ITC","ITC","NSE","EQUITY"],["BHARTIARTL","BHARTIARTL","NSE","EQUITY"],
 ["NIFTY FUT","NIFTY 50","NSE","FUTURES"],["BANKNIFTY FUT","BANK NIFTY","NSE","FUTURES"],
 ["NIFTY 50","NIFTY 50","NSE","FUTURES"],["BANK NIFTY","BANK NIFTY","NSE","FUTURES"],
 ["GOLD FUT","GOLD","MCX","MCX"],["SILVER FUT","SILVER","MCX","MCX"],
 ["USDINR","USD/INR","NSE","FOREX"],["EURINR","EUR/INR","NSE","FOREX"]
];
let optionContracts=[];
function fallbackExpiry(){
  const d=new Date();
  const days=(2-d.getDay()+7)%7 || 7;
  d.setDate(d.getDate()+days);
  return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}).replace(/ /g,"-");
}
function makeFallbackOptions(centers={NIFTY:22500,BANKNIFTY:52000}){
  const out=[];
  const expiry=fallbackExpiry();
  for(const [underlying,step] of [["NIFTY",50],["BANKNIFTY",100]]){
    const center=Math.round(Number(centers[underlying]||0)/step)*step;
    for(let i=-30;i<=30;i++){
      const strike=center+i*step;if(strike<=0)continue;
      for(const type of ["CE","PE"]) out.push({symbol:`${underlying}${strike}${type}`,underlying,expiry,strike,type,ltp:null,bid:null,ask:null});
    }
  }
  return out;
}
async function loadNiftyOptions(){
  const all=[];
  for(const idx of ["NIFTY","BANKNIFTY"]){
    try{const d=await api(`/fno?symbol=${idx}`);if(d.live!==false)(d.contracts||[]).forEach(c=>all.push({...c,underlying:idx}));}catch(e){}
  }
  if(all.length){optionContracts=all;return optionContracts;}
  let centers={NIFTY:22500,BANKNIFTY:52000};
  try{
    const m=await api(`/market?symbols=${encodeURIComponent("NIFTY 50,BANK NIFTY")}`);
    for(const q of (m.data||[])){
      if(q.symbol==="NIFTY 50"&&q.price) centers.NIFTY=Number(q.price);
      if(q.symbol==="BANK NIFTY"&&q.price) centers.BANKNIFTY=Number(q.price);
    }
  }catch(e){}
  optionContracts=makeFallbackOptions(centers);
  return optionContracts;
}
async function renderScriptResults(query){
  const q=query.trim().toUpperCase(),d=await api(`/watchlist?list=${activeList}`),added=d.symbols||[];
  if(activeScriptTab==="OPTIONS" && !optionContracts.length) await loadNiftyOptions();
  let rows=activeScriptTab==="OPTIONS" ? optionContracts.map(x=>[x.symbol,x.underlying||"NIFTY",x.expiry,"OPTIONS",x]) : scriptCatalog.filter(x=>x[3]===activeScriptTab);
  if(q) rows=rows.filter(x=>x.join(" ").toUpperCase().includes(q));
  $("#scriptCount").textContent=`${added.length} added`;
  if(!rows.length){$("#scriptResults").innerHTML=`<div class="empty-watch">No ${activeScriptTab.toLowerCase()} scripts found.</div>`;return;}
  $("#scriptResults").innerHTML=rows.map(x=>{
    const meta=x[4]||{},isAdded=added.includes(x[0]);
    const quote=`<span class="script-quote">LTP ${meta.ltp!=null?money(meta.ltp):"—"} · Bid ${meta.bid!=null?money(meta.bid):"—"} · Ask ${meta.ask!=null?money(meta.ask):"—"}</span>`;
    return `<div class="script-row"><div><b>${esc(x[0])}</b><small>${esc(x[1])}</small><small>Exp: ${esc(x[2])}</small>${quote}</div><button class="script-action ${isAdded?"remove":""}" data-script="${esc(x[0])}" data-added="${isAdded}" >${isAdded?"×":"+"}</button></div>`;
  }).join("");
}
$("#scriptSearch").oninput=e=>renderScriptResults(e.target.value);
$$('[data-script-tab]').forEach(b=>b.onclick=async()=>{
  activeScriptTab=b.dataset.scriptTab;
  $$('[data-script-tab]').forEach(x=>x.classList.toggle("active",x===b));
  await renderScriptResults($("#scriptSearch").value);
});
function openScriptModal(){
  $("#scriptModal").classList.add("open");$("#scriptSearch").value="";
  activeScriptTab="EQUITY";$$('[data-script-tab]').forEach(x=>x.classList.toggle("active",x.dataset.scriptTab==="EQUITY"));
  renderScriptResults("");setTimeout(()=>$("#scriptSearch").focus(),80);
}
$(".search-open").onclick=()=>openScriptModal();
$("#addScriptBtn").onclick=()=>openScriptModal();
$("#quickAddBtn").onclick=()=>openScriptModal();
$("#tvBtn").onclick=()=>{$("#tvBtn").classList.toggle("active");toast("TV ticker "+($("#tvBtn").classList.contains("active")?"ON":"OFF"))};
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-script]");if(!b)return;
  const symbol=b.dataset.script,added=b.dataset.added==="true";
  try{
    if(added){
      await api(`/watchlist?symbol=${encodeURIComponent(symbol)}&list=${activeList}`,{method:"DELETE"});
    }else{
      const meta=optionContracts.find(x=>String(x.symbol).toUpperCase()===String(symbol).toUpperCase());
      if(meta) cacheOptionQuote(meta);
      await api("/watchlist",{method:"POST",body:JSON.stringify({symbol,list_no:activeList})});
    }
    await renderScriptResults($("#scriptSearch").value);await loadWatchlist();toast(added?"Script removed":"Script added");
  }catch(x){toast(x.message)}
});

$("#detailBuy").onclick=()=>openTradeOrder("BUY");
$("#detailSell").onclick=()=>openTradeOrder("SELL");
$("#tradeQty").oninput=updateOrderValue;$("#tradePrice").oninput=updateOrderValue;$("#placeOrder").onclick=placeOrder;
$("#refreshPositions").onclick=loadPositions;$("#refreshOrders").onclick=loadOrdersData;$("#refreshTrade").onclick=()=>{loadOrdersData();loadLedgerData()};
$$(".period-tabs button").forEach(b=>b.onclick=()=>{currentPeriod=b.dataset.period;$$(".period-tabs button").forEach(x=>x.classList.toggle("active",x===b));renderTrade()});
$$(".subtabs button").forEach(b=>b.onclick=()=>{currentTradeSubtab=b.dataset.subtab;$$(".subtabs button").forEach(x=>x.classList.toggle("active",x===b));renderTrade()});
$$(".order-tabs button").forEach(b=>b.onclick=()=>{currentOrderFilter=b.dataset.orderFilter;$$(".order-tabs button").forEach(x=>x.classList.toggle("active",x===b));renderOrders()});
$("#copyUpi").onclick=async()=>{try{await navigator.clipboard.writeText($("#depositUpi").textContent);toast("UPI ID copied")}catch{toast("Copy not available")}};
function upiRequestUrl(scheme, amount){
  const pa=String($("#depositUpi").textContent||"").trim();
  const am=Number(amount).toFixed(2);
  const q=`pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent("TRADE BAZZAR")}&am=${encodeURIComponent(am)}&cu=INR`;
  return `${scheme}${q}`;
}
function openUpiApp(scheme){
  const amount=Number($("#depAmount").value);
  const pa=String($("#depositUpi").textContent||"").trim();
  if(!amount||amount<=0)return toast("Enter a valid deposit amount first");
  if(!pa||pa==="Not configured")return toast("UPI ID is not configured");
  const url=upiRequestUrl(scheme,amount);
  window.location.href=url;
}
$("#payNowBtn").onclick=()=>{
  const amount=Number($("#depAmount").value);
  if(!amount||amount<=0)return toast("Enter a valid deposit amount first");
  $("#upiPayAmount").textContent=money(amount);
  $("#upiPaySheet").style.display="flex";
};
$("#closeUpiPay").onclick=()=>$("#upiPaySheet").style.display="none";
$("#upiPaySheet").addEventListener("click",e=>{if(e.target.id==="upiPaySheet")e.currentTarget.style.display="none"});
$("#phonePePay").onclick=()=>openUpiApp("phonepe://pay?");
$("#gpayPay").onclick=()=>openUpiApp("tez://upi/pay?");
$("#paytmPay").onclick=()=>openUpiApp("paytmmp://pay?");
$("#qrPay").onclick=()=>{
  $("#upiPaySheet").style.display="none";
  const img=$("#depositQr");
  if(img&&img.src&&img.style.display!=="none"){img.scrollIntoView({behavior:"smooth",block:"center"});toast("Scan the QR with PhonePe, Google Pay, Paytm or another UPI app");}
  else{navigator.clipboard?.writeText($("#depositUpi").textContent||"");toast("UPI ID copied — open your UPI app and pay the amount");}
};
$("#depSubmit").onclick=submitDeposit;$("#wdSubmit").onclick=submitWithdraw;$("#changePw").onclick=async()=>{
  const old=$("#oldPw").value,n1=$("#newPw").value,n2=$("#newPw2").value;
  if(n1!==n2)return toast("Passwords do not match");
  try{await api("/change-password",{method:"POST",body:JSON.stringify({old_password:old,new_password:n1})});toast("Password updated");$("#oldPw").value=$("#newPw").value=$("#newPw2").value=""}catch(e){toast(e.message)}
};
$$(".withdraw-choice button").forEach(b=>b.onclick=()=>{withdrawMode=b.dataset.withdraw;$$(".withdraw-choice button").forEach(x=>x.classList.toggle("active",x===b));$("#upiWithdrawBox").classList.toggle("hidden-fields",withdrawMode!=="upi");$("#bankWithdrawBox").classList.toggle("hidden-fields",withdrawMode!=="bank")});
$("#hideBalances").onclick=()=>{settingsState.hide=!settingsState.hide;savePrefs();applyPrefs()};
$("#tradeSounds").onclick=()=>{settingsState.sounds=!settingsState.sounds;savePrefs();applyPrefs();if(settingsState.sounds)playTone()};
$("#boldNumbers").onclick=()=>{settingsState.bold=!settingsState.bold;savePrefs();applyPrefs()};
$$(".theme-segment button").forEach(b=>b.onclick=()=>{settingsState.theme=b.dataset.theme;savePrefs();applyPrefs()});
$$(".number-segment button").forEach(b=>b.onclick=()=>{settingsState.size=b.dataset.size;savePrefs();applyPrefs()});
$("#logoutSettings").onclick=()=>$("#logoutModal").classList.add("open");
$("#confirmLogout").onclick=async()=>{try{await api("/logout",{method:"POST"})}finally{location.href="/"}};

boot();
// ==========================================
// TRADE BAZZAR — Forex TRADING
// FOREX MARKET
// ==========================================

const forexPairsData = [
  { symbol: "EUR/USD", price: 1.10000, digits: 5 },
  { symbol: "GBP/USD", price: 1.27500, digits: 5 },
  { symbol: "USD/JPY", price: 150.000, digits: 3 },
  { symbol: "USD/CHF", price: 0.88000, digits: 5 },
  { symbol: "AUD/USD", price: 0.66000, digits: 5 },
  { symbol: "USD/CAD", price: 1.36000, digits: 5 },
  { symbol: "NZD/USD", price: 0.61000, digits: 5 },
  { symbol: "EUR/GBP", price: 0.86000, digits: 5 },
  { symbol: "EUR/JPY", price: 165.000, digits: 3 },
  { symbol: "GBP/JPY", price: 191.000, digits: 3 },
  { symbol: "EUR/CHF", price: 0.96000, digits: 5 },
  { symbol: "AUD/JPY", price: 99.000, digits: 3 },
  { symbol: "CAD/JPY", price: 110.000, digits: 3 },
  { symbol: "CHF/JPY", price: 170.000, digits: 3 },
  { symbol: "GBP/CHF", price: 1.12000, digits: 5 },
  { symbol: "EUR/AUD", price: 1.66000, digits: 5 },
  { symbol: "EUR/CAD", price: 1.49000, digits: 5 },
  { symbol: "GBP/CAD", price: 1.73000, digits: 5 },
  { symbol: "AUD/CAD", price: 0.90000, digits: 5 },
  { symbol: "NZD/JPY", price: 91.000, digits: 3 }
];

const FOREX_STARTING_BALANCE = 0;
const FOREX_STORAGE_KEY = "tb_forex_paper_v1";

let forexSelectedPair = "EUR/USD";
let forexSearchText = "";
let forexPaperState = {
  balance: FOREX_STARTING_BALANCE,
  positions: [],
  history: []
};

function forexLoadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOREX_STORAGE_KEY) || "null");

    if (
      saved &&
      Number.isFinite(saved.balance) &&
      Array.isArray(saved.positions) &&
      Array.isArray(saved.history)
    ) {
      forexPaperState = saved;
    }
  } catch (error) {
    console.warn("Forex loaded.");
  }
}

function forexSaveState() {
  try {
    localStorage.setItem(
      FOREX_STORAGE_KEY,
      JSON.stringify(forexPaperState)
    );
  } catch (error) {
    console.warn("Forex demo state could not be saved.");
  }
}

function forexMoney(value) {
  const amount = Number(value) || 0;
  return "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function forexGetPair(symbol) {
  return forexPairsData.find(pair => pair.symbol === symbol);
}

function forexFormatPrice(pair, price) {
  return Number(price).toFixed(pair.digits);
}

function forexCurrentPrice(symbol) {
  const pair = forexGetPair(symbol);
  return pair ? pair.price : 0;
}

function forexEscape(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function forexPositionPnl(position) {
  const current = forexCurrentPrice(position.symbol);
  const difference = position.side === "BUY"
    ? current - position.entryPrice
    : position.entryPrice - current;

  return difference * position.quantity;
}

function forexTotalOpenPnl() {
  return forexPaperState.positions.reduce(
    (total, position) => total + forexPositionPnl(position),
    0
  );
}

function updateForexSummary() {
  const balance = document.getElementById("forexBalance");
  const pnl = document.getElementById("forexOpenPnl");
  const count = document.getElementById("forexPositionCount");
  const label = document.getElementById("forexPositionsLabel");

  if (balance) balance.textContent = forexMoney(forexPaperState.balance);

  const openPnl = forexTotalOpenPnl();

  if (pnl) {
    pnl.textContent = (openPnl >= 0 ? "+" : "") + forexMoney(openPnl);
    pnl.classList.toggle("positive", openPnl >= 0);
    pnl.classList.toggle("negative", openPnl < 0);
  }

  if (count) count.textContent = forexPaperState.positions.length;
  if (label) label.textContent = forexPaperState.positions.length + " OPEN";
}

function renderForexPairs() {
  const container = document.getElementById("forexPairs");
  if (!container) return;

  const filtered = forexPairsData.filter(pair =>
    pair.symbol.toLowerCase().includes(forexSearchText.toLowerCase())
  );

  if (!filtered.length) {
    container.innerHTML =
      '<div class="forex-empty">No currency pair found.</div>';
    return;
  }

  container.innerHTML = filtered.map(pair => {
    const active = pair.symbol === forexSelectedPair;
    const price = forexFormatPrice(pair, pair.price);

    return `
      <button type="button"
        class="forex-pair-row ${active ? "active" : ""}"
        data-forex-symbol="${forexEscape(pair.symbol)}">
        <span class="forex-pair-name">
          <strong>${forexEscape(pair.symbol)}</strong>
          <small>Currency Market</small>
        </span>
        <span class="forex-pair-price">${price}</span>
        <span class="forex-pair-action">TRADE</span>
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-forex-symbol]").forEach(button => {
    button.addEventListener("click", () => {
      selectForexPair(button.dataset.forexSymbol);
    });
  });
}

function selectForexPair(symbol) {
  const pair = forexGetPair(symbol);
  if (!pair) return;

  forexSelectedPair = symbol;

  const panel = document.getElementById("forexTradePanel");
  const selectedSymbol = document.getElementById("forexSelectedSymbol");
  const selectedPrice = document.getElementById("forexSelectedPrice");

  if (panel) panel.hidden = false;
  if (selectedSymbol) selectedSymbol.textContent = pair.symbol;
  if (selectedPrice) {
    selectedPrice.textContent = forexFormatPrice(pair, pair.price);
  }

  renderForexPairs();
}

function renderForexPositions() {
  const container = document.getElementById("forexPositions");
  if (!container) return;

  if (!forexPaperState.positions.length) {
    container.innerHTML =
      '<div class="forex-empty">No open Forex positions.</div>';
    return;
  }

  container.innerHTML = forexPaperState.positions.map(position => {
    const pnl = forexPositionPnl(position);
    const pair = forexGetPair(position.symbol);

    return `
      <div class="forex-position-card">
        <div class="forex-position-top">
          <strong>${forexEscape(position.symbol)}</strong>
          <span class="${position.side === "BUY" ? "positive" : "negative"}">
            ${position.side}
          </span>
        </div>
        <div class="forex-position-details">
          <span>Quantity: ${position.quantity.toLocaleString("en-US")}</span>
          <span>Entry: ${forexFormatPrice(pair, position.entryPrice)}</span>
        </div>
        <div class="forex-position-bottom">
          <span>Unrealized P&amp;L</span>
          <strong class="${pnl >= 0 ? "positive" : "negative"}">
            ${pnl >= 0 ? "+" : ""}${forexMoney(pnl)}
          </strong>
        </div>
        <button type="button"
          class="forex-close-position"
          data-forex-close="${forexEscape(position.id)}">
          CLOSE POSITION
        </button>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-forex-close]").forEach(button => {
    button.addEventListener("click", () => {
      closeForexPosition(button.dataset.forexClose);
    });
  });
}

function renderForexHistory() {
  const container = document.getElementById("forexHistory");
  if (!container) return;

  if (!forexPaperState.history.length) {
    container.innerHTML =
      '<div class="forex-empty">No completed Forex trades.</div>';
    return;
  }

  container.innerHTML = forexPaperState.history.slice(0, 30).map(trade => `
    <div class="forex-history-row">
      <div>
        <strong>${forexEscape(trade.symbol)}</strong>
        <small>${forexEscape(trade.side)} · ${forexEscape(trade.time)}</small>
      </div>
      <div class="forex-history-result">
        <strong class="${trade.pnl >= 0 ? "positive" : "negative"}">
          ${trade.pnl >= 0 ? "+" : ""}${forexMoney(trade.pnl)}
        </strong>
        <small>Live P&amp;L</small>
      </div>
    </div>
  `).join("");
}

function refreshForexScreen() {
  renderForexPairs();
  renderForexPositions();
  renderForexHistory();
  updateForexSummary();

  const pair = forexGetPair(forexSelectedPair);
  const price = document.getElementById("forexSelectedPrice");

  if (pair && price) {
    price.textContent = forexFormatPrice(pair, pair.price);
  }
}

async function loadForexBalanceFromServer() {
  try {
    const data = await api("/forex/balance");
    if (data && Number.isFinite(Number(data.forex_balance))) {
      forexPaperState.balance = Number(data.forex_balance);
      forexSaveState();
      updateForexSummary();
    }
  } catch (error) {
    console.warn("Forex balance could not be refreshed from the account.", error);
  }
}

async function loadForexPage() {
  refreshForexScreen();
  await loadForexBalanceFromServer();
}

function forexOpenTrade(side) {
  const pair = forexGetPair(forexSelectedPair);
  const quantityInput = document.getElementById("forexQuantity");
  const quantity = Number(quantityInput?.value);

  if (!pair) {
    if (typeof toast === "function") toast("Select a currency pair first.");
    return;
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    if (typeof toast === "function") toast("Enter a valid whole-number quantity.");
    return;
  }

  // Reserve a simulated margin of 1% of the notional trade value.
  const requiredMargin = quantity * pair.price * 0.01;

  if (requiredMargin > forexPaperState.balance) {
    if (typeof toast === "function") {
      toast("Insufficient virtual balance for this trade.");
    }
    return;
  }

  forexPaperState.balance -= requiredMargin;

  forexPaperState.positions.unshift({
    id: "fx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    symbol: pair.symbol,
    side,
    quantity,
    entryPrice: pair.price,
    margin: requiredMargin,
    openedAt: new Date().toLocaleString()
  });

  forexSaveState();
  refreshForexScreen();

  if (typeof toast === "function") {
    toast("- " + side + " order opened.");
  }
}

function closeForexPosition(id) {
  const index = forexPaperState.positions.findIndex(position => position.id === id);
  if (index < 0) return;

  const position = forexPaperState.positions[index];
  const pnl = forexPositionPnl(position);

  // Return reserved margin and add/subtract the simulated result.
  forexPaperState.balance += position.margin + pnl;

  forexPaperState.history.unshift({
    symbol: position.symbol,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    exitPrice: forexCurrentPrice(position.symbol),
    pnl,
    time: new Date().toLocaleString()
  });

  forexPaperState.positions.splice(index, 1);

  forexPaperState.history = forexPaperState.history.slice(0, 100);

  forexSaveState();
  refreshForexScreen();

  if (typeof toast === "function") {
    toast("position closed. P&L: " + forexMoney(pnl));
  }
}

function initForexPaperTrading() {
  if (!document.getElementById("view-forex")) return;

  forexLoadState();
  refreshForexScreen();

  const search = document.getElementById("forexSearch");
  const refreshButton = document.getElementById("refreshForex");
  const buyButton = document.getElementById("forexBuy");
  const sellButton = document.getElementById("forexSell");

  if (search) {
    search.addEventListener("input", () => {
      forexSearchText = search.value.trim();
      renderForexPairs();
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      refreshForexScreen();
      await loadForexBalanceFromServer();
      if (typeof toast === "function") {
        toast("Forex balance and prices refreshed.");
      }
    });
  }

  if (buyButton) {
    buyButton.addEventListener("click", () => forexOpenTrade("BUY"));
  }

  if (sellButton) {
    sellButton.addEventListener("click", () => forexOpenTrade("SELL"));
  }

  // Move live prices slightly. These are generated prices, live quotes.
  window.setInterval(() => {
    forexPairsData.forEach(pair => {
      const movement = (Math.random() - 0.5) * pair.price * 0.001;
      pair.price = Math.max(pair.price + movement, 0.00001);
    });

    refreshForexScreen();
  }, 5000);
}

initForexPaperTrading();