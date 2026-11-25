import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {saveBoardRefreshToken,loadBoardRefreshToken,designatedGmailSender} from './gmail-vault.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('./gmail-vault.schema.sql',import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({bind(...v){return stmt(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){let r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 return {sqlite,db:{prepare:sql=>stmt(sql)},close:()=>sqlite.close()};
}
const key=()=>Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
test('refresh token encrypted at rest, only board@ mailbox, never returned from save',async()=>{
 const t=sandbox();try{
  const vaultSecret=key(),refreshToken='opaque-Google-refresh-token-12345';
  const ack=await saveBoardRefreshToken({db:t.db,vaultSecret,refreshToken,now:1000000});
  assert.deepEqual(ack,{ok:true,sender:designatedGmailSender,tokenStored:true});
  const row=t.sqlite.prepare('SELECT * FROM gmail_sender_vault').get();
  assert.equal(row.sender_email,'board@bppcondos.org');
  assert.equal(row.ciphertext.includes(refreshToken),false);
  assert.equal(row.iv.length>12,true);
  assert.equal(JSON.stringify(row).includes(refreshToken),false);
  assert.equal(await loadBoardRefreshToken({db:t.db,vaultSecret}),refreshToken);
  assert.equal(Object.prototype.hasOwnProperty.call(ack,'refreshToken'),false);
 }finally{t.close()}
});
test('wrong key, tampered ciphertext, and key version mismatch fail closed',async()=>{
 const t=sandbox();try{
  const vaultSecret=key();
  await saveBoardRefreshToken({db:t.db,vaultSecret,refreshToken:'opaque-Google-refresh-token-12345',now:1000000});
  await assert.rejects(()=>loadBoardRefreshToken({db:t.db,vaultSecret:key()}),/Vault decryption failed/);
  await assert.rejects(()=>loadBoardRefreshToken({db:t.db,vaultSecret,keyVersion:'v2'}),/rotation required/);
  t.sqlite.prepare("UPDATE gmail_sender_vault SET ciphertext=? WHERE sender_email=?").run('abcdefgh','board@bppcondos.org');
  await assert.rejects(()=>loadBoardRefreshToken({db:t.db,vaultSecret}),/Vault (format invalid|decryption failed)/);
 }finally{t.close()}
});
test('reauthorization rotates nonce/ciphertext without storing prior Google token',async()=>{
 const t=sandbox();try{
  const vaultSecret=key();
  await saveBoardRefreshToken({db:t.db,vaultSecret,refreshToken:'opaque-old-refresh-token-12345',now:1000000});
  const first=t.sqlite.prepare('SELECT ciphertext,iv FROM gmail_sender_vault').get();
  await saveBoardRefreshToken({db:t.db,vaultSecret,refreshToken:'opaque-new-refresh-token-54321',now:1000001});
  const second=t.sqlite.prepare('SELECT ciphertext,iv,token_version FROM gmail_sender_vault').get();
  assert.notEqual(first.ciphertext,second.ciphertext);
  assert.notEqual(first.iv,second.iv);
  assert.equal(second.token_version,2);
  assert.equal(await loadBoardRefreshToken({db:t.db,vaultSecret}),'opaque-new-refresh-token-54321');
 }finally{t.close()}
});
test('does not accept plaintext vault secrets or missing database',async()=>{
 const t=sandbox();try{
  await assert.rejects(()=>saveBoardRefreshToken({db:t.db,vaultSecret:'human-readable-password',refreshToken:'token-123456789',now:1000000}));
  await assert.rejects(()=>loadBoardRefreshToken({db:t.db,vaultSecret:key()}),/not connected/);
  await assert.rejects(()=>saveBoardRefreshToken({db:null,vaultSecret:key(),refreshToken:'token-123456789',now:1000000}));
 }finally{t.close()}
});
