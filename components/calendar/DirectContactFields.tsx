'use client'
import {useEffect,useState} from 'react'
import {getDirectReservationContact} from '@/actions/direct-contact'
/** Se carga aparte: nunca se incorpora a la lista general de reservas ni al equipo. */
export function DirectContactFields({reservationId}:{reservationId?:string}){
 const [contact,setContact]=useState<{forId:string;phone:string;version:number}|null>(reservationId?null:{forId:'new',phone:'',version:0})
 const [error,setError]=useState('')
 const [key,setKey]=useState('')
 useEffect(()=>{let alive=true;async function load(){const requestKey=crypto.randomUUID();if(!reservationId){if(alive)setKey(requestKey);return}const result=await getDirectReservationContact(reservationId);if(!alive)return;if(result.ok){setContact({forId:reservationId,phone:result.phone,version:result.version});setKey(requestKey)}else setError(result.error)}void load().catch(()=>{if(alive)setError('No se pudo cargar el teléfono. No se cambiará al guardar otros datos.')});return()=>{alive=false}},[reservationId])
 const current=contact?.forId===(reservationId??'new')?contact:null
 return <div className="space-y-1"><label htmlFor="direct-guest-phone" className="text-sm font-medium">Teléfono del huésped (opcional)</label>
 <input id="direct-guest-phone" name={current&&key?'guest_phone':undefined} type="tel" value={current?.phone??''} disabled={!current||!key} maxLength={32} placeholder="+57 300 123 4567" onChange={e=>{if(current)setContact({...current,phone:e.target.value})}} className="w-full rounded-lg border p-3 text-sm" />
 {current&&key&&<><input type="hidden" name="contact_version" value={current.version}/><input type="hidden" name="contact_request_key" value={key}/></>}
 <p className="text-xs text-slate-600">Privado para administración. Guardarlo no verifica el número ni activa mensajes automáticos.</p>{error&&<p role="status" className="text-xs text-amber-800">{error}</p>}
 </div>
}
