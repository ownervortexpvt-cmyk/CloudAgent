'use client'

/**
 * /dashboard has never been a real route — the builder lives at `/`.
 * Users (and bookmarks) still type it, so redirect instead of 404.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/') }, [router])
  return null
}
