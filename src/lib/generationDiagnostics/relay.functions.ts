import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { BatchSchema } from './schema';

export const sendGenerationDiagnostics = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BatchSchema.parse(input))
  .handler(async ({ data }) => {
    const { relayDiagnostics } = await import('./relay.server');
    return relayDiagnostics(data, { token: process.env['BETTER_STACK_SOURCE_TOKEN'], host: process.env['BETTER_STACK_INGESTING_HOST'] });
  });