"""
Web tools — browser automation, search, fetch pages, and global news briefings.
"""

import asyncio
import httpx
import xml.etree.ElementTree as ET
import re
from playwright.async_api import async_playwright
from friday.config import config
import keyring
import os

SEED_FEEDS = [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.cnbc.com/id/100727362/device/rss/rss.html',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    'https://www.aljazeera.com/xml/rss/all.xml'
]

USERNAME_SELECTORS = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email"]',
    'input[name="username"]',
    'input[id*="user"]',
    'input[name="login"]',
    'input[type="text"]'
]

PASSWORD_SELECTORS = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="pass"]'
]

SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name="login"]',
    'button[id*="login"]',
    'button[id*="sign"]'
]

SEARCH_INPUT_SELECTORS = [
    'textarea[name="q"]',
    'input[name="q"]',
    'input[aria-label*="Search"]',
    'input[type="search"]'
]

def normalize_url(input_url: str = "") -> str:
    value = str(input_url).strip()
    if not value:
        raise ValueError("A URL or search query is required.")
    if value.startswith(('http://', 'https://')):
        return value
    if re.match(r'^[\w.-]+\.[a-z]{2,}', value):
        return f'https://{value}'
    return f'https://www.google.com/search?q={value.replace(" ", "+")}'

async def fetch_and_parse_feed(client, url):
    """Helper function to handle a single feed request and parse its XML."""
    try:
        response = await client.get(url, headers={'User-Agent': 'Friday-AI/1.0'}, timeout=5.0)
        if response.status_code != 200:
            return []
        root = ET.fromstring(response.content)
        source_name = url.split('.')[1].upper()
        
        feed_items = []
        items = root.findall(".//item")[:5]
        for item in items:
            title = item.findtext("title")
            description = item.findtext("description")
            link = item.findtext("link")
            
            if description:
                description = re.sub('<[^<]+?>', '', description).strip()

            feed_items.append({
                "source": source_name,
                "title": title,
                "summary": description[:200] + "..." if description else "",
                "link": link
            })
        return feed_items
    except Exception:
        return []

def register(mcp):
    @mcp.tool()
    async def get_world_news() -> str:
        """
        Fetches the latest global headlines from major news outlets simultaneously.
        Use this when the user asks 'What's going on in the world?' or for recent events.
        """
        
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            tasks = [fetch_and_parse_feed(client, url) for url in SEED_FEEDS]
            results_of_lists = await asyncio.gather(*tasks)
            all_articles = [item for sublist in results_of_lists for item in sublist]

        if not all_articles:
            return "The global news grid is unresponsive, sir. I'm unable to pull headlines."

        report = ["### GLOBAL NEWS BRIEFING (LIVE)\n"]
        for entry in all_articles[:12]:
            report.append(f"**[{entry['source']}]** {entry['title']}")
            report.append(f"{entry['summary']}")
            report.append(f"Link: {entry['link']}\n")

        return "\n".join(report)

    @mcp.tool()
    async def search_web(query: str) -> str:
        """Search the web for a given query using Google."""
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.goto(f"https://www.google.com/search?q={query}")
                # Extract search results
                results = await page.query_selector_all('.g')
                search_results = []
                for result in results[:5]:
                    title_elem = await result.query_selector('h3')
                    link_elem = await result.query_selector('a')
                    desc_elem = await result.query_selector('.VwiC3b')
                    
                    title = await title_elem.inner_text() if title_elem else ""
                    link = await link_elem.get_attribute('href') if link_elem else ""
                    desc = await desc_elem.inner_text() if desc_elem else ""
                    
                    search_results.append(f"**{title}**\n{desc}\n{link}\n")
                
                await browser.close()
                return "\n".join(search_results) if search_results else f"No results found for: {query}"
        except Exception as e:
            return f"Search failed: {str(e)}"

    @mcp.tool()
    async def fetch_url(url: str) -> str:
        """Fetch the raw text content of a URL."""
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
                response = await client.get(url)
                response.raise_for_status()
                return response.text[:4000]
        except Exception as e:
            return f"Failed to fetch URL: {str(e)}"

    @mcp.tool()
    async def open_browser(url_or_query: str) -> str:
        """Open a URL or search query in the default browser."""
        try:
            import webbrowser
            url = normalize_url(url_or_query)
            webbrowser.open(url)
            return f"Opened {url} in your default browser."
        except Exception as e:
            return f"Failed to open browser: {str(e)}"

    @mcp.tool()
    async def automate_login(site: str, username: str = None, password: str = None) -> str:
        """Automate login to a website using stored or provided credentials."""
        try:
            if not username:
                username = keyring.get_password("jarvis", f"{site}_username")
            if not password:
                password = keyring.get_password("jarvis", f"{site}_password")
            
            if not username or not password:
                return f"Credentials not found for {site}. Please store them first."
            
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=False)
                page = await browser.new_page()
                await page.goto(site)
                
                # Try to fill login form
                for selector in USERNAME_SELECTORS:
                    try:
                        await page.fill(selector, username)
                        break
                    except:
                        continue
                
                for selector in PASSWORD_SELECTORS:
                    try:
                        await page.fill(selector, password)
                        break
                    except:
                        continue
                
                for selector in SUBMIT_SELECTORS:
                    try:
                        await page.click(selector)
                        break
                    except:
                        continue
                
                await page.wait_for_timeout(2000)
                await browser.close()
                return f"Login attempt completed for {site}."
        except Exception as e:
            return f"Login automation failed: {str(e)}"
