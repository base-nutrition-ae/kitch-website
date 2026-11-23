/* KITCH Ready Products: pure transfer guards (no network or inventory writes).
   Shared by browser preview and local test harness. Server must re-validate all rules.
*/
(function(root){
 'use strict';
 function quantity(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=100000?n:null;
 }
 function dateOnly(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
   !Number.isNaN(Date.parse(String(s)+'T00:00:00Z'))?String(s):null}
 function todayUTC(d=new Date()){return d.toISOString().slice(0,10)}
 function dispatch({requested,dispatchQty,available,expiry,today=todayUTC()}){
  const q=quantity(dispatchQty),r=quantity(requested),have=quantity(available);
  if(q===null||r===null||have===null||q<=0||r<=0)return {ok:false,error:'Invalid quantities'};
  if(q>r)return {ok:false,error:'Dispatch exceeds requested amount'};
  if(q>have)return {ok:false,error:'Not enough finished-batch stock'};
  if(!dateOnly(expiry)||expiry<today)return {ok:false,error:'Batch has expired or expiry date is invalid'};
  return {ok:true,remaining:have-q};
 }
 function receipt({sent,accepted,rejected}){
  const s=quantity(sent),a=quantity(accepted),r=quantity(rejected);
  if(s===null||a===null||r===null||s<=0)return {ok:false,error:'Invalid receipt quantities'};
  if(Math.abs((a+r)-s)>0.0000001)return {ok:false,error:'Accepted and rejected must total the dispatched amount'};
  return {ok:true,branchIncrease:a,rejected:r};
 }
 function balance(movements,{restaurantId,branchId,batchId}){
  return movements.filter(m=>m.restaurantId===restaurantId&&m.branchId===branchId&&m.batchId===batchId)
   .reduce((n,m)=>n+Number(m.delta||0),0);
 }
 const api={quantity,dateOnly,todayUTC,dispatch,receipt,balance};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.KitchReadyEngine=api;
})(typeof globalThis==='object'?globalThis:this);
