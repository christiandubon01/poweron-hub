'use strict';
const {runtime}=require('./planner-runtime.cjs');
async function runMaintenance({env=process.env,backend=runtime(env),fetcher=fetch,onStage=()=>{}}={}) {
  onStage('orphan_discovery');
  const paths=await backend.rpc('panel_planner_orphan_paths',{});
  onStage('orphan_cleanup');
  await backend.remove(paths);
  onStage('technical_expiry');
  const expired=await backend.rpc('panel_planner_expire_technical_data',{});
  onStage('notification_claim');
  const events=await backend.rpc('claim_panel_planner_notifications',{});
  const counts={orphans_removed:paths.length,technical_records_expired:expired,sent:0,failed:0,uncertain:0};
  for(const event of events) {
    onStage('notification_delivery');
    let state='failed', messageId=null;
    try {
      if(!env.RESEND_API_KEY || !env.PANEL_PLANNER_FROM_EMAIL)throw new Error('configuration');
      const owner=event.event_type==='owner_new_request';
      // Trusted per-site recipient. PANEL_PLANNER_OWNER_EMAIL is a TEMPORARY fallback honored only for the
      // legacy Power On integration (owner_email_fallback_allowed); other sites never use it.
      const recipient=owner ? (event.owner_email || (event.owner_email_fallback_allowed ? env.PANEL_PLANNER_OWNER_EMAIL : null)) : event.email;
      if(!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw new Error('configuration');
      const tracking=(event.tracking_base_url||'https://app.poweronsolutionsllc.com')+'/portal/track/'+event.request_id;
      const brand=event.display_name||event.site_label||'your service provider';
      const proposed={
        from:env.PANEL_PLANNER_FROM_EMAIL,to:[recipient],
        subject:owner ? 'New Panel Planner service request' : 'We received your request — '+brand,
        text:owner ? ['New Panel Planner request',event.request_id,event.name,event.phone||'',event.email||'',
          event.address||'',event.city||'',event.description||'',tracking].join('\n') :
          ['Hi '+event.name+',','Your service request is saved.',tracking,
            'Optional photo delivery is tracked separately.',brand].join('\n')
      };
      // Freeze exact provider payload before first attempt; config/contact changes cannot alter replays.
      const payload=await backend.rpc('prepare_panel_planner_notification',{
        p_id:event.id,p_claim_token:event.claim_token,p_delivery_payload:proposed});
      let response;
      try {
        response=await fetcher('https://api.resend.com/emails',{method:'POST',
          headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json',
            'Idempotency-Key':'panel-planner/'+event.request_id+'/'+event.event_type},
          body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
      } catch {
        // Leave claimed/sending: reclaim within 23h with the SAME provider payload/key.
        counts.uncertain++;continue;
      }
      const data=await response.json().catch(()=>null);
      if(response.ok && data?.id){state='sent';messageId=data.id;}
      else if(response.status>=500 || response.status===429 ||
          (response.status===409 && data?.name==='concurrent_idempotent_requests')){
        counts.uncertain++;continue;
      }
    } catch { state='failed'; }
    await backend.rpc('complete_panel_planner_notification',{
      p_id:event.id,p_claim_token:event.claim_token,p_state:state,p_message_id:messageId});
    counts[state]++;
  }
  return counts;
}
module.exports={runMaintenance};
