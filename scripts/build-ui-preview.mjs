import { writeFile } from 'node:fs/promises';
import { demo } from '../server/demo.mjs';
export function uiPreview(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/phase-4-supabase-multi-user';
}
const enabled = uiPreview(process.env);
await writeFile('public/ui-preview.js', enabled
  ? `import { installPreview } from '/ui/ui-preview.js';\ninstallPreview(${JSON.stringify(demo)});\nawait import('/ui/main.js');\n`
  : `import '/ui/main.js';\n`);
