#!/usr/bin/env python3
"""
Post to Facebook wall via Selenium.
Usage:
  python3 fb_post_to_wall.py --content "Hello" [--image /path/to/img.jpg] [--cookies /path/to/cookies.txt]
Outputs JSON on stdout: {"success": true} or {"success": false, "error": "..."}
"""
import argparse
import json
import os
import sys
import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FB_URL = 'https://facebook.com'


def find_chromedriver():
    candidates = [
        '/usr/bin/chromedriver',
        '/snap/chromium/current/usr/lib/chromium-browser/chromedriver',
        '/usr/lib/chromium-browser/chromedriver',
        '/snap/bin/chromium.chromedriver',
        'chromedriver',
    ]
    for c in candidates:
        if os.path.isfile(c) or os.path.isfile('/' + c.lstrip('/')):
            return c
    import shutil
    return shutil.which('chromedriver') or shutil.which('chromium.chromedriver')


def load_cookies(driver, cookies_path):
    driver.get('https://facebook.com')
    with open(cookies_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('Http'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7:
                domain = parts[0]
                path = parts[2]
                secure = parts[3].lower() == 'true'
                name = parts[5]
                value = parts[6]
                driver.add_cookie({
                    'name': name,
                    'value': value,
                    'domain': domain,
                    'path': path,
                    'secure': secure,
                })


def js_click(driver, xpath):
    try:
        el = driver.find_element(By.XPATH, xpath)
        driver.execute_script('arguments[0].click();', el)
        return True
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--content', required=True)
    parser.add_argument('--file', default=None,
                        help='Path to image or document to attach')
    parser.add_argument('--cookies', default=None,
                        help='Path to Netscape-format cookies.txt exported from Chrome')
    args = parser.parse_args()

    options = webdriver.ChromeOptions()
    options.add_argument('--headless=new')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_argument('--window-size=480,900')
    options.add_argument('--disable-notifications')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')

    profile_dir = '/tmp/fb_profile'
    try:
        os.makedirs(profile_dir, exist_ok=True)
        options.add_argument(f'--user-data-dir={profile_dir}')
    except Exception:
        pass

    driver = None
    try:
        chromedriver_path = find_chromedriver()
        if not chromedriver_path:
            print(json.dumps({'success': False, 'error': 'chromedriver not found'}), flush=True)
            return
        service = ChromeService(chromedriver_path)
        driver = webdriver.Chrome(service=service, options=options)

        if args.cookies and os.path.isfile(args.cookies):
            load_cookies(driver, args.cookies)

        driver.get(FB_URL)
        time.sleep(5)

        # Dismiss "Continue as [name]" dialog
        try:
            # Debug: dump elements with Continue in textContent
            dump = driver.execute_script("""
                const all = [...document.querySelectorAll('*')]
                    .filter(e => e.textContent.trim().includes('Continue'));
                const exact = all.filter(e => e.textContent.trim() === 'Continue');
                const partial = all.filter(e => e.textContent.trim() !== 'Continue').slice(0,5);
                return {
                    exactCount: exact.length,
                    exact: exact.slice(0,5).map(e => ({
                        tag: e.tagName,
                        role: e.getAttribute('role'),
                        outer: e.outerHTML.substring(0,200)
                    })),
                    partial: partial.map(e => ({
                        tag: e.tagName,
                        role: e.getAttribute('role'),
                        text: e.textContent.trim().substring(0,80),
                        outer: e.outerHTML.substring(0,150)
                    }))
                };
            """)
            json.dump(dump, open('/tmp/fb_cont_debug2.json', 'w'), indent=2)
            # Try to click based on findings
            if dump.get('exactCount', 0) > 0:
                driver.execute_script("""
                    const all = [...document.querySelectorAll('*')]
                        .filter(e => e.textContent.trim() === 'Continue');
                    // Click the FIRST element that is itself a button or has role="button"
                    for (const el of all) {
                        const role = el.getAttribute('role');
                        if (role === 'button' || el.tagName === 'BUTTON' || el.tagName === 'A') {
                            el.click();
                            return;
                        }
                    }
                    // Fallback: walk up from each element
                    for (const el of all) {
                        let parent = el.parentElement;
                        while (parent && parent !== document.body) {
                            const role = parent.getAttribute('role');
                            if (role === 'button' || parent.tagName === 'BUTTON' || parent.tagName === 'A') {
                                parent.click();
                                return;
                            }
                            parent = parent.parentElement;
                        }
                    }
                    // Last resort: click first visible Continue element
                    for (const el of all) {
                        if (el.offsetParent !== null) {
                            el.click();
                            return;
                        }
                    }
                """)
                time.sleep(3)
            else:
                # Fallback: try clicking the first visible button in the login area
                driver.execute_script("""
                    const btns = [...document.querySelectorAll('[role="button"]')]
                        .filter(e => e.offsetParent !== null && e.textContent.trim().length > 0);
                    for (const btn of btns) {
                        btn.click();
                        break;
                    }
                """)
                time.sleep(3)
        except Exception:
            pass

        # Check if logged in (instant find_elements, no slow wait.until)
        logged_in = False
        for selector in [
            "//span[contains(text(),\"What's on your mind\")]",
            "//div[@role='button' and contains(@aria-label,\"What's on your mind\")]",
            "//div[@role='textbox' and contains(@aria-label,\"What's on your mind?\")]",
            "//*[@aria-label='Create a post']",
        ]:
            if driver.find_elements(By.XPATH, selector):
                logged_in = True
                break

        wait = WebDriverWait(driver, 20)

        if not logged_in:
            page_title = driver.title.lower()
            page_url = driver.current_url
            if 'login' in page_title or 'log in' in page_title:
                print(json.dumps({'success': False, 'error': 'Not logged in. Export a fresh cookies.txt from Chrome while on facebook.com.'}), flush=True)
            else:
                screenshot_path = '/tmp/fb_debug.png'
                try:
                    driver.save_screenshot(screenshot_path)
                except Exception:
                    screenshot_path = None
                body_text = driver.find_element(By.TAG_NAME, 'body').text[:500] if driver.find_elements(By.TAG_NAME, 'body') else ''
                diag = f'title="{page_title}" url={page_url}'
                if screenshot_path:
                    diag += f' screenshot={screenshot_path}'
                diag += f' body="{body_text}"'
                print(json.dumps({'success': False, 'error': f'Could not find the post box. {diag}'}), flush=True)
            return

        # Click the post box trigger (JS click to bypass interception)
        clicked = False
        for xpath in [
            "//span[contains(text(),\"What's on your mind\")]",
            "//div[@role='button' and contains(@aria-label,\"What's on your mind\")]",
            "//*[@aria-label='Create a post']",
        ]:
            if js_click(driver, xpath):
                clicked = True
                break
        if not clicked:
            print(json.dumps({'success': False, 'error': 'Failed to click post box'}), flush=True)
            return

        time.sleep(2)

        # Type content
        try:
            textbox = wait.until(EC.element_to_be_clickable(
                (By.XPATH, "//div[@role='textbox' and @aria-label=\"What's on your mind?\"]")
            ))
        except TimeoutException:
            try:
                textbox = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//div[@role='textbox']")
                ))
            except TimeoutException as e:
                print(json.dumps({'success': False, 'error': f'Could not find text input: {e}'}), flush=True)
                return

        textbox.click()
        time.sleep(0.3)
        textbox.send_keys(args.content)

        # Handle file upload (image or document)
        if args.file and os.path.isfile(args.file):
            file_abs = os.path.abspath(args.file)

            # Try clicking photo/video button first
            photo_btn_clicked = False
            for selector in [
                "//div[@aria-label='Photo/video']",
                "//div[contains(@aria-label,'Photo')]",
                "//span[text()='Photo/video']/..",
                "//div[@role='button' and .//span[text()='Add to your post']]",
            ]:
                if js_click(driver, selector):
                    photo_btn_clicked = True
                    time.sleep(1)
                    break

            # Find file input and upload
            try:
                if photo_btn_clicked:
                    time.sleep(0.5)
                file_input = driver.find_element(By.XPATH, "//input[@type='file']")
                file_input.send_keys(file_abs)
                time.sleep(4)
            except Exception as e:
                print(json.dumps({'success': False, 'error': f'File upload failed: {e}'}), flush=True)
                return

        time.sleep(1)

        # Click Post button
        try:
            post_btn = wait.until(EC.element_to_be_clickable((By.XPATH, "//div[@aria-label='Post']")))
            post_btn.click()
        except TimeoutException:
            try:
                post_btn = wait.until(EC.element_to_be_clickable((By.XPATH, "//span[contains(text(),'Post')]/..")))
                post_btn.click()
            except TimeoutException as e:
                print(json.dumps({'success': False, 'error': f'Could not find Post button: {e}'}), flush=True)
                return

        time.sleep(4)
        print(json.dumps({'success': True}), flush=True)

    except Exception as e:
        print(json.dumps({'success': False, 'error': f'{type(e).__name__}: {e}'}), flush=True)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == '__main__':
    main()