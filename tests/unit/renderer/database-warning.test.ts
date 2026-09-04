import { expect, it } from 'vitest'
import { setLocale } from '../../../src/shared/i18n'
import { createDatabaseWarningController } from '../../../src/renderer/app/database-warning'

class FakeElement extends EventTarget {
  textContent = ''
  hidden = true
}

it('renders only localized recovery copy for safe database warning codes and can dismiss it', () => {
  setLocale('en')
  const banner = new FakeElement()
  const text = new FakeElement()
  const dismiss = new FakeElement()
  const controller = createDatabaseWarningController({
    banner: banner as unknown as HTMLElement,
    text: text as unknown as HTMLElement,
    dismiss: dismiss as unknown as HTMLButtonElement,
  })

  controller.show('DATABASE_RECOVERED')
  expect(banner.hidden).toBe(false)
  expect(text.textContent).toContain('database damage')
  expect(text.textContent).not.toMatch(/sqlite|\/Users\//i)
  dismiss.dispatchEvent(new Event('click'))
  expect(banner.hidden).toBe(true)
})

it('uses distinct localized copy for in-memory fallback', () => {
  setLocale('zh-CN')
  const banner = new FakeElement()
  const text = new FakeElement()
  const dismiss = new FakeElement()
  const controller = createDatabaseWarningController({
    banner: banner as unknown as HTMLElement,
    text: text as unknown as HTMLElement,
    dismiss: dismiss as unknown as HTMLButtonElement,
  })
  controller.show('DATABASE_MEMORY_FALLBACK')
  expect(text.textContent).toContain('Markdown')
  expect(text.textContent).toContain('暂时不可用')
})
