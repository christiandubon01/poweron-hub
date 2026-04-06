import{s as u}from"./index-CtQ1n1r3.js";async function h(e,n,r){try{let t=r;(!t||t.length===0)&&(t=await f(e));let o=u.from("nec_articles").select("*");if(t.length>0){const l=t.map(d=>`%${d.toLowerCase()}%`);o=o.or(`keywords.cs.{${t.map(d=>`"${d}"`).join(",")}},title.ilike.%${e}%,description.ilike.%${e}%`)}else o=o.or(`title.ilike.%${e}%,description.ilike.%${e}%`);const{data:s,error:a}=await o.limit(10);if(a)throw console.error("[OHM] Article search error:",a),new Error(`Article search failed: ${a.message}`);let i=[];if(n){const{data:l,error:d}=await u.from("jurisdiction_rules").select("*").eq("jurisdiction",n).limit(5);d?console.error("[OHM] Jurisdiction rules error:",d):i=l||[]}const c=Array.from(new Set((s||[]).flatMap(l=>l.related_articles||[])));return{articles:s||[],rules:i,relatedTopics:c.slice(0,5)}}catch(t){throw console.error("[OHM] searchNECArticles error:",t),t}}async function p(e,n){try{let r=u.from("jurisdiction_rules").select("*").eq("jurisdiction",e);const{data:t,error:o}=await r;if(o)throw console.error("[OHM] getJurisdictionRules error:",o),new Error(`Failed to fetch jurisdiction rules: ${o.message}`);return t||[]}catch(r){throw console.error("[OHM] getJurisdictionRules error:",r),r}}async function f(e){var n,r;try{const t={messages:[{role:"user",content:`Extract 3-5 electrical code keywords from this query for NEC article search:
"${e}"

Return ONLY a comma-separated list of keywords (no explanation). Examples: wire sizing, EV charging, solar, grounding, conduit fill`}],max_tokens:200};console.log("[OHM] extractKeywordsFromQuery → POST /.netlify/functions/claude",JSON.stringify(t));const o=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(t)});if(!o.ok){const c=await o.text().catch(()=>"(unreadable)");throw console.error("[OHM] extractKeywordsFromQuery proxy non-200:",o.status,o.statusText,"— body:",c),new Error(`Claude proxy error (${o.status}): ${c.slice(0,200)}`)}return(((r=(n=(await o.json()).content)==null?void 0:n[0])==null?void 0:r.text)??"").split(",").map(c=>c.trim().toLowerCase()).filter(c=>c.length>0).slice(0,5)}catch(t){return console.error("[OHM] extractKeywordsFromQuery error:",t),[]}}function _(e){const n=e.is_california_amendment?" (California Amendment)":"";return`
**NEC ${e.article_number}${n}** — ${e.title}

Section: ${e.section}
${e.excerpt}

Keywords: ${e.keywords.join(", ")}
`.trim()}function $(e){return`
**${e.jurisdiction}** — ${e.rule_category}

Severity: ${e.severity.toUpperCase()}
NEC Article: ${e.nec_article}

${e.rule_text}

Effective: ${e.effective_date}${e.expires_date?` (expires ${e.expires_date})`:""}
`.trim()}function w(e){const n=e.toLowerCase(),r=new Set(["what","is","are","the","a","an","for","in","to","of","on","at","with","how","do","i","we","should","can","does","need","my","our","this","that","and","or","but","if","when","where","which","who","would","will","be"]);return n.replace(/[^a-z0-9\s-]/g," ").split(/\s+/).filter(t=>t.length>2&&!r.has(t))}function m(e,n){if(!e.tags||e.tags.length===0||n.length===0)return 0;const r=new Set(e.tags.map(s=>s.toLowerCase())),t=e.scenario.toLowerCase();let o=0;for(const s of n)r.has(s)?o+=1:[...r].some(a=>a.includes(s)||s.includes(a))&&(o+=.5),t.includes(s)&&(o+=.3);return Math.min(o/n.length,1)}async function y(e,n,r=3,t=.2){try{const{data:o,error:s}=await u.from("trade_knowledge").select("*").or(`org_id.is.null,org_id.eq.${n}`).order("created_at",{ascending:!1});if(s)return console.warn("[TradeKnowledge] Query failed:",s.message),[];const a=o||[],i=w(e);return i.length===0?[]:a.map(l=>({entry:l,relevance:m(l,i)})).filter(l=>l.relevance>=t).sort((l,d)=>d.relevance-l.relevance).slice(0,r)}catch(o){return console.warn("[TradeKnowledge] Unexpected error:",o),[]}}function x(e){return e.length===0?"":`## Trade Knowledge Base
Beyond code compliance, experienced contractors note:

${e.map(({entry:r})=>{const t=[`**${r.scenario}**`];if(r.code_answer&&t.push(`Code: ${r.code_answer}`),r.field_answer&&t.push(`Field judgment: ${r.field_answer}`),r.failure_modes&&t.push(`Failure modes: ${r.failure_modes}`),r.material_options&&Array.isArray(r.material_options)&&r.material_options.length>0){const o=r.material_options.map(s=>`  - ${Object.entries(s).map(([i,c])=>`${i}: ${c}`).join(" | ")}`).join(`
`);t.push(`Material options:
${o}`)}return r.owner_notes&&t.push(`Owner field note: ${r.owner_notes}`),t.join(`
`)}).join(`

---

`)}`}async function T(e,n,r){try{const{data:t}=await u.from("trade_knowledge").select("owner_notes").eq("id",e).single(),s=`[${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}] ${n.trim()}`,a=t!=null&&t.owner_notes?`${t.owner_notes}

${s}`:s,{error:i}=await u.from("trade_knowledge").update({owner_notes:a}).eq("id",e);return i?(console.error("[TradeKnowledge] Save note failed:",i.message),!1):!0}catch(t){return console.error("[TradeKnowledge] Save note error:",t),!1}}async function k(e,n){try{const{data:r,error:t}=await u.from("trade_knowledge").insert({...e,org_id:n,source:"owner"}).select("id").single();return t?(console.error("[TradeKnowledge] Create failed:",t.message),null):(r==null?void 0:r.id)??null}catch(r){return console.error("[TradeKnowledge] Create error:",r),null}}async function C(e){try{const{data:n,error:r}=await u.from("trade_knowledge").select("*").or(`org_id.is.null,org_id.eq.${e}`).order("created_at",{ascending:!1});return r?(console.warn("[TradeKnowledge] Fetch all failed:",r.message),[]):n||[]}catch(n){return console.warn("[TradeKnowledge] Fetch all error:",n),[]}}export{T as a,p as b,k as c,_ as d,$ as e,x as f,C as g,y as q,h as s};
//# sourceMappingURL=tradeKnowledgeService-B2kY9FIE.js.map
