// BPP staging maintenance: encrypted server-side Gmail refresh-token vault.
// Never mount this module directly on a public route. Token key is a
// high-entropy 256-bit base64url CLOUDFLARE SECRET, not in source or D1.
// A verified admin OAuth handler must independently authorize saving tokens.
// Decrypt only within trusted server-side Gmail sending/refreshing work.
const SENDER='board@bppcondos.org';
const to64=bytes=>{
 let s='';for(const x of bytes)s+=String.fromCharCode(x);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const from64=value=>{
 if(typeof value!=='string'||!/^[a-zA-Z0-9_-]+$/.test(value))throw Error('Vault format invalid');
 const fixed=value.replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(fixed+'='.repeat((4-fixed.length%4)%4)),x=>x.charCodeAt(0));
};
async function keyOf(secret){
 const bytes=from64(secret);
 if(bytes.length!==32)throw Error('Invalid vault secret length');
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function check(db,now,keyVersion){
 if(!db?.prepare||!Number.isSafeInteger(now)||now<1||
  typeof keyVersion!=='string'||!/^[a-z0-9_-]{1,40}$/.test(keyVersion))
  throw Error('Vault unavailable');
}
export async function saveBoardRefreshToken({
 db,refreshToken,vaultSecret,keyVersion='v1',now=Date.now()
}){
 check(db,now,keyVersion);
 if(typeof refreshToken!=='string'||refreshToken.length<10||refreshToken.length>16384)
  throw Error('OAuth refresh token missing or oversized');
 const key=await keyOf(vaultSecret),iv=crypto.getRandomValues(new Uint8Array(12));
 const content=new TextEncoder().encode(refreshToken);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(SENDER)},key,content);
 const result=await db.prepare(
  "INSERT INTO gmail_sender_vault(sender_email,ciphertext,iv,key_version,authorized_at,token_version) "+
  "VALUES(?,?,?,?,?,1) ON CONFLICT(sender_email) DO UPDATE SET "+
  "ciphertext=excluded.ciphertext,iv=excluded.iv,key_version=excluded.key_version,"+
  "authorized_at=excluded.authorized_at,token_version=token_version+1"
 ).bind(SENDER,to64(new Uint8Array(cipher)),to64(iv),keyVersion,now).run();
 if(Number(result?.meta?.changes||0)!==1)throw Error('Vault write failed');
 return Object.freeze({ok:true,sender:SENDER,tokenStored:true});
}
export async function loadBoardRefreshToken({
 db,vaultSecret,keyVersion='v1'
}){
 check(db,Date.now(),keyVersion);
 const row=await db.prepare('SELECT ciphertext,iv,key_version FROM gmail_sender_vault WHERE sender_email=?')
  .bind(SENDER).first();
 if(!row)throw Error('Board Gmail not connected');
 if(row.key_version!==keyVersion)throw Error('Vault key rotation required');
 const iv=from64(row.iv),cipher=from64(row.ciphertext);
 if(iv.length!==12||cipher.length<17)throw Error('Vault format invalid');
 try{
  const key=await keyOf(vaultSecret);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(SENDER)},key,cipher);
  const refreshToken=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  if(refreshToken.length<10||refreshToken.length>16384)throw Error();
  return refreshToken;
 }catch{throw Error('Vault decryption failed')}
}
export const designatedGmailSender=SENDER;
