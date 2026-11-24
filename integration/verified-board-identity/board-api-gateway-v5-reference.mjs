// BPP PRIVATE STAGING BOARD API GATE. OFFLINE CANDIDATE, NOT DEPLOYABLE.
// Insert immediately after roleOf(req, env) and the "if (!role)" return,
// before every Board GET or POST handler (not only review()).
// Requires bppVerifiedBoardPrincipal() already present in staging Worker.
export async function requireVerifiedBoardForAllRoutes(req,env,role){
 if(role!=='board')return {allowed:true};
 const principal=await bppVerifiedBoardPrincipal(req,env);
 return principal ? {allowed:true,principal} : {allowed:false,status:403};
}
// Recommended integration inside the staging Worker:
// if(role === 'board' && !await bppVerifiedBoardPrincipal(req,env)) {
//   return encode({error:'Verified Board PIN session required'},403,headers);
// }
// Test all Board READS (list, drafts, updates, policy advice), not only mutations.
// Do NOT enable public intake or live work-order importing in this patch.
