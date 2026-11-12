/** Una nota no es diagnóstico. El snapshot conserva exactamente la fila leída. */
export interface PreventiveReviewParent {
 id:string;property_id:string;title:string;notes:string;description:string;priority:string;status:string
 [key:string]:unknown
}
export interface PreventiveReview {
 id:string;parent_id:string;corrective_id:string|null;parent_snapshot:PreventiveReviewParent;corrective_snapshot:PreventiveReviewParent|null
 source_reference:string;disposition:'create_report'|'link_existing'|'no_action';reason:string
 report_state:'pending_verification'|null;actor_id:string;author:string;recorded_at:string;version:number
}
