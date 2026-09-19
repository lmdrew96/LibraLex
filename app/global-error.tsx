"use client"

import { useEffect } from "react"

// Last-resort boundary for errors thrown by the ROOT layout itself. It replaces
// everything (including <html>/<body>), so globals.css and the theme tokens
// aren't available here — the light/dark tokens are inlined in a <style> tag. The common
// case (a page throwing) is handled by app/error.tsx with the full themed shell.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <head>
        {/* globals.css isn't loaded here, so the light/dark tokens are inlined —
            same values as app/globals.css, same theme choice as layout.tsx. */}
        <style>{`
          :root { --surface:#ebeed5; --ink:#41386b; --teal:#464e3e; }
          html.dark { --surface:#201c36; --ink:#ebeed5; --teal:#b0c49c; }
          body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
            padding:2rem; background:var(--surface); color:var(--ink); text-align:center;
            font-family:system-ui,-apple-system,sans-serif; }
          h1 { font-size:1.75rem; margin:0 0 .5rem; font-weight:600; }
          p { color:var(--teal); line-height:1.5; margin:0 0 1.5rem; }
          button { background:var(--ink); color:var(--surface); border:none; border-radius:9999px;
            padding:.7rem 1.6rem; font-size:1rem; font-weight:500; cursor:pointer; min-height:44px; }
          button:focus-visible { outline:2px solid var(--teal); outline-offset:3px; }
        `}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('libralex-theme');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <div style={{ maxWidth: 460 }}>
          <h1>Something broke</h1>
          <p>LibraLex hit an unexpected error. Try reloading — your shelf is safe.</p>
          <button onClick={() => reset()}>Reload</button>
        </div>
      </body>
    </html>
  )
}
