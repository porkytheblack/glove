"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { checkAuth, logout as apiLogout } from "../hooks/use-api"

interface AuthContextValue {
  authenticated: boolean
  username?: string
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: true,
  logout: async () => {},
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

const LoginCallbackContext = createContext<() => void>(() => {})

export function useLoginCallback(): () => void {
  return useContext(LoginCallbackContext)
}

export function AuthProvider({ children, loginPage }: { children: ReactNode; loginPage: ReactNode }): ReactNode {
  const [state, setState] = useState<"loading" | "ok" | "needs-login">("loading")
  const [username, setUsername] = useState<string | undefined>(undefined)

  useEffect(() => {
    checkAuth()
      .then((r) => {
        if (!r.authRequired || r.authenticated) {
          setState("ok")
          setUsername(r.username)
        } else {
          setState("needs-login")
        }
      })
      .catch(() => {
        // If the server is down, still render the dashboard shell so the
        // user can see error states from each page rather than a blank screen.
        setState("ok")
      })
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setState("needs-login")
    setUsername(undefined)
  }, [])

  const onLoginSuccess = useCallback(() => {
    setState("ok")
  }, [])

  if (state === "loading") return null
  if (state === "needs-login") {
    return <LoginCallbackContext.Provider value={onLoginSuccess}>{loginPage}</LoginCallbackContext.Provider>
  }

  return <AuthContext.Provider value={{ authenticated: true, username, logout }}>{children}</AuthContext.Provider>
}
