import{s as d}from"./index-mXN9BgJK.js";async function h(e,o,t){try{let r=t;(!r||r.length===0)&&(r=await f(e));let n=d.from("nec_articles").select("*");if(r.length>0){const c=r.map(l=>`%${l.toLowerCase()}%`);n=n.or(`keywords.cs.{${r.map(l=>`"${l}"`).join(",")}},title.ilike.%${e}%,description.ilike.%${e}%`)}else n=n.or(`title.ilike.%${e}%,description.ilike.%${e}%`);const{data:s,error:i}=await n.limit(10);if(i)throw console.error("[OHM] Article search error:",i),new Error(`Article search failed: ${i.message}`);let a=[];if(o){const{data:c,error:l}=await d.from("jurisdiction_rules").select("*").eq("jurisdiction",o).limit(5);l?console.error("[OHM] Jurisdiction rules error:",l):a=c||[]}const u=Array.from(new Set((s||[]).flatMap(c=>c.related_articles||[])));return{articles:s||[],rules:a,relatedTopics:u.slice(0,5)}}catch(r){throw console.error("[OHM] searchNECArticles error:",r),r}}async function p(e,o){try{let t=d.from("jurisdiction_rules").select("*").eq("jurisdiction",e);const{data:r,error:n}=await t;if(n)throw console.error("[OHM] getJurisdictionRules error:",n),new Error(`Failed to fetch jurisdiction rules: ${n.message}`);return r||[]}catch(t){throw console.error("[OHM] getJurisdictionRules error:",t),t}}async function f(e){var o,t;try{const r=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:200,messages:[{role:"user",content:`Extract 3-5 electrical code keywords from this query for NEC article search:
"${e}"

Return ONLY a comma-separated list of keywords (no explanation). Examples: wire sizing, EV charging, solar, grounding, conduit fill`}]})});if(!r.ok)throw new Error(`Claude API error: ${r.statusText}`);return(((t=(o=(await r.json()).content)==null?void 0:o[0])==null?void 0:t.text)??"").split(",").map(a=>a.trim().toLowerCase()).filter(a=>a.length>0).slice(0,5)}catch(r){return console.error("[OHM] extractKeywordsFromQuery error:",r),[]}}function _(e){const o=e.is_california_amendment?" (California Amendment)":"";return`
**NEC ${e.article_number}${o}** — ${e.title}

Section: ${e.section}
${e.excerpt}

Keywords: ${e.keywords.join(", ")}
`.trim()}function $(e){return`
**${e.jurisdiction}** — ${e.rule_category}

Severity: ${e.severity.toUpperCase()}
NEC Article: ${e.nec_article}

${e.rule_text}

Effective: ${e.effective_date}${e.expires_date?` (expires ${e.expires_date})`:""}
`.trim()}function w(e){const o=e.toLowerCase(),t=new Set(["what","is","are","the","a","an","for","in","to","of","on","at","with","how","do","i","we","should","can","does","need","my","our","this","that","and","or","but","if","when","where","which","who","would","will","be"]);return o.replace(/[^a-z0-9\s-]/g," ").split(/\s+/).filter(r=>r.length>2&&!t.has(r))}function m(e,o){if(!e.tags||e.tags.length===0||o.length===0)return 0;const t=new Set(e.tags.map(s=>s.toLowerCase())),r=e.scenario.toLowerCase();let n=0;for(const s of o)t.has(s)?n+=1:[...t].some(i=>i.includes(s)||s.includes(i))&&(n+=.5),r.includes(s)&&(n+=.3);return Math.min(n/o.length,1)}async function y(e,o,t=3,r=.2){try{const{data:n,error:s}=await d.from("trade_knowledge").select("*").or(`org_id.is.null,org_id.eq.${o}`).order("created_at",{ascending:!1});if(s)return console.warn("[TradeKnowledge] Query failed:",s.message),[];const i=n||[],a=w(e);return a.length===0?[]:i.map(c=>({entry:c,relevance:m(c,a)})).filter(c=>c.relevance>=r).sort((c,l)=>l.relevance-c.relevance).slice(0,t)}catch(n){return console.warn("[TradeKnowledge] Unexpected error:",n),[]}}function k(e){return e.length===0?"":`## Trade Knowledge Base
Beyond code compliance, experienced contractors note:

${e.map(({entry:t})=>{const r=[`**${t.scenario}**`];if(t.code_answer&&r.push(`Code: ${t.code_answer}`),t.field_answer&&r.push(`Field judgment: ${t.field_answer}`),t.failure_modes&&r.push(`Failure modes: ${t.failure_modes}`),t.material_options&&Array.isArray(t.material_options)&&t.material_options.length>0){const n=t.material_options.map(s=>`  - ${Object.entries(s).map(([a,u])=>`${a}: ${u}`).join(" | ")}`).join(`
`);r.push(`Material options:
${n}`)}return t.owner_notes&&r.push(`Owner field note: ${t.owner_notes}`),r.join(`
`)}).join(`

---

`)}`}async function C(e,o,t){try{const{data:r}=await d.from("trade_knowledge").select("owner_notes").eq("id",e).single(),s=`[${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}] ${o.trim()}`,i=r!=null&&r.owner_notes?`${r.owner_notes}

${s}`:s,{error:a}=await d.from("trade_knowledge").update({owner_notes:i}).eq("id",e);return a?(console.error("[TradeKnowledge] Save note failed:",a.message),!1):!0}catch(r){return console.error("[TradeKnowledge] Save note error:",r),!1}}async function T(e,o){try{const{data:t,error:r}=await d.from("trade_knowledge").insert({...e,org_id:o,source:"owner"}).select("id").single();return r?(console.error("[TradeKnowledge] Create failed:",r.message),null):(t==null?void 0:t.id)??null}catch(t){return console.error("[TradeKnowledge] Create error:",t),null}}async function x(e){try{const{data:o,error:t}=await d.from("trade_knowledge").select("*").or(`org_id.is.null,org_id.eq.${e}`).order("created_at",{ascending:!1});return t?(console.warn("[TradeKnowledge] Fetch all failed:",t.message),[]):o||[]}catch(o){return console.warn("[TradeKnowledge] Fetch all error:",o),[]}}export{C as a,p as b,T as c,_ as d,$ as e,k as f,x as g,y as q,h as s};
//# sourceMappingURL=tradeKnowledgeService-BxMiXzFp.js.map
