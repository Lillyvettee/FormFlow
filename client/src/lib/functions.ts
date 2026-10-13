import { supabase } from '@/lib/supabase'

/**
 * Calls a Supabase Edge Function (supabase/functions/<name>) and returns its
 * JSON. Functions report problems as { error: "message" } with a non-2xx
 * status; supabase-js hides that body behind a generic message, so it is
 * read back out here and thrown as a readable Error.
 */
export async function callFunction<T>(name: string, body: object, fallback = 'Something went wrong. Please try again.'): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    const message = await error.context?.json?.().then((b: { error?: string }) => b?.error).catch(() => null)
    throw new Error(message || fallback)
  }
  return data as T
}
