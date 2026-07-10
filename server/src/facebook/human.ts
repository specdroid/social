import type { Page, Locator } from 'playwright'

export class HumanSimulator {
  async typeText(page: Page, selector: string, text: string): Promise<void> {
    const locator = page.locator(selector)
    try {
      await locator.click({ force: true, timeout: 5000 })
    } catch {
      await page.fill(selector, text).catch(() => {})
      return
    }
    for (const char of text) {
      const delay = Math.floor(Math.random() * 80) + 40
      await page.keyboard.type(char, { delay })
      if (Math.random() > 0.92) {
        await page.waitForTimeout(Math.floor(Math.random() * 400) + 100)
      }
    }
  }

  async moveMouse(page: Page, startX: number, startY: number, endX: number, endY: number): Promise<void> {
    const steps = Math.floor(Math.random() * 8) + 5
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const bezier = t * t * (3 - 2 * t)
      const x = startX + (endX - startX) * bezier + (Math.random() - 0.5) * 10
      const y = startY + (endY - startY) * bezier + (Math.random() - 0.5) * 10
      await page.mouse.move(x, y)
      await page.waitForTimeout(Math.floor(Math.random() * 40) + 10)
    }
  }

  async clickElement(page: Page, locator: Locator): Promise<void> {
    try {
      const box = await locator.boundingBox()
      if (box) {
        const startX = Math.random() * 500
        const startY = Math.random() * 300
        await this.moveMouse(page, startX, startY, box.x + box.width / 2, box.y + box.height / 2)
      }
    } catch {}
    await locator.click().catch(() => {})
  }
}
