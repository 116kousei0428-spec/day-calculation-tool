import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getDatabase,ref,onValue,push,set,runTransaction} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const $ = id => document.getElementById(id);
const dayMs = 24 * 60 * 60 * 1000;
const intervalMs = dayMs * 10;
const recordsRefPath = 'toichi_shared_v1/records';
const money = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const numberFmt = n => n.toLocaleString('ja-JP');
const dateFmt = ms => new Date(ms).toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function calcAmount(base,start,end){
  const intervals=Math.max(0,Math.floor((end-start)/intervalMs));
  // 1円未満は最終値で丸める。端数の累積誤差を避けるため10倍した整数で計算。
  return {intervals,amount:Math.round(base*(10+intervals)/10)};
}
let records={}, view='active', db=null, recordBase=null, connected=false, canRead=false, readDenied=false;
function message(text){$('error').textContent=text;$('error').classList.toggle('hidden',!text)}
function state(text,kind=''){ $('connection').textContent=text;$('dot').className='dot '+kind; }
function el(tag,cls,content){const element=document.createElement(tag);if(cls)element.className=cls;if(content!==undefined)element.textContent=content;return element;}
function row(label,value){return el('div','',label+'：'+value)}
function render(){
 const now=Date.now();const all=Object.entries(records).map(([id,r])=>({id,...r})).filter(r=>r&&Number.isSafeInteger(r.principal)&&Number.isFinite(r.startAt)&&typeof r.name==='string');
 const active=all.filter(r=>r.status!=='completed');const done=all.filter(r=>r.status==='completed');
 $('activeCount').textContent=numberFmt(active.length)+'件';$('doneCount').textContent=numberFmt(done.length)+'件';
 $('activeTotal').textContent=money(active.reduce((total,r)=>total+calcAmount(r.principal,r.startAt,now).amount,0));
 $('activeTab').classList.toggle('active',view==='active');$('doneTab').classList.toggle('active',view==='completed');
 const current=(view==='active'?active:done).sort((a,b)=>(b.startAt-a.startAt));
 $('cards').replaceChildren();$('empty').classList.toggle('hidden',current.length!==0);
 for(const item of current){
  const end=item.status==='completed'?item.completedAt:now;
  const result=calcAmount(item.principal,item.startAt,end);
  const card=el('article','card'),top=el('div','cardtop');top.append(el('div','name',item.name),el('span',item.status==='completed'?'pill completed':'pill',item.status==='completed'?'完了':'登録中'));card.append(top,el('div','amount',money(result.amount)));
  const details=el('div','meta');details.append(row('元金',money(item.principal)),row('開始',dateFmt(item.startAt)),row('経過回数',result.intervals+'回（10日単位）'));
  if(item.status==='completed')details.append(row('完了',dateFmt(item.completedAt)));
  card.append(details);
  if(item.memo)card.append(el('div','note',item.memo));
  const actions=el('div','actions');
  if(item.status!=='completed'){
   const complete=el('button','ghost','完了');complete.type='button';complete.disabled=!(connected&&canRead);
   complete.addEventListener('click',()=>completeRecord(item));actions.append(complete);
  }
  const remove=el('button','danger','削除');remove.type='button';remove.disabled=!(connected&&canRead);remove.addEventListener('click',()=>deleteRecord(item));actions.append(remove);card.append(actions);$('cards').append(card);
 }
}
function localValue(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
$('openAdd').onclick=()=>{if(!(connected&&canRead)){message('Firebaseへの同期接続・読み込みが完了していません。');return;}$('startTime').value=localValue();$('addOverlay').classList.remove('hidden');$('personName').focus()};
function closeForm(){$('addOverlay').classList.add('hidden');$('addForm').reset()}
$('cancelAdd').onclick=closeForm;
$('addOverlay').addEventListener('click',e=>{if(e.target===$('addOverlay'))closeForm()});
$('activeTab').onclick=()=>{view='active';render()};$('doneTab').onclick=()=>{view='completed';render()};
$('addForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!recordBase||!connected||!canRead)return;
 const name=$('personName').value.trim(),principal=Number($('principal').value),startAt=new Date($('startTime').value).getTime(),memo=$('memo').value.trim();
 if(!name||!Number.isSafeInteger(principal)||principal<0||principal>999999999999||!Number.isFinite(startAt)){message('入力内容を確認してください。');return;}
 $('saveAdd').disabled=true;message('');
 try{const item=push(recordBase);await set(item,{name,principal,startAt,memo,status:'active',createdAt:Date.now()});closeForm();view='active';render();}
 catch(err){message('登録に失敗しました。Firebaseの設定・アクセス権を確認してください。\n'+err.message)}
 finally{$('saveAdd').disabled=false}
});
async function completeRecord(item){
 if(!window.confirm('「'+item.name+'」を完了にしますか？ 完了後は金額が増えません。'))return;
 const completedAt=Date.now();
 try{message('');await runTransaction(ref(db,recordsRefPath+'/'+item.id),current=>{
  if(!current||current.status==='completed')return;
  return {...current,status:'completed',completedAt};
 });}catch(err){message('完了処理に失敗しました：'+err.message)}
}
async function deleteRecord(item){
 if(!window.confirm('「'+item.name+'」を完全に削除しますか？ この操作は元に戻せません。'))return;
 try{message('');await runTransaction(ref(db,recordsRefPath+'/'+item.id),current=>current?null:undefined)}catch(err){message('削除に失敗しました：'+err.message)}
}
const config=window.FIREBASE_CONFIG;
if(!config||!config.apiKey||!config.databaseURL||!config.projectId||!config.appId){
 state('未設定','bad');message('Firebaseの接続設定がまだありません。ZIP内の config.js にFirebaseのWebアプリ設定を入力してから公開してください。');$('openAdd').disabled=true;render();
}else{
 try{
  const app=initializeApp(config);db=getDatabase(app);recordBase=ref(db,recordsRefPath);
  onValue(ref(db,'.info/connected'),snap=>{connected=snap.val()===true;state(readDenied?'読込権限エラー':!connected?'接続待機中':canRead?'同期接続中':'読込待機中',readDenied?'bad':connected&&canRead?'ok':'');$('openAdd').disabled=!(connected&&canRead);render()});
  onValue(recordBase,snap=>{records=snap.val()||{};canRead=true;readDenied=false;state(connected?'同期接続中':'読込完了・接続待機',connected?'ok':'');$('openAdd').disabled=!connected;render();message('')},err=>{readDenied=true;canRead=false;state('読込権限エラー','bad');$('openAdd').disabled=true;render();message('データを読み込めません。Firebase Realtime Databaseのルールを確認してください。\n'+err.message)});
 }catch(err){state('設定エラー','bad');message('Firebase設定を確認してください。\n'+err.message);$('openAdd').disabled=true}
}
// 開きっぱなしでも画面の経過日数を更新する。
setInterval(render,60000);
