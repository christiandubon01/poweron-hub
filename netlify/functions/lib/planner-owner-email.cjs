'use strict';
// Portal lead-alert visual vocabulary from notify-new-lead.ts; no delivery logic here.
const STYLE = {background:'#0f172a',card:'#1e293b',border:'#334155',gold:'#f59e0b',text:'#f8fafc',muted:'#94a3b8'};
const OWNER_APP_URL = 'https://app.poweronsolutionsllc.com/';
const LOGO = 'https://edxxbtyugohtowvslbfo.supabase.co/storage/v1/object/public/brand-assets/ChatGPT%20Image%20Jan%2030,%202026,%2010_40_53%20AM1.png';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function row(label,value) {
  if (!value) return '';
  return `<tr><th scope="row" style="padding:7px 0;border-bottom:1px solid ${STYLE.card};color:${STYLE.muted};font-size:13px;width:36%;vertical-align:top;text-align:left;font-weight:400;">${esc(label)}</th><td style="padding:7px 0;border-bottom:1px solid ${STYLE.card};color:${STYLE.text};font-size:13px;font-weight:600;overflow-wrap:anywhere;word-break:break-word;">${esc(value)}</td></tr>`;
}
function card(title,content) {
  return `<tr><td style="padding:0 20px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${STYLE.background};border:1px solid ${STYLE.border};border-radius:8px;"><tr><td style="padding:16px;"><h2 style="margin:0 0 10px;color:${STYLE.muted};font-size:12px;letter-spacing:.08em;">${title}</h2>${content}</td></tr></table></td></tr>`;
}
function buildPlannerOwnerEmail(event,brand='Power On Solutions') {
  const name = typeof event.name === 'string' && event.name.trim() ? event.name.trim() : 'Customer';
  // Subject is plain text; remove control characters to keep headers readable.
  const subject = `New Panel Planner Lead — ${name.replace(/[\r\n\x00-\x1f\x7f]/g,' ')} | Panel Upgrade`;
  const parsed=new Date(event.created_at);
  const submitted=Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleString('en-US',{
    year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Los_Angeles',timeZoneName:'short'});
  const powerOn=brand==='Power On Solutions' || brand==='Power On Solutions LLC';
  const footer=powerOn ? 'Power On Solutions LLC<br>C-10 License #1151468' : esc(brand);
  const contact=[['Name',name],['Phone',event.phone],['Email',event.email],['Address',event.address],['City',event.city],['Submitted',submitted],['Request ID',event.request_id]];
  const context='A customer submitted a Panel Upgrade Planner request for professional review.';
  const text=['New Panel Planner Lead',context,...contact.filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`),
    'Service: Panel Upgrade','Professional review requested',event.description || '',`Open in Power On Hub → ${OWNER_APP_URL}`,
    powerOn ? 'Power On Solutions LLC\nC-10 License #1151468' : brand,'Automated Panel Planner lead alert'].join('\n');
  const html=`<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New Panel Planner Lead</title></head>
<body style="margin:0;padding:0;background:${STYLE.background};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
<table lang="en" dir="ltr" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${STYLE.background};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:${STYLE.card};border:1px solid ${STYLE.border};border-radius:12px;overflow:hidden;">
<tr><td style="background:${STYLE.gold};padding:6px 12px;text-align:center;color:${STYLE.background};font-size:11px;font-weight:700;letter-spacing:.15em;">${esc(powerOn ? 'POWER ON SOLUTIONS LLC · C-10 LICENSED · CA' : brand)}</td></tr>
<tr><td style="padding:28px 20px 20px;text-align:center;border-bottom:1px solid ${STYLE.border};">
${powerOn ? `<img src="${LOGO}" alt="Power On Solutions LLC" width="240" height="59" style="display:block;margin:0 auto 14px;max-width:100%;height:auto;">` : ''}
<span style="display:inline-block;background:${STYLE.background};color:#4ade80;font-size:11px;font-weight:700;padding:3px 12px;border-radius:12px;border:1px solid #166534;">NEW LEAD</span>
<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:3px 12px;border-radius:12px;border:1px solid #fde68a;">PANEL PLANNER</span>
<h1 style="margin:12px 0 0;font-size:20px;color:${STYLE.text};">New Panel Planner Lead</h1></td></tr>
<tr><td style="padding:20px;"><p style="margin:0;font-size:14px;color:${STYLE.muted};">${context}</p></td></tr>
${card('CONTACT',`<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">${contact.map(([k,v])=>row(k,v)).join('')}</table>`)}
${card('REQUEST',`<p style="margin:0;color:${STYLE.text};font-size:14px;">Service: Panel Upgrade<br>Professional review requested</p>${event.description ? `<p style="margin:10px 0 0;color:#cbd5e1;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${esc(event.description)}</p>` : ''}`)}
<tr><td align="center" style="padding:8px 20px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${STYLE.gold};"><a href="${OWNER_APP_URL}" style="display:inline-block;padding:14px 22px;color:${STYLE.background};font-size:14px;font-weight:700;text-decoration:none;">Open in Power On Hub →</a></td></tr></table></td></tr>
<tr><td style="padding:20px;border-top:1px solid ${STYLE.border};text-align:center;color:${STYLE.muted};font-size:12px;line-height:1.6;">${footer}<br>Automated Panel Planner lead alert</td></tr>
</table></td></tr></table></body></html>`;
  return {subject,text,html};
}
module.exports={buildPlannerOwnerEmail};
