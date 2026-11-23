/* 자재 원장: 브라우저와 Worker에서 같은 검증 규칙을 사용합니다. 수량은 1/1000 정수입니다. */
(function(root){
'use strict';
const CAT='자재',UNITS=['EA','M','KG','L','M2','M3','SET','BOX','ROLL'],COUNT=['EA','SET','BOX','ROLL'];
const clone=x=>JSON.parse(JSON.stringify(x)),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),mat=a=>a?.category===CAT&&!!a.material;
function need(v,msg){if(!v)throw Error(msg);}
function text(v,label){need(typeof v==='string'&&v.trim()&&v.length<=1000,label+'을(를) 입력해 주세요');return v.trim();}
function qty(v,unit,zero=false){const s=String(v??'');need(/^\d+(?:\.\d{1,3})?$/.test(s),'수량은 소수 3자리 이내의 숫자로 입력해 주세요');const n=Math.round(Number(s)*1000);need(Number.isSafeInteger(n)&&n<=1e12&&(zero?n>=0:n>0),'수량 범위를 확인해 주세요');need(!COUNT.includes(unit)||n%1000===0,unit+' 단위에는 소수를 입력할 수 없습니다');return n;}
function state(a){
 const parts=a.material.parts,book=Object.fromEntries(parts.map(p=>[p.key,0])),damage={...book},issues=Object.create(null);
 for(const e of a.material.ledger){
  if(['receive','use','splitOut','splitIn','adjust'].includes(e.kind)){for(const k in e.delta)book[k]+=e.delta[k];if(e.damage)for(const k in e.damage)damage[k]+=e.damage[k];}
  if(e.kind==='zoneRename')for(const i of Object.values(issues))if((i.location||a.material.initialLocation)===e.from)i.location=e.to;
  if(e.kind==='issue')issues[e.id]={...clone(e),returned:Object.fromEntries(parts.map(p=>[p.key,0])),confirmed:false,cancelled:false};
  if(e.kind==='amend')issues[e.target].q=clone(e.q);
  if(e.kind==='cancel')issues[e.target].cancelled=true;
  if(e.kind==='confirm'){const i=issues[e.target];for(const k in i.q)book[k]-=i.q[k]-(i.returned[k]||0);i.confirmed=true;i.confirmedAt=e.at;}
  if(e.kind==='return'){const i=issues[e.target];for(const k in e.q){if(i.confirmed)book[k]+=e.q[k];i.returned[k]=(i.returned[k]||0)+e.q[k];if(e.damaged)damage[k]+=e.q[k];}}
 }
 const pending=Object.fromEntries(parts.map(p=>[p.key,0]));
 for(const i of Object.values(issues))if(!i.cancelled&&!i.confirmed)for(const k in i.q)pending[k]+=i.q[k]-(i.returned[k]||0);
 const available=Object.fromEntries(parts.map(p=>[p.key,book[p.key]-damage[p.key]-pending[p.key]]));
 for(const p of parts)need([book[p.key],damage[p.key],pending[p.key],available[p.key]].every(n=>Number.isSafeInteger(n)&&n>=0),'재고 원장 수량이 맞지 않습니다');
 return {book,damage,pending,available,issues};
}
// 같은 QR 아래 구역별 재고. 이전 원장은 첫 작업 때 현재 재고 그대로 연결합니다.
function zones(a){
 const total=state(a),parts=a.material.parts,zero=()=>Object.fromEntries(parts.map(p=>[p.key,0])),rows=new Map(),issues=new Map();
 const base=a.material.initialLocation||a.location,get=name=>{name=name||base;if(!rows.has(name)){const meta=(a.material.locations||[]).find(x=>x.name===name)||{};rows.set(name,{name,lat:meta.lat??'',lng:meta.lng??'',book:zero(),damage:zero(),pending:zero()});}return rows.get(name);},change=(name,v,field='book',sign=1)=>{const z=get(name);for(const k of Object.keys(z[field]))z[field][k]+=sign*(v?.[k]||0);};
 if(a.material.stockVersion!==2){const z=get(a.location);Object.assign(z,{lat:a.lat,lng:a.lng,book:total.book,damage:total.damage,pending:total.pending});}
 else{let active=!a.material.ledger.some(e=>e.kind==='locationsInit');for(const e of a.material.ledger){
  if(e.kind==='issue')issues.set(e.id,{...clone(e),returned:zero(),confirmed:false});
  if(e.kind==='amend'&&issues.has(e.target))issues.get(e.target).q=clone(e.q);
  if(e.kind==='return'&&issues.has(e.target)&&!active){const i=issues.get(e.target);for(const k in e.q)i.returned[k]+=e.q[k];}
  if(e.kind==='confirm'&&issues.has(e.target)&&!active)issues.get(e.target).confirmed=true;
  if(e.kind==='locationsInit'){active=true;change(base,e.book);change(base,e.damage,'damage');continue;}if(!active)continue;
  if(['receive','splitIn','splitOut','use','adjust'].includes(e.kind)){change(e.location||base,e.delta);change(e.location||base,e.damage,'damage');}
  if(e.kind==='zoneRename'){const z=get(e.from);rows.delete(e.from);Object.assign(z,{name:e.to},(a.material.locations||[]).find(x=>x.name===e.to)||{});rows.set(e.to,z);for(const i of issues.values())if((i.location||base)===e.from)i.location=e.to;}
  if(e.kind==='transfer'){change(e.from,e.q,'book',-1);change(e.to,e.q);}
  if(e.kind==='confirm'){const i=issues.get(e.target);if(i){change(i.location||base,Object.fromEntries(parts.map(p=>[p.key,i.q[p.key]-i.returned[p.key]])),'book',-1);i.confirmed=true;}}
  if(e.kind==='return'){const i=issues.get(e.target);if(i){if(!i.confirmed)change(i.location||base,e.q,'book',-1);change(e.location||i.location||base,e.q);if(e.damaged)change(e.location||base,e.q,'damage');for(const k in e.q)i.returned[k]+=e.q[k];}}
 }
 for(const i of Object.values(total.issues))if(!i.cancelled&&!i.confirmed)change(issues.get(i.id)?.location||i.location||base,Object.fromEntries(parts.map(p=>[p.key,i.q[p.key]-i.returned[p.key]])),'pending');}
 for(const z of rows.values()){z.available=zero();for(const p of parts){z.available[p.key]=z.book[p.key]-z.damage[p.key]-z.pending[p.key];need([z.book[p.key],z.damage[p.key],z.pending[p.key],z.available[p.key]].every(v=>Number.isSafeInteger(v)&&v>=0),'구역별 재고가 맞지 않습니다. 위치와 반출 수량을 확인해 주세요');}}
 for(const field of ['book','damage','pending','available'])for(const p of parts)need([...rows.values()].reduce((n,z)=>n+z[field][p.key],0)===total[field][p.key],'구역별 수량 합계가 전체 재고와 다릅니다');
 return [...rows.values()];
}
function clean(v){return String(v??'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();}
function vector(a,values,zero=false){const r={};for(const p of a.material.parts)r[p.key]=qty(values?.[p.key]??0,p.unit,true);need(zero||Object.values(r).some(n=>n>0),'처리할 수량을 입력해 주세요');return r;}
function available(a,q){const s=state(a);for(const k in q)need(q[k]<=s.available[k],'사용 가능 수량을 초과했습니다. 최신 재고를 확인해 주세요');}
function nextId(doc){let n=0;for(const a of [...doc.assets,...(doc.trash||[])]){const m=String(a.id).match(/^MAT-(\d+)$/);if(m)n=Math.max(n,+m[1]);}return 'MAT-'+String(n+1).padStart(3,'0');}
function proof(p){return !!(p&&typeof p.path==='string'&&/^photos\/[^\x00-\x1f\\]+\.(?:jpg|jpeg|png|webp)$/i.test(p.path)&&!p.path.split('/').includes('..'));}
function summary(a){const s=state(a),p=a.material.parts[0];return a.material.parts.length===1?{book:s.book[p.key]/1000,pending:s.pending[p.key]/1000,available:s.available[p.key]/1000,damage:s.damage[p.key]/1000,unit:p.unit}:{book:null,pending:null,available:null,damage:null,unit:'구성품별'};}
function refresh(a){const s=summary(a);a.qty=s.available??0;a.unit=s.unit;return a;}
function orderKey(po,line){return po?JSON.stringify(line.poLine?[po,String(line.poLine).trim()]:[po,line.item,line.model,line.unit]):'';}
function apply(doc,command){
 need(command&&typeof command.id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(command.id),'처리 식별자가 필요합니다');
 const prior=(doc.materialOps||[]).find(x=>x.id===command.id);if(prior){need(eq(prior,command),'동일한 처리 번호의 내용이 다릅니다');return {ids:doc.assets.filter(a=>mat(a)&&a.registrationId===command.id).map(a=>a.id),duplicate:true};}
 const d=clone(doc),c=clone(command);d.materialOps??=[];d.materialOrders??=[];
 text(c.operator,'담당자');need(typeof c.at==='string'&&Number.isFinite(Date.parse(c.at)),'처리 일시를 확인해 주세요');
 const event=(a,kind,data={})=>{const e={id:c.id+'_'+a.material.ledger.length,opId:c.id,kind,at:c.at,operator:c.operator,...data};a.material.ledger.push(e);a.updatedAt=c.at;return e;};
 const setLoc=(a,location)=>{a.location=text(location,'보관 구역');if(!(d.locations||[]).includes(a.location))(d.locations??=[]).push(a.location);};
 const make=(line,common)=>{
  const modern=c.stockVersion===2;if(modern){line=clone(line);line.totalMode=true;if(line.parts?.length){need(line.parts.length>=2,'묶음에는 구성품을 2종 이상 입력해 주세요');line.parts=line.parts.map(p=>({...p,perSet:String(qty(p.quantity,p.unit)/1000)}));line.packCount='1';line.quantity='';}else{qty(line.quantity,line.unit);line.packCount='1';line.perSet=line.quantity;}}

  const parts=(line.parts?.length?line.parts:[{key:'p1',name:line.item,spec:line.model,unit:line.unit,perSet:line.perSet||line.quantity||'1'}]).map((p,i)=>{const unit=text(p.unit,'단위');need(UNITS.includes(unit),'재고 단위를 확인해 주세요');return {key:'p'+(i+1),name:text(p.name,'품명'),spec:text(p.spec,'규격'),unit,perSet:qty(p.perSet||'1',unit)};});
  if(parts.length>1){need(line.packCount,'구성품 세트는 입고 묶음 수를 입력해 주세요');if(line.quantity)need(qty(line.quantity,'SET')===qty(line.packCount,'SET'),'세트 입고수량과 입고 묶음 수가 다릅니다');}
  need(parts.length<=30,'세트 구성품은 30줄 이내로 등록해 주세요');const count=qty(line.packCount||'1','BOX')/1000;
  const a={id:nextId(d),registrationId:c.id,category:CAT,item:text(line.item,'품명'),model:text(line.model,'규격'),unit:parts.length===1?parts[0].unit:'구성품별',qty:0,status:'상',location:'',lat:line.lat??'',lng:line.lng??'',manager:c.operator,note:line.note||'',out:null,log:[],photos:[],updatedAt:c.at,material:{parts,ledger:[],common:clone(common),archived:false,parent:null,packCount:count,packLabel:line.packLabel||'묶음',serial:line.serial||''}};
  if(modern){a.material.stockVersion=2;a.material.totalMode=true;a.material.verification=line.verification||common.verification||'verified';need(['verified','unverified'].includes(a.material.verification),'실물 확인 상태를 선택해 주세요');a.material.initialLocation=line.location;a.material.locations=[{name:line.location,lat:a.lat,lng:a.lng}];}setLoc(a,line.location);a.locInit=a.location;d.assets.push(a);const delta=Object.fromEntries(parts.map(p=>[p.key,p.perSet*count]));for(const p of parts)need(Number.isSafeInteger(delta[p.key])&&delta[p.key]<=1e12,'입고수량이 너무 큽니다');
  const key=modern&&parts.length>1?'':orderKey(common.po,{...line,unit:a.unit});a.material.orderKey=key;a.material.poLine=line.poLine||'';let order=line.orderId?d.materialOrders.find(o=>o.id===line.orderId):d.materialOrders.find(o=>key&&(o.key===key||(line.poLine&&o.po===common.po&&o.poLine===line.poLine)));if(line.orderId)need(order&&order.po===common.po,'기존 발주 연결을 확인해 주세요');
  const ordered=line.ordered===''||line.ordered==null?null:qty(line.ordered,parts.length>1?'SET':a.unit);
  if(ordered!==null){if(order)need(order.quantity===ordered,'같은 PO 품목의 발주수량이 다릅니다. 기존 발주수량을 확인해 주세요');else{order={id:c.id+'_'+a.id,key,po:common.po,poLine:line.poLine||'',item:a.item,model:a.model,unit:parts.length>1?'SET':a.unit,quantity:ordered,parts:parts.length>1?clone(parts):null};d.materialOrders.push(order);}}
  if(order){need(order.unit===(parts.length>1?'SET':a.unit),'PO 품목 줄의 단위가 다릅니다');a.material.orderKey=order.key;if(parts.length>1)need(eq(order.parts,parts),'같은 PO 품목의 세트 구성이 다릅니다. 품목 줄 번호를 구분해 주세요');a.material.orderId=order.id;const received=d.assets.filter(x=>mat(x)&&x.id!==a.id&&x.material.orderId===order.id).reduce((n,x)=>n+x.material.ledger.filter(e=>e.kind==='receive').reduce((m,e)=>m+(e.orderQuantity??Object.values(e.delta).reduce((t,v)=>t+v,0)),0),0);need(received+(parts.length>1?count*1000:Object.values(delta).reduce((n,v)=>n+v,0))<=order.quantity,'발주수량을 초과하는 입고입니다. PO 품목 줄과 발주수량을 확인해 주세요');}
  if(parts.length===1&&line.quantity!==''&&line.quantity!=null)need(qty(line.quantity,parts[0].unit)===delta[parts[0].key],'입고수량과 묶음 환산 수량이 다릅니다');
  if(line.serial)need(parts.length===1&&parts[0].unit==='EA'&&delta[parts[0].key]===1000,'개체 번호가 있는 기기·Spool은 수량 1 EA로 등록해 주세요');
  event(a,'receive',{delta,orderQuantity:parts.length>1?count*1000:Object.values(delta).reduce((n,v)=>n+v,0),photo:common.plPhoto||null,location:a.location,lat:a.lat,lng:a.lng});if(proof(line.photo)){a.photo=line.photo;a.photos=[line.photo];a.thumb=line.thumb||'';}return a;
 };
 let result={};
 if(c.kind==='create'||c.kind==='import'){
  const importing=c.kind==='import';
  if(importing){need(/^[a-f0-9]{64}$/.test(c.fileHash||'')&&/^[a-f0-9]{64}$/.test(c.contentHash||''),'엑셀 파일 확인 정보가 없습니다');need(!(d.materialOps||[]).some(o=>o.kind==='import'&&(o.fileHash===c.fileHash||o.contentHash===c.contentHash)),'이미 등록한 엑셀 파일 또는 같은 내용입니다. 기존 입고 내역을 확인해 주세요');}
  const receipts=importing?c.receipts:[{common:c.common,lines:c.lines}];
  need(Array.isArray(receipts)&&receipts.length&&receipts.length<=100,'입고 건은 한 번에 1~100건까지 등록할 수 있습니다');
  need(receipts.reduce((n,r)=>n+(Array.isArray(r.lines)?r.lines.length:501),0)<=(importing?500:30),importing?'엑셀은 한 번에 500묶음까지 등록할 수 있습니다':'자재를 1~30줄 입력해 주세요');result.ids=[];
  for(const [ri,receipt] of receipts.entries()){
   need(Array.isArray(receipt.lines)&&receipt.lines.length,'입고할 자재 줄이 없습니다');const common=receipt.common||{};text(common.vendor,'업체명');
   if(common.docState==='complete'){text(common.po,'PO번호');text(common.pl,'PL번호');}else{need(['pending','none'].includes(common.docState),'서류 상태를 선택해 주세요');text(common.docReason,'서류 사유');}
   need(common.arrivedAt&&Number.isFinite(Date.parse(common.arrivedAt)),'실제 입고일을 입력해 주세요');if(c.stockVersion===2)need(/^\d{4}-\d{2}-\d{2}$/.test(common.arrivedAt)&&new Date(common.arrivedAt+'T00:00:00Z').toISOString().slice(0,10)===common.arrivedAt,'실제 입고일을 확인해 주세요');if(common.plPhoto)need(proof(common.plPhoto),'PL 사진 경로를 확인해 주세요');
   common.receiptId=importing?c.id+'_r'+ri:c.id;common.receivedBy=importing||c.stockVersion===2?text(common.receivedBy,'입고자'):c.operator;
   for(const line of receipt.lines){need(line&&typeof line==='object','자재 행 정보를 확인해 주세요');try{const a=make(line,common);if(importing){a.material.importBatch=c.id;a.material.sourceRow=line.sourceRow;}result.ids.push(a.id);}catch(error){throw Error((importing?'엑셀 '+(line.sourceRow||'?')+'행: ':'')+error.message);}}
  }
 }else if(c.kind==='renameLocationV2'){const from=text(c.from,'기존 위치'),to=text(c.to,'새 위치');need(from!==to,'같은 위치입니다');d.locations=[...new Set((d.locations||[]).map(x=>x===from?to:x))];for(const a of d.assets){if(mat(a)){const existing=zones(a);if(!existing.some(z=>z.name===from))continue;if(a.material.stockVersion!==2){const t=state(a);a.material.stockVersion=2;a.material.initialLocation=a.location;a.material.locations=[{name:a.location,lat:a.lat,lng:a.lng}];event(a,'locationsInit',{book:t.book,damage:t.damage});}need(!existing.some(z=>z.name===to),'자재에 같은 이름의 다른 구역이 있습니다. 먼저 재고를 이동해 주세요');for(const z of a.material.locations)if(z.name===from)z.name=to;event(a,'zoneRename',{from,to});if(a.location===from)a.location=to;}else if(a.location===from)a.location=to;}
 }else if(c.kind==='renameLocation'){const from=text(c.from,'기존 위치'),to=text(c.to,'새 위치');d.locations=[...new Set((d.locations||[]).map(x=>x===from?to:x))];for(const a of d.assets.filter(a=>a.location===from)){a.location=to;a.updatedAt=c.at;a.log=[{at:c.at,t:'위치 이름 변경 '+from+' → '+to},...(a.log||[])].slice(0,15);if(mat(a))event(a,'locationRename',{from,to});}
 }else{
  const a=d.assets.find(x=>x.id===c.asset&&mat(x));need(a,'자재를 찾을 수 없습니다');need(!a.material.archived||c.kind==='restore','보관함 자재를 먼저 복원해 주세요');if(c.stockVersion===2&&a.material.stockVersion!==2){const t=state(a);a.material.stockVersion=2;a.material.initialLocation=a.location;a.material.locations=[{name:a.location,lat:a.lat,lng:a.lng}];event(a,'locationsInit',{book:t.book,damage:t.damage});}
  need(a.material.stockVersion!==2||c.stockVersion===2,'새 자재 화면을 새로고침한 뒤 처리해 주세요');const modern=c.stockVersion===2,s=state(a),reason=()=>text(c.reason,'사유');
  const zone=()=>{const name=text(c.fromLocation||c.location||a.location,'출발 구역');const z=zones(a).find(z=>z.name===name);need(z,'출발 구역을 다시 선택해 주세요');return z;};
  const registerZone=name=>{text(name,'보관 구역');if(!a.material.locations.some(z=>z.name===name))a.material.locations.push({name,lat:'',lng:''});if(!(d.locations||[]).includes(name))(d.locations??=[]).push(name);};

  const issue=()=>{const i=s.issues[c.target];need(Object.hasOwn(s.issues,c.target)&&i&&!i.cancelled,'반출 건을 다시 확인해 주세요');if(c.expectedIssue!=null)need(JSON.stringify(i)===c.expectedIssue,'다른 담당자가 반출 내역을 변경했습니다. 최신 내역을 다시 열어 확인해 주세요');return i;};
  if(modern&&['transfer','move','split'].includes(c.kind)){
   const from=zone(),to=text(c.location,'도착 구역');need(from.name!==to,'출발 구역과 도착 구역이 같습니다');const q=c.kind==='move'?clone(from.available):vector(a,c.quantities);need(Object.values(q).some(Boolean),'이동할 수량을 입력해 주세요');for(const k in q)need(q[k]<=from.available[k],'출발 구역의 사용 가능 수량을 초과했습니다');registerZone(to);event(a,'transfer',{from:from.name,to,q,note:c.note||''});
  }else if(modern&&c.kind==='verify'){need(['verified','unverified'].includes(c.verification),'실물 확인 상태를 선택해 주세요');a.material.verification=c.verification;event(a,'verify',{verification:c.verification,note:c.note||''});
  }else if(['use','issue','split'].includes(c.kind)){
   const q=vector(a,c.quantities);available(a,q);const source=modern?zone():null;if(source)for(const k in q)need(q[k]<=source.available[k],'선택한 구역의 사용 가능 수량을 초과했습니다');
   if(c.kind==='use')event(a,'use',{...(source?{location:source.name}:{}),delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),place:text(c.place,'사용처'),note:c.note||''});
   if(c.kind==='issue'){need(proof(c.photo),'반출증 사진을 첨부해 주세요');event(a,'issue',{...(source?{location:source.name}:{}),q,person:text(c.person,'반출자'),place:text(c.place,'사용처·반출처'),photo:c.photo,docNo:c.docNo||'',note:c.note||''});}
   if(c.kind==='split'){
    const b=clone(a);b.id=nextId(d);b.registrationId=c.id;b.material.ledger=[];b.material.parent=a.id;b.material.packCount=null;b.material.archived=false;b.updatedAt=c.at;b.lat='';b.lng='';setLoc(b,c.location);b.locInit=b.location;d.assets.push(b);
    event(a,'splitOut',{delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),to:b.id,location:b.location});event(b,'splitIn',{delta:q,from:a.id});result.ids=[b.id];
   }
  }else if(c.kind==='confirm'){const i=issue();need(!i.confirmed,'이미 반출 완료된 건입니다');event(a,'confirm',{target:i.id,note:c.note||''});}
  else if(c.kind==='cancel'){const i=issue();need(!i.confirmed&&!Object.values(i.returned).some(Boolean),'실제 나갔던 자재는 돌아온 자재 등록을 사용해 주세요');need(c.neverLeft===true,'실물이 나가지 않은 입력 오류인지 확인해 주세요');event(a,'cancel',{target:i.id,reason:reason()});}
  else if(c.kind==='amend'){const i=issue();need(!i.confirmed,'반출 완료 건은 수량 조정으로 정정해 주세요');const q=vector(a,c.quantities);for(const p of a.material.parts){need(q[p.key]>=i.returned[p.key],'이미 돌아온 수량보다 작게 바꿀 수 없습니다');need(q[p.key]-i.q[p.key]<=(modern?zones(a).find(z=>z.name===(i.location||a.material.initialLocation)).available[p.key]:s.available[p.key]),'정정 수량이 사용 가능 재고를 초과합니다');}event(a,'amend',{target:i.id,q,reason:reason()});}
  else if(c.kind==='return'){const i=issue(),q=vector(a,c.quantities);for(const k in q)need(q[k]<=i.q[k]-i.returned[k],'실제 나간 수량보다 많이 돌아올 수 없습니다');const location=text(c.location,'보관 구역');if(modern){registerZone(location);event(a,'return',{target:i.id,q,damaged:c.damaged===true,location,note:c.note||''});}else{const separate=location!==a.location&&a.material.parts.some(p=>s.book[p.key]-s.pending[p.key]>0);
   if(!separate){if(location!==a.location){a.lat='';a.lng='';}setLoc(a,location);}
   event(a,'return',{target:i.id,q,damaged:c.damaged===true,location,note:c.note||''});
   if(separate){const b=clone(a);b.id=nextId(d);b.registrationId=c.id;b.material.ledger=[];b.material.parent=a.id;b.material.packCount=null;b.lat='';b.lng='';setLoc(b,location);b.locInit=location;d.assets.push(b);event(a,'splitOut',{delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),damage:c.damaged?Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])):undefined,to:b.id});event(b,'splitIn',{delta:q,damage:c.damaged?q:undefined,from:a.id});result.ids=[b.id];}}}
  else if(c.kind==='adjust'){const total=vector(a,c.quantities,true),damage=vector(a,c.damagedQuantities,true),current=modern?zone():s;reason();for(const p of a.material.parts)need(total[p.key]>=current.pending[p.key]+damage[p.key],'확인 대기 반출과 파손 수량보다 재고가 작을 수 없습니다');event(a,'adjust',{...(modern?{location:current.name}:{}),delta:Object.fromEntries(a.material.parts.map(p=>[p.key,total[p.key]-current.book[p.key]])),damage:Object.fromEntries(a.material.parts.map(p=>[p.key,damage[p.key]-current.damage[p.key]])),reason:c.reason});}
  else if(c.kind==='coordinates'){need(Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&c.lat>=-90&&c.lat<=90&&c.lng>=-180&&c.lng<=180,'좌표를 확인해 주세요');const z=modern?zone():a,from={lat:z.lat,lng:z.lng},to={lat:c.lat,lng:c.lng};if(modern){registerZone(z.name);Object.assign(a.material.locations.find(x=>x.name===z.name),to);}event(a,'coordinates',{from,to,...(modern?{location:z.name}:{}),method:c.method||'위치 갱신'});if(!modern||z.name===a.location){a.lat=c.lat;a.lng=c.lng;}a.log=[{id:c.id,at:c.at,t:'좌표 변경 (자재 · '+(c.method||'위치 갱신')+')',move:{from,to,method:c.method||'위치 갱신',restores:c.restores||null}},...(a.log||[])].slice(0,15);}
  else if(c.kind==='move'){need(!Object.values(s.pending).some(Boolean),'반출 확인 대기 건을 먼저 처리한 후 이동해 주세요');const from=a.location,coordinates={lat:a.lat,lng:a.lng};setLoc(a,c.location);if(from!==a.location){a.lat='';a.lng='';}event(a,'move',{from,to:a.location,coordinates,note:c.note||''});}
  else if(c.kind==='documents'){const common=a.material.common;if(c.docState==='complete'){text(c.po,'PO번호');text(c.pl,'PL번호');}else{need(['pending','none'].includes(c.docState),'서류 상태를 선택해 주세요');reason();}need(!a.material.orderId||c.po===common.po,'발주 연결이 있는 PO는 임의로 변경할 수 없습니다');if(c.photo)need(proof(c.photo),'PL 사진을 확인해 주세요');for(const x of d.assets.filter(x=>mat(x)&&x.material.common.receiptId===common.receiptId)){need(!x.material.orderId||c.po===x.material.common.po,'발주 연결이 있는 PO는 임의로 변경할 수 없습니다');Object.assign(x.material.common,{po:c.po||'',pl:c.pl||'',docState:c.docState,docReason:c.reason||'',vendor:text(c.vendor,'업체명')},c.photo?{plPhoto:c.photo}:{});x.material.orderKey=orderKey(c.po,{item:x.item,model:x.model,unit:x.unit,poLine:x.material.poLine});event(x,'documents',{common:clone(x.material.common)});}}
  else if(c.kind==='metadata'){need(c.unit==null||c.unit===a.unit,'거래가 있는 자재의 단위는 변경할 수 없습니다');a.item=text(c.item,'품명');a.model=text(c.model,'규격');if(a.material.parts.length===1){a.material.parts[0].name=a.item;a.material.parts[0].spec=a.model;}a.note=c.note||'';if(!a.material.orderId)a.material.orderKey=orderKey(a.material.common.po,{item:a.item,model:a.model,unit:a.unit,poLine:a.material.poLine});event(a,'metadata',{item:a.item,model:a.model,note:a.note,reason:reason()});}
  else if(c.kind==='archive'||c.kind==='restore'){need(!Object.values(s.pending).some(Boolean),'반출 확인 대기 중인 자재는 보관할 수 없습니다');if(c.kind==='restore')need(a.material.archived,'이미 복원된 자재입니다');a.material.archived=c.kind==='archive';event(a,c.kind,{reason:reason()});d.trash??=[];if(c.kind==='archive')d.trash.unshift({kind:'material',id:a.id,at:c.at,reason:c.reason,operator:c.operator});else{const t=d.trash.find(t=>t.kind==='material'&&t.id===a.id&&!t.restoredAt);if(t)t.restoredAt=c.at;}}
  else throw Error('지원하지 않는 자재 처리입니다');
 }
 for(const a of d.assets.filter(mat)){if(!a.material.orderId&&a.material.orderKey){const order=d.materialOrders.find(o=>o.key===a.material.orderKey);if(order){need(order.unit===(a.material.parts.length>1?'SET':a.unit),'PO 품목 줄의 단위가 다릅니다');if(a.material.parts.length>1)need(eq(order.parts,a.material.parts),'같은 PO 품목의 세트 구성이 다릅니다. 품목 줄 번호를 구분해 주세요');a.material.orderId=order.id;event(a,'orderLink',{orderId:order.id});}}refresh(a);if(a.material.stockVersion===2)zones(a);}
 for(const order of d.materialOrders){const received=d.assets.filter(a=>mat(a)&&a.material.orderId===order.id).reduce((n,a)=>n+a.material.ledger.filter(e=>e.kind==='receive').reduce((n,e)=>n+(e.orderQuantity??Object.values(e.delta).reduce((n,q)=>n+q,0)),0),0);need(received<=order.quantity,'기존 입고를 포함하면 발주수량을 초과합니다. PO 발주수량을 확인해 주세요');}
 d.materialOps.push(clone(command));Object.assign(doc,d);return result;
}
// 행 순서·Excel 저장 형식이 바뀌어도 같은 입고 내용을 구분합니다.
function importKey(receipts){
 const number=v=>v===''||v==null?'':String(Number(v));
 const values=(receipts||[]).map(r=>({common:Object.fromEntries(['po','pl','vendor','arrivedAt','receivedBy','docState','docReason','orderDate','expectedDate'].map(k=>[k,String(r.common?.[k]||'').trim()])),lines:(r.lines||[]).map(l=>({item:String(l.item||'').trim(),model:String(l.model||'').trim(),unit:l.unit,quantity:number(l.quantity),location:String(l.location||'').trim(),packCount:number(l.packCount||1),perSet:number(l.perSet||l.quantity),packLabel:l.packLabel||'묶음',ordered:number(l.ordered),poLine:l.poLine||'',serial:l.serial||'',note:l.note||'',bundleKey:l.bundleKey||'',parts:(l.parts||[]).map(p=>({name:p.name,spec:p.spec,unit:p.unit,perSet:number(p.perSet)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));
 for(let ri=0;ri<values.length;ri++){const source=receipts[ri];if(source.lines.some(l=>l.totalMode)){values[ri].common.verification=source.common.verification||'';values[ri].lines=source.lines.map(l=>({item:l.item,model:l.model,location:l.location,note:l.note||'',unit:l.unit,quantity:number(l.quantity),totalMode:true,verification:l.verification||'',parts:(l.parts||[]).map(p=>({name:p.name,spec:p.spec,unit:p.unit,quantity:number(p.quantity)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}}
 return JSON.stringify(values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function protectedView(doc){return {orders:doc.materialOrders||[],trash:(doc.trash||[]).filter(t=>t.kind==='material'),assets:doc.assets.filter(a=>a.material).map(a=>({id:a.id,category:a.category,item:a.item,model:a.model,unit:a.unit,qty:a.qty,status:a.status||'상',out:a.out||null,location:a.location,material:a.material||null})).sort((a,b)=>a.id.localeCompare(b.id))};}
function validateTransition(old,next){
 const legacy=new Set(old.assets.filter(a=>a.category===CAT&&!a.material).map(a=>a.id));need(next.assets.every(a=>a.category!==CAT||a.material||legacy.has(a.id)),'자재는 신규 자재 등록에서 입력해 주세요');
 const before=old.materialOps||[],after=next.materialOps||[];need(Array.isArray(after)&&after.length>=before.length,'자재 원장은 삭제할 수 없습니다');need(eq(before,after.slice(0,before.length)),'기존 자재 원장은 수정할 수 없습니다');
 const replay=clone(old);for(const c of after.slice(before.length)){need(!(replay.materialOps||[]).some(x=>x.id===c.id),'원장에 같은 처리 번호를 중복 추가할 수 없습니다');apply(replay,c);}need(eq(protectedView(replay),protectedView(next)),'자재 수량·정보는 자재 처리 기능으로 변경해 주세요');
}
root.MaterialCore=Object.freeze({CAT,UNITS,mat,qty,state,summary,refresh,apply,validateTransition,proof,importKey,zones,clean});
})(globalThis);
