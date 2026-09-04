import { t, type Locale } from '../shared/i18n'

export type DefaultAppExtension = 'md' | 'markdown'

export interface DefaultAppResult {
  extension: DefaultAppExtension
  ok: boolean
}

export const DEFAULT_APP_SCRIPT = `
  ObjC.import('CoreServices');
  var bundleID = 'app.draftmd.desktop';
  var exts = ['md', 'markdown'];
  var results = [];
  for (var i = 0; i < exts.length; i++) {
    var ext = exts[i];
    try {
      var uti = $.UTTypeCreatePreferredIdentifierForTag(
        $.kUTTagClassFilenameExtension,
        $(ext),
        null
      );
      if (!uti) throw new Error('Could not resolve file type');
      var status = String($.LSSetDefaultRoleHandlerForContentType(uti, $.kLSRolesAll, $(bundleID)));
      results.push({ extension: ext, ok: status === '0' });
    } catch (e) {
      results.push({ extension: ext, ok: false });
    }
  }
  JSON.stringify(results);
`

function isDefaultAppResult(value: unknown): value is DefaultAppResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return (result.extension === 'md' || result.extension === 'markdown') && typeof result.ok === 'boolean'
}

export function parseDefaultAppResults(stdout: string): DefaultAppResult[] {
  const parsed: unknown = JSON.parse(stdout.trim())
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isDefaultAppResult)) {
    throw new Error('Invalid default-app result')
  }
  return parsed
}

export function formatDefaultAppResultDetails(locale: Locale, results: readonly DefaultAppResult[]): string {
  return results.map(({ extension, ok }) => t(locale, 'defaultApp.result', {
    extension,
    status: t(locale, ok ? 'defaultApp.statusSuccess' : 'defaultApp.statusFailure'),
  })).join('\n')
}

interface DefaultAppExecDiagnostics {
  error: string
  stderr: string
}

type ErrorLogger = (message: string, diagnostics: DefaultAppExecDiagnostics) => void

export function logDefaultAppExecFailure(
  error: Error,
  stderr: string,
  logger: ErrorLogger = console.error,
): void {
  logger('Default app association failed:', { error: error.message, stderr })
}
