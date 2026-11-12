import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({member:vi.fn(),client:vi.fn(),read:vi.fn(),write:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/auth',()=>({getCurrentMember:m.member}))
vi.mock('@/lib/supabase/server',()=>({createClient:m.client}))
vi.mock('@/lib/gpt-api/preventive-review',()=>({listPreventiveReviews:m.read,savePreventiveReview:m.write}))
vi.mock('next/cache',()=>({revalidatePath:m.revalidate}))
import {getPreventiveReviews,recordPreventiveReview} from '@/actions/preventive-review'
beforeEach(()=>{vi.clearAllMocks();m.client.mockResolvedValue({synthetic:true});m.member.mockResolvedValue({id:'admin-synthetic',role:'admin'})})
it('deriva actor sesión y revalida solo escritura confirmada',async()=>{m.write.mockResolvedValue({ok:true,data:{}});await getPreventiveReviews();expect(m.read).toHaveBeenCalledWith({synthetic:true},{id:'admin-synthetic',via:'app'});await recordPreventiveReview({confirmed:true});expect(m.write).toHaveBeenCalledWith({synthetic:true},{id:'admin-synthetic',via:'app'},{confirmed:true});expect(m.revalidate).toHaveBeenCalledWith('/maintenance/review')})
it('no inventa sesión ni revalida fracaso',async()=>{m.member.mockResolvedValue(null);m.write.mockResolvedValue({ok:false,error:'Sin sesión'});await recordPreventiveReview({});expect(m.write).toHaveBeenCalledWith({synthetic:true},null,{});expect(m.revalidate).not.toHaveBeenCalled()})
