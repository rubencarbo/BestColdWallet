import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
const firebaseConfig={apiKey:'AIzaSyAo9VedHHw5eaZzSa5-y8Ks8MEhUJNbTEY',authDomain:'bestcoldwallet.firebaseapp.com',projectId:'bestcoldwallet',storageBucket:'bestcoldwallet.firebasestorage.app',messagingSenderId:'460451721729',appId:'1:460451721729:web:ecb2a253dc4a0268c5c600'};
const app=initializeApp(firebaseConfig),auth=getAuth(app),provider=new GoogleAuthProvider();
const API='https://api.coinlore.net/api', ECB='https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=5&format=jsondata', KEY='vault_v2';
let coinCatalog=null, eurRate=1;
const defaults={portfolios:[{id:crypto.randomUUID(),name:'Principal',hidden:false,assets:[{id:crypto.randomUUID(),coinId:'',symbol:'XRP',name:'XRP',amount:9000},{id:crypto.randomUUID(),coinId:'',symbol:'XLM',name:'Stellar',amount:9000}]}],active:null,mode:'value',range:30,selected:{},theme:'light'};
let state=load(),prices={},hist={},chartFocus=null,chartModel=null,chartDrawToken=0;
state.mode='value';
let hiddenWalletsRevealed=false, themeClicks=0;
const visiblePortfolios=()=>state.portfolios.filter(x=>hiddenWalletsRevealed||!x.hidden);
if(!visiblePortfolios().some(x=>x.id===state.active)) state.active=visiblePortfolios()[0]?.id||state.portfolios[0]?.id;
const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n||0),num=n=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:8}).format(n||0);
function load(){try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return structuredClone(defaults)}}function save(){localStorage.setItem(KEY,JSON.stringify(state))}function p(){return state.portfolios.find(x=>x.id===state.active)||state.portfolios[0]}function assets(){return p().assets}function esc(x){return String(x).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#92;'}[c]))}
function getSortValue(a,sort){const pr=prices[String(a.coinId)]?.price||0;if(sort==='price')return pr;if(sort==='amount')return Number(a.amount)||0;return pr*(Number(a.amount)||0)}
function render(){
  const ps=$('#portfolios');
  const shown=visiblePortfolios();
  ps.innerHTML=shown.map(x=>`<div class="wallet-tab ${x.id===state.active?'active':''}"><button class="wallet-select" data-p="${x.id}">${esc(x.name)} ${x.hidden?'◌':'◉'}</button><button class="wallet-delete" data-wdel="${x.id}" aria-label="Borrar cartera ${esc(x.name)}" title="Borrar cartera">×</button></div>`).join('');
  ps.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{state.active=b.dataset.p;chartFocus=null;render();loadPrices()});
  ps.querySelectorAll('[data-wdel]').forEach(b=>b.onclick=()=>{const id=b.dataset.wdel,w=state.portfolios.find(x=>x.id===id);if(!w)return;if(state.portfolios.length<=1){alert('Debe existir al menos una cartera.');return}if(!confirm(`¿Borrar la cartera «${w.name}» y todos sus activos?`))return;state.portfolios=state.portfolios.filter(x=>x.id!==id);if(state.active===id)state.active=visiblePortfolios()[0]?.id||state.portfolios[0].id;chartFocus=null;save();render();loadPrices()});
  let total=0;assets().forEach(a=>total+=(prices[String(a.coinId)]?.price||0)*a.amount);
  $('#total').textContent=money(total);$('#count').textContent=assets().length;$('#current').textContent=p().name;$('#visibility').textContent=p().hidden?'Oculta · filtro visual':'Visible';
  const sort=state.assetSort||'total';
  document.querySelectorAll('#assetSort button').forEach(b=>b.classList.toggle('active',b.dataset.sort===sort));
  const sorted=assets().map((a,i)=>({a,i})).sort((x,y)=>getSortValue(y.a,sort)-getSortValue(x.a,sort));
  $('#assets').innerHTML=sorted.map(({a,i})=>{let pr=prices[String(a.coinId)]?.price||0;return `<div class="asset"><input type="checkbox" ${state.selected[a.id]!==false?'checked':''} data-a="${a.id}"><div class="coin">${esc(a.symbol.slice(0,4))}</div><div><b>${esc(a.name)}</b><small>${esc(a.symbol)} · ${num(a.amount)}</small></div><div class="value">${money(pr*a.amount)}<small>${money(pr)}</small></div><button class="delete" data-del="${i}">×</button></div>`}).join('');
  $('#assets').querySelectorAll('[data-a]').forEach(x=>x.onchange=()=>{state.selected[x.dataset.a]=x.checked;if(!x.checked&&chartFocus===x.dataset.a)chartFocus=null;save();draw()});
  $('#assets').querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{const removed=assets()[+x.dataset.del];if(removed?.id===chartFocus)chartFocus=null;assets().splice(+x.dataset.del,1);render();loadPrices()});
  save();draw();
}
async function ensureCoinIds(){const list=await getCoinCatalog();let changed=false;for(const a of assets()){if(/^\d+$/.test(String(a.coinId)))continue;const sym=String(a.symbol||'').toLowerCase(),name=String(a.name||'').toLowerCase();const c=list.find(x=>String(x.symbol||'').toLowerCase()===sym&&String(x.name||'').toLowerCase()===name)||list.find(x=>String(x.symbol||'').toLowerCase()===sym)||list.find(x=>String(x.name||'').toLowerCase()===name);if(c){a.coinId=String(c.id);changed=true;}}if(changed)save();return assets().filter(a=>/^\d+$/.test(String(a.coinId)));}
async function getEurRate(){
  const cacheKey='vault_fx_usd_eur';
  try{
    const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');
    if(Number(cached?.rate)>0 && Date.now()-Number(cached.at||0)<86400000) return Number(cached.rate);
  }catch{}
  try{
    const r=await fetch(ECB,{cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error(`ECB HTTP ${r.status}`);
    const root=await r.json();
    const data=root?.data||root;
    const series=data?.dataSets?.[0]?.series;
    const key=series?Object.keys(series)[0]:null;
    const observations=key?series[key]?.observations:null;
    const periods=data?.structure?.dimensions?.observation?.[0]?.values||[];
    let usdPerEur=null,date='';
    for(const [i,v] of Object.entries(observations||{})){
      const n=Number(v?.[0]),dt=periods[Number(i)]?.id;
      if(Number.isFinite(n)&&n>0&&dt&&dt>date){usdPerEur=n;date=dt}
    }
    if(!usdPerEur)throw new Error('ECB sin observaciones USD/EUR');
    eurRate=1/usdPerEur;
    localStorage.setItem(cacheKey,JSON.stringify({rate:eurRate,at:Date.now(),date,source:'ECB'}));
    return eurRate;
  }catch(e){
    try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(Number(cached?.rate)>0){eurRate=Number(cached.rate);return eurRate}}catch{}
    eurRate=.89;
    console.warn('ECB no disponible; usando temporalmente 0,89 EUR/USD',e);
    return eurRate;
  }
}
async function loadPrices(){if(!assets().length){render();return}$('#status').textContent='Actualizando…';try{const validAssets=await ensureCoinIds();if(!validAssets.length)throw new Error('No se pudieron resolver los IDs de CoinLore');eurRate=await getEurRate();const ids=[...new Set(validAssets.map(a=>a.coinId))].join(',');const r=await fetch(`${API}/ticker/?id=${encodeURIComponent(ids)}`,{cache:'no-store'});if(!r.ok)throw new Error(`CoinLore HTTP ${r.status}`);const data=await r.json();for(const d of data){prices[String(d.id)]={price:Number(d.price_usd)*eurRate,change:Number(d.percent_change_24h)||0}}$('#status').textContent='Actualizado';}catch(e){console.error('Error obteniendo precios:',e);$('#status').textContent='No se pudieron actualizar los precios';}let total=assets().reduce((s,a)=>s+(prices[String(a.coinId)]?.price||0)*a.amount,0),weighted=total?assets().reduce((s,a)=>s+(prices[String(a.coinId)]?.price||0)*a.amount*(prices[String(a.coinId)]?.change||0),0)/total:0;$('#change').textContent=assets().length?`${weighted.toFixed(2).replace('.',',')} %`:'—';render()}
async function history(a){
  const requested=state.range==='max'?1825:Number(state.range);
  const key=String(a.coinId)+'_'+requested;
  if(hist[key])return hist[key];
  try{
    if(!/^\d+$/.test(String(a.coinId)))await ensureCoinIds();
    if(!/^\d+$/.test(String(a.coinId)))return [];
    const r=await fetch(`${API}/coin/ohlcv/?coin=${encodeURIComponent(a.coinId)}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`CoinLore OHLCV HTTP ${r.status}`);
    const d=await r.json();
    const rows=Object.entries(d||{}).map(([ts,x])=>{
      if(!Array.isArray(x)||x.length<5)return null;
      const close=Number(x[4]),timestamp=Number(x[0])||Number(ts);
      return Number.isFinite(close)&&timestamp?{d:new Date(timestamp*1000).toISOString(),v:close*eurRate*Number(a.amount||0)}:null;
    }).filter(Boolean).sort((x,y)=>new Date(x.d)-new Date(y.d));
    if(state.range==='1'){
      const current=prices[String(a.coinId)]?.price;
      if(current!=null){
        const change=Number(prices[String(a.coinId)]?.change)||0;
        const prior=current/(1+change/100);
        return hist[key]=[{d:new Date(Date.now()-86400000).toISOString(),v:prior*Number(a.amount||0)},{d:new Date().toISOString(),v:current*Number(a.amount||0)}];
      }
    }
    const cutoff=Date.now()-requested*86400000;
    return hist[key]=rows.filter(x=>new Date(x.d).getTime()>=cutoff);
  }catch(e){console.error(`Error histórico ${a.symbol}:`,e);return hist[key]=[]}
}

function formatAxisValue(v){return money(v)}
function formatDateLabel(iso){
  const d=new Date(iso),r=String(state.range);
  if(r==='1')return d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',hour12:false});
  if(r==='7'||r==='30')return d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}).replace('.','');
  if(r==='90'||r==='180'||r==='365'||r==='730'||r==='1095'||r==='1825'||r==='max')return d.toLocaleDateString('es-ES',{month:'short',year:'2-digit'}).replace('.','');
  return d.toLocaleDateString('es-ES',{month:'short',year:'numeric'}).replace('.','');
}

function pointDateLabel(iso){return new Date(iso).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}).replace('.','')}
function selectChartToken(id){chartFocus=id||null;document.querySelectorAll('#quickTokens button,#legend button').forEach(b=>b.classList.toggle('active',b.dataset.token===chartFocus||(chartFocus===null&&b.dataset.token==='all')));draw()}
const palette=['#635BFF','#00A8A8','#FF6B6B','#F59E0B','#7C3AED','#0EA5E9','#10B981','#E11D48','#64748B','#D946EF'];
function tokenColor(a){let h=0,s=String(a.id||a.symbol);for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i);return palette[Math.abs(h)%palette.length]}
function buildChartControls(as){
  const q=$('#quickTokens');
  q.innerHTML=`<button type="button" data-token="all" class="${chartFocus===null?'active':''}">Todos</button>`+as.map(a=>`<button type="button" data-token="${esc(a.id)}" class="${chartFocus===a.id?'active':''}" style="--token:${tokenColor(a)}">${esc(a.symbol)}</button>`).join('');
  q.querySelectorAll('button').forEach(b=>b.onclick=()=>selectChartToken(b.dataset.token==='all'?null:b.dataset.token));
}
async function draw(){
  const token=++chartDrawToken,c=$('#chart'),ctx=c.getContext('2d'),r=c.getBoundingClientRect(),d=devicePixelRatio||1,W=r.width,H=r.height;
  c.width=Math.max(1,Math.floor(W*d));c.height=Math.max(1,Math.floor(H*d));ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,W,H);
  let available=assets().filter(a=>state.selected[a.id]!==false);
  if(chartFocus&&!available.some(a=>a.id===chartFocus))chartFocus=null;
  const as=chartFocus?available.filter(a=>a.id===chartFocus):available;
  buildChartControls(available);
  $('#empty').classList.toggle('hidden',!!as.length);
  $('#chartTitle').textContent=chartFocus&&as[0]?`${as[0].name} · ${as[0].symbol}`:available.length?'Todos los tokens':'Sin tokens seleccionados';
  $('#chartSelected').textContent=chartFocus&&as[0]?`Token seleccionado: ${as[0].name} (${as[0].symbol})`:'Toca una línea para identificar el token';
  $('#legend').innerHTML=available.map(a=>`<button type="button" data-token="${esc(a.id)}" class="${chartFocus===a.id?'active':''}"><i style="color:${tokenColor(a)}"></i>${esc(a.symbol)}</button>`).join('')+`<button type="button" data-token="all" class="${chartFocus===null?'active':''}"><i></i>Todos</button>`;
  $('#legend').querySelectorAll('button').forEach(b=>b.onclick=()=>selectChartToken(b.dataset.token==='all'?null:b.dataset.token));
  if(!as.length){chartModel=null;return}
  const ss=await Promise.all(as.map(history));
  if(token!==chartDrawToken)return;
  let dates,vals;
  if(state.range==='1'){
    const start=Date.now()-86400000,end=Date.now(),steps=5;
    dates=Array.from({length:steps},(_,i)=>new Date(start+(end-start)*i/(steps-1)).toISOString());
    vals=ss.map(s=>{const a=s[0]?.v??null,b=s[s.length-1]?.v??null;return dates.map((_,i)=>a==null||b==null?null:a+(b-a)*i/(steps-1))});
  }else{
    dates=[...new Set(ss.flat().map(x=>x.d))].sort();
    vals=ss.map(s=>{const m=new Map(s.map(x=>[x.d,x.v]));return dates.map(x=>m.get(x)??null)});
  }
  let plotted=vals.map(v=>v.slice());
  if(state.range!=='1'){
    const now=new Date().toISOString();
    if(dates[dates.length-1]!==now){
      dates.push(now);
      plotted=plotted.map((v,j)=>v.concat(prices[String(as[j].coinId)]?.price!=null?Number(prices[String(as[j].coinId)].price)*Number(as[j].amount||0):null));
    }
  }
  const flat=plotted.flat().filter(Number.isFinite);
  if(!flat.length){chartModel=null;$('#chartSelected').textContent='No hay datos históricos disponibles para este periodo.';return}
  const walletSeries=chartFocus===null?dates.map((_,i)=>{let sum=0,has=false;plotted.forEach(v=>{if(Number.isFinite(v[i])){sum+=v[i];has=true}});return has?sum:null}):null;
  const scaleValues=walletSeries?flat.concat(walletSeries.filter(Number.isFinite)):flat;
  let mn=Math.min(...scaleValues),mx=Math.max(...scaleValues),pad=(mx-mn)*.08||1;mn-=pad;mx+=pad;
  const m={l:72,r:14,t:16,b:42},cw=Math.max(1,W-m.l-m.r),ch=Math.max(1,H-m.t-m.b);
  const px=i=>m.l+(i/Math.max(1,dates.length-1))*cw,py=v=>m.t+(1-(v-mn)/(mx-mn))*ch;
  const css=getComputedStyle(document.body),line=css.getPropertyValue('--line'),muted=css.getPropertyValue('--muted');
  ctx.font='11px DM Sans, sans-serif';ctx.textBaseline='middle';ctx.lineWidth=1;ctx.strokeStyle=line;ctx.fillStyle=muted;
  for(let i=0;i<5;i++){const value=mx-(mx-mn)*i/4,y=py(value);ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(W-m.r,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(formatAxisValue(value),m.l-9,y)}
  let labelIndexes=[];
  if(state.range==='1'){labelIndexes=[0,1,2,3,4]}else{const target=W<500?4:7,step=Math.max(1,Math.ceil(dates.length/target));for(let i=0;i<dates.length;i+=step)labelIndexes.push(i);if(dates.length)labelIndexes.push(dates.length-1)}
  [...new Set(labelIndexes)].forEach(i=>{const x=px(i);ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=muted;ctx.fillText(formatDateLabel(dates[i]),x,H-m.b+10)});
  const series=[];
  plotted.forEach((v,j)=>{ctx.beginPath();let started=false;v.forEach((x,i)=>{if(!Number.isFinite(x)){started=false;return}const xx=px(i),y=py(x);if(!started){ctx.moveTo(xx,y);started=true}else ctx.lineTo(xx,y)});const color=tokenColor(as[j]);ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.stroke();series.push({asset:as[j],values:v,color})});
  if(walletSeries){
    ctx.beginPath();let started=false;walletSeries.forEach((x,i)=>{if(!Number.isFinite(x)){started=false;return}const xx=px(i),y=py(x);if(!started){ctx.moveTo(xx,y);started=true}else ctx.lineTo(xx,y)});
    const walletColor=getComputedStyle(document.body).getPropertyValue('--accent');ctx.strokeStyle=walletColor;ctx.lineWidth=4;ctx.stroke();
    series.push({asset:{id:'__wallet__',name:'Cartera total',symbol:'TOTAL'},values:walletSeries,color:walletColor,isWallet:true});
  }
  if(['730','1095','1825','max'].includes(String(state.range)))$('#chartSelected').textContent='CoinLore proporciona 365 días de histórico diario; los periodos superiores muestran los datos disponibles dentro de ese límite.';
  chartModel={m,cw,ch,px,py,dates,series,W,H};
}

function hitChart(clientX,clientY){if(!chartModel)return null;const c=$('#chart'),r=c.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;let best=null,dist=Infinity;for(const s of chartModel.series){for(let i=0;i<s.values.length;i++){const v=s.values[i];if(!Number.isFinite(v))continue;const dx=chartModel.px(i)-x,dy=chartModel.py(v)-y,dd=Math.hypot(dx,dy);if(dd<dist){dist=dd;best={asset:s.asset,date:chartModel.dates[i],value:v,isWallet:!!s.isWallet}}}}return dist<=18?best:null}
function showChartTip(hit,x,y){const tip=$('#chartTip');if(!hit){tip.classList.add('hidden');return}tip.classList.remove('hidden');tip.innerHTML=`<b>${esc(hit.asset.name)}${hit.isWallet?'':' ('+esc(hit.asset.symbol)+')'}</b><span>${pointDateLabel(hit.date)} · ${formatAxisValue(hit.value)}</span>`;const cr=$('#chart').getBoundingClientRect(),tw=tip.offsetWidth,th=tip.offsetHeight;tip.style.left=Math.max(6,Math.min(x+12,cr.width-tw-6))+'px';tip.style.top=Math.max(6,Math.min(y-th-12,cr.height-th-6))+'px';$('#chartSelected').textContent=hit.isWallet?`Cartera total: ${formatAxisValue(hit.value)}`:`Token: ${hit.asset.name} (${hit.asset.symbol})`;}
const themes={
  obsidian:{name:'Obsidian',light:{bg:'#F3F5F8',card:'rgba(255,255,255,.9)',text:'#111827',muted:'#667085',line:'rgba(17,24,39,.1)',accent:'#6D5DF5',good:'#059669',shadow:'0 24px 70px rgba(15,23,42,.1)'},dark:{bg:'#090B0E',card:'rgba(18,21,27,.92)',text:'#F5F7FA',muted:'#98A2B3',line:'rgba(255,255,255,.1)',accent:'#9B8CFF',good:'#2DD4BF',shadow:'0 24px 70px rgba(0,0,0,.34)'}},
  arctic:{name:'Arctic',light:{bg:'#F4F7FB',card:'rgba(255,255,255,.92)',text:'#101828',muted:'#667085',line:'rgba(16,24,40,.1)',accent:'#2563EB',good:'#059669',shadow:'0 24px 70px rgba(31,41,55,.1)'},dark:{bg:'#0A1220',card:'rgba(16,25,40,.92)',text:'#F4F8FF',muted:'#94A3B8',line:'rgba(191,219,254,.13)',accent:'#60A5FA',good:'#34D399',shadow:'0 24px 70px rgba(0,0,0,.34)'}},
  graphite:{name:'Graphite',light:{bg:'#F2F2F1',card:'rgba(255,255,255,.92)',text:'#18181B',muted:'#71717A',line:'rgba(24,24,27,.11)',accent:'#A16207',good:'#059669',shadow:'0 24px 70px rgba(24,24,27,.1)'},dark:{bg:'#151719',card:'rgba(29,31,35,.94)',text:'#F4F4F5',muted:'#A1A1AA',line:'rgba(255,255,255,.1)',accent:'#F4C95D',good:'#34D399',shadow:'0 24px 70px rgba(0,0,0,.36)'}},
  aurora:{name:'Aurora',light:{bg:'#F1F8F6',card:'rgba(255,255,255,.9)',text:'#10201D',muted:'#607A75',line:'rgba(16,80,70,.12)',accent:'#0F9F8F',good:'#4D7C0F',shadow:'0 24px 70px rgba(15,118,110,.1)'},dark:{bg:'#071313',card:'rgba(11,27,27,.93)',text:'#E9FFFA',muted:'#8AA7A2',line:'rgba(167,243,208,.12)',accent:'#2DD4BF',good:'#A3E635',shadow:'0 24px 70px rgba(0,0,0,.3)'}},
  editorial:{name:'Editorial',light:{bg:'#F7F3EC',card:'rgba(255,252,247,.93)',text:'#201C18',muted:'#756E65',line:'rgba(32,28,24,.12)',accent:'#B45309',good:'#15803D',shadow:'0 24px 70px rgba(67,56,43,.1)'},dark:{bg:'#171411',card:'rgba(31,27,23,.94)',text:'#FFF8ED',muted:'#B5A99B',line:'rgba(255,241,220,.12)',accent:'#F59E0B',good:'#4ADE80',shadow:'0 24px 70px rgba(0,0,0,.36)'}}
};
const fonts={dm:{name:'DM Sans',heading:'Manrope'},inter:{name:'Inter',heading:'Space Grotesk'},jakarta:{name:'Plus Jakarta Sans',heading:'Plus Jakarta Sans'},outfit:{name:'Outfit',heading:'Outfit'}};
function applyTheme(){const id=state.visualTheme&&themes[state.visualTheme]?state.visualTheme:'obsidian';const mode=state.theme==='dark'?'dark':'light';const t=themes[id][mode];const root=document.documentElement;Object.entries({bg:t.bg,card:t.card,text:t.text,muted:t.muted,line:t.line,accent:t.accent,good:t.good,shadow:t.shadow}).forEach(([k,v])=>root.style.setProperty('--'+k,v));const f=fonts[state.fontTheme||'dm'];root.style.setProperty('--font-body',`"${f.name}",sans-serif`);root.style.setProperty('--font-heading',`"${f.heading}",sans-serif`);root.style.setProperty('color-scheme',mode);const toggle=$('#theme');if(toggle){toggle.textContent=mode==='dark'?'☀':'☾';toggle.setAttribute('aria-label',mode==='dark'?'Cambiar a modo día':'Cambiar a modo noche');toggle.title=mode==='dark'?'Modo día':'Modo noche';}document.documentElement.dataset.mode=mode;}
function renderThemeStudio(){const p=$('#themePalettes'),f=$('#themeFonts');p.innerHTML=Object.entries(themes).map(([id,t])=>{const v=t[state.theme==='dark'?'dark':'light'];return `<button type="button" class="theme-choice ${state.visualTheme===id?'active':''}" data-theme="${id}"><span class="swatches"><i style="background:${v.bg}"></i><i style="background:${v.accent}"></i><i style="background:${v.text}"></i></span><b>${t.name}</b><small>${id==='obsidian'?'Luxury dark':id==='arctic'?'Clean & precise':id==='graphite'?'Premium contrast':id==='aurora'?'Tech nature':'Warm editorial'}</small></button>`}).join('');f.innerHTML=Object.entries(fonts).map(([id,x])=>`<button type="button" class="font-choice ${state.fontTheme===id?'active':''}" data-font="${id}" style="font-family:${x.name},sans-serif"><b>${x.name}</b><small>${x.heading}</small></button>`).join('');p.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{state.visualTheme=b.dataset.theme;save();applyTheme();renderThemeStudio();draw()});f.querySelectorAll('[data-font]').forEach(b=>b.onclick=()=>{state.fontTheme=b.dataset.font;save();applyTheme();renderThemeStudio();draw()});}
$('#themeStudio').onclick=()=>{$('#themeDialog').showModal();renderThemeStudio()};$('#closeTheme').onclick=()=>$('#themeDialog').close();$('#closeTheme2').onclick=()=>$('#themeDialog').close();
$('#newPortfolio').onclick=()=>{$('#portfolioForm').reset();$('#portfolioDialog').showModal()};$('#newAsset').onclick=()=>{$('#assetForm').reset();$('#coinId').value='';$('#results').innerHTML='';$('#assetDialog').showModal()};$('#theme').onclick=()=>{themeClicks++;state.theme=state.theme==='dark'?'light':'dark';save();applyTheme();if($('#themeDialog')?.open)renderThemeStudio();if(themeClicks>=5&&!hiddenWalletsRevealed){hiddenWalletsRevealed=true;const hidden=state.portfolios.filter(x=>x.hidden).length;if(hidden)$('#status').textContent=`${hidden} cartera${hidden===1?'':'s'} oculta${hidden===1?'':'s'} desbloqueada${hidden===1?'':'s'}`;render()}else draw()};$('#ranges').onclick=e=>{let b=e.target.closest('button');if(!b)return;state.range=b.dataset.range;document.querySelectorAll('#ranges button').forEach(x=>x.classList.toggle('active',x===b));hist={};draw()};document.querySelector('#assetSort').onclick=e=>{let b=e.target.closest('button');if(!b)return;state.assetSort=b.dataset.sort;save();render()};
$('#chart').addEventListener('pointermove',e=>{const r=$('#chart').getBoundingClientRect(),hit=hitChart(e.clientX,e.clientY);showChartTip(hit,e.clientX-r.left,e.clientY-r.top)});
$('#chart').addEventListener('pointerleave',()=>showChartTip(null));
$('#chart').addEventListener('click',e=>{const hit=hitChart(e.clientX,e.clientY);if(hit){chartFocus=hit.asset.id;draw();showChartTip(hit,e.clientX-$('#chart').getBoundingClientRect().left,e.clientY-$('#chart').getBoundingClientRect().top)}});$('#portfolioForm').onsubmit=e=>{e.preventDefault();let x={id:crypto.randomUUID(),name:$('#portfolioName').value.trim(),hidden:$('#portfolioHidden').checked,assets:[]};state.portfolios.push(x);state.active=x.id;$('#portfolioDialog').close();render()};$('#assetForm').onsubmit=async e=>{e.preventDefault();if(!$('#coinId').value)return alert('Selecciona un resultado');let id=$('#coinId').value,list=await getCoinCatalog(),coin=list.find(c=>String(c.id)===String(id));if(!coin)return alert('No se ha encontrado el activo');assets().push({id:crypto.randomUUID(),coinId:String(id),symbol:coin.symbol,name:coin.name,amount:+$('#amount').value});$('#assetDialog').close();render();loadPrices()};
let timer;
async function getCoinCatalog(){if(coinCatalog)return coinCatalog;try{const r=await fetch(`${API}/assets/`,{cache:'force-cache'});if(!r.ok)throw new Error(`CoinLore HTTP ${r.status}`);const d=await r.json();coinCatalog=d.data||[];return coinCatalog}catch(e){console.error('No se pudo cargar el catálogo de CoinLore:',e);return []}}
function rankCoins(q, list){const needle=q.toLowerCase().trim();return list.map(c=>{const sym=(c.symbol||'').toLowerCase(),name=(c.name||'').toLowerCase(),slug=(c.nameid||'').toLowerCase();let score=999;if(sym===needle)score=0;else if(name===needle)score=1;else if(slug===needle)score=2;else if(sym.startsWith(needle))score=3;else if(name.startsWith(needle))score=4;else if(slug.startsWith(needle))score=5;else if(name.includes(needle)||slug.includes(needle))score=6;return {...c,score}}).filter(c=>c.score<999).sort((a,b)=>a.score-b.score||(a.rank||999999)-(b.rank||999999)).slice(0,8)}
$('#search').oninput=e=>{clearTimeout(timer);timer=setTimeout(async()=>{let q=e.target.value.trim();if(q.length<2){$('#results').innerHTML='';return}$('#results').innerHTML='<div class="searching">Buscando…</div>';let list=await getCoinCatalog(),matches=rankCoins(q,list);$('#results').innerHTML=matches.map(c=>`<button type="button" class="result" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><small>${esc(c.symbol)}</small></button>`).join('')||'<div class="searching">Sin coincidencias</div>';document.querySelectorAll('.result').forEach(b=>b.onclick=()=>{let c=list.find(x=>String(x.id)===b.dataset.id);$('#coinId').value=c.id;$('#search').value=`${c.name} (${c.symbol})`;$('#results').innerHTML=''})},250)};

// Importación desde texto libre
$('#importAssets').onclick=()=>{ $('#importText').value=''; $('#importResults').innerHTML=''; $('#importStatus').textContent=''; $('#confirmImport').disabled=true; $('#importDialog').showModal(); };
$('#closeImport').onclick=()=>$('#importDialog').close();$('#cancelImport').onclick=()=>$('#importDialog').close();
let importItems=[];
function parseAmount(raw){let s=raw.trim().replace(/\s/g,'');if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'')}else if(s.includes(',')){let parts=s.split(',');s=parts.length===2&&parts[1].length<=3?parts[0]+'.'+parts[1]:s.replace(/,/g,'')}else if(/^\d{1,3}(\.\d{3})+$/.test(s)){s=s.replace(/\./g,'')}return Number(s)}
function parseImportText(text){let clean=text.replace(/[\n\r;]+/g,' ').replace(/\b(tengo|también|tambien|además|ademas|y|con|en total)\b/gi,' ');let re=/(\d+(?:[.,]\d+)*)(?:\s*)([a-zA-Z][a-zA-Z0-9_-]*(?:\s+[a-zA-Z][a-zA-Z0-9_-]*){0,3})(?=\s|,|;|$|\d)/g,out=[],m;while((m=re.exec(clean))){let amount=parseAmount(m[1]),token=m[2].trim().replace(/[.,!?]+$/,'');if(Number.isFinite(amount)&&amount>0&&token)out.push({raw:m[0].trim(),amount,token,results:[],coin:null,valid:false})}return out}
async function searchCoin(token){let list=await getCoinCatalog();return rankCoins(token,list).map(c=>({id:String(c.id),name:c.name,symbol:c.symbol}))}
function renderImportResults(){let box=$('#importResults');box.innerHTML=importItems.map((it,i)=>{let opts=it.results.map(c=>`<option value="${esc(c.id)}" ${it.coin?.id===c.id?'selected':''}>${esc(c.name)} (${esc(c.symbol)})</option>`).join('');return `<div class="import-row ${it.valid?'':'invalid'}" data-import="${i}"><div class="raw" title="${esc(it.raw)}"><b>${num(it.amount)}</b> · ${esc(it.token)}</div><select data-coin="${i}" ${it.results.length?'':'disabled'}><option value="">${it.results.length?'Selecciona una coincidencia':'No encontrada'}</option>${opts}</select><div class="state">${it.valid?'✅':'⚠️'}</div></div>`}).join('');box.querySelectorAll('[data-coin]').forEach(sel=>sel.onchange=()=>{let it=importItems[+sel.dataset.coin],coin=it.results.find(c=>c.id===sel.value);it.coin=coin||null;it.valid=!!coin;renderImportResults();updateImportButton()});updateImportButton()}
function updateImportButton(){let valid=importItems.filter(x=>x.valid).length;$('#confirmImport').disabled=!valid;$('#importStatus').textContent=importItems.length?`${valid} de ${importItems.length} líneas identificadas. Los tokens repetidos se sumarán automáticamente.`:''}
$('#analyzeImport').onclick=async()=>{let text=$('#importText').value.trim();if(!text){$('#importStatus').textContent='Pega primero el texto de tu cartera.';return}importItems=parseImportText(text);if(!importItems.length){$('#importStatus').textContent='No he podido detectar cantidades y criptomonedas. Prueba con formatos como “3000 XRP, 45 QNT, 0,005 BTC”.';$('#importResults').innerHTML='';$('#confirmImport').disabled=true;return}$('#importStatus').textContent='Cargando catálogo y buscando coincidencias…';$('#confirmImport').disabled=true;const cache=new Map();for(const it of importItems){let key=it.token.toLowerCase();if(!cache.has(key))cache.set(key,await searchCoin(it.token));it.results=cache.get(key);it.coin=it.results[0]||null;it.valid=!!it.coin}renderImportResults()};
$('#importForm').onsubmit=e=>{e.preventDefault();let valid=importItems.filter(x=>x.valid&&x.coin),grouped=new Map();for(const it of valid){let key=it.coin.id;if(!grouped.has(key))grouped.set(key,{...it.coin,amount:0});grouped.get(key).amount+=it.amount}for(const it of grouped.values()){let existing=assets().find(a=>a.coinId===it.id);if(existing)existing.amount+=it.amount;else assets().push({id:crypto.randomUUID(),coinId:it.id,symbol:it.symbol,name:it.name,amount:it.amount})}$('#importDialog').close();render();loadPrices()};


$('#login').style.display='none';;state.assetSort??='total';state.visualTheme??='obsidian';state.fontTheme??='dm';applyTheme();window.onresize=draw;render();loadPrices();setInterval(loadPrices,180000);
