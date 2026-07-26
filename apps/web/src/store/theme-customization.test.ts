import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAppTerminalTheme } from '~/features/tui/app-theme'

import {
  cloneThemeProfile,
  DEFAULT_ACTIVE_PROFILE_IDS,
  DEFAULT_THEME_PROFILES,
  parseThemeImport,
  resolveThemePreview,
  useThemeCustomizationStore,
} from './theme-customization'
import { applyThemeProfile } from './theme-customization-runtime'

const IMPORTED_THEME = JSON.stringify({
  name: 'Paper',
  variant: 'light',
  accentColor: '#2563eb',
  backgroundColor: '#fffdf8',
  foregroundColor: '#292524',
  uiFont: 'Inter, sans-serif',
  codeFont: 'Berkeley Mono, monospace',
  translucentSidebar: true,
  contrast: 64,
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.themeProfile
  delete document.documentElement.dataset.themeCodeFont
  delete document.documentElement.dataset.themeTranslucentSidebar
})

describe('theme customization', () => {
  it('imports a complete theme without changing its values', () => {
    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')

    expect(profile).toEqual({
      id: 'paper-light',
      name: 'Paper',
      variant: 'light',
      overrides: {
        accentColor: '#2563eb',
        backgroundColor: '#fffdf8',
        foregroundColor: '#292524',
        uiFont: 'Inter, sans-serif',
        codeFont: 'Berkeley Mono, monospace',
        translucentSidebar: true,
        contrast: 64,
      },
    })
  })

  it('rejects invalid theme colors', () => {
    expect(() => parseThemeImport(IMPORTED_THEME.replace('#2563eb', 'blue'), 'invalid')).toThrow()
  })

  it('duplicates overrides without sharing their object identity', () => {
    const source = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const copy = cloneThemeProfile(source, 'paper-copy')

    expect(copy.name).toBe('Paper Copy')
    expect(copy.overrides).toEqual(source.overrides)
    expect(copy.overrides).not.toBe(source.overrides)
  })

  it('keeps the built-in palette untouched when no overrides are configured', () => {
    const profile = DEFAULT_THEME_PROFILES[0]!
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    expect(resolveThemePreview(profile).backgroundColor).toBe('#fafafa')

    removeProfile()
  })

  it('applies and removes only explicit overrides', () => {
    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#fffdf8')
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('#292524')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#2563eb')
    expect(document.documentElement.dataset.themeCodeFont).toBe('true')

    removeProfile()

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    expect(document.documentElement.dataset.themeCodeFont).toBeUndefined()
  })

  it('preserves the terminal palette until a theme color is explicitly overridden', () => {
    expect(getAppTerminalTheme()).toMatchObject({
      background: '#ffffff',
      foreground: '#333333',
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
    })

    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(getAppTerminalTheme()).toMatchObject({
      background: '#fffdf8',
      foreground: '#292524',
      // Selection stays on the fixed terminal palette, not theme accent.
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
    })

    removeProfile()
  })
})

describe('theme customization store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    useThemeCustomizationStore.setState({
      profiles: DEFAULT_THEME_PROFILES.map(profile => ({
        ...profile,
        overrides: { ...profile.overrides },
      })),
      activeProfileIds: { ...DEFAULT_ACTIVE_PROFILE_IDS },
    })
  })

  it('resetOverrides clears every override back to the Cradle defaults', () => {
    const store = useThemeCustomizationStore
    store.setState({
      profiles: [
        {
          id: 'cradle-light',
          name: 'Cradle Light',
          variant: 'light',
          overrides: {
            accentColor: '#ff0000',
            backgroundColor: '#eeeeee',
            foregroundColor: '#111111',
            uiFont: 'Inter, sans-serif',
            codeFont: 'Mono, monospace',
            translucentSidebar: true,
            contrast: 80,
          },
        },
      ],
      activeProfileIds: { light: 'cradle-light', dark: 'cradle-dark' },
    })

    store.getState().resetOverrides('cradle-light')

    const profile = store.getState().profiles.find(p => p.id === 'cradle-light')!
    expect(profile.overrides).toEqual({
      accentColor: null,
      backgroundColor: null,
      foregroundColor: null,
      uiFont: null,
      codeFont: null,
      translucentSidebar: null,
      contrast: null,
    })

    const preview = resolveThemePreview(profile)
    expect(preview.accentColor).toBe('#262626')
    expect(preview.backgroundColor).toBe('#fafafa')
    expect(preview.contrast).toBe(50)
    expect(preview.translucentSidebar).toBe(false)

    const removeProfile = applyThemeProfile(profile, 'light')
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    removeProfile()
  })

  it('resetOverrides only touches the targeted profile', () => {
    const store = useThemeCustomizationStore
    store.setState({
      profiles: [
        {
          id: 'cradle-light',
          name: 'Cradle Light',
          variant: 'light',
          overrides: { ...DEFAULT_THEME_PROFILES[0]!.overrides },
        },
        {
          id: 'cradle-dark',
          name: 'Cradle Dark',
          variant: 'dark',
          overrides: {
            accentColor: '#00ff00',
            backgroundColor: null,
            foregroundColor: null,
            uiFont: null,
            codeFont: null,
            translucentSidebar: null,
            contrast: null,
          },
        },
      ],
      activeProfileIds: { light: 'cradle-light', dark: 'cradle-dark' },
    })

    store.getState().resetOverrides('cradle-dark')

    const light = store.getState().profiles.find(p => p.id === 'cradle-light')!
    const dark = store.getState().profiles.find(p => p.id === 'cradle-dark')!
    expect(light.overrides.accentColor).toBeNull()
    expect(dark.overrides.accentColor).toBeNull()
  })
})
