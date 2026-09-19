import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8001';

// DELETE /api/qkview/{id} → removes the analysis row, its captured files and
// its logs_<id>.db in one backend call (RT#36).
export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const url = `${BACKEND_URL}/api/qkview/${encodeURIComponent(id)}`;
    try {
        const backendRes = await fetch(url, { method: 'DELETE', headers: { accept: 'application/json' } });
        const body = await backendRes.text();
        return new Response(body, {
            status: backendRes.status,
            headers: { 'Content-Type': backendRes.headers.get('content-type') || 'application/json' },
        });
    } catch (err) {
        console.error(`Proxy error in DELETE /api/qkview/${id}:`, err);
        return NextResponse.json({ error: 'Internal proxy error' }, { status: 500 });
    }
}
