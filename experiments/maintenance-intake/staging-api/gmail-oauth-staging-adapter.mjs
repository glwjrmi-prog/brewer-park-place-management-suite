// BPP maintenance: composition of *isolated* OAuth handler and encrypted D1 vault.
// This is NOT a public Worker entrypoint. No Cloudflare deployment or Google
// authorization occurs by importing this module. Every call requires a
// separately verified admin identity and CSRF check supplied by trusted code.
// The existing STAGING_INTAKE_ENABLED must remain exactly "false".
import {handleGmailAdminOAuth} from './gmail-oauth-admin-http.mjs';
import {saveBoardRefreshToken} from './gmail-vault.mjs';
export async function handleIsolatedGmailSetup(request,env,{
 isVerifiedAdmin,getAdminSession,hasValidCsrf,returnAuthorizationJson=false,fetcher=fetch,now=Date.now()
}={}){
 if(!env?.GMAIL_VAULT_KEY||!env?.INTAKE_DB||
  env?.STAGING_INTAKE_ENABLED!=='false'||env?.STAGING_GMAIL_OAUTH_ENABLED!=='true')
  return new Response('Gmail setup disabled',{status:503,headers:{
   'cache-control':'no-store','content-type':'text/plain; charset=utf-8'
  }});
 const vaultSecret=env.GMAIL_VAULT_KEY;
 return handleGmailAdminOAuth(request,env,{
  isVerifiedAdmin,getAdminSession,hasValidCsrf,returnAuthorizationJson,fetcher,now,
  async saveRefreshToken({refreshToken,scope}){
   if(scope!=='https://www.googleapis.com/auth/gmail.send')throw Error('Unexpected OAuth scope');
   await saveBoardRefreshToken({
    db:env.INTAKE_DB,refreshToken,vaultSecret,keyVersion:String(env.GMAIL_VAULT_KEY_VERSION||'v1'),now
   });
  }
 });
}
