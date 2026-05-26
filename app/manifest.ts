import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AirAdmin',
    short_name: 'AirAdmin',
    description: 'Gestión de apartamentos Airbnb',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#ff385c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
