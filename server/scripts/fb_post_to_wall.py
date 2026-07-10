#!/usr/bin/env python3
"""
Post to Facebook wall via Selenium.
Usage:
  xvfb-run python3 fb_post_to_wall.py --content "Hello" [--image /path/to/img.jpg] [--cookies /path/to/cookies.txt]
Outputs JSON on stdout: {"success": true} or {"success": false, "error": "..."}
"""
import argparse
import json
import os
import sys
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FB_URL = 'https://facebook.com/me'


def load_cookies(driver, cookies_path):
    """Load Netscape-format cookies.txt into the browser."""
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--content', required=True)
    parser.add_argument('--image', default=None)
    parser.add_argument('--cookies', default=None,
                        help='Path to Netscape-format cookies.txt exported from Chrome')
    args = parser.parse_args()

    options = webdriver.ChromeOptions()
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_argument('--window-size=480,900')
    options.add_argument('--disable-notifications')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')

    # If a profile directory exists, use it
    profile_dir = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'fb_profile'))
    if os.path.isdir(profile_dir):
        options.add_argument(f'--user-data-dir={profile_dir}')

    driver = None
    try:
        driver = webdriver.Chrome(options=options)

        # Load cookies if provided
        if args.cookies and os.path.isfile(args.cookies):
            load_cookies(driver, args.cookies)

        # Navigate to own timeline
        driver.get(FB_URL)
        wait = WebDriverWait(driver, 20)

        # Check if logged in
        logged_in = False
        for selector in [
            "//span[contains(text(),\"What's on your mind\")]",
            "//div[@role='button' and contains(@aria-label,\"What's on your mind\")]",
            "//div[@role='textbox' and contains(@aria-label,\"What's on your mind?\")]",
        ]:
            try:
                wait.until(EC.presence_of_element_located((By.XPATH, selector)))
                logged_in = True
                break
            except TimeoutException:
                continue

        if not logged_in:
            page_title = driver.title.lower()
            if 'login' in page_title or 'log in' in page_title:
                print(json.dumps({'success': False, 'error': 'Not logged in. Export a fresh cookies.txt from Chrome while on facebook.com.'}))
            else:
                print(json.dumps({'success': False, 'error': 'Could not find the post box. Facebook page structure may have changed.'}))
            return

        # Click the post box trigger
        try:
            post_trigger = driver.find_element(By.XPATH, "//span[contains(text(),\"What's on your mind\")]")
            post_trigger.click()
        except Exception:
            try:
                post_trigger = driver.find_element(By.XPATH, "//div[@role='button' and contains(@aria-label,\"What's on your mind\")]")
                post_trigger.click()
            except Exception as e:
                print(json.dumps({'success': False, 'error': f'Failed to click post box: {e}'}))
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
                print(json.dumps({'success': False, 'error': f'Could not find text input: {e}'}))
                return

        textbox.click()
        time.sleep(0.3)
        textbox.send_keys(args.content)

        # Handle image upload
        if args.image and os.path.isfile(args.image):
            try:
                file_input = driver.find_element(By.XPATH, "//input[@type='file' and contains(@accept, 'image')]")
                file_input.send_keys(os.path.abspath(args.image))
                time.sleep(3)
            except Exception as e:
                print(json.dumps({'success': False, 'error': f'Image upload failed: {e}'}))
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
                print(json.dumps({'success': False, 'error': f'Could not find Post button: {e}'}))
                return

        time.sleep(4)
        print(json.dumps({'success': True}))

    except WebDriverException as e:
        print(json.dumps({'success': False, 'error': f'Browser error: {e}'}))
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == '__main__':
    main()
