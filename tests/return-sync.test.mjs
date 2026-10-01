import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('return sync handles pending refunds, tax inclusive lines, complete pagination and incremental updates deterministically',()=>{
 const output=execFileSync('python3',['-c',`import sys,json
sys.path.insert(0,'scripts')
from sync_returns import normalize
raw={'synced_at':'2026-10-01T12:00:00Z','complete':True,'orders':[{'name':'#1','createdAt':'2026-09-01T12:00:00Z','cancelledAt':None,'test':False,'taxesIncluded':True,'totalPriceSet':{'shopMoney':{'amount':'121'}},'refunds':[{'id':'r1','createdAt':'2026-09-15T12:00:00Z','note':'RETURN_RECEIVED','totalRefundedSet':{'shopMoney':{'amount':'0'}},'refundLineItems':{'nodes':[{'quantity':2,'restockType':'NO_RESTOCK','subtotalSet':{'shopMoney':{'amount':'121'}},'totalTaxSet':{'shopMoney':{'amount':'21'}}}],'pageInfo':{'hasNextPage':False}}}]}]}
a=normalize(raw);assert a['corrections'][0]['refunded_incl']==121;assert a['corrections'][0]['received_packages']==1;assert a['corrections'][0]['refund_status']=='pending'
b=normalize({'synced_at':raw['synced_at'],'complete':True,'orders':[]},a);assert b['orders']==a['orders']
raw['orders'][0]['refunds'][0]['refundLineItems']['pageInfo']['hasNextPage']=True
try:normalize(raw);raise AssertionError('accepted incomplete rows')
except ValueError:pass
print('OK')`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(output.trim(),'OK');
});
