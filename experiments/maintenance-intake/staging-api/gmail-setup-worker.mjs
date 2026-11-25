// BPP isolated staging Worker entry candidate: Gmail-only paths layered
// over existing disabled private maintenance gateway. NOT DEPLOYED.
// Residents cannot access any maintenance routes while
// STAGING_INTAKE_ENABLED stays exactly "false".
// Deploy requires manual review, isolated D1 migrations and secure secrets.
import privateGateway from './private-test-gateway.mjs';
import {routeGmailConnection} from './gmail-connection-routes.mjs';
import {renderGmailSetupPage} from './gmail-setup-page.mjs';
const OAUTH_PATHS=new Set(['/oauth/gmail/session','/oauth/gmail/start','/oauth/gmail/callback']);
const UI_PATHS=new Set(['/oauth/gmail/setup','/oauth/gmail/setup.js']);
const deny=()=>new Response(JSON.stringify({error:'Gmail staging disabled'}),{
 status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
});
export default {
 async fetch(req,env,ctx){
  let path;try{path=new URL(req.url).pathname}catch{return deny()}
  if(OAUTH_PATHS.has(path)||UI_PATHS.has(path)){
   if(env?.STAGING_INTAKE_ENABLED!=='false'||env?.STAGING_GMAIL_OAUTH_ENABLED!=='true')return deny();
   if(UI_PATHS.has(path))return renderGmailSetupPage(req,env);
   return routeGmailConnection(req,env);
  }
  // No new maintenance routes bypass the original synthetic-only private gate.
  return privateGateway.fetch(req,env,ctx);
 }
};
