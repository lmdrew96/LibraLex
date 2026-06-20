"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

// Promise-based replacement for the native window.confirm(): `await confirm({…})`
// resolves true on confirm and false on cancel/dismiss, so an existing
// `if (!(await confirm(...))) return` guard reads just like the old one — but in
// the themed Radix dialog instead of the browser's unstyled box. Render the
// returned `confirmDialog` element once anywhere in the component (it portals).
export function useConfirm() {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setOpts(options)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  // Resolve the pending promise and close. Guarded against a double-settle (the
  // confirm/cancel click flips `open`, which fires onOpenChange(false) too — the
  // second call finds the resolver already cleared and no-ops).
  const settle = useCallback((value: boolean) => {
    setOpen(false)
    resolver.current?.(value)
    resolver.current = null
  }, [])

  const confirmDialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false)
      }}
    >
      <DialogContent className="p-6">
        <DialogTitle>{opts?.title ?? "Are you sure?"}</DialogTitle>
        {opts?.message ? (
          <DialogDescription className="mt-2 leading-relaxed">{opts.message}</DialogDescription>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => settle(false)}>
            {opts?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={opts?.destructive ? "danger" : "primary"}
            size="sm"
            onClick={() => settle(true)}
          >
            {opts?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { confirm, confirmDialog }
}
