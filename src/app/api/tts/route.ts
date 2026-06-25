// src/app/api/tts/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get('text');

    if (!text || text.trim() === '') {
      return new NextResponse('Parameter "text" wajib diisi', { status: 400 });
    }

    // Google Translate TTS URL for Indonesian language (tl=id)
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=id&client=tw-ob&q=${encodeURIComponent(text)}`;

    const response = await fetch(googleTtsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (!response.ok) {
      console.error(`Gagal mengambil audio dari Google TTS. Status: ${response.status}`);
      return new NextResponse('Gagal mengambil audio dari server Google TTS', { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    });
  } catch (error: any) {
    console.error('Terjadi kesalahan pada endpoint TTS:', error);
    return new NextResponse('Kesalahan Internal Server', { status: 500 });
  }
}
