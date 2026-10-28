// Meal Plan Generator — reads a secret from the site's environment variables
//
// Forgives the usual copy-paste slips in the Netlify UI: surrounding spaces or
// newlines, wrapping quotes, and the variable name pasted in with the value
// ("ANTHROPIC_API_KEY=sk-ant-…"). Returns '' when the variable isn't set.

export function readEnv(name) {
  const raw = globalThis.Netlify?.env.get(name) ?? process.env[name];
  if (!raw) return '';
  return raw.trim()
    .replace(new RegExp(`^${name}\\s*=\\s*`), '')
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim();
}
