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
function vector(a,values,zero=false){const r={};for(const p of a.material.parts)r[p.key]=qty(values?.[p.key]??0,p.unit,true);need(zero||Object.values(r).some(n=>n>0),'처리할 수량을 입력해 주세요');return r;}
function available(a,q){const s=state(a);for(const k in q)need(q[k]<=s.available[k],'사용 가능 수량을 초과했습니다. 최신 재고를 확인해 주세요');}
function nextId(doc){let n=0;for(const a of [...doc.assets,...(doc.trash||[])]){const m=String(a.id).match(/^MAT-(\d+)$/);if(m)n=Math.max(n,+m[1]);}return 'MAT-'+String(n+1).padStart(3,'0');}
function proof(p){return !!(p&&typeof p.path==='string'&&/^photos\/[^\x00-\x1f\\]+\.(?:jpg|jpeg|png|webp)$/i.test(p.path)&&!p.path.split('/').includes('..'));}
function summary(a){const s=state(a),p=a.material.parts[0];return a.material.parts.length===1?{book:s.book[p.key]/1000,pending:s.pending[p.key]/1000,available:s.available[p.key]/1000,damage:s.damage[p.key]/1000,unit:p.unit}:{book:null,pending:null,available:null,damage:null,unit:'구성품별'};}
function refresh(a){const s=summary(a);a.qty=s.available??0;a.unit=s.unit;return a;}
function orderKey(po,line){return po?JSON.stringify([po,line.poLine||line.item,line.model,line.unit]):'';}
function apply(doc,command){
 need(command&&typeof command.id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(command.id),'처리 식별자가 필요합니다');
 const prior=(doc.materialOps||[]).find(x=>x.id===command.id);if(prior){need(eq(prior,command),'동일한 처리 번호의 내용이 다릅니다');return {ids:doc.assets.filter(a=>mat(a)&&a.registrationId===command.id).map(a=>a.id),duplicate:true};}
 const d=clone(doc),c=clone(command);d.materialOps??=[];d.materialOrders??=[];
 text(c.operator,'담당자');need(typeof c.at==='string'&&Number.isFinite(Date.parse(c.at)),'처리 일시를 확인해 주세요');
 const event=(a,kind,data={})=>{const e={id:c.id+'_'+a.material.ledger.length,opId:c.id,kind,at:c.at,operator:c.operator,...data};a.material.ledger.push(e);a.updatedAt=c.at;return e;};
 const setLoc=(a,location)=>{a.location=text(location,'보관 구역');if(!(d.locations||[]).includes(a.location))(d.locations??=[]).push(a.location);};
 const make=(line,common)=>{
  const parts=(line.parts?.length?line.parts:[{key:'p1',name:line.item,spec:line.model,unit:line.unit,perSet:line.perSet||line.quantity||'1'}]).map((p,i)=>{const unit=text(p.unit,'단위');need(UNITS.includes(unit),'재고 단위를 확인해 주세요');return {key:'p'+(i+1),name:text(p.name,'품명'),spec:text(p.spec,'규격'),unit,perSet:qty(p.perSet||'1',unit)};});
  if(parts.length>1){need(line.packCount,'구성품 세트는 입고 묶음 수를 입력해 주세요');if(line.quantity)need(qty(line.quantity,'SET')===qty(line.packCount,'SET'),'세트 입고수량과 입고 묶음 수가 다릅니다');}
  need(parts.length<=30,'세트 구성품은 30줄 이내로 등록해 주세요');const count=qty(line.packCount||'1','BOX')/1000;
  const a={id:nextId(d),registrationId:c.id,category:CAT,item:text(line.item,'품명'),model:text(line.model,'규격'),unit:parts.length===1?parts[0].unit:'구성품별',qty:0,status:'상',location:'',lat:line.lat??'',lng:line.lng??'',manager:c.operator,note:line.note||'',out:null,log:[],photos:[],updatedAt:c.at,material:{parts,ledger:[],common:clone(common),archived:false,parent:null,packCount:count,packLabel:line.packLabel||'묶음',serial:line.serial||''}};
  setLoc(a,line.location);a.locInit=a.location;d.assets.push(a);const delta=Object.fromEntries(parts.map(p=>[p.key,p.perSet*count]));for(const p of parts)need(Number.isSafeInteger(delta[p.key])&&delta[p.key]<=1e12,'입고수량이 너무 큽니다');
  const key=orderKey(common.po,{...line,unit:a.unit});a.material.orderKey=key;a.material.poLine=line.poLine||'';let order=d.materialOrders.find(o=>o.key===key&&key);
  const ordered=line.ordered===''||line.ordered==null?null:qty(line.ordered,parts.length>1?'SET':a.unit);
  if(ordered!==null){if(order)need(order.quantity===ordered,'같은 PO 품목의 발주수량이 다릅니다. 기존 발주수량을 확인해 주세요');else{order={id:c.id+'_'+a.id,key,po:common.po,poLine:line.poLine||'',item:a.item,model:a.model,unit:parts.length>1?'SET':a.unit,quantity:ordered,parts:parts.length>1?clone(parts):null};d.materialOrders.push(order);}}
  if(order){if(parts.length>1)need(eq(order.parts,parts),'같은 PO 품목의 세트 구성이 다릅니다. 품목 줄 번호를 구분해 주세요');a.material.orderId=order.id;const received=d.assets.filter(x=>mat(x)&&x.id!==a.id&&x.material.orderId===order.id).reduce((n,x)=>n+x.material.ledger.filter(e=>e.kind==='receive').reduce((m,e)=>m+(e.orderQuantity??Object.values(e.delta).reduce((t,v)=>t+v,0)),0),0);need(received+(parts.length>1?count*1000:Object.values(delta).reduce((n,v)=>n+v,0))<=order.quantity,'발주수량을 초과하는 입고입니다. PO 품목 줄과 발주수량을 확인해 주세요');}
  if(parts.length===1&&line.quantity!==''&&line.quantity!=null)need(qty(line.quantity,parts[0].unit)===delta[parts[0].key],'입고수량과 묶음 환산 수량이 다릅니다');
  if(line.serial)need(parts.length===1&&parts[0].unit==='EA'&&delta[parts[0].key]===1000,'개체 번호가 있는 기기·Spool은 수량 1 EA로 등록해 주세요');
  event(a,'receive',{delta,orderQuantity:parts.length>1?count*1000:Object.values(delta).reduce((n,v)=>n+v,0),photo:common.plPhoto||null,location:a.location,lat:a.lat,lng:a.lng});if(proof(line.photo)){a.photo=line.photo;a.photos=[line.photo];a.thumb=line.thumb||'';}return a;
 };
 let result={};
 if(c.kind==='create'){
  need(Array.isArray(c.lines)&&c.lines.length&&c.lines.length<=30,'자재를 1~30줄 입력해 주세요');const common=c.common||{};text(common.vendor,'업체명');
  if(common.docState==='complete'){text(common.po,'PO번호');text(common.pl,'PL번호');}else{need(['pending','none'].includes(common.docState),'서류 상태를 선택해 주세요');text(common.docReason,'서류 사유');}
  need(common.arrivedAt&&Number.isFinite(Date.parse(common.arrivedAt)),'실제 입고일을 입력해 주세요');if(common.plPhoto)need(proof(common.plPhoto),'PL 사진 경로를 확인해 주세요');
  common.receiptId=c.id;common.receivedBy=c.operator;result.ids=c.lines.map(l=>make(l,common).id);
 }else{
  const a=d.assets.find(x=>x.id===c.asset&&mat(x));need(a,'자재를 찾을 수 없습니다');need(!a.material.archived||c.kind==='restore','보관함 자재를 먼저 복원해 주세요');const s=state(a),reason=()=>text(c.reason,'사유');
  const issue=()=>{const i=s.issues[c.target];need(Object.hasOwn(s.issues,c.target)&&i&&!i.cancelled,'반출 건을 다시 확인해 주세요');return i;};
  if(['use','issue','split'].includes(c.kind)){
   const q=vector(a,c.quantities);available(a,q);
   if(c.kind==='use')event(a,'use',{delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),place:text(c.place,'사용처'),note:c.note||''});
   if(c.kind==='issue'){need(proof(c.photo),'반출증 사진을 첨부해 주세요');event(a,'issue',{q,person:text(c.person,'반출자'),place:text(c.place,'사용처·반출처'),photo:c.photo,docNo:c.docNo||'',note:c.note||''});}
   if(c.kind==='split'){
    const b=clone(a);b.id=nextId(d);b.registrationId=c.id;b.material.ledger=[];b.material.parent=a.id;b.material.packCount=null;b.material.archived=false;b.updatedAt=c.at;b.lat='';b.lng='';setLoc(b,c.location);b.locInit=b.location;d.assets.push(b);
    event(a,'splitOut',{delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),to:b.id,location:b.location});event(b,'splitIn',{delta:q,from:a.id});result.ids=[b.id];
   }
  }else if(c.kind==='confirm'){const i=issue();need(!i.confirmed,'이미 반출 완료된 건입니다');event(a,'confirm',{target:i.id,note:c.note||''});}
  else if(c.kind==='cancel'){const i=issue();need(!i.confirmed&&!Object.values(i.returned).some(Boolean),'실제 나갔던 자재는 돌아온 자재 등록을 사용해 주세요');need(c.neverLeft===true,'실물이 나가지 않은 입력 오류인지 확인해 주세요');event(a,'cancel',{target:i.id,reason:reason()});}
  else if(c.kind==='amend'){const i=issue();need(!i.confirmed,'반출 완료 건은 수량 조정으로 정정해 주세요');const q=vector(a,c.quantities);for(const p of a.material.parts){need(q[p.key]>=i.returned[p.key],'이미 돌아온 수량보다 작게 바꿀 수 없습니다');need(q[p.key]-i.q[p.key]<=s.available[p.key],'정정 수량이 사용 가능 재고를 초과합니다');}event(a,'amend',{target:i.id,q,reason:reason()});}
  else if(c.kind==='return'){const i=issue(),q=vector(a,c.quantities);for(const k in q)need(q[k]<=i.q[k]-i.returned[k],'실제 나간 수량보다 많이 돌아올 수 없습니다');const location=text(c.location,'보관 구역'),separate=location!==a.location&&a.material.parts.some(p=>s.book[p.key]-s.pending[p.key]>0);
   if(!separate){if(location!==a.location){a.lat='';a.lng='';}setLoc(a,location);}
   event(a,'return',{target:i.id,q,damaged:c.damaged===true,location,note:c.note||''});
   if(separate){const b=clone(a);b.id=nextId(d);b.registrationId=c.id;b.material.ledger=[];b.material.parent=a.id;b.material.packCount=null;b.lat='';b.lng='';setLoc(b,location);b.locInit=location;d.assets.push(b);event(a,'splitOut',{delta:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])),damage:c.damaged?Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-v])):undefined,to:b.id});event(b,'splitIn',{delta:q,damage:c.damaged?q:undefined,from:a.id});result.ids=[b.id];}}
  else if(c.kind==='adjust'){const total=vector(a,c.quantities,true),damage=vector(a,c.damagedQuantities,true);reason();for(const p of a.material.parts)need(total[p.key]>=s.pending[p.key]+damage[p.key],'확인 대기 반출과 파손 수량보다 재고가 작을 수 없습니다');event(a,'adjust',{delta:Object.fromEntries(a.material.parts.map(p=>[p.key,total[p.key]-s.book[p.key]])),damage:Object.fromEntries(a.material.parts.map(p=>[p.key,damage[p.key]-s.damage[p.key]])),reason:c.reason});}
  else if(c.kind==='coordinates'){need(Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&c.lat>=-90&&c.lat<=90&&c.lng>=-180&&c.lng<=180,'좌표를 확인해 주세요');const from={lat:a.lat,lng:a.lng},to={lat:c.lat,lng:c.lng};event(a,'coordinates',{from,to,method:c.method||'위치 갱신'});a.lat=c.lat;a.lng=c.lng;a.log=[{id:c.id,at:c.at,t:'좌표 변경 (자재 · '+(c.method||'위치 갱신')+')',move:{from,to,method:c.method||'위치 갱신',restores:c.restores||null}},...(a.log||[])].slice(0,15);}
  else if(c.kind==='move'){need(!Object.values(s.pending).some(Boolean),'반출 확인 대기 건을 먼저 처리한 후 이동해 주세요');const from=a.location,coordinates={lat:a.lat,lng:a.lng};setLoc(a,c.location);if(from!==a.location){a.lat='';a.lng='';}event(a,'move',{from,to:a.location,coordinates,note:c.note||''});}
  else if(c.kind==='documents'){const common=a.material.common;if(c.docState==='complete'){text(c.po,'PO번호');text(c.pl,'PL번호');}else{need(['pending','none'].includes(c.docState),'서류 상태를 선택해 주세요');reason();}need(!a.material.orderId||c.po===common.po,'발주 연결이 있는 PO는 임의로 변경할 수 없습니다');if(c.photo)need(proof(c.photo),'PL 사진을 확인해 주세요');for(const x of d.assets.filter(x=>mat(x)&&x.material.common.receiptId===common.receiptId)){need(!x.material.orderId||c.po===x.material.common.po,'발주 연결이 있는 PO는 임의로 변경할 수 없습니다');Object.assign(x.material.common,{po:c.po||'',pl:c.pl||'',docState:c.docState,docReason:c.reason||'',vendor:text(c.vendor,'업체명')},c.photo?{plPhoto:c.photo}:{});x.material.orderKey=orderKey(c.po,{item:x.item,model:x.model,unit:x.unit,poLine:x.material.poLine});event(x,'documents',{common:clone(x.material.common)});}}
  else if(c.kind==='metadata'){need(c.unit==null||c.unit===a.unit,'거래가 있는 자재의 단위는 변경할 수 없습니다');a.item=text(c.item,'품명');a.model=text(c.model,'규격');if(a.material.parts.length===1){a.material.parts[0].name=a.item;a.material.parts[0].spec=a.model;}a.note=c.note||'';event(a,'metadata',{item:a.item,model:a.model,note:a.note,reason:reason()});}
  else if(c.kind==='archive'||c.kind==='restore'){need(!Object.values(s.pending).some(Boolean),'반출 확인 대기 중인 자재는 보관할 수 없습니다');if(c.kind==='restore')need(a.material.archived,'이미 복원된 자재입니다');a.material.archived=c.kind==='archive';event(a,c.kind,{reason:reason()});d.trash??=[];if(c.kind==='archive')d.trash.unshift({kind:'material',id:a.id,at:c.at,reason:c.reason,operator:c.operator});else{const t=d.trash.find(t=>t.kind==='material'&&t.id===a.id&&!t.restoredAt);if(t)t.restoredAt=c.at;}}
  else throw Error('지원하지 않는 자재 처리입니다');
 }
 for(const a of d.assets.filter(mat)){if(!a.material.orderId&&a.material.orderKey){const order=d.materialOrders.find(o=>o.key===a.material.orderKey);if(order){if(a.material.parts.length>1)need(eq(order.parts,a.material.parts),'같은 PO 품목의 세트 구성이 다릅니다. 품목 줄 번호를 구분해 주세요');a.material.orderId=order.id;event(a,'orderLink',{orderId:order.id});}}refresh(a);}
 for(const order of d.materialOrders){const received=d.assets.filter(a=>mat(a)&&a.material.orderId===order.id).reduce((n,a)=>n+a.material.ledger.filter(e=>e.kind==='receive').reduce((n,e)=>n+(e.orderQuantity??Object.values(e.delta).reduce((n,q)=>n+q,0)),0),0);need(received<=order.quantity,'기존 입고를 포함하면 발주수량을 초과합니다. PO 발주수량을 확인해 주세요');}
 d.materialOps.push(clone(command));Object.assign(doc,d);return result;
}
function protectedView(doc){return {orders:doc.materialOrders||[],trash:(doc.trash||[]).filter(t=>t.kind==='material'),assets:doc.assets.filter(a=>a.material||a.category===CAT).map(a=>({id:a.id,category:a.category,item:a.item,model:a.model,unit:a.unit,qty:a.qty,location:a.location,material:a.material||null})).sort((a,b)=>a.id.localeCompare(b.id))};}
function validateTransition(old,next){
 const before=old.materialOps||[],after=next.materialOps||[];need(Array.isArray(after)&&after.length>=before.length,'자재 원장은 삭제할 수 없습니다');need(eq(before,after.slice(0,before.length)),'기존 자재 원장은 수정할 수 없습니다');
 const replay=clone(old);for(const c of after.slice(before.length)){need(!(replay.materialOps||[]).some(x=>x.id===c.id),'원장에 같은 처리 번호를 중복 추가할 수 없습니다');apply(replay,c);}need(eq(protectedView(replay),protectedView(next)),'자재 수량·정보는 자재 처리 기능으로 변경해 주세요');
}
root.MaterialCore=Object.freeze({CAT,UNITS,mat,qty,state,summary,refresh,apply,validateTransition,proof});
})(globalThis);
