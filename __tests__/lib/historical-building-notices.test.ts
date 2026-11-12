import { describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../helpers/fake-db'
import { buildingView, buildingIds as ids, buildingNotice } from '../helpers/building-notices'
import { noticeSnapshot, noticeDraftLink, currentBuildingObservation } from '@/lib/building-notices'
import { recordHistoricalBuildingNoticeTool, writeBuildingNoticeTool } from '@/lib/gpt-api/building-notices'
const v = buildingView(), snapshot = noticeSnapshot(v, v.recipients[0])
const input = { reservation_id: ids.reservation, recipient_id: ids.recipient, snapshot, expected_version: 0,
  request_key: 'historical-synthetic', status: 'delivered', occurred_at: '2026-11-01T07:30:00-05:00', evidence: 'Comprobante sintético de entrega', reference: 'ref-synthetic-1', confirmed: true }
const observation = { id: ids.notice, reservation_id: ids.reservation, recipient_id: ids.recipient, snapshot, status: 'delivered' as const,
  occurred_at: input.occurred_at, recorded_at: '2026-11-12T12:00:00Z', actor_id: ids.admin, author: 'Admin sintético', evidence: input.evidence,
  reference: input.reference, version: 1, invalidated_at: null }
const actor = {id:ids.admin,via:'app' as const}
function setup(options: {verified?:boolean; saved?:typeof observation | null}={}) {
  const saved=options.saved===undefined?observation:options.saved
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,data:observation},error:null})
  const db=fakeDb({ team_members:[{id:ids.admin,role:'admin',active:true}], reservations:[{...v.reservation}],
    properties:[{id:ids.property,name:v.property,active:true}], building_recipients:[{...v.recipients[0],verified_at:options.verified===false?null:v.recipients[0].verified_at}],
    building_notices:[], building_notice_history:[], tasks:[], building_notice_observations:saved?[saved]:[] },{rpc})
  return {db,rpc}
}
describe('registro histórico de avisos',()=>{
 it('relee la observación sin inventar etapas previas ni enviar',async()=>{
  const {db,rpc}=setup(); const result=await recordHistoricalBuildingNoticeTool(db,input,actor)
  expect(result.ok).toBe(true);expect(rpc).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledWith('record_historical_building_notice',expect.objectContaining({p_input:input,p_actor_id:ids.admin}))
  expect(result.ok && result.data).not.toHaveProperty('sent_at')
 })
 it.each([{confirmed:false},{status:'prepared'},{occurred_at:'2099-01-01T00:00:00Z'},{expected_version:1},{reference:''}])('rechaza hecho inválido %j',async patch=>{
  const {db,rpc}=setup();expect((await recordHistoricalBuildingNoticeTool(db,{...input,...patch},actor)).ok).toBe(false);expect(rpc).not.toHaveBeenCalled()
 })
 it('no verifica candidatos como efecto secundario',async()=>{const {db,rpc}=setup({verified:false});expect((await recordHistoricalBuildingNoticeTool(db,input,actor)).ok).toBe(false);expect(rpc).not.toHaveBeenCalled()})
 it('falla cerrado si la relectura falta o no coincide',async()=>{
  for(const saved of [null,{...observation,version:2},{...observation,snapshot:{...snapshot,guests:9}}]) {
   const {db}=setup({saved});expect((await recordHistoricalBuildingNoticeTool(db,input,actor)).ok).toBe(false)
  }
 })
 it('impide preparar y abrir incluso un borrador existente si hay evidencia vigente',async()=>{
  const view=buildingView({observations:[observation]});expect(noticeDraftLink(view,view.recipients[0],buildingNotice(view))).toBeNull()
  const {db,rpc}=setup();expect((await writeBuildingNoticeTool(db,'prepare',{reservation_id:ids.reservation,recipient_id:ids.recipient,snapshot,request_key:'no-resend'},actor)).ok).toBe(false);expect(rpc).not.toHaveBeenCalled()
 })
 it('mantiene evidencia sin considerarla vigente tras invalidación o cambios',()=>{
  expect(currentBuildingObservation(buildingView({observations:[{...observation,invalidated_at:'2026-11-12T13:00:00Z'}]}),v.recipients[0])).toBeUndefined()
  expect(currentBuildingObservation(buildingView({observations:[{...observation,snapshot:{...snapshot,guests:3}}]}),v.recipients[0])).toBeUndefined()
 })
})
