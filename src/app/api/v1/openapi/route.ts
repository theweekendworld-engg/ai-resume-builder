import { NextResponse } from 'next/server';

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'AI Resume Builder API',
    version: '1.0.0',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/generate': {
      post: { summary: 'Start or continue a generation session' },
    },
    '/generate/{sessionId}/status': {
      get: { summary: 'Get generation session status' },
    },
    '/generate/{sessionId}/result': {
      get: { summary: 'Get completed generation result' },
    },
    '/profile': {
      post: { summary: 'Create or update user profile' },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(spec);
}
