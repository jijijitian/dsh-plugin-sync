const MESSAGES = {
  'already-installed': 'The bundle is already in this profile. Updating an existing bundle needs a remove-then-install step.',
  'ambiguous-install': 'The spec matches more than one package. Name the package explicitly.',
  'bundle-in-use': 'The bundle is currently in use; stop it or restart DSH before changing it.',
  'incompatible-version': 'The package requires a different DSH version than this Host runs.',
  'invalid-spec': 'The install spec is not valid.',
  'management-required': 'This bundle is managed by the DSH installation and cannot be changed from a profile.',
  'not-bundle': 'The package does not provide a bundle patch, so it cannot be activated.',
  'not-removable': 'This bundle cannot be removed.',
  'stale-approval': 'The recorded build approval is stale; approve the build again.',
  'stop-profile': 'The profile is stopping, so the change was refused.',
  'unknown-plugin': 'The bundle is not present in this profile.',
}

const HINTS = {
  'already-installed': 'Enable the remove-then-install upgrade path, or update the bundle from the Plugins page.',
  'incompatible-version': 'Update DSH, or keep the local version.',
  'management-required': 'Change it from the DSH installation instead of this profile.',
  'not-bundle': 'Install it as a dependency instead; it has no bundle patch to activate.',
  'not-removable': 'Keep the local copy.',
}

export function describeManagementCode(code) {
  if (typeof code !== 'string' || code === '') return null
  const message = MESSAGES[code]
  if (message === undefined) return null
  const hint = HINTS[code]
  return hint === undefined ? message : `${message} ${hint}`
}

/**
 * Turn a plugin-manager failure into one readable line.
 *
 * The manager reports `{ changed: false, application: 'failed', error: { code } }`
 * with no message for most refusals, so a bare `String(error)` degrades to
 * "[object Object]". Every shape is handled here: a plain string, a ManagementFailure
 * instance, a coded record, or anything else.
 */
export function describeChangeError(error) {
  if (error === null || error === undefined) return null
  if (typeof error === 'string') return error.trim() === '' ? null : error.trim()
  if (typeof error !== 'object') return String(error)

  const code = managementCodeOf(error)
  for (const key of ['diagnostic', 'message', 'reason', 'detail', 'description']) {
    const value = error[key]
    if (typeof value !== 'string' || value.trim() === '' || value === '[object Object]') continue
    // ManagementFailure sets message to the code itself, so a localized
    // description reads far better than the bare identifier.
    if (code !== null && value.trim() === code) continue
    return value.trim()
  }
  const described = describeManagementCode(code)
  if (described !== null) {
    const incompatible = Array.isArray(error.incompatible) ? error.incompatible : []
    if (incompatible.length === 0) return described
    const names = incompatible
      .map((item) => (typeof item === 'string' ? item : item?.name))
      .filter((item) => typeof item === 'string' && item !== '')
    return names.length === 0 ? described : `${described} Incompatible: ${names.join(', ')}.`
  }
  if (code !== null) return `The plugin manager refused the change (${code}).`
  const keys = Object.keys(error)
  if (keys.length > 0) {
    try {
      return JSON.stringify(error).slice(0, 500)
    } catch {
      return `The plugin manager failed with fields: ${keys.join(', ')}`
    }
  }
  return 'The plugin manager failed without a reason.'
}

export function managementCodeOf(error) {
  if (error === null || error === undefined) return null
  if (typeof error === 'string') return error
  if (typeof error !== 'object') return null
  if (typeof error.code === 'string' && error.code !== '') return error.code
  if (typeof error.reason === 'string' && error.reason !== '') return error.reason
  return null
}
