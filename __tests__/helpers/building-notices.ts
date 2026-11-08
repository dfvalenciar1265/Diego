import { noticeSnapshot, type BuildingNotice, type BuildingNoticeView, type BuildingRecipient } from '@/lib/building-notices'
export const buildingIds = {
  admin: '10000000-0000-4000-8000-000000000001', property: '10000000-0000-4000-8000-000000000002',
  reservation: '10000000-0000-4000-8000-000000000003', recipient: '10000000-0000-4000-8000-000000000004',
  notice: '10000000-0000-4000-8000-000000000005',
}
export function buildingRecipient(patch: Partial<BuildingRecipient> = {}): BuildingRecipient {
  return { id: buildingIds.recipient, property_id: buildingIds.property, channel: 'email', address: 'porter-sintetico@example.test',
    version: 1, verified_at: '2026-11-08T12:00:00Z', verified_by: buildingIds.admin,
    verification_evidence: 'Contacto verificado Sintético', ...patch }
}
export function buildingView(patch: Partial<BuildingNoticeView> = {}): BuildingNoticeView {
  return { reservation: { id: buildingIds.reservation, property_id: buildingIds.property, guest_name: 'Titular Sintético', guests: 2,
    check_in: '2026-11-08', check_out: '2026-11-10', status: 'confirmed' }, property: 'Apartamento Sintético',
    recipients: [buildingRecipient()], notices: [], history: [], legacy_marks: [], blockers: [], ...patch }
}
export function buildingNotice(view = buildingView(), patch: Partial<BuildingNotice> = {}): BuildingNotice {
  return { id: buildingIds.notice, reservation_id: buildingIds.reservation, recipient_id: buildingIds.recipient,
    content_version: 1, snapshot: noticeSnapshot(view, view.recipients[0]), status: 'prepared', version: 1,
    created_at: '2026-11-08T13:00:00Z', sent_at: null, delivered_at: null, received_at: null, review_reason: null, ...patch }
}
