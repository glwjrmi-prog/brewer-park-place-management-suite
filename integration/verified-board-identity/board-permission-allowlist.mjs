// BPP non-deployed permission helper. Never trust caller-supplied roles.
const ID=/^usr-[a-zA-Z0-9._~-]{8,128}$/;
export function authorizedReviewer(user,configuredIds=''){
 const ids=String(configuredIds).split(',').map(x=>x.trim()).filter(Boolean);
 if(ids.some(x=>!ID.test(x)))return false;
 if(!user||!ID.test(user.id||''))return false;
 return user.role==='admin'||(user.role==='user'&&ids.includes(user.id));
}
