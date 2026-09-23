const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('citation helper removes mixed-case and adjacent internal references',()=>{
  const src=fs.readFileSync(require.resolve('./librechat'),'utf8');
  const start=src.indexOf('function stripCitationAnchors(');
  const end=src.indexOf('\n}',start)+2;
  const ctx={};vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
  const text=ctx.stripCitationAnchors('%%%warm%%% Open at nine. Turn0local0turn1search2 TURN9TECH3');
  assert.doesNotMatch(text,/turn\d+/i);assert.match(text,/%%%warm%%%/);
});
