import asyncio, os, sys
from playwright.async_api import async_playwright

JOBS = [
    ("/home/z/my-project/scripts/diagrams/arch.html",      "/home/z/my-project/scripts/diagrams/arch.png",      1100),
    ("/home/z/my-project/scripts/diagrams/timeline.html",  "/home/z/my-project/scripts/diagrams/timeline.png",  1040),
]

async def html_to_image(html_path, output_path, width=1200, scale=2):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--force-color-profile=srgb"])
        page = await browser.new_page(viewport={'width': width, 'height': 900}, device_scale_factor=scale)
        await page.goto(f'file://{html_path}', wait_until='networkidle')
        await page.wait_for_timeout(400)
        el = page.locator('#root')
        bbox = await el.bounding_box()
        if bbox:
            fit_w = max(width, int(bbox['width'] + 60))
            fit_h = int(bbox['height'] + 60)
            await page.set_viewport_size({'width': fit_w, 'height': fit_h})
            await page.wait_for_timeout(200)
        await el.screenshot(path=output_path)
        await browser.close()
        size = os.path.getsize(output_path) / 1024
        print(f'OK {output_path} ({size:.0f}KB, bbox={bbox["width"]:.0f}x{bbox["height"]:.0f})')

async def main():
    for src, out, w in JOBS:
        await html_to_image(src, out, width=w)

if __name__ == '__main__':
    asyncio.run(main())
