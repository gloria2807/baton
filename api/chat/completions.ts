// Vercel function: Baton Live's model proxy (apps/live/server/proxy.ts). The key stays here.
import { envFromProcess, handleProxy } from '../../apps/live/server/proxy.js';

export function POST(request: Request): Promise<Response> {
  return handleProxy(request, envFromProcess(process.env));
}
