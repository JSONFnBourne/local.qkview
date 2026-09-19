'use client'

import { useEffect } from 'react'

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    // An error boundary that throws its error away is a bug: without this the
    // only trace of a client-side failure is the blank panel the user sees.
    useEffect(() => {
        console.error('Unhandled error in the analyzer UI:', error)
    }, [error])

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Something went wrong
            </h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-md">
                An unexpected error occurred. Please try again.
            </p>
            {error.digest && (
                <p className="text-xs font-mono text-slate-500 dark:text-slate-500">
                    Reference: {error.digest}
                </p>
            )}
            <button
                onClick={() => reset()}
                className="inline-flex items-center px-6 py-3 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors"
            >
                Try Again
            </button>
        </div>
    )
}
