import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// No Supabase connection or customer records are used in these tests.
const source=fs.readFileSync(new URL('../public/assets/kitch-ready-engine.js',import.meta.url),'utf8');
const sandbox={};
vm.runInNewContext(source,sandbox,{filename:'kitch-ready-engine.js'});
const g=sandbox.KitchReadyEngine;
assert.ok(g,'Ready Products guards must be available');

let pass=0;
function test(name,fn){fn();pass++;console.log('PASS:',name)}
test('valid dispatch reduces available finished stock',()=>{
 const x=g.dispatch({requested:20,dispatchQty:12,available:25,expiry:'2030-01-01',today:'2026-11-23'});
 assert.equal(x.ok,true);assert.equal(x.remaining,13);
});
test('cannot ship more than the request',()=>assert.equal(g.dispatch({requested:5,dispatchQty:6,available:20,expiry:'2030-01-01',today:'2026-11-23'}).ok,false));
test('cannot ship more than actual batch stock',()=>assert.equal(g.dispatch({requested:20,dispatchQty:10,available:9,expiry:'2030-01-01',today:'2026-11-23'}).ok,false));
test('expired finished batch is blocked',()=>assert.equal(g.dispatch({requested:10,dispatchQty:5,available:20,expiry:'2026-11-22',today:'2026-11-23'}).ok,false));
test('invalid quantity does not pass as zero',()=>assert.equal(g.dispatch({requested:10,dispatchQty:'',available:20,expiry:'2030-01-01',today:'2026-11-23'}).ok,false));
test('complete receipt increases branch stock only by accepted quantity',()=>{
 const x=g.receipt({sent:20,accepted:18,rejected:2});
 assert.equal(x.ok,true);assert.equal(x.branchIncrease,18);assert.equal(x.rejected,2);
});
test('incomplete receipt reconciliation fails',()=>assert.equal(g.receipt({sent:20,accepted:18,rejected:1}).ok,false));
test('over-receipt fails',()=>assert.equal(g.receipt({sent:20,accepted:21,rejected:0}).ok,false));
test('invalid negative quantities fail',()=>assert.equal(g.receipt({sent:20,accepted:-1,rejected:21}).ok,false));
test('inventory totals are tenant and branch isolated',()=>{
 const rows=[
 {restaurantId:'A',branchId:'central',batchId:'X',delta:20},
 {restaurantId:'A',branchId:'central',batchId:'X',delta:-12},
 {restaurantId:'A',branchId:'branch',batchId:'X',delta:10},
 {restaurantId:'B',branchId:'central',batchId:'X',delta:200}];
 assert.equal(g.balance(rows,{restaurantId:'A',branchId:'central',batchId:'X'}),8);
 assert.equal(g.balance(rows,{restaurantId:'A',branchId:'branch',batchId:'X'}),10);
});
const sql=fs.readFileSync(new URL('../sql/kitch-ready-products-v1.review.sql',import.meta.url),'utf8');
test('migration defines four separate ready-product tables',()=>assert.equal((sql.match(/create table if not exists public\\.kitch_ready_/g)||[]).length,4));
test('migration does not write to raw ingredient inventory',()=>assert.equal(sql.includes('insert into public.inventory_movements'),false));
test('migration blocks duplicate dispatch and receipt using status checks',()=>{
 assert.ok(sql.includes("v_request.status<>'Accepted'"));
 assert.ok(sql.includes("v_request.status<>'In Transfer'"));
});
test('migration has complete authorization and single function body',()=>{
 assert.equal((sql.match(/\\$function\\$;/g)||[]).length,1);
 assert.ok(sql.includes("p_pin !~ '^[0-9]{4}$' then raise exception"));
 assert.ok(sql.includes('enable row level security'));
});
console.log('READY PRODUCTS',pass,'local tests passed; database integration NOT validated.');
