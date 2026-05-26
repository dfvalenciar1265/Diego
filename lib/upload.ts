import { createClient } from '@/lib/supabase/client'

export async function uploadMaintenancePhoto(file: File): Promise<string | null> {
  const supabase = createClient()
  const filename = `maintenance/${Date.now()}-${file.name.replace(/\s/g, '_')}`
  const { error } = await supabase.storage.from('photos').upload(filename, file)
  if (error) return null
  const { data } = supabase.storage.from('photos').getPublicUrl(filename)
  return data.publicUrl
}
