"use client"

import { createContext, useContext } from "react"

export interface BreadcrumbSegment {
  label: string
  href?: string
}

interface BreadcrumbCtx {
  segments: BreadcrumbSegment[]
  activeSection: string | null
  setSegments: (s: BreadcrumbSegment[]) => void
  setActiveSection: (s: string | null) => void
}

export const BreadcrumbContext = createContext<BreadcrumbCtx>({
  segments: [],
  activeSection: null,
  setSegments: () => {},
  setActiveSection: () => {},
})

export function useBreadcrumb(): BreadcrumbCtx {
  return useContext(BreadcrumbContext)
}
