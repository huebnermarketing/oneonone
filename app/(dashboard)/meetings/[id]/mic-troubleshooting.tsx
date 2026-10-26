'use client'

import { AlertCircle, CheckCircle2, Mic, RefreshCw } from 'lucide-react'

interface MicTroubleshootingProps {
  /** Permission flipped to granted while this panel was open */
  micPermGranted: boolean
  /** How many times the user has retried after a block */
  micRetryCount: number
  /** Clears the blocked state and attempts to start recording again */
  onRetry: () => void
}

/** Step-by-step guidance shown when getUserMedia is denied (OS + browser permission checklist). */
export function MicTroubleshooting({ micPermGranted, micRetryCount, onRetry }: MicTroubleshootingProps) {
  return (
    <div className="space-y-5">
      {micPermGranted ? (
        <div className="rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="font-semibold text-dark-gray dark:text-white">Microphone Allowed</p>
              <p className="text-sm text-medium-gray mt-0.5">
                Permission granted. You can now start recording.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Step A: macOS system permission (show after first retry) */}
          {micRetryCount > 0 && (
            <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="font-semibold text-dark-gray dark:text-white">Still Blocked — Check System Settings</p>
                  <p className="text-sm text-medium-gray mt-0.5">
                    Your browser site setting looks correct, but your <strong>operating system</strong> may be blocking microphone access. This is the most common cause.
                  </p>
                </div>
              </div>

              <div className="space-y-3 ml-1">
                <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">On Mac:</p>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-center">1</span>
                  <p className="text-sm text-dark-gray dark:text-white/90">
                    Open <strong>System Settings</strong> → <strong>Privacy &amp; Security</strong> → <strong>Microphone</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-center">2</span>
                  <p className="text-sm text-dark-gray dark:text-white/90">
                    Make sure <strong>Google Chrome</strong> (or your browser) is <strong>toggled ON</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-center">3</span>
                  <p className="text-sm text-dark-gray dark:text-white/90">
                    <strong>Restart Chrome</strong> completely (quit and reopen), then come back to this page
                  </p>
                </div>
                <p className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide mt-3">On Windows:</p>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-center">1</span>
                  <p className="text-sm text-dark-gray dark:text-white/90">
                    Open <strong>Settings</strong> → <strong>Privacy</strong> → <strong>Microphone</strong> → ensure <strong>&quot;Allow apps to access your microphone&quot;</strong> is ON, and Chrome is listed
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step B: Browser site permission (always shown) */}
          <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Mic className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-dark-gray dark:text-white">
                  {micRetryCount > 0 ? 'Also Check: Browser Site Permission' : 'Microphone Access Needed'}
                </p>
                <p className="text-sm text-medium-gray mt-0.5">
                  {micRetryCount > 0
                    ? 'Make sure the browser site permission is also set to Allow:'
                    : 'Your browser blocked access to the microphone. Follow these steps:'}
                </p>
              </div>
            </div>

            <div className="space-y-3 ml-1">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center justify-center">1</span>
                <p className="text-sm text-dark-gray dark:text-white/90">
                  Click the <strong>lock icon</strong> (or tune icon) at the <strong>left side of the address bar</strong>.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center justify-center">2</span>
                <p className="text-sm text-dark-gray dark:text-white/90">
                  Find <strong>&quot;Microphone&quot;</strong> and set it to <strong>&quot;Allow&quot;</strong>.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center justify-center">3</span>
                <p className="text-sm text-dark-gray dark:text-white/90">
                  <strong>Reload this page</strong>, then click <strong>&quot;Start Recording&quot;</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        {micRetryCount > 0 && !micPermGranted && (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-3 px-6 py-3 text-base font-medium bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-colors shadow-lg"
          >
            <RefreshCw className="w-5 h-5" />
            Reload Page
          </button>
        )}
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-3 px-6 py-3 text-base font-medium bg-gradient-to-r from-red-500 to-orange text-white rounded-2xl hover:opacity-90 transition-opacity shadow-lg"
        >
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
            <Mic className="w-4 h-4" />
          </div>
          {micRetryCount > 0 ? 'Try Again' : 'Start Recording'}
        </button>
      </div>

      {!micPermGranted && micRetryCount === 0 && (
        <p className="text-center text-xs text-medium-gray">
          Changed the setting? Reload the page, or click Start Recording to try again.
        </p>
      )}
    </div>
  )
}
