import Link from 'next/link'
import { ArrowRight, FileSearch } from 'lucide-react'

export default function Home() {
    return (
        <div className="py-12 space-y-10">
            <div className="text-center space-y-4">
                <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-slate-900 dark:text-slate-50">
                    Local.Qkview
                </h1>
                <p className="mx-auto max-w-2xl text-lg text-slate-600 dark:text-slate-400">
                    Offline QKView archive analyzer for F5 BIG-IP (TMOS), F5OS rSeries, and VELOS. No cloud, no telemetry — your diagnostic archive never leaves the machine.
                </p>
            </div>

            <div className="max-w-2xl mx-auto">
                <Link href="/qkview" className="group relative block p-8 bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 hover:border-violet-500 dark:hover:border-violet-500 hover:shadow-md transition-all">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">
                            <FileSearch className="h-6 w-6" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">QKView Log Analyzer</h3>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Upload a QKView archive to unpack logs, parse device configuration, match known-issue patterns from a YAML rule library, and drill into virtual servers, pools, profiles, and iRules.
                    </p>
                    <div className="flex items-center text-violet-600 dark:text-violet-400 font-medium group-hover:translate-x-1 transition-transform">
                        Launch Analyzer <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                </Link>
            </div>
        </div>
    )
}
