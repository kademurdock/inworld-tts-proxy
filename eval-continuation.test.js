const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./librechat'), 'utf8');
function harness() {
  const requests = [];
  const seat = { user: () => 'test@example.invalid' };
  const context = { process: { env: {} }, console: { log() {} }, TextDecoder,
    BASE: 'https://test.invalid', UA: 'browser', SEATS: { admin: {} },
    seatByName: () => seat, seatToken: () => 'test-token', paced: fn => fn(),
    setTimeout: fn => fn(), stripCitationAnchors: s => s,
    messageText: m => m?.text || '',
    fetch: async (url, opts) => {
      if (opts.method === 'POST') {
        requests.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({streamId: 'stream', conversationId:'conversation'}) };
      }
      return { ok: true, body: (async function* () {
        yield new TextEncoder().encode('data: '+JSON.stringify({ final:true,
          responseMessage:{text:'A whole reply',messageId:'reply-id',conversationId:'conversation'}})+'\n');
      })() };
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const TRANSCRIPT_TURNS'),source.indexOf('// POST /librechat/ask  {')),context);
  return { context, requests };
}
test('real continuation posts only the latest text with exact parent and conversation IDs', async () => {
  const {context, requests}=harness();
  const result=await context.lcAsk('kiana',[{role:'user',content:'old question'},{role:'assistant',content:'old answer'},{role:'user',content:'follow up'}],null,
    {seat:'evalfixture',continueConversation:true,conversationId:'conversation',parentMessageId:'previous-reply'});
  assert.equal(requests[0].text,'follow up');
  assert.equal(requests[0].conversationId,'conversation');
  assert.equal(requests[0].parentMessageId,'previous-reply');
  assert.equal(result.parentMessageId,'reply-id');
  assert.equal(result.conversationId,'conversation');
  assert.equal(result.text,'A whole reply');
});
test('existing voice and one-shot callers retain transcript folding and string response', async () => {
  const {context, requests}=harness();
  const result=await context.lcAsk('kiana',[{role:'user',content:'old question'},{role:'user',content:'follow up'}]);
  assert.match(requests[0].text,/EARLIER IN THIS CONVERSATION/);
  assert.equal(requests[0].conversationId,'new');
  assert.equal(result,'A whole reply');
});
