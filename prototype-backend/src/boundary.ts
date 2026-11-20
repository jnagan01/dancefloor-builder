// The HTTP gateway verifies the JWT before calling any shared handler. Keep the
// existing schema validators and require that verified context at this boundary.
export const requireSupabaseAuth = Symbol('verified-http-boundary');
export function createServerFn() {
  let validator: (data: unknown) => unknown = data => data;
  let guarded = false;
  return {
    middleware(items: unknown[]) { if (items.length !== 1 || items[0] !== requireSupabaseAuth) throw Error('Unexpected auth boundary.'); guarded = true; return this; },
    inputValidator(fn: (data: unknown) => unknown) { validator = fn; return this; },
    handler(fn: (r: any) => any) { return async (request: any) => {
      if (!guarded || request.context?.verifiedPrototype !== true || !request.context?.userId || !request.context?.supabase) throw Error('Verified test session required.');
      return fn({ data: validator(request.data), context: request.context });
    }; },
  };
}
