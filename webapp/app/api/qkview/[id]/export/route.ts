import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8001';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const format = req.nextUrl.searchParams.get('format') || 'json';
    const url = `${BACKEND_URL}/api/qkview/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`;
    try {
        const backendRes = await fetch(url);
        const body = await backendRes.text();
        return new Response(body, {
            status: backendRes.status,
            headers: {
                'Content-Type': backendRes.headers.get('content-type') || 'application/octet-stream',
                'Content-Disposition':
                    backendRes.headers.get('content-disposition') || `attachment; filename="findings_${id}.${format}"`,
            },
        });
    } catch (err) {
        console.error(`Proxy error in /api/qkview/${id}/export:`, err);
        return NextResponse.json({ error: 'Internal proxy error' }, { status: 500 });
    }
}
