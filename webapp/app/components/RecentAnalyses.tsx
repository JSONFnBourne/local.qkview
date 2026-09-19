'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2, History, RefreshCw } from 'lucide-react';

// The persisted analyses with a per-row delete (RT#36). Each analysis leaves
// a 40–125 MB logs_<id>.db behind; before this the only way to reclaim one
// was to delete the DB row by hand and wait for the startup orphan sweep.

interface AnalysisRow {
    id: number;
    filename: string;
    analysis_date: string;
    summary_bytes: number;
    logs_db_bytes: number;
}

function formatBytes(n: number): string {
    if (!n) return '—';
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecentAnalyses({
    refreshKey,
    currentId,
}: {
    /** Bump to re-fetch (e.g. the id of the analysis that just finished). */
    refreshKey: number | null;
    /** The analysis currently on screen; its row is marked, not deletable. */
    currentId: number | null;
}) {
    const [rows, setRows] = useState<AnalysisRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [confirmId, setConfirmId] = useState<number | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await fetch('/api/qkview', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const j = await r.json();
            setRows(Array.isArray(j.analyses) ? j.analyses : []);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load analyses');
        }
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    const remove = async (id: number) => {
        setBusyId(id);
        try {
            const r = await fetch(`/api/qkview/${id}`, { method: 'DELETE' });
            if (r.status === 404) {
                // Already gone (another tab, or the row was swept) — the list
                // is simply stale, so reload rather than report an error.
            } else if (!r.ok) {
                throw new Error(`HTTP ${r.status}`);
            }
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Delete failed');
        } finally {
            setBusyId(null);
            setConfirmId(null);
        }
    };

    if (rows === null && !error) return null;
    if (rows !== null && rows.length === 0 && !error) return null;

    const totalLogs = (rows ?? []).reduce((a, r) => a + r.logs_db_bytes, 0);

    return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-bold flex items-center gap-2">
                    <History className="w-5 h-5 text-slate-500" /> Recent Analyses
                    {rows && (
                        <span className="text-xs font-normal text-slate-500">
                            {rows.length} stored · {formatBytes(totalLogs)} of log indexes on disk
                        </span>
                    )}
                </h2>
                <button
                    onClick={load}
                    title="Refresh"
                    className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>
            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            {rows && rows.length > 0 && (
                <div className="overflow-x-auto mt-3">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                                <th className="py-1 pr-3">#</th>
                                <th className="py-1 pr-3">Archive</th>
                                <th className="py-1 pr-3">Analysed (UTC)</th>
                                <th className="py-1 pr-3 text-right">Log index</th>
                                <th className="py-1 pr-3 text-right">Summary</th>
                                <th className="py-1"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const isCurrent = r.id === currentId;
                                return (
                                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700/60">
                                        <td className="py-1.5 pr-3 font-mono text-slate-500">{r.id}</td>
                                        <td className="py-1.5 pr-3 font-mono truncate max-w-[24rem]" title={r.filename}>
                                            {r.filename}
                                            {isCurrent && (
                                                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(open)</span>
                                            )}
                                        </td>
                                        <td className="py-1.5 pr-3 font-mono text-slate-600 dark:text-slate-400">{r.analysis_date}</td>
                                        <td className="py-1.5 pr-3 text-right font-mono">{formatBytes(r.logs_db_bytes)}</td>
                                        <td className="py-1.5 pr-3 text-right font-mono">{formatBytes(r.summary_bytes)}</td>
                                        <td className="py-1.5 text-right whitespace-nowrap">
                                            {isCurrent ? null : confirmId === r.id ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <button
                                                        onClick={() => remove(r.id)}
                                                        disabled={busyId === r.id}
                                                        className="px-2 py-0.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                                                    >
                                                        {busyId === r.id ? 'Deleting…' : 'Confirm delete'}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmId(null)}
                                                        disabled={busyId === r.id}
                                                        className="px-2 py-0.5 text-xs rounded border border-slate-300 dark:border-slate-600"
                                                    >
                                                        Cancel
                                                    </button>
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmId(r.id)}
                                                    title={`Delete analysis ${r.id} and its log index`}
                                                    className="p-1 rounded text-slate-400 hover:text-red-600"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
