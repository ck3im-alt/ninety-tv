import { describe, expect, it } from 'vitest'
import { previousCascadeStep } from './cascadeNavigation'

describe('previousCascadeStep', () => {
  it('steps preview -> channel', () => {
    expect(previousCascadeStep('preview')).toEqual({ level: 'channel' })
  })

  it('steps channel -> category', () => {
    expect(previousCascadeStep('channel')).toEqual({ level: 'category' })
  })

  it('steps category -> country', () => {
    expect(previousCascadeStep('category')).toEqual({ level: 'country' })
  })

  it('exits the screen from country (the top level)', () => {
    expect(previousCascadeStep('country')).toEqual({ exit: true })
  })
})
