// BPP maintenance Gmail authorization: verify exact Google Workspace sender.
// Deliberately separate from the Gmail send-only transport. OAuth connection
// requests basic OpenID identity (openid + email) in addition to gmail.send;
// neither grants permission to read, modify or delete Gmail messages.
const TOKENINFO='https://oauth2.googleapis.com/tokeninfo';
export const EXPECTED_BOARD_SENDER='board@bppcondos.org';
export const EXPECTED_GOOGLE_HOSTED_DOMAIN='bppcondos.org';
export const IDENTIFICATION_SCOPES=Object.freeze(['openid','https://www.googleapis.com/auth/userinfo.email']);
export class GmailSenderIdentityError extends Error{
 constructor(code){super(code);this.name='GmailSenderIdentityError';this.code=code}
}
export async function verifyGoogleBoardIdentity({idToken,clientId,nonce,fetcher=fetch}){
 if(typeof idToken!=='string'||idToken.length<30||idToken.length>20000||
  typeof clientId!=='string'||!clientId.endsWith('.apps.googleusercontent.com')||
  typeof nonce!=='string'||nonce.length<30)
  throw new GmailSenderIdentityError('INVALID_IDENTITY_INPUT');
 let response;
 try{
  response=await fetcher(TOKENINFO,{
   method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({id_token:idToken}),
   signal:AbortSignal.timeout(10000)
  });
 }catch{throw new GmailSenderIdentityError('IDENTITY_VERIFIER_UNAVAILABLE')}
 if(!response?.ok)throw new GmailSenderIdentityError('IDENTITY_NOT_VERIFIED');
 let data;
 try{data=await response.json()}catch{throw new GmailSenderIdentityError('IDENTITY_NOT_VERIFIED')}
 if(!['accounts.google.com','https://accounts.google.com'].includes(data?.iss)||
  data?.aud!==clientId||data?.email?.toLowerCase()!==EXPECTED_BOARD_SENDER||
  data?.email_verified!==true&&data?.email_verified!=='true'||
  data?.hd!==EXPECTED_GOOGLE_HOSTED_DOMAIN||data?.nonce!==nonce||
  !Number.isFinite(Number(data?.exp))||Number(data.exp)<=Math.floor(Date.now()/1000))
  throw new GmailSenderIdentityError('WRONG_OR_UNVERIFIED_WORKSPACE_ACCOUNT');
 return Object.freeze({verified:true,email:EXPECTED_BOARD_SENDER});
}
