import{s as d}from"./auth-BpE4TH0M.js";async function p(e,o,i){try{let r=i;(!r||r.length===0)&&(r=await f(e));let t=d.from("nec_articles").select("*");if(r.length>0){const n=r.map(a=>`%${a.toLowerCase()}%`);t=t.or(`keywords.cs.{${r.map(a=>`"${a}"`).join(",")}},title.ilike.%${e}%,description.ilike.%${e}%`)}else t=t.or(`title.ilike.%${e}%,description.ilike.%${e}%`);const{data:l,error:c}=await t.limit(10);if(c)throw console.error("[OHM] Article search error:",c),new Error(`Article search failed: ${c.message}`);let s=[];if(o){const{data:n,error:a}=await d.from("jurisdiction_rules").select("*").eq("jurisdiction",o).limit(5);a?console.error("[OHM] Jurisdiction rules error:",a):s=n||[]}const u=Array.from(new Set((l||[]).flatMap(n=>n.related_articles||[])));return{articles:l||[],rules:s,relatedTopics:u.slice(0,5)}}catch(r){throw console.error("[OHM] searchNECArticles error:",r),r}}async function w(e,o){try{let i=d.from("jurisdiction_rules").select("*").eq("jurisdiction",e);const{data:r,error:t}=await i;if(t)throw console.error("[OHM] getJurisdictionRules error:",t),new Error(`Failed to fetch jurisdiction rules: ${t.message}`);return r||[]}catch(i){throw console.error("[OHM] getJurisdictionRules error:",i),i}}async function f(e){var o,i;try{const r=await fetch("/api/anthropic/v1/messages",{method:"POST",headers:{"x-api-key":"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","anthropic-version":"2023-06-01","content-type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:200,messages:[{role:"user",content:`Extract 3-5 electrical code keywords from this query for NEC article search:
"${e}"

Return ONLY a comma-separated list of keywords (no explanation). Examples: wire sizing, EV charging, solar, grounding, conduit fill`}]})});if(!r.ok)throw new Error(`Claude API error: ${r.statusText}`);return(((i=(o=(await r.json()).content)==null?void 0:o[0])==null?void 0:i.text)??"").split(",").map(s=>s.trim().toLowerCase()).filter(s=>s.length>0).slice(0,5)}catch(r){return console.error("[OHM] extractKeywordsFromQuery error:",r),[]}}function y(e){const o=e.is_california_amendment?" (California Amendment)":"";return`
**NEC ${e.article_number}${o}** — ${e.title}

Section: ${e.section}
${e.excerpt}

Keywords: ${e.keywords.join(", ")}
`.trim()}function h(e){return`
**${e.jurisdiction}** — ${e.rule_category}

Severity: ${e.severity.toUpperCase()}
NEC Article: ${e.nec_article}

${e.rule_text}

Effective: ${e.effective_date}${e.expires_date?` (expires ${e.expires_date})`:""}
`.trim()}export{h as a,y as f,w as g,p as s};
//# sourceMappingURL=codeSearch-7TVa2Yjf.js.map
