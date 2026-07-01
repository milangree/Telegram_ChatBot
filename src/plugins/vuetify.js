// src/plugins/vuetify.js
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'

const darkTheme = {
  dark: true,
  colors: {
    background: '#121218',
    surface: '#1e1e2e',
    'surface-bright': '#272937',
    'surface-variant': '#2a2d3e',
    'on-surface': '#e2e2e8',
    primary: '#4f8ef7',
    'primary-darken-1': '#3a6fd4',
    secondary: '#7c8ba5',
    'secondary-darken-1': '#5a6a82',
    error: '#f74f4f',
    info: '#64b5f6',
    success: '#4fbe7c',
    warning: '#f7a44f',
    'on-background': '#e2e2e8',
    'on-surface': '#e2e2e8',
    outline: '#3a3d4e',
  },
}

const lightTheme = {
  dark: false,
  colors: {
    background: '#f5f5f7',
    surface: '#ffffff',
    'surface-bright': '#f8f9fa',
    'surface-variant': '#f0f1f3',
    'on-surface': '#1c1b1f',
    primary: '#2563eb',
    'primary-darken-1': '#1d4ed8',
    secondary: '#5f6368',
    'secondary-darken-1': '#3c4043',
    error: '#dc2626',
    info: '#2196f3',
    success: '#16a34a',
    warning: '#ea580c',
    'on-background': '#1c1b1f',
    'on-surface': '#1c1b1f',
    outline: '#c4c6d0',
  },
}

export default createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'darkTheme',
    themes: { darkTheme, lightTheme },
  },
  defaults: {
    VBtn: { rounded: 'lg', variant: 'flat' },
    VCard: { rounded: 'xl', elevation: 0 },
    VTextField: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VSelect: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VTextarea: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VSwitch: { color: 'primary', inset: true },
    VChip: { rounded: 'lg' },
    VAlert: { rounded: 'lg', variant: 'tonal' },
    VDataTable: { density: 'comfortable' },
    VNavigationDrawer: { elevation: 0 },
    VList: { rounded: 'lg' },
    VDialog: { maxWidth: 560 },
    VSheet: { rounded: 'xl' },
  },
})
