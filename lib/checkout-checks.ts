export interface CheckSource {id:string;property_id:string;title:string;status:string;priority:string;fingerprint:string}
export interface CheckStay {id:string;property_id:string;check_in:string;check_out:string}
export interface CheckoutPrompt {id:string;instruction:string;source_snapshot:CheckSource;property_id:string;source_id:string}
export interface CheckoutSkip {id:string;prompt_id:string;stay_snapshot:CheckStay;source_snapshot:CheckSource;reason:string;author:string;created_at:string}
export function sameCheckSource(a:CheckSource,b:CheckSource){return ['id','property_id','title','status','priority','fingerprint'].every(k=>a[k as keyof CheckSource]===b[k as keyof CheckSource])}
export function sameCheckStay(a:CheckStay,b:CheckStay){return ['id','property_id','check_in','check_out'].every(k=>a[k as keyof CheckStay]===b[k as keyof CheckStay])}
export function checkoutPrompts(prompts:CheckoutPrompt[],sources:CheckSource[],skips:CheckoutSkip[],stay:CheckStay){const seen=new Set<string>();return prompts.filter(p=>{if(p.property_id!==stay.property_id||seen.has(p.source_id))return false;seen.add(p.source_id);return true}).flatMap(p=>{
 const source=sources.find(s=>s.id===p.source_id&&s.property_id===stay.property_id&&s.priority!=='scheduled'&&s.status!=='resolved')
 if(!source)return []
 const stale=!sameCheckSource(source,p.source_snapshot)
 const skipped=skips.find(k=>k.prompt_id===p.id&&sameCheckStay(k.stay_snapshot,stay)&&sameCheckSource(k.source_snapshot,source))
 return [{...p,source,stale,skipped}]
})}
