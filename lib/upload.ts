import { createClient } from '@/lib/supabase/client'

/** Uploads a photo to the public `photos` bucket under `folder/` and returns its URL. */
async function uploadPhoto(file: File, folder: string): Promise<string | null> {
  const supabase = createClient()
  const filename = `${folder}/${Date.now()}-${file.name.replace(/\s/g, '_')}`
  const { error } = await supabase.storage.from('photos').upload(filename, file)
  if (error) return null
  const { data } = supabase.storage.from('photos').getPublicUrl(filename)
  return data.publicUrl
}

export function uploadMaintenancePhoto(file: File): Promise<string | null> {
  return uploadPhoto(file, 'maintenance')
}

/** Proof-of-clean photo taken by staff when finishing a cleaning task. */
export function uploadCleaningPhoto(file: File): Promise<string | null> {
  return uploadPhoto(file, 'cleaning')
}
