import { describe, expect, it } from 'vitest'
import { validateProductionBuildEnvironment } from '../../../scripts/productionConfig.js'

describe('TV production build configuration', () => {
  it('accepts an HTTPS API origin', () => {
    expect(() => validateProductionBuildEnvironment({ VITE_NINETY_API_URL: 'https://api.ninety.tv' })).not.toThrow()
  })

  it('rejects a missing, local, or path-bearing API URL', () => {
    expect(() => validateProductionBuildEnvironment({})).toThrow(/required/)
    expect(() => validateProductionBuildEnvironment({ VITE_NINETY_API_URL: 'http://localhost:3000' })).toThrow(/HTTPS/)
    expect(() => validateProductionBuildEnvironment({ VITE_NINETY_API_URL: 'https://api.ninety.tv/v1' })).toThrow(/origin/)
  })
})
