'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { UploadCloud, File, CheckCircle, AlertTriangle, Bug, Terminal, Network, Cpu, Activity, Folder, ShieldCheck, X, Loader2, ChevronRight, ChevronDown, Copy, Check, Server, Calendar, Settings, Search, Download, Database, Layers, FileText } from 'lucide-react';
import LogsSearchTile from '../components/LogsSearchTile';

type AppSummary = {
    name: string;
    fullPath: string;
    partition: string;
    folder?: string | null;
    destination?: string;
    pool?: string;
};

type F5OSHealth = {
    component: string;
    health: string;
    severity: string;
    attribute?: string;
    description: string;
    value?: string;
};

type F5OSClusterNode = {
    name: string;
    running_state: string;
    ready: boolean;
    ready_message: string;
    slot: string;
};

type F5OSPortgroup = { id: string; mode: string };

type F5OSTenant = {
    name: string;
    type: string;
    running_state: string;
    status: string;
    image_version: string;
    mgmt_ip: string;
    vcpu_cores_per_node: string;
    memory_mb: string;
};

type F5OSOverview = {
    generation_start: string;
    generation_stop: string;
    platform_pid: string;
    platform_code: string;
    platform_part_number: string;
    platform_uuid: string;
    platform_slot: string;
    version_edition: string;
    cluster_summary: string;
    cluster_nodes: F5OSClusterNode[];
    mgmt_ipv4_address: string;
    mgmt_ipv4_prefix: string;
    mgmt_ipv4_gateway: string;
    mgmt_ipv6_address: string;
    mgmt_ipv6_prefix: string;
    mgmt_ipv6_gateway: string;
    payg_license_level: string;
    licensed_version: string;
    registration_key: string;
    licensed_date: string;
    serial_number: string;
    time_zone: string;
    appliance_datetime: string;
    appliance_mode: string;
    portgroups: F5OSPortgroup[];
    tenants: F5OSTenant[];
    tenants_configured: number;
    tenants_provisioned: number;
    tenants_deployed: number;
    tenants_running: number;
};

function formatGenerationDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toUTCString();
}

function portgroupModeColor(mode: string): string {
    if (mode === 'MODE_100GB') return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200';
    if (mode === 'MODE_25GB') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
    if (mode === 'MODE_10GB') return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    if (!mode) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

type XmlStatRow = Record<string, string>;
type XmlStatsPayload = {
    summary: Record<string, number>;
    top_virtual_servers: XmlStatRow[];
    top_pools: XmlStatRow[];
    top_pool_members?: XmlStatRow[];
    tmms: XmlStatRow[];
    interfaces: XmlStatRow[];
    cpus: XmlStatRow[];
    active_modules: XmlStatRow[];
    asm_policies: XmlStatRow[];
    top_expiring_certificates?: XmlStatRow[];
    db_variables?: { name: string; value: string; default: string }[];
};

function AppDetailsPanel({
    fullPath,
    loading,
    error,
    details,
    showRaw,
    onToggleRaw,
    onClose,
}: {
    fullPath: string;
    loading: boolean;
    error: string | null;
    details: any;
    showRaw: boolean;
    onToggleRaw: () => void;
    onClose: () => void;
}) {
    const pool = details?.pool;
    const poolIsObject = pool && typeof pool === 'object' && !Array.isArray(pool);
    const members: Record<string, any> = poolIsObject && pool.members && typeof pool.members === 'object' ? pool.members : {};
    const memberNames = Object.keys(members).filter((k) => k !== 'line');
    const monitors: any[] = poolIsObject && pool.monitor
        ? (Array.isArray(pool.monitor) ? pool.monitor : [pool.monitor])
        : [];
    const profiles: string[] = Array.isArray(details?.profiles) ? details.profiles : [];
    const rules: string[] = Array.isArray(details?.rules) ? details.rules : [];
    const ruleBodies: Record<string, string> = (details?.rule_bodies && typeof details.rule_bodies === 'object') ? details.rule_bodies : {};
    const lines: string[] = Array.isArray(details?.lines) ? details.lines : [];

    const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState(false);

    const toggleRule = (name: string) => {
        setExpandedRules((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const copyStanzas = async () => {
        try {
            await navigator.clipboard.writeText(lines.join('\n\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // fallback: select-all in a temp textarea
            const ta = document.createElement('textarea');
            ta.value = lines.join('\n\n');
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* noop */ }
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };

    // Config-based member status. QKView XML carries no runtime monitor state,
    // so colouring reflects intent in bigip.conf: user-disabled / forced-down
    // vs. default (assumed up). Live availability would need a device-side query.
    const memberStatus = (m: any): { tone: 'up' | 'disabled' | 'down'; label: string } => {
        const state = typeof m?.state === 'string' ? m.state : '';
        const session = typeof m?.session === 'string' ? m.session : '';
        if (state === 'user-down' || state.includes('forced-down')) return { tone: 'down', label: 'forced down' };
        if (session === 'user-disabled' || session.includes('disabled')) return { tone: 'disabled', label: 'disabled' };
        return { tone: 'up', label: 'enabled' };
    };
    const toneClasses: Record<'up' | 'disabled' | 'down', string> = {
        up: 'bg-green-500',
        disabled: 'bg-amber-500',
        down: 'bg-red-500',
    };

    const renderMonitor = (m: any, i: number) => {
        if (typeof m === 'string') {
            return <li key={i} className="font-mono text-xs">{m}</li>;
        }
        const keys = Object.keys(m || {}).filter((k) => k !== 'line');
        return (
            <li key={i} className="font-mono text-xs">
                <span className="text-slate-700 dark:text-slate-300">{keys.slice(0, 6).map((k) => `${k}=${typeof m[k] === 'object' ? JSON.stringify(m[k]) : m[k]}`).join('  ')}</span>
            </li>
        );
    };

    return (
        <div className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-6">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Network className="w-4 h-4 text-amber-500" />
                        <span className="font-mono text-sm">{fullPath}</span>
                    </h4>
                    {details?.destination && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">destination: {details.destination}</p>
                    )}
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close app details"
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {loading && (
                <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading app details…
                </div>
            )}

            {error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">
                    {error}
                </div>
            )}

            {!loading && !error && details && (
                <div className="grid md:grid-cols-2 gap-6 text-sm">
                    <div className="space-y-4">
                        <div>
                            <h5 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-2">Pool</h5>
                            {poolIsObject ? (
                                <div className="font-mono text-xs space-y-1">
                                    {details.pool && typeof details.pool === 'object' && Object.entries(details.pool)
                                        .filter(([k]) => !['members', 'monitor', 'line'].includes(k))
                                        .slice(0, 8)
                                        .map(([k, v]) => (
                                            <div key={k} className="flex gap-2">
                                                <span className="text-slate-500 shrink-0">{k}:</span>
                                                <span className="text-slate-800 dark:text-slate-200 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                                            </div>
                                        ))}
                                </div>
                            ) : pool ? (
                                <p className="font-mono text-xs text-slate-600 dark:text-slate-400">{String(pool)} <span className="text-slate-400">(not resolved)</span></p>
                            ) : (
                                <p className="text-xs text-slate-400 italic">No pool attached.</p>
                            )}
                        </div>

                        <div>
                            <h5 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-2">Members ({memberNames.length})</h5>
                            {memberNames.length > 0 ? (
                                <>
                                    <ul className="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
                                        {memberNames.map((m) => {
                                            const s = memberStatus(members[m]);
                                            return (
                                                <li key={m} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                                    <span
                                                        className={`inline-block w-2 h-2 rounded-full shrink-0 ${toneClasses[s.tone]}`}
                                                        title={`config intent: ${s.label}`}
                                                        aria-label={s.label}
                                                    />
                                                    <span className="truncate">{m}</span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="mt-1 text-[10px] text-slate-400 italic">Dot = bigip.conf intent (enabled / disabled / forced-down). Live monitor state is not in QKView.</p>
                                </>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None.</p>
                            )}
                        </div>

                        <div>
                            <h5 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-2">Monitors ({monitors.length})</h5>
                            {monitors.length > 0 ? (
                                <ul className="space-y-1">{monitors.map(renderMonitor)}</ul>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None.</p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h5 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-2">Profiles ({profiles.length})</h5>
                            {profiles.length > 0 ? (
                                <ul className="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
                                    {profiles.map((p) => (
                                        <li key={p} className="text-slate-700 dark:text-slate-300">{p}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None.</p>
                            )}
                        </div>

                        <div>
                            <h5 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-2">iRules ({rules.length})</h5>
                            {rules.length > 0 ? (
                                <ul className="font-mono text-xs space-y-1">
                                    {rules.map((r) => {
                                        const isOpen = expandedRules.has(r);
                                        const body = ruleBodies[r];
                                        const hasBody = typeof body === 'string' && body.length > 0;
                                        return (
                                            <li key={r} className="text-slate-700 dark:text-slate-300">
                                                <button
                                                    type="button"
                                                    onClick={() => hasBody && toggleRule(r)}
                                                    disabled={!hasBody}
                                                    className={`flex items-center gap-1 w-full text-left ${hasBody ? 'hover:text-amber-700 dark:hover:text-amber-400 cursor-pointer' : 'cursor-default opacity-75'}`}
                                                    aria-expanded={isOpen}
                                                >
                                                    {hasBody ? (
                                                        isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
                                                    ) : (
                                                        <span className="w-3 h-3 shrink-0" />
                                                    )}
                                                    <span className="truncate">{r}</span>
                                                    {!hasBody && <span className="text-slate-400 text-[10px] ml-1">(body not parsed)</span>}
                                                </button>
                                                {isOpen && hasBody && (
                                                    <pre className="mt-1 ml-4 bg-black text-slate-200 p-2 rounded text-[11px] overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
{body}
                                                    </pre>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None.</p>
                            )}
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={onToggleRaw}
                                className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                            >
                                {showRaw ? '▾ Hide' : '▸ Show'} raw config stanzas ({lines.length})
                            </button>
                            {lines.length > 0 && (
                                <button
                                    onClick={copyStanzas}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-400"
                                    aria-label="Copy raw config stanzas to clipboard"
                                >
                                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied' : 'Copy stanzas'}
                                </button>
                            )}
                        </div>
                        {showRaw && lines.length > 0 && (
                            <pre className="mt-2 bg-black text-slate-200 p-3 rounded text-xs overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed">
                                {lines.join('\n\n')}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Configured Virtual Servers table with client-side search + row windowing.
// vCMP archives carry ~2000 virtual servers on a single partition; rendering
// every <tr> at once janks scroll and balloons the DOM. Above a threshold we
// render only the rows in (and just around) the viewport, padding the rest
// with spacer rows so the scrollbar still reflects the full list length.
// Kept dependency-free on purpose — the runtime dep budget forbids pulling in
// react-window / react-virtual just for this one table.
const VS_ROW_HEIGHT = 33;       // px per single-line row (py-2 + text-xs)
const VS_VIEWPORT_HEIGHT = 600; // px; matches the prior max-h-[600px] scroll box
const VS_OVERSCAN = 10;         // extra rows above/below the viewport
const VS_VIRTUALIZE_ABOVE = 100;

function VirtualizedVSTable({
    apps,
    selectedAppPath,
    onSelect,
}: {
    apps: AppSummary[];
    selectedAppPath: string | null;
    onSelect: (fullPath: string) => void;
}) {
    const [query, setQuery] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return apps;
        return apps.filter(
            (a) =>
                a.name.toLowerCase().includes(q) ||
                (a.destination || '').toLowerCase().includes(q) ||
                (a.pool || '').toLowerCase().includes(q)
        );
    }, [apps, query]);

    // Clear any active filter when the underlying app set changes (partition
    // switch or a new upload) so a stale query doesn't hide the new list.
    useEffect(() => {
        setQuery('');
    }, [apps]);

    // Reset scroll to the top whenever the visible set changes so we never
    // strand the viewport in the middle of a now-shorter list.
    useEffect(() => {
        setScrollTop(0);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [query, apps]);

    const total = filtered.length;
    const virtualize = total > VS_VIRTUALIZE_ABOVE;
    const scrollable = total > 50;

    let startIndex = 0;
    let endIndex = total;
    if (virtualize) {
        startIndex = Math.max(0, Math.floor(scrollTop / VS_ROW_HEIGHT) - VS_OVERSCAN);
        const visible = Math.ceil(VS_VIEWPORT_HEIGHT / VS_ROW_HEIGHT) + VS_OVERSCAN * 2;
        endIndex = Math.min(total, startIndex + visible);
    }
    const topPad = startIndex * VS_ROW_HEIGHT;
    const bottomPad = (total - endIndex) * VS_ROW_HEIGHT;
    const visibleRows = filtered.slice(startIndex, endIndex);

    return (
        <>
            <div className="mb-3 flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter by name, destination, or pool…"
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                </div>
                <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {query.trim() ? `${total} of ${apps.length}` : `${total}`} shown
                </span>
            </div>
            <div
                ref={scrollRef}
                onScroll={(e) => {
                    if (virtualize) setScrollTop(e.currentTarget.scrollTop);
                }}
                className="overflow-x-auto overflow-y-auto"
                style={scrollable ? { maxHeight: VS_VIEWPORT_HEIGHT } : undefined}
            >
                <table className="w-full text-sm">
                    <thead
                        className={`text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 ${scrollable ? 'sticky top-0 bg-white dark:bg-slate-800 z-10' : ''}`}
                    >
                        <tr>
                            <th className="text-left py-2 pr-4 font-semibold">Name</th>
                            <th className="text-left py-2 pr-4 font-semibold">Destination</th>
                            <th className="text-left py-2 font-semibold">Pool</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {total === 0 ? (
                            <tr>
                                <td colSpan={3} className="py-6 text-center text-sm text-slate-500">
                                    No virtual servers match “{query.trim()}”.
                                </td>
                            </tr>
                        ) : (
                            <>
                                {topPad > 0 && (
                                    <tr style={{ height: topPad }} aria-hidden>
                                        <td colSpan={3} className="p-0 border-0" />
                                    </tr>
                                )}
                                {visibleRows.map((a) => {
                                    const isSelected = selectedAppPath === a.fullPath;
                                    return (
                                        <tr
                                            key={a.fullPath}
                                            onClick={() => onSelect(a.fullPath)}
                                            className={`cursor-pointer ${isSelected ? 'bg-amber-50 dark:bg-amber-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                                        >
                                            <td className="py-2 pr-4 font-mono text-xs text-slate-800 dark:text-slate-200 whitespace-nowrap">{a.name}</td>
                                            <td className="py-2 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{a.destination || '—'}</td>
                                            <td className="py-2 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{a.pool || '—'}</td>
                                        </tr>
                                    );
                                })}
                                {bottomPad > 0 && (
                                    <tr style={{ height: bottomPad }} aria-hidden>
                                        <td colSpan={3} className="p-0 border-0" />
                                    </tr>
                                )}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// Searchable TMOS DB-variable inventory (the runtime `sys db` dump from
// mcp_module.xml). Each row carries its current value and shipped default, so
// the card offers a non-default-only filter — the set engineers usually want.
function DbVariablesCard({ vars }: { vars: { name: string; value: string; default: string }[] }) {
    const [filter, setFilter] = useState('');
    const [nonDefaultOnly, setNonDefaultOnly] = useState(true);
    // An empty `value` means the variable sits at its default (mcp_module.xml
    // only records an explicit value when one was set). So non-default ==
    // value is present AND differs from the default.
    const isChanged = (v: { value: string; default: string }) => v.value !== '' && v.value !== v.default;
    const effective = (v: { value: string; default: string }) => v.value || v.default;
    const nonDefaultCount = useMemo(() => vars.filter(isChanged).length, [vars]);
    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return vars.filter((v) => {
            if (nonDefaultOnly && !isChanged(v)) return false;
            if (!q) return true;
            return v.name.toLowerCase().includes(q) || effective(v).toLowerCase().includes(q);
        });
    }, [vars, filter, nonDefaultOnly]);

    return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[560px] overflow-hidden flex flex-col">
            <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                <Database className="w-5 h-5 text-cyan-500" /> Database Variables ({vars.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Runtime <span className="font-mono">sys db</span> dump from mcp_module.xml. {nonDefaultCount} non-default.
            </p>
            <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter by name or value…"
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={nonDefaultOnly}
                        onChange={(e) => setNonDefaultOnly(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    Non-default only
                </label>
            </div>
            <div className="overflow-y-auto">
                <table className="w-full text-xs">
                    <thead className="text-slate-500 uppercase sticky top-0 bg-white dark:bg-slate-800">
                        <tr>
                            <th className="text-left py-1 pr-2">Variable</th>
                            <th className="text-left py-1 pr-2">Value</th>
                            <th className="text-left py-1">Default</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {shown.map((v) => {
                            const changed = isChanged(v);
                            return (
                                <tr key={v.name}>
                                    <td className="py-1 pr-2 font-mono text-slate-700 dark:text-slate-300 break-all">{v.name}</td>
                                    <td className={`py-1 pr-2 font-mono break-all ${changed ? 'text-cyan-700 dark:text-cyan-300 font-semibold' : 'text-slate-900 dark:text-slate-100'}`}>{effective(v) || '—'}</td>
                                    <td className="py-1 font-mono text-slate-400 break-all">{v.default || '—'}</td>
                                </tr>
                            );
                        })}
                        {shown.length === 0 && (
                            <tr><td colSpan={3} className="py-3 text-slate-500 text-center">No variables match.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

type CapturedFile = { path: string; category: string; size: number };

// Raw archive file explorer. Lists the text artifacts captured at analysis time
// (config files, var/tmp daemon dumps, F5OS command outputs) and views/downloads
// them on demand from the persisted store.
function FileExplorer({ analysisId }: { analysisId: number }) {
    const [files, setFiles] = useState<CapturedFile[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [content, setContent] = useState<string>('');
    const [viewLoading, setViewLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(`/api/qkview/${analysisId}/files`)
            .then((r) => (r.ok ? r.json() : { files: [] }))
            .then((d) => { if (!cancelled) setFiles(d.files || []); })
            .catch(() => { if (!cancelled) setFiles([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [analysisId]);

    const openFile = async (path: string) => {
        setSelected(path);
        setViewLoading(true);
        setContent('');
        try {
            const r = await fetch(`/api/qkview/${analysisId}/files/${path.split('/').map(encodeURIComponent).join('/')}`);
            setContent(await r.text());
        } catch {
            setContent('# failed to load file');
        } finally {
            setViewLoading(false);
        }
    };

    const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
    const catTone: Record<string, string> = {
        config: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
        diagnostic: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
        command: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    };

    if (loading) {
        return (
            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading captured files…
            </div>
        );
    }
    if (!files || files.length === 0) return null;

    return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-500" /> Archive Files ({files.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Captured config, diagnostic dumps, and command outputs from the qkview. Click to view; use Download to save.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
                <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-xs max-h-[420px] overflow-y-auto">
                    {files.map((f) => (
                        <li key={f.path}>
                            <button
                                onClick={() => openFile(f.path)}
                                className={`w-full text-left py-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 px-1 rounded ${selected === f.path ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                            >
                                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold shrink-0 ${catTone[f.category] || 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>{f.category}</span>
                                <span className="font-mono text-slate-700 dark:text-slate-300 break-all flex-1">{f.path}</span>
                                <span className="text-slate-400 tabular-nums shrink-0">{fmtSize(f.size)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="min-w-0">
                    {selected ? (
                        <div className="flex flex-col h-full">
                            <div className="flex items-center justify-between mb-2 gap-2">
                                <span className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all">{selected}</span>
                                <a
                                    href={`/api/qkview/${analysisId}/files/${selected.split('/').map(encodeURIComponent).join('/')}`}
                                    download={selected.split('/').pop()}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 shrink-0"
                                >
                                    <Download className="w-3.5 h-3.5" /> Download
                                </a>
                            </div>
                            <pre className="flex-1 bg-black rounded p-3 text-[11px] leading-relaxed text-green-300 font-mono overflow-auto whitespace-pre-wrap max-h-[420px]">
                                {viewLoading ? '# loading…' : content}
                            </pre>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg min-h-[120px]">
                            Select a file to view its contents
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function QKViewPage() {
    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [progressMsg, setProgressMsg] = useState<string>('');
    // Wall-clock since the analyze stream started, ticked once per second.
    // Server progress events can be 30+ seconds apart on big VELOS archives
    // (rule scan over 800k+ entries) — without a visible counter the UI looks
    // hung even though the backend is working.
    const [elapsedSec, setElapsedSec] = useState(0);
    const uploadStartRef = useRef<number | null>(null);
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeCmd, setActiveCmd] = useState<string | null>(null);
    const [activePartition, setActivePartition] = useState<string | null>(null);
    const [selectedAppPath, setSelectedAppPath] = useState<string | null>(null);
    const [appDetails, setAppDetails] = useState<any>(null);
    const [appDetailsLoading, setAppDetailsLoading] = useState(false);
    const [appDetailsError, setAppDetailsError] = useState<string | null>(null);
    const [showRawStanzas, setShowRawStanzas] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isUploading) return;
        const id = window.setInterval(() => {
            if (uploadStartRef.current != null) {
                setElapsedSec(Math.floor((Date.now() - uploadStartRef.current) / 1000));
            }
        }, 1000);
        return () => window.clearInterval(id);
    }, [isUploading]);

    const rawProduct: string = analysisResult?.device_info?.product || '';
    const isF5OS = rawProduct.startsWith('F5OS');
    const platformFlavor: string = (analysisResult?.device_info?.platform || '').toLowerCase();
    const f5osVariant: string = analysisResult?.device_info?.f5os_variant || '';
    // PRODUCT.Platform reports "controller" for both VELOS flavors, so we use
    // the backend-computed variant (keyed off subpackage signatures) to drive
    // controller-specific framing (Chassis card vs Tenant Counts). The tenant
    // inventory itself renders for any F5OS archive that carries `show tenants`
    // output — a VELOS controller can surface a chassis-wide tenant inventory.
    const isController = isF5OS && f5osVariant === 'velos-controller';
    const f5osCommands: Record<string, string> = analysisResult?.f5os_commands || {};
    const f5osHealth: F5OSHealth[] = analysisResult?.f5os_health || [];
    const f5osOverview: F5OSOverview | null = analysisResult?.f5os_overview || null;
    const xmlStats: XmlStatsPayload | null = analysisResult?.xml_stats || null;
    const apps: AppSummary[] = analysisResult?.apps || [];
    const partitions: string[] = analysisResult?.partitions || [];
    const provisionedModules: { module: string; name: string; level: string; cpu_ratio: string; memory_ratio: string }[] = analysisResult?.provisioned_modules || [];
    const dbVariables = xmlStats?.db_variables || [];
    const cmRedundancy: { devices: any[]; device_groups: any[]; traffic_groups: any[] } | null = analysisResult?.cm_redundancy || null;
    const hasCm = !!cmRedundancy && (cmRedundancy.devices.length > 0 || cmRedundancy.device_groups.length > 0);

    const appsByPartition = useMemo(() => {
        const out: Record<string, AppSummary[]> = {};
        for (const a of apps) {
            (out[a.partition] ||= []).push(a);
        }
        return out;
    }, [apps]);

    const effectivePartition = activePartition ?? partitions[0] ?? null;

    // Sort interfaces for display: real front-panel NICs (1.1, 1.2, …) first,
    // then mgmt, then everything else (internal / HSB). TMOS stat_module.xml
    // emits them in index order, which looks random to humans.
    const sortedInterfaces = useMemo(() => {
        const list = xmlStats?.interfaces ?? [];
        const rank = (name: string): [number, string] => {
            if (/^\d+\.\d+$/.test(name)) return [0, name];
            if (name === 'mgmt') return [1, name];
            if (name) return [2, name];
            return [3, ''];
        };
        return [...list].sort((a, b) => {
            const [ra, na] = rank(a['name'] || '');
            const [rb, nb] = rank(b['name'] || '');
            if (ra !== rb) return ra - rb;
            return na.localeCompare(nb, undefined, { numeric: true });
        });
    }, [xmlStats]);

    const analysisId: number | null = analysisResult?.analysis_id ?? null;

    const loadAppDetails = async (fullPath: string) => {
        if (analysisId == null) {
            setAppDetailsError('Analysis ID missing — re-upload the archive.');
            return;
        }
        if (selectedAppPath === fullPath) {
            setSelectedAppPath(null);
            setAppDetails(null);
            setAppDetailsError(null);
            return;
        }
        setSelectedAppPath(fullPath);
        setAppDetails(null);
        setAppDetailsError(null);
        setAppDetailsLoading(true);
        setShowRawStanzas(false);
        try {
            const encoded = fullPath.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
            const res = await fetch(`/api/qkview/${analysisId}/apps/${encoded}`);
            if (!res.ok) throw new Error(`Backend returned ${res.status}`);
            const data = await res.json();
            setAppDetails(data.app ?? null);
        } catch (err: any) {
            setAppDetailsError(err.message || 'Failed to load app details.');
        } finally {
            setAppDetailsLoading(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleFileSelect = (selectedFile: File) => {
        const validExt = selectedFile.name.endsWith('.qkview') || selectedFile.name.endsWith('.tgz') || selectedFile.name.endsWith('.tar.gz') || selectedFile.name.endsWith('.tar');
        if (!validExt) {
            setError('Please upload a valid .qkview, .tgz, .tar.gz, or .tar archive.');
            return;
        }
        setError(null);
        setFile(selectedFile);
    };

    const uploadFile = async () => {
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setProgressMsg('Uploading archive… 0%');
        uploadStartRef.current = Date.now();
        setElapsedSec(0);

        // XHR, not fetch, because fetch doesn't expose upload progress. The
        // body is the raw file (octet-stream) — the server reads bytes directly
        // and gives us back an NDJSON stream of pipeline progress + result.
        try {
            const finalData = await new Promise<any>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/analyze', true);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.setRequestHeader('X-Filename', file.name);
                xhr.responseType = 'text';

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const pct = Math.floor((e.loaded / e.total) * 100);
                        const mb = (e.loaded / (1024 * 1024)).toFixed(1);
                        const total = (e.total / (1024 * 1024)).toFixed(1);
                        setProgressMsg(`Uploading archive… ${pct}% (${mb} / ${total} MB)`);
                    } else {
                        const mb = (e.loaded / (1024 * 1024)).toFixed(1);
                        setProgressMsg(`Uploading archive… ${mb} MB`);
                    }
                };

                xhr.upload.onload = () => {
                    setProgressMsg('Upload complete — waiting for server…');
                };

                // Track NDJSON lines as they arrive in responseText. This
                // fires repeatedly during streaming; each call sees the full
                // accumulated text, so we only parse what's new.
                let parsedUpto = 0;
                let resultPayload: any = null;
                let streamError: string | null = null;

                const parseNewLines = () => {
                    const text = xhr.responseText || '';
                    if (text.length <= parsedUpto) return;
                    const chunk = text.slice(parsedUpto);
                    const lastNl = chunk.lastIndexOf('\n');
                    if (lastNl === -1) return; // no complete line yet
                    const complete = chunk.slice(0, lastNl);
                    parsedUpto += lastNl + 1;
                    for (const rawLine of complete.split('\n')) {
                        const line = rawLine.trim();
                        if (!line) continue;
                        let evt: any;
                        try { evt = JSON.parse(line); } catch { continue; }
                        if (evt.type === 'progress') {
                            setProgressMsg(evt.msg || '');
                        } else if (evt.type === 'result') {
                            resultPayload = evt.data;
                        } else if (evt.type === 'error') {
                            streamError = evt.detail || 'Analysis failed.';
                        }
                    }
                };

                xhr.onprogress = parseNewLines;

                xhr.onload = () => {
                    parseNewLines();
                    if (xhr.status < 200 || xhr.status >= 300) {
                        // Validation errors (400/413/415) come back as JSON, not NDJSON.
                        let detail = `Upload failed with status ${xhr.status}`;
                        try {
                            const errData = JSON.parse(xhr.responseText || '{}');
                            if (errData?.error) detail = errData.error;
                            else if (errData?.detail) detail = errData.detail;
                        } catch { /* keep generic */ }
                        reject(new Error(detail));
                        return;
                    }
                    if (streamError) { reject(new Error(streamError)); return; }
                    if (!resultPayload) { reject(new Error('Analysis stream ended without a result.')); return; }
                    resolve(resultPayload);
                };

                xhr.onerror = () => reject(new Error('Network error during upload.'));
                xhr.onabort = () => reject(new Error('Upload aborted.'));

                xhr.send(file);
            });

            setAnalysisResult(finalData);
            setSelectedAppPath(null);
            setAppDetails(null);
            setAppDetailsError(null);
            setActivePartition(null);
            setActiveCmd(null);
            setShowRawStanzas(false);
        } catch (err: any) {
            setError(err.message || 'An error occurred during analysis.');
        } finally {
            setIsUploading(false);
            setProgressMsg('');
            uploadStartRef.current = null;
            setElapsedSec(0);
        }
    };

    const formatElapsed = (sec: number): string => {
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s.toString().padStart(2, '0')}s`;
    };

    return (
        <div className="py-8 space-y-8 max-w-5xl mx-auto">
            <div className="space-y-4">
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
                    QKView Analyzer
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Drag and drop an F5 TMOS (.qkview) or F5OS (.tgz / .tar) diagnostic archive to parse logs, index configurations, and scan for known issues.
                </p>
            </div>

            {/* Upload Area */}
            {!analysisResult && (
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${isDragging ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/10' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'}`}
                >
                    <input
                        type="file"
                        accept=".qkview,.tgz,.tar.gz,.tar"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
                    />
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                            <UploadCloud className="w-8 h-8" />
                        </div>
                        {file ? (
                            <div className="space-y-4">
                                <p className="text-lg font-medium text-slate-700 dark:text-slate-300">
                                    Selected: {file.name}
                                </p>
                                <button
                                    onClick={uploadFile}
                                    disabled={isUploading}
                                    className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
                                >
                                    {isUploading ? 'Analyzing Archive...' : 'Begin Analysis'}
                                </button>
                                {isUploading && progressMsg && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 font-mono">
                                        <span>{progressMsg}</span>
                                        <span className="ml-2 text-slate-500 dark:text-slate-500">
                                            · {formatElapsed(elapsedSec)} elapsed
                                        </span>
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-lg font-medium text-slate-700 dark:text-slate-300">
                                    Click or drag .qkview, .tgz, or .tar archive to this area to upload
                                </p>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-amber-600 dark:text-amber-400 font-medium hover:underline"
                                >
                                    Browse Files
                                </button>
                            </div>
                        )}
                        {error && <p className="text-red-500 font-medium mt-4">{error}</p>}
                    </div>
                </div>
            )}

            {/* Results Display */}
            {analysisResult && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <CheckCircle className="text-green-500 w-6 h-6" /> Analysis Complete
                            </h2>
                            <p className="text-slate-600 dark:text-slate-400 mt-1">Hostname: {analysisResult.device_info?.hostname} | Platform: {analysisResult.device_info?.platform}</p>
                        </div>
                        <button
                            onClick={() => { setFile(null); setAnalysisResult(null); }}
                            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-medium transition-colors"
                        >
                            Analyze Another
                        </button>
                    </div>

                    {(() => {
                        const di = analysisResult.device_info || {};
                        const genIso: string = (isF5OS && f5osOverview?.generation_start) || di.generation_date || '';
                        const platformLabel = isF5OS
                            ? `${rawProduct || 'F5OS'}${f5osOverview?.platform_pid ? ` (${f5osOverview.platform_pid})` : ''}`
                            : `${rawProduct || '—'}${di.platform ? ` (${di.platform})` : ''}`;
                        const versionEdition = isF5OS
                            ? (f5osOverview?.version_edition || `${di.version || '—'}${di.build ? ` - ${di.build}` : ''}`)
                            : `${di.version || '—'}${di.build ? ` - ${di.build}` : ''}`;
                        if (!genIso && !platformLabel && !versionEdition) return null;
                        return (
                            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                                    <div className="flex items-center gap-3">
                                        <Calendar className="w-5 h-5 text-slate-500" />
                                        <div>
                                            <p className="text-xs uppercase tracking-wider text-slate-500">Generation Date</p>
                                            <p className="font-mono text-sm text-slate-800 dark:text-slate-200">{formatGenerationDate(genIso)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Server className="w-5 h-5 text-slate-500" />
                                        <div>
                                            <p className="text-xs uppercase tracking-wider text-slate-500">Platform</p>
                                            <p className="font-mono text-sm text-slate-800 dark:text-slate-200">{platformLabel}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <File className="w-5 h-5 text-slate-500" />
                                        <div>
                                            <p className="text-xs uppercase tracking-wider text-slate-500">Version-Edition</p>
                                            <p className="font-mono text-sm text-slate-800 dark:text-slate-200">{versionEdition}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Device Info / F5OS System Status */}
                        {isF5OS && f5osOverview ? (
                            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <Server className="w-5 h-5 text-blue-500" /> System Status
                                </h3>
                                <dl className="space-y-2 text-sm">
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Cluster Status</dt>
                                        <dd className="text-slate-800 dark:text-slate-200">{f5osOverview.cluster_summary || '—'}</dd>
                                    </div>
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Host name</dt>
                                        <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{analysisResult.device_info?.hostname || '—'}</dd>
                                    </div>
                                    {(f5osOverview.mgmt_ipv4_address || f5osOverview.mgmt_ipv6_address) && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Management IP</dt>
                                            <dd className="font-mono text-xs text-slate-800 dark:text-slate-200 space-y-0.5">
                                                {f5osOverview.mgmt_ipv4_address && (
                                                    <div>IPv4 {f5osOverview.mgmt_ipv4_address}/{f5osOverview.mgmt_ipv4_prefix} <span className="text-slate-400">gw {f5osOverview.mgmt_ipv4_gateway || '—'}</span></div>
                                                )}
                                                {f5osOverview.mgmt_ipv6_address && f5osOverview.mgmt_ipv6_address !== '::' && (
                                                    <div>IPv6 {f5osOverview.mgmt_ipv6_address}/{f5osOverview.mgmt_ipv6_prefix} <span className="text-slate-400">gw {f5osOverview.mgmt_ipv6_gateway || '—'}</span></div>
                                                )}
                                                {f5osOverview.mgmt_ipv6_address === '::' && (
                                                    <div className="text-slate-400">IPv6 ::/0 (unset)</div>
                                                )}
                                            </dd>
                                        </div>
                                    )}
                                    {f5osOverview.payg_license_level && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">PAYG License Level</dt>
                                            <dd className="font-mono text-slate-800 dark:text-slate-200">{f5osOverview.payg_license_level}</dd>
                                        </div>
                                    )}
                                    {f5osOverview.serial_number && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Serial Number</dt>
                                            <dd className="font-mono text-slate-800 dark:text-slate-200">{f5osOverview.serial_number}</dd>
                                        </div>
                                    )}
                                    {f5osOverview.time_zone && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Time Zone</dt>
                                            <dd className="text-slate-800 dark:text-slate-200">{f5osOverview.time_zone}</dd>
                                        </div>
                                    )}
                                </dl>
                            </div>
                        ) : (
                            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <Server className="w-5 h-5 text-blue-500" /> System Status
                                </h3>
                                <dl className="space-y-2 text-sm">
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Host name</dt>
                                        <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{analysisResult.device_info?.hostname || '—'}</dd>
                                    </div>
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Product</dt>
                                        <dd className="text-slate-800 dark:text-slate-200">{analysisResult.device_info?.product || '—'}</dd>
                                    </div>
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Version</dt>
                                        <dd className="font-mono text-slate-800 dark:text-slate-200">
                                            {analysisResult.device_info?.version || '—'}
                                            {analysisResult.device_info?.build ? ` - ${analysisResult.device_info.build}` : ''}
                                        </dd>
                                    </div>
                                    {analysisResult.device_info?.edition && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Edition</dt>
                                            <dd className="text-slate-800 dark:text-slate-200">{analysisResult.device_info.edition}</dd>
                                        </div>
                                    )}
                                    {analysisResult.device_info?.platform && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Platform</dt>
                                            <dd className="font-mono text-slate-800 dark:text-slate-200">{analysisResult.device_info.platform}</dd>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Cores</dt>
                                        <dd className="font-mono text-slate-800 dark:text-slate-200">{analysisResult.device_info?.cores ?? '—'}</dd>
                                    </div>
                                    <div className="grid grid-cols-[11rem_1fr] gap-2">
                                        <dt className="text-slate-500">Memory</dt>
                                        <dd className="font-mono text-slate-800 dark:text-slate-200">
                                            {analysisResult.device_info?.memory_mb ? `${analysisResult.device_info.memory_mb} MB` : '—'}
                                        </dd>
                                    </div>
                                    {analysisResult.device_info?.base_mac && (
                                        <div className="grid grid-cols-[11rem_1fr] gap-2">
                                            <dt className="text-slate-500">Base MAC</dt>
                                            <dd className="font-mono text-slate-800 dark:text-slate-200">{analysisResult.device_info.base_mac}</dd>
                                        </div>
                                    )}
                                </dl>
                            </div>
                        )}

                        {/* Known Issues Card */}
                        <div className="p-6 flex flex-col bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                            <div className="flex items-center justify-between mb-4 gap-2">
                                <h3 className="font-semibold text-lg flex items-center gap-2">
                                    <Bug className="w-5 h-5 text-red-500" /> Known Issues Detected
                                </h3>
                                {analysisId !== null && analysisResult.findings && analysisResult.findings.length > 0 && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <a
                                            href={`/api/qkview/${analysisId}/export?format=csv`}
                                            download={`findings_${analysisId}.csv`}
                                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600"
                                        >
                                            <Download className="w-3.5 h-3.5" /> CSV
                                        </a>
                                        <a
                                            href={`/api/qkview/${analysisId}/export?format=json`}
                                            download={`findings_${analysisId}.json`}
                                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600"
                                        >
                                            <Download className="w-3.5 h-3.5" /> JSON
                                        </a>
                                    </div>
                                )}
                            </div>
                            {analysisResult.findings && analysisResult.findings.length > 0 ? (
                                <div className="space-y-4">
                                    {analysisResult.findings.map((finding: any, idx: number) => (
                                        <div key={idx} className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg text-sm">
                                            <p className="font-bold text-red-800 dark:text-red-300 mb-1">{finding.rule_name} <span className="text-xs font-normal px-2 py-0.5 ml-2 bg-red-200 dark:bg-red-800 rounded">{finding.severity.toUpperCase()}</span></p>
                                            <p className="text-red-700 dark:text-red-400 mb-3">{finding.description}</p>

                                            {finding.sample_entries && finding.sample_entries.length > 0 && (
                                                <div className="mt-2 text-xs font-mono bg-white dark:bg-black/40 border border-red-100 dark:border-red-900/50 rounded p-2 overflow-x-auto">
                                                    <p className="text-slate-500 mb-1 font-sans font-semibold">Matched Log Samples:</p>
                                                    {finding.sample_entries.map((sample: any, sIdx: number) => (
                                                        <div key={sIdx} className="whitespace-pre-wrap text-slate-800 dark:text-slate-300 leading-relaxed mb-1 border-b border-red-100 dark:border-red-900/40 pb-1 last:border-0 last:pb-0">
                                                            <span className="text-slate-400 mr-2">[{sample.timestamp}]</span>
                                                            {sample.raw_line}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-600 dark:text-slate-400">No known issues detected in the logs.</p>
                            )}
                        </div>
                    </div>

                    <LogsSearchTile
                        analysisId={analysisId}
                        staticEntries={analysisResult.entries || []}
                        entryCount={analysisResult.entry_count || 0}
                    />

                    {/* Provisioned Modules + Redundancy (TMOS) */}
                    {!isF5OS && (provisionedModules.length > 0 || hasCm) && (
                        <div className="grid md:grid-cols-2 gap-6">
                            {provisionedModules.length > 0 && (
                                <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                        <Layers className="w-5 h-5 text-violet-500" /> Provisioned Modules ({provisionedModules.length})
                                    </h3>
                                    <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                                        {provisionedModules.map((m) => {
                                            const tone = m.level === 'dedicated'
                                                ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
                                                : m.level === 'none'
                                                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
                                            return (
                                                <li key={m.module} className="py-2 flex items-center justify-between gap-3">
                                                    <span>
                                                        <span className="font-mono text-xs uppercase text-slate-500 mr-2">{m.module}</span>
                                                        <span className="text-slate-800 dark:text-slate-200">{m.name}</span>
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${tone}`}>{m.level}</span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}
                            {hasCm && cmRedundancy && (
                                <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                        <Server className="w-5 h-5 text-blue-500" /> Redundancy (Device Trust)
                                    </h3>
                                    {cmRedundancy.devices.length > 0 && (
                                        <div className="mb-4">
                                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Devices</p>
                                            <ul className="space-y-1 text-sm">
                                                {cmRedundancy.devices.map((d: any) => (
                                                    <li key={d.full_name} className="flex items-center justify-between gap-3">
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 break-all">{d.name}</span>
                                                        <span className="flex items-center gap-2 shrink-0">
                                                            {d.management_ip && <span className="font-mono text-xs text-slate-500">{d.management_ip}</span>}
                                                            {d.self_device && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">this device</span>}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {cmRedundancy.device_groups.length > 0 && (
                                        <div className="mb-4">
                                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Device Groups</p>
                                            <ul className="space-y-1 text-sm">
                                                {cmRedundancy.device_groups.map((g: any) => (
                                                    <li key={g.name} className="flex items-center justify-between gap-3">
                                                        <span className="text-slate-800 dark:text-slate-200">{g.name} <span className="text-xs text-slate-500">({g.devices.length} members)</span></span>
                                                        <span className="font-mono text-xs text-slate-500 shrink-0">{g.type}{g.auto_sync ? ` · auto-sync ${g.auto_sync}` : ''}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {cmRedundancy.traffic_groups.length > 0 && (
                                        <div>
                                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Traffic Groups</p>
                                            <ul className="space-y-1 text-sm">
                                                {cmRedundancy.traffic_groups.map((t: any) => (
                                                    <li key={t.name} className="flex items-center justify-between gap-3">
                                                        <span className="text-slate-800 dark:text-slate-200">{t.name}</span>
                                                        <span className="font-mono text-xs text-slate-500 shrink-0 truncate max-w-[16rem]" title={t.ha_order.join(' → ')}>{t.ha_order.join(' → ') || '—'}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Database Variables (TMOS, from mcp_module.xml) */}
                    {!isF5OS && dbVariables.length > 0 && (
                        <DbVariablesCard vars={dbVariables} />
                    )}

                    {/* F5OS Configuration Totals (portgroup modes, tenant counts / cluster nodes, appliance-mode) */}
                    {isF5OS && f5osOverview && (
                        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                <Settings className="w-5 h-5 text-amber-500" />
                                {isController ? 'Controller Summary' : 'Configuration Totals'}
                            </h3>
                            <div className="grid md:grid-cols-3 gap-6 text-sm">
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Appliance Mode</p>
                                        <p className={`font-mono ${f5osOverview.appliance_mode === 'enabled' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {f5osOverview.appliance_mode || '—'}
                                        </p>
                                    </div>
                                    {isController ? (
                                        <>
                                            {(f5osOverview.platform_pid || f5osOverview.platform_code) && (
                                                <div>
                                                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Chassis</p>
                                                    <ul className="font-mono text-xs space-y-0.5">
                                                        {f5osOverview.platform_pid && (
                                                            <li className="flex justify-between gap-4"><span className="text-slate-500">PID</span><span className="text-slate-800 dark:text-slate-200">{f5osOverview.platform_pid}</span></li>
                                                        )}
                                                        {f5osOverview.platform_code && (
                                                            <li className="flex justify-between gap-4"><span className="text-slate-500">Code</span><span className="text-slate-800 dark:text-slate-200">{f5osOverview.platform_code}</span></li>
                                                        )}
                                                        {f5osOverview.platform_part_number && (
                                                            <li className="flex justify-between gap-4"><span className="text-slate-500">Part #</span><span className="text-slate-800 dark:text-slate-200">{f5osOverview.platform_part_number}</span></li>
                                                        )}
                                                    </ul>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div>
                                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Tenant Counts</p>
                                            <ul className="font-mono text-xs space-y-0.5">
                                                <li className="flex justify-between gap-4"><span className="text-slate-500">Configured</span><span className="text-slate-800 dark:text-slate-200 tabular-nums">{f5osOverview.tenants_configured}</span></li>
                                                <li className="flex justify-between gap-4"><span className="text-slate-500">Provisioned</span><span className="text-slate-800 dark:text-slate-200 tabular-nums">{f5osOverview.tenants_provisioned}</span></li>
                                                <li className="flex justify-between gap-4"><span className="text-slate-500">Deployed</span><span className="text-slate-800 dark:text-slate-200 tabular-nums">{f5osOverview.tenants_deployed}</span></li>
                                                <li className="flex justify-between gap-4"><span className="text-slate-500">Running</span><span className="text-slate-800 dark:text-slate-200 tabular-nums font-semibold">{f5osOverview.tenants_running}</span></li>
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                {f5osOverview.cluster_nodes.length > 0 ? (
                                    <div className="md:col-span-2">
                                        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Cluster Nodes</p>
                                        <table className="w-full text-xs">
                                            <thead className="text-slate-500 uppercase">
                                                <tr>
                                                    <th className="text-left py-1 pr-3">Name</th>
                                                    <th className="text-left py-1 pr-3">Slot</th>
                                                    <th className="text-left py-1 pr-3">State</th>
                                                    <th className="text-left py-1 pr-3">Ready</th>
                                                    <th className="text-left py-1">Message</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                                {f5osOverview.cluster_nodes.map((n) => (
                                                    <tr key={n.name}>
                                                        <td className="py-1 pr-3 font-mono text-slate-800 dark:text-slate-200">{n.name}</td>
                                                        <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">{n.slot || '—'}</td>
                                                        <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">{n.running_state || '—'}</td>
                                                        <td className={`py-1 pr-3 font-mono ${n.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{n.ready ? 'yes' : 'no'}</td>
                                                        <td className="py-1 text-slate-600 dark:text-slate-400">{n.ready_message || '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : f5osOverview.portgroups.length > 0 ? (
                                    <div className="md:col-span-2">
                                        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Portgroup Modes in Use</p>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                                            {f5osOverview.portgroups.map((pg) => (
                                                <div key={pg.id} className="flex items-center justify-between gap-3 py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
                                                    <span className="text-slate-600 dark:text-slate-400">portgroup {pg.id}</span>
                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${portgroupModeColor(pg.mode)}`}>
                                                        {pg.mode || 'unset'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            {f5osOverview.tenants.length > 0 && (
                                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">{isController ? 'Tenant Inventory (chassis-wide)' : 'Tenants'}</p>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-3">Name</th>
                                                <th className="text-left py-1 pr-3">Type</th>
                                                <th className="text-left py-1 pr-3">Running-State</th>
                                                <th className="text-left py-1 pr-3">Status</th>
                                                <th className="text-left py-1 pr-3">Image</th>
                                                <th className="text-left py-1 pr-3">Mgmt IP</th>
                                                <th className="text-right py-1">Mem MB</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {f5osOverview.tenants.map((t) => (
                                                <tr key={t.name}>
                                                    <td className="py-1 pr-3 font-mono text-slate-800 dark:text-slate-200">{t.name}</td>
                                                    <td className="py-1 pr-3 text-slate-700 dark:text-slate-300">{t.type || '—'}</td>
                                                    <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">{t.running_state || '—'}</td>
                                                    <td className={`py-1 pr-3 font-mono ${t.status === 'Running' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>{t.status || '—'}</td>
                                                    <td className="py-1 pr-3 font-mono text-slate-600 dark:text-slate-400">{t.image_version || '—'}</td>
                                                    <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-300">{t.mgmt_ip || '—'}</td>
                                                    <td className="py-1 text-right tabular-nums text-slate-700 dark:text-slate-300">{t.memory_mb || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* F5OS Quick Links + Health (F5OS only) */}
                    {isF5OS && (Object.keys(f5osCommands).length > 0 || f5osHealth.length > 0) && (
                        <div className="grid md:grid-cols-3 gap-6">
                            <div className="md:col-span-1 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <Terminal className="w-5 h-5 text-amber-500" /> Command Links
                                </h3>
                                {Object.keys(f5osCommands).length === 0 ? (
                                    <p className="text-sm text-slate-500">No command outputs captured.</p>
                                ) : (
                                    <ul className="space-y-1 text-sm">
                                        {Object.keys(f5osCommands).sort().map((name) => (
                                            <li key={name}>
                                                <button
                                                    onClick={() => setActiveCmd(name === activeCmd ? null : name)}
                                                    className={`w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 font-mono text-xs ${name === activeCmd ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-300'}`}
                                                >
                                                    {name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="md:col-span-2 p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 max-h-[500px] overflow-hidden flex flex-col">
                                <h3 className="font-semibold text-lg mb-4 text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    <Terminal className="w-5 h-5 text-amber-400" />
                                    {activeCmd ? activeCmd : 'Select a command on the left'}
                                </h3>
                                <pre className="flex-1 bg-black rounded p-4 text-xs text-green-300 font-mono overflow-auto whitespace-pre-wrap">
                                    {activeCmd ? f5osCommands[activeCmd] : '# no command selected'}
                                </pre>
                            </div>
                        </div>
                    )}

                    {/* F5OS Health entries */}
                    {isF5OS && f5osHealth.length > 0 && (
                        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-red-500" /> F5OS Health ({f5osHealth.length})
                            </h3>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                                {f5osHealth.map((h, i) => {
                                    const sev = h.severity || 'info';
                                    const color = sev === 'critical' ? 'text-red-700 dark:text-red-300' : sev === 'error' ? 'text-red-600 dark:text-red-400' : sev === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400';
                                    return (
                                        <li key={i} className="py-2 grid grid-cols-[5rem_minmax(0,18rem)_1fr] gap-3 items-start">
                                            <span className={`uppercase font-semibold text-xs pt-0.5 ${color}`}>{sev}</span>
                                            <span className="font-mono text-xs text-slate-500 break-all leading-relaxed pt-0.5">{h.component}</span>
                                            <span className="text-slate-700 dark:text-slate-300 break-words">{h.description}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {/* F5OS: explain why there is no VS / Pool panel */}
                    {isF5OS && f5osOverview && f5osOverview.tenants.length > 0 && (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-3">
                            <Folder className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
                            <div>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Tenant BIG-IP configurations are not included in this host-level qkview.</span>
                                {' '}F5OS captures the host control-plane only — virtual servers, pools, iRules, and profiles live inside each tenant. To analyze a specific tenant, generate a qkview from within the tenant (via the tenant&apos;s TMOS CLI) and upload it here.
                            </div>
                        </div>
                    )}

                    {/* Apps Browser (TMOS only) */}
                    {!isF5OS && apps.length > 0 && (
                        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                            <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                                <Folder className="w-5 h-5 text-blue-500" /> Configured Virtual Servers ({apps.length})
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                From bigip.conf — user-defined apps only. Runtime stats below may show more (system/internal VS).
                            </p>
                            {partitions.length > 1 && (
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {partitions.map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => setActivePartition(p === activePartition ? null : p)}
                                            className={`px-3 py-1 rounded text-xs font-medium ${p === activePartition ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {(() => {
                                // User's explicit click wins, even if the bucket is empty.
                                // Without a click, prefer the first-partition view but fall
                                // back to the full `apps` list when that bucket is empty —
                                // fixes the "Configured VS (N) but empty rows" bug that hit
                                // when `partitions[]` from the backend doesn't key 1-to-1
                                // into `appsByPartition` (observed on some TMOS archives
                                // whose apps carry a differently-cased or missing
                                // partition field).
                                const displayedApps = activePartition
                                    ? (appsByPartition[activePartition] || [])
                                    : (partitions[0] && appsByPartition[partitions[0]]?.length
                                        ? appsByPartition[partitions[0]]
                                        : apps);
                                return (
                                    <VirtualizedVSTable
                                        apps={displayedApps}
                                        selectedAppPath={selectedAppPath}
                                        onSelect={loadAppDetails}
                                    />
                                );
                            })()}
                            {selectedAppPath && (
                                <AppDetailsPanel
                                    fullPath={selectedAppPath}
                                    loading={appDetailsLoading}
                                    error={appDetailsError}
                                    details={appDetails}
                                    showRaw={showRawStanzas}
                                    onToggleRaw={() => setShowRawStanzas((v) => !v)}
                                    onClose={() => {
                                        setSelectedAppPath(null);
                                        setAppDetails(null);
                                        setAppDetailsError(null);
                                    }}
                                />
                            )}
                        </div>
                    )}

                    {/* XML Stats panels (TMOS only) */}
                    {xmlStats && (
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-emerald-500" /> Runtime Stats
                                </h3>
                                <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                                    {Object.entries(xmlStats.summary).map(([k, v]) => (
                                        <li key={k} className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-1">
                                            <span className="text-slate-500 font-mono text-xs">{k}</span>
                                            <span className="text-slate-800 dark:text-slate-200 font-semibold">{v}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <Network className="w-5 h-5 text-indigo-500" /> Top Virtual Servers
                                </h3>
                                {xmlStats.top_virtual_servers.length === 0 ? (
                                    <p className="text-sm text-slate-500">No VS stats in archive.</p>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">Name</th>
                                                <th className="text-right py-1 pr-2">Cur Conns</th>
                                                <th className="text-right py-1">Tot Conns</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.top_virtual_servers.map((vs, i) => (
                                                <tr key={i}>
                                                    <td className="py-1 pr-2 font-mono">{vs['name'] || vs['vs_name'] || '—'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">{vs['clientside.cur_conns'] || '0'}</td>
                                                    <td className="py-1 text-right tabular-nums">{vs['clientside.tot_conns'] || '0'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {xmlStats.top_pools && xmlStats.top_pools.length > 0 && (
                                <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                        <Network className="w-5 h-5 text-orange-500" /> Top Pools
                                    </h3>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">Name</th>
                                                <th className="text-right py-1 pr-2">Cur</th>
                                                <th className="text-right py-1">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.top_pools.map((p, i) => (
                                                <tr key={i}>
                                                    <td className="py-1 pr-2 font-mono">{p['name'] || '—'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">{p['serverside.cur_conns'] || '0'}</td>
                                                    <td className="py-1 text-right tabular-nums">{p['serverside.tot_conns'] || '0'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {xmlStats.tmms.length > 0 && (
                                <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[400px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                        <Cpu className="w-5 h-5 text-purple-500" /> TMM CPU ({xmlStats.tmms.length})
                                    </h3>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">TMM</th>
                                                <th className="text-right py-1 pr-2">1s</th>
                                                <th className="text-right py-1 pr-2">1m</th>
                                                <th className="text-right py-1 pr-2">5m</th>
                                                <th className="text-right py-1">Conns</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.tmms.map((t, i) => {
                                                // TMOS tmm_stat reports cpu_usage_* in hundredths of a percent
                                                // (`show /sys tmm-info` divides by 100 for display).
                                                const fmtPct = (raw: string | undefined) => {
                                                    if (!raw) return '—';
                                                    const n = parseInt(raw, 10);
                                                    if (!Number.isFinite(n)) return '—';
                                                    return `${(n / 100).toFixed(2)}%`;
                                                };
                                                const oneMinPct = parseInt(t['cpu_usage_1min'] || '0', 10) / 100;
                                                const color = oneMinPct >= 80
                                                    ? 'text-red-600 dark:text-red-400'
                                                    : oneMinPct >= 60
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-slate-700 dark:text-slate-300';
                                                return (
                                                    <tr key={i} className={color}>
                                                        <td className="py-1 pr-2 font-mono">cpu {t['cpu']}/slot {t['slot_id']}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(t['cpu_usage_1sec'])}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums font-semibold">{fmtPct(t['cpu_usage_1min'])}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(t['cpu_usage_5mins'])}</td>
                                                        <td className="py-1 text-right tabular-nums">{t['client_side_traffic.cur_conns'] || '0'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {xmlStats.cpus.length > 0 && (
                                <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[400px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                        <Cpu className="w-5 h-5 text-fuchsia-500" /> System CPU ({xmlStats.cpus.length})
                                    </h3>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">CPU</th>
                                                <th className="text-left py-1 pr-2">Plane</th>
                                                <th className="text-right py-1 pr-2">5s</th>
                                                <th className="text-right py-1 pr-2">1m</th>
                                                <th className="text-right py-1">5m</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.cpus.map((c, i) => {
                                                const oneMin = parseInt(c['one_min_avg.ratio'] || '0', 10);
                                                const color = oneMin >= 80
                                                    ? 'text-red-600 dark:text-red-400'
                                                    : oneMin >= 60
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-slate-700 dark:text-slate-300';
                                                return (
                                                    <tr key={i} className={color}>
                                                        <td className="py-1 pr-2 font-mono">cpu {c['cpu_id']}/slot {c['slot_id']}</td>
                                                        <td className="py-1 pr-2 text-slate-500">{c['plane_name'] || '—'}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums">{c['five_sec_avg.ratio'] || '—'}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums font-semibold">{c['one_min_avg.ratio'] || '—'}</td>
                                                        <td className="py-1 text-right tabular-nums">{c['five_min_avg.ratio'] || '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {xmlStats.interfaces.length > 0 && (
                                <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[400px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                                        <Network className="w-5 h-5 text-cyan-500" /> Interfaces ({xmlStats.interfaces.length})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                        Rows with any non-zero error, drop, or collision are highlighted.
                                    </p>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">Name</th>
                                                <th className="text-right py-1 pr-2">Pkts In</th>
                                                <th className="text-right py-1 pr-2">Pkts Out</th>
                                                <th className="text-right py-1 pr-2">Err In</th>
                                                <th className="text-right py-1 pr-2">Err Out</th>
                                                <th className="text-right py-1 pr-2">Drop In</th>
                                                <th className="text-right py-1 pr-2">Drop Out</th>
                                                <th className="text-right py-1">Coll</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {sortedInterfaces.map((intf, i) => {
                                                const errIn = parseInt(intf['counters.errors_in'] || '0', 10);
                                                const errOut = parseInt(intf['counters.errors_out'] || '0', 10);
                                                const dropIn = parseInt(intf['counters.drops_in'] || '0', 10);
                                                const dropOut = parseInt(intf['counters.drops_out'] || '0', 10);
                                                const coll = parseInt(intf['counters.collisions'] || '0', 10);
                                                const hasTrouble = errIn + errOut + dropIn + dropOut + coll > 0;
                                                const rowColor = hasTrouble
                                                    ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30'
                                                    : 'text-slate-700 dark:text-slate-300';
                                                const troubleCell = (v: number) =>
                                                    v > 0 ? 'font-semibold' : 'text-slate-400 dark:text-slate-600';
                                                return (
                                                    <tr key={i} className={rowColor}>
                                                        <td className="py-1 pr-2 font-mono">{intf['name'] || `idx ${intf['if_index']}`}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums">{intf['counters.pkts_in'] || '0'}</td>
                                                        <td className="py-1 pr-2 text-right tabular-nums">{intf['counters.pkts_out'] || '0'}</td>
                                                        <td className={`py-1 pr-2 text-right tabular-nums ${troubleCell(errIn)}`}>{errIn}</td>
                                                        <td className={`py-1 pr-2 text-right tabular-nums ${troubleCell(errOut)}`}>{errOut}</td>
                                                        <td className={`py-1 pr-2 text-right tabular-nums ${troubleCell(dropIn)}`}>{dropIn}</td>
                                                        <td className={`py-1 pr-2 text-right tabular-nums ${troubleCell(dropOut)}`}>{dropOut}</td>
                                                        <td className={`py-1 text-right tabular-nums ${troubleCell(coll)}`}>{coll}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {xmlStats.top_pool_members && xmlStats.top_pool_members.length > 0 && (
                                <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                                        <Activity className="w-5 h-5 text-teal-500" /> Top Pool Members ({xmlStats.top_pool_members.length})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                        Ordered by serverside total connections. Member up/down state lives in config — this is the traffic-volume view.
                                    </p>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">Member</th>
                                                <th className="text-right py-1 pr-2">Port</th>
                                                <th className="text-right py-1 pr-2">Cur Conns</th>
                                                <th className="text-right py-1 pr-2">Tot Conns</th>
                                                <th className="text-right py-1 pr-2">Requests</th>
                                                <th className="text-right py-1">Bytes In</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.top_pool_members.map((m, i) => (
                                                <tr key={i}>
                                                    <td className="py-1 pr-2 font-mono truncate max-w-[20rem]" title={m['name']}>{m['name'] || '—'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums font-mono">{m['port'] || '—'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">{m['serverside.cur_conns'] || '0'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums font-semibold">{m['serverside.tot_conns'] || '0'}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">{m['tot_requests'] || '0'}</td>
                                                    <td className="py-1 text-right tabular-nums">{m['serverside.bytes_in'] || '0'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {xmlStats.top_expiring_certificates && xmlStats.top_expiring_certificates.length > 0 && (
                                <div className="md:col-span-2 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 max-h-[500px] overflow-y-auto">
                                    <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                                        <ShieldCheck className="w-5 h-5 text-rose-500" /> Certificate Expiry ({xmlStats.top_expiring_certificates.length})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                                        Soonest-to-expire first. Red row: &lt;30 days. Amber: &lt;90 days.
                                    </p>
                                    <table className="w-full text-xs">
                                        <thead className="text-slate-500 uppercase">
                                            <tr>
                                                <th className="text-left py-1 pr-2">Name</th>
                                                <th className="text-left py-1 pr-2">Subject</th>
                                                <th className="text-left py-1 pr-2">Issuer</th>
                                                <th className="text-left py-1 pr-2">Expires</th>
                                                <th className="text-right py-1">Days</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {xmlStats.top_expiring_certificates.map((c, i) => {
                                                const epoch = parseInt(c['expiration_date'] || '0', 10);
                                                const days = epoch > 0
                                                    ? Math.floor((epoch * 1000 - Date.now()) / 86400000)
                                                    : null;
                                                const rowColor = days === null
                                                    ? 'text-slate-700 dark:text-slate-300'
                                                    : days < 30
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : days < 90
                                                            ? 'text-amber-600 dark:text-amber-400'
                                                            : 'text-slate-700 dark:text-slate-300';
                                                const expires = c['expiration_string']
                                                    || (epoch > 0 ? new Date(epoch * 1000).toISOString().slice(0, 10) : '—');
                                                return (
                                                    <tr key={i} className={rowColor}>
                                                        <td className="py-1 pr-2 font-mono truncate max-w-[14rem]" title={c['name']}>{c['name'] || '—'}</td>
                                                        <td className="py-1 pr-2 truncate max-w-[18rem]" title={c['subject']}>{c['subject'] || '—'}</td>
                                                        <td className="py-1 pr-2 truncate max-w-[18rem]" title={c['issuer']}>{c['issuer'] || '—'}</td>
                                                        <td className="py-1 pr-2 font-mono whitespace-nowrap">{expires}</td>
                                                        <td className="py-1 text-right tabular-nums font-semibold">{days ?? '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Raw archive file explorer (config, diagnostic dumps, command outputs) */}
                    {analysisId !== null && (
                        <FileExplorer analysisId={analysisId} />
                    )}

                </div>
            )}
        </div>
    );
}
