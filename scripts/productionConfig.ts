export function validateProductionBuildEnvironment(env: Record<string, string | undefined>): void {
  const value = env.VITE_NINETY_API_URL?.trim()
  if (!value) throw new Error('VITE_NINETY_API_URL is required for production builds')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('VITE_NINETY_API_URL must be an absolute URL')
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== value.replace(/\/+$/, '')) {
    throw new Error('VITE_NINETY_API_URL must be an HTTPS origin without a path, query, or fragment')
  }
}
