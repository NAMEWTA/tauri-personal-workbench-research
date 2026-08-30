import { requireData } from './client'

describe('requireData', () => {
  it('returns a response payload', () => {
    expect(requireData({ ok: true })).toEqual({ ok: true })
  })
  it('rejects an empty response', () => {
    expect(() => requireData(undefined)).toThrow('服务返回了空响应')
  })
})
