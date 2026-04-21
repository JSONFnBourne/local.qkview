'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Loader2, X } from 'lucide-react';

type LogEntry = {
    timestamp: string;
    hostname?: string;
    severity: string;
    severity_num?: number;
    process?: string;
    pid?: number;
    msg_code?: string;
    source_file?: string;
    line_number?: number;
    raw_line: string;
};

type SourcesResponse = {
    chips: Record<string, number>;
    sources: Record<string, number>;
};

type SearchResponse = {
    total: number;
    entries: LogEntry[];
};

// Display order + labels mirror iHealth's standard log list. `id` must match
// the backend's LOG_CHIP_SOURCES keys.
const CHIPS: { id: string; label: string }[] = [
    { id: 'ltm', label: 'LTM' },
    { id: 'tmm', label: 'TMM' },
    { id: 'gtm', label: 'GTM' },
    { id: 'apm', label: 'APM' },
    { id: 'asm', label: 'ASM' },
    { id: 'restjavad', label: 'REST API' },
];

const SEVERITIES: { id: string; label: string }[] = [
    { id: '', label: 'All severities' },
    { id: 'warning', label: 'Warning+' },
    { id: 'err', label: 'Error+' },
    { id: 'crit', label: 'Critical+' },
    { id: 'emerg', label: 'Emergency only' },
];

function severityColor(sev?: string): string {
    if (sev === 'err' || sev === 'crit' || sev === 'emerg' || sev === 'alert') return 'text-red-400';
    if (sev === 'warning') return 'text-amber-400';
    if (sev === 'notice') return 'text-blue-400';
    return 'text-slate-300';
}

function TerminalDots() {
    return (
        <div className="flex gap-1.5 mr-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>
    );
}

function LogLine({ entry }: { entry: LogEntry }) {
    return (
        <li className={`whitespace-pre-wrap leading-relaxed border-b border-slate-800/50 pb-1 ${severityColor(entry.severity)}`}>
            <span className="text-slate-500 mr-2">{entry.timestamp}</span>
            {entry.process && <span className="opacity-75 mr-2">[{entry.process}]</span>}
            {entry.raw_line}
        </li>
    );
}

export default function LogsSearchTile({
    analysisId,
    staticEntries,
    entryCount,
}: {
    analysisId: number | null;
    staticEntries: LogEntry[];
    entryCount: number;
}) {
    const [query, setQuery] = useState('');
    const [activeChip, setActiveChip] = useState<string | null>(null);
    const [severity, setSeverity] = useState<string>('');

    const [chipCounts, setChipCounts] = useState<Record<string, number>>({});
    const [chipsLoaded, setChipsLoaded] = useState(false);

    const [results, setResults] = useState<LogEntry[] | null>(null);
    const [total, setTotal] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);

    // Fetch per-chip counts once per analysis so we can dim chips whose log
    // family wasn't captured in this archive (module not provisioned, etc.).
    useEffect(() => {
        if (analysisId == null) {
            setChipCounts({});
            setChipsLoaded(false);
            return;
        }
        let cancelled = false;
        setChipsLoaded(false);
        fetch(`/api/qkview/${analysisId}/logs/sources`)
            .then(async (res) => {
                if (!res.ok) throw new Error(`sources ${res.status}`);
                return res.json() as Promise<SourcesResponse>;
            })
            .then((data) => {
                if (cancelled) return;
                setChipCounts(data.chips || {});
                setChipsLoaded(true);
            })
            .catch(() => {
                if (cancelled) return;
                setChipCounts({});
                setChipsLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [analysisId]);

    // Reset local search state when the analysis changes.
    useEffect(() => {
        setQuery('');
        setActiveChip(null);
        setSeverity('');
        setResults(null);
        setTotal(0);
        setError(null);
    }, [analysisId]);

    const isSearchActive = useMemo(
        () => query.trim().length > 0 || activeChip != null || severity !== '',
        [query, activeChip, severity],
    );

    const abortRef = useRef<AbortController | null>(null);

    const runSearch = useCallback(async () => {
        if (analysisId == null) return;
        if (!isSearchActive) {
            setResults(null);
            setTotal(0);
            setError(null);
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (activeChip) params.set('source', activeChip);
        if (severity) params.set('severity', severity);
        params.set('limit', '500');
        try {
            const res = await fetch(`/api/qkview/${analysisId}/logs?${params.toString()}`, {
                signal: controller.signal,
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || `search ${res.status}`);
            }
            setResults((data as SearchResponse).entries || []);
            setTotal((data as SearchResponse).total || 0);
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            setError(String(err?.message || err));
            setResults([]);
            setTotal(0);
        } finally {
            if (abortRef.current === controller) {
                setLoading(false);
            }
        }
    }, [analysisId, isSearchActive, query, activeChip, severity]);

    // Debounce search to ~300ms after typing settles.
    useEffect(() => {
        const h = setTimeout(runSearch, 300);
        return () => clearTimeout(h);
    }, [runSearch]);

    const clearAll = () => {
        setQuery('');
        setActiveChip(null);
        setSeverity('');
    };

    const displayed = isSearchActive ? (results ?? []) : staticEntries;
    const headerCount = isSearchActive ? total : entryCount;

    return (
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <TerminalDots />
                    Extracted Critical/Warning Logs
                    <span className="text-slate-500 font-normal text-base">
                        ({isSearchActive ? `${headerCount} matches` : headerCount})
                    </span>
                </h3>
            </div>

            {analysisId != null && (
                <div className="mb-4 space-y-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={'Search logs — "user session", word1 OR word2, -notfound, log:ltm, process:bigd'}
                                className="w-full px-3 py-2 pr-10 font-mono text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <button
                                type="button"
                                onClick={() => setShowHelp((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                aria-label="Query syntax help"
                            >
                                <HelpCircle className="w-4 h-4" />
                            </button>
                        </div>
                        <select
                            value={severity}
                            onChange={(e) => setSeverity(e.target.value)}
                            className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label="Severity filter"
                        >
                            {SEVERITIES.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                        </select>
                        {isSearchActive && (
                            <button
                                type="button"
                                onClick={clearAll}
                                className="flex items-center gap-1 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                <X className="w-4 h-4" /> Clear
                            </button>
                        )}
                    </div>

                    {showHelp && (
                        <div className="p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-700 dark:text-slate-300">
                            <p className="font-semibold mb-2">Query syntax</p>
                            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
                                <li><span className="text-blue-600 dark:text-blue-400">"user session"</span> — phrase</li>
                                <li><span className="text-blue-600 dark:text-blue-400">user OR session</span> — either word</li>
                                <li><span className="text-blue-600 dark:text-blue-400">user session</span> — both words</li>
                                <li><span className="text-blue-600 dark:text-blue-400">user -session</span> — exclude word</li>
                                <li><span className="text-blue-600 dark:text-blue-400">conn*</span> — prefix match</li>
                                <li><span className="text-blue-600 dark:text-blue-400">log:ltm</span> — restrict to log family</li>
                                <li><span className="text-blue-600 dark:text-blue-400">severity:warning</span> — min severity</li>
                                <li><span className="text-blue-600 dark:text-blue-400">process:bigd</span> — exact process</li>
                            </ul>
                            <p className="mt-2 text-slate-500 dark:text-slate-400">
                                Regex and fuzzy (<span className="font-mono">/…/</span>, <span className="font-mono">rat~</span>) aren't supported.
                            </p>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wider text-slate-500">Log source:</span>
                        {CHIPS.map((chip) => {
                            const count = chipCounts[chip.id] ?? 0;
                            const isActive = activeChip === chip.id;
                            const isEmpty = chipsLoaded && count === 0;
                            return (
                                <button
                                    key={chip.id}
                                    type="button"
                                    disabled={isEmpty}
                                    onClick={() => setActiveChip(isActive ? null : chip.id)}
                                    title={isEmpty ? 'Not present in this archive' : `${count.toLocaleString()} entries`}
                                    className={[
                                        'px-2.5 py-1 text-xs rounded-full border font-medium transition-colors',
                                        isActive
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : isEmpty
                                                ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700',
                                    ].join(' ')}
                                >
                                    {chip.label} <span className="opacity-70">({count.toLocaleString()})</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="bg-black rounded border border-slate-800 p-4 h-96 overflow-y-auto font-mono text-sm relative">
                {loading && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 text-xs text-slate-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> searching…
                    </div>
                )}
                {error ? (
                    <p className="text-red-400 italic">{error}</p>
                ) : displayed.length > 0 ? (
                    <ul className="space-y-1">
                        {displayed.map((entry, i) => (
                            <LogLine key={`${entry.source_file || ''}-${entry.line_number || i}-${i}`} entry={entry} />
                        ))}
                        {isSearchActive && total > displayed.length && (
                            <li className="text-slate-500 pt-2 italic">
                                … {(total - displayed.length).toLocaleString()} more matches — refine your query to narrow the result set.
                            </li>
                        )}
                        {!isSearchActive && staticEntries.length < entryCount && (
                            <li className="text-slate-500 pt-2 italic">
                                … {entryCount - staticEntries.length} more entries — use the search field above to find specific events.
                            </li>
                        )}
                    </ul>
                ) : isSearchActive ? (
                    <p className="text-slate-500 italic">No matching entries.</p>
                ) : (
                    <p className="text-slate-500 italic">No significant warning/error logs found in archive.</p>
                )}
            </div>
        </div>
    );
}
