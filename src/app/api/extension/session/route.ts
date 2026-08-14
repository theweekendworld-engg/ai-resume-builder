import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Extension sessions must be created through the connect grant flow',
    },
    { status: 410 }
  );
}
