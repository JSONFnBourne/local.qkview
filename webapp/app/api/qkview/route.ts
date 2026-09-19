import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8001';

// GET /api/qkview → the persisted analyses, newest first (RT#36). Server-side
// proxy like every other route here: the browser never talks to FastAPI.
export async function GET() {
    const url = `${BACKEND_URL}/api/qkview`;
    try {
        const backendRes = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
        const body = await backendRes.text();
        return new Response(body, {
            status: backendRes.status,
            headers: { 'Content-Type': backendRes.headers.get('content-type') || 'application/json' },
        });
    } catch (err) {
        console.error('Proxy error in GET /api/qkview:', err);
        return NextResponse.json({ error: 'Internal proxy error' }, { status: 500 });
    }
}
