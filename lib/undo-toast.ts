import { toast } from "sonner"

/**
 * Deferred-commit Undo: the caller hides the item immediately, and the real
 * (irreversible) mutation only runs once the toast closes without Undo being
 * pressed. Use for deletes with no server-side way back (a dismissed rec, a
 * declined friend request). If the tab closes inside the window the action just
 * never happens — the safe direction to fail.
 */
export const undoToast = ({
  message,
  commit,
  onUndo,
  errorMessage,
}: {
  message: string
  commit: () => Promise<unknown>
  onUndo: () => void
  errorMessage: string
}): void => {
  let settled = false
  const run = (): void => {
    if (settled) return
    settled = true
    commit().catch(() => {
      onUndo() // bring the item back so the UI matches the server
      toast.error(errorMessage)
    })
  }
  toast(message, {
    action: {
      label: "Undo",
      onClick: () => {
        settled = true
        onUndo()
      },
    },
    onAutoClose: run,
    onDismiss: run,
  })
}
