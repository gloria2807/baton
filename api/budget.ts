// Vercel function: how much of today's Baton Live budget is left, as numbers only.
import { envFromProcess, handleBudget } from '../apps/live/server/proxy.js';

export function GET(request: Request): Promise<Response> {
  return handleBudget(request, envFromProcess(process.env));
}
