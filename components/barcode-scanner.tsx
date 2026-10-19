"use client"

import { useEffect, useRef, useState } from "react"
import type { IScannerControls } from "@zxing/browser"
import { Camera, Keyboard } from "lucide-react"

type Status = "starting" | "scanning" | "error"

// Book barcodes are EAN-13 in the Bookland range (978/979 prefix) — the digits
// ARE the ISBN-13. Anything else (price stickers, UPCs) is ignored.
const isBookIsbn = (text: string): boolean => /^(978|979)\d{10}$/.test(text)

/**
 * Live camera barcode scanner (ZXing). Calls onDetected with the ISBN-13 once a
 * book barcode is read, then stops. Falls back gracefully when the camera is
 * blocked or absent. ZXing is dynamically imported so it never runs during SSR.
 */
export function BarcodeScanner({
  onDetected,
  onManual,
}: {
  onDetected: (isbn: string) => void
  onManual: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Keep the latest onDetected without retriggering the camera effect.
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const [status, setStatus] = useState<Status>("starting")
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    let cancelled = false
    let controls: IScannerControls | undefined
    let detected = false

    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser")
        const { BarcodeFormat, DecodeHintType } = await import("@zxing/library")

        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13])
        // Spend more effort per frame — phone frames of a curved back cover are
        // often skewed or soft, and the default pass misses them.
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new BrowserMultiFormatReader(hints)

        if (cancelled || !videoRef.current) return

        controls = await reader.decodeFromConstraints(
          // Ask for HD: the browser default (often 640x480) leaves the bars too
          // few pixels wide to decode unless the book is held very close.
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result, _err, scanControls) => {
            if (!result || detected) return
            const text = result.getText()
            if (isBookIsbn(text)) {
              detected = true
              // The callback's own controls — the outer `controls` isn't assigned
              // yet if a barcode decodes on the very first frames.
              scanControls.stop()
              onDetectedRef.current(text)
            }
          },
        )
        if (cancelled) {
          controls.stop()
          return
        }
        setStatus("scanning")
      } catch (err) {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ""
        setErrorMsg(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera access is blocked. Allow the camera in your browser, or search by title instead."
            : name === "NotFoundError"
              ? "No camera found on this device. Search by title instead."
              : "Couldn't start the camera. Search by title instead.",
        )
        setStatus("error")
      }
    }

    void start()
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {status === "error" ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-lavender bg-card p-6 text-center">
          <Camera className="h-8 w-8 text-teal" />
          <p className="text-sm text-ink">{errorMsg}</p>
        </div>
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-scrim">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-28 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(30,24,48,0.35)]" />
          </div>
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/90">
            {status === "starting" ? "Starting camera…" : "Point at the barcode on the back cover"}
          </p>
        </div>
      )}

      <button
        onClick={onManual}
        className="inline-flex items-center justify-center gap-2 self-center text-sm font-medium text-teal hover:underline"
      >
        <Keyboard className="h-4 w-4" />
        Search by title instead
      </button>
    </div>
  )
}
