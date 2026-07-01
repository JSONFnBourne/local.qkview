import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8001';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string; path: string[] }> }
) {
    const { id, path } = await context.params;
    const filePath = path.map(encodeURIComponent).join('/');
    const url = `${BACKEND_URL}/api/qkview/${encodeURIComponent(id)}/files/${filePath}`;
    try {
        const backendRes = await fetch(url, { headers: { accept: 'text/plain' } });
        const body = await backendRes.text();
        return new Response(body, {
            status: backendRes.status,
            headers: { 'Content-Type': backendRes.headers.get('content-type') || 'text/plain' },
        });
    } catch (err) {
        console.error(`Proxy error in /api/qkview/${id}/files/${filePath}:`, err);
        return NextResponse.json({ error: 'Internal proxy error' }, { status: 500 });
    }
}
