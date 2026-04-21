import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8001';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const qs = req.nextUrl.searchParams.toString();
    const url = `${BACKEND_URL}/api/qkview/${encodeURIComponent(id)}/logs${qs ? `?${qs}` : ''}`;
    try {
        const backendRes = await fetch(url, { headers: { accept: 'application/json' } });
        const body = await backendRes.text();
        return new Response(body, {
            status: backendRes.status,
            headers: { 'Content-Type': backendRes.headers.get('content-type') || 'application/json' },
        });
    } catch (err) {
        console.error(`Proxy error in /api/qkview/${id}/logs:`, err);
        return NextResponse.json({ error: 'Internal proxy error' }, { status: 500 });
    }
}
