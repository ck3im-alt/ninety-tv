// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ActivationScreen } from './ActivationScreen'

const pairing = vi.hoisted(() => ({
  current: {
    status: 'loading' as 'loading' | 'waiting' | 'error',
    activationUrl: null as string | null,
    retry: vi.fn(),
  },
}))

vi.mock('@noriginmedia/norigin-spatial-navigation', () => ({
  setFocus: vi.fn(),
  useFocusable: () => ({ ref: { current: null }, focused: false }),
}))

vi.mock('../../core/platform/deviceIdentity', () => ({
  getDisplayMacAddress: () => '00:11:22:33:44:55',
}))

vi.mock('./usePairingSession', () => ({
  ackPairing: vi.fn(),
  usePairingSession: () => pairing.current,
}))

afterEach(() => {
  cleanup()
  pairing.current = { status: 'loading', activationUrl: null, retry: vi.fn() }
})

describe('ActivationScreen', () => {
  it('uses the full loading screen until the QR session is ready', () => {
    render(<ActivationScreen onImported={vi.fn()} />)

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('Preparing your setup')).toBeDefined()
    expect(screen.queryByText('Set up NINETY')).toBeNull()
    expect(screen.queryByRole('img', { name: /QR code/i })).toBeNull()
  })

  it('renders the finished first-run experience only when the QR code is available', () => {
    pairing.current = {
      status: 'waiting',
      activationUrl: 'https://api.example/activate?t=secure-token',
      retry: vi.fn(),
    }

    render(<ActivationScreen onImported={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Set up NINETY' })).toBeDefined()
    expect(screen.getByText('Scan this QR code to add your playlist and activate your 7-day free trial.')).toBeDefined()
    expect(screen.getByRole('img', { name: 'QR code to set up Ninety on this TV' })).toBeDefined()
    expect(screen.getByText('7 DAYS FREE')).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
