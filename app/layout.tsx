import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AirAdmin',
  description: 'Gestión de apartamentos Airbnb',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AirAdmin' },
}

export const viewport: Viewport = {
  themeColor: '#ff385c',
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays enabled (accessibility); iOS input auto-zoom is avoided with 16px inputs
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
