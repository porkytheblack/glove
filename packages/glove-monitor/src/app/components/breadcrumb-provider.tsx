"use client"

import { useCallback, useState, type ReactNode } from "react"
import { BreadcrumbContext, type BreadcrumbSegment } from "../hooks/use-breadcrumb"

export function BreadcrumbProvider({ children }: { children: ReactNode }): ReactNode {
  const [segments, setSegmentsState] = useState<BreadcrumbSegment[]>([])
  const [activeSection, setActiveSectionState] = useState<string | null>(null)

  const setSegments = useCallback((s: BreadcrumbSegment[]) => setSegmentsState(s), [])
  const setActiveSection = useCallback((s: string | null) => setActiveSectionState(s), [])

  return (
    <BreadcrumbContext.Provider value={{ segments, activeSection, setSegments, setActiveSection }}>
      {children}
    </BreadcrumbContext.Provider>
  )
}
