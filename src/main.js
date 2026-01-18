import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

await Actor.init();

const DEFAULT_START_URL = 'https://www.myntra.com/men-tshirts';

// ============================================
// UTILITY FUNCTIONS
// ============================================

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();

const toAbsoluteUrl = (href, baseUrl) => {
    if (!href) return null;
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return null;
    }
};

const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const text = cleanText(String(value));
    if (!text) return null;
    const match = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
};

const parseSizes = (value) => {
    const text = cleanText(value);
    if (!text) return null;
    const sizes = text.split(',').map((part) => part.trim()).filter(Boolean);
    return sizes.length ? sizes : null;
};

const extractIdFromUrl = (url) => {
    if (!url) return null;
    const match = url.match(/\/(\d+)\b/);
    return match ? match[1] : null;
};

const extractImageUrl = ($card) => {
    const img = $card.find('img').first();
    if (!img.length) return null;
    const srcset = img.attr('srcset');
    if (srcset) {
        const first = srcset.split(',')[0]?.trim().split(' ')[0];
        if (first) return first;
    }
    return img.attr('src') || img.attr('data-src') || img.attr('data-original') || null;
};

const parseRatingCountFromText = (text) => {
    if (!text) return null;
    const parts = text.split('|');
    if (parts.length < 2) return null;
    return parseNumber(parts[1]);
};

// ============================================
// PRIORITY 1: window.__myx EXTRACTION (BEST!)
// Found via browser investigation:
// - window.__myx.searchData.results.products (32 organic)
// - window.__myx.searchData.results.plaProducts (18 sponsored)
// ============================================

const extractProductsFromMyx = ($, baseUrl) => {
    const items = [];

    // Find the script containing window.__myx
    $('script').each((_, el) => {
        const scriptText = $(el).text() || '';

        // Look for window.__myx = { ... }
        const myxMatch = scriptText.match(/window\.__myx\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|$)/);
        if (!myxMatch) return;

        try {
            const myxData = JSON.parse(myxMatch[1]);
            const searchData = myxData?.searchData?.results;

            if (!searchData) return;

            // Extract organic products
            const products = searchData.products || [];
            // Extract sponsored products (PLAs)
            const plaProducts = searchData.plaProducts || [];

            const allProducts = [...products, ...plaProducts];

            log.info(`Found ${products.length} organic + ${plaProducts.length} sponsored = ${allProducts.length} total products in __myx`);

            for (const product of allProducts) {
                if (!product) continue;

                items.push({
                    productId: String(product.productId || ''),
                    name: product.productName || product.product || null,
                    brand: product.brand || null,
                    price: parseNumber(product.price),
                    mrp: parseNumber(product.mrp),
                    discountPercent: parseNumber(product.discountDisplayStr || product.discount),
                    rating: parseNumber(product.rating),
                    ratingCount: parseNumber(product.ratingCount || product.totalRatings),
                    sizes: product.sizes || null,
                    imageUrl: product.searchImage || product.defaultImage || product.image || null,
                    productUrl: product.landingPageUrl
                        ? toAbsoluteUrl(product.landingPageUrl, baseUrl)
                        : null,
                    inStock: product.inventoryInfo?.[0]?.inventoryCount > 0 ?? true,
                    isSponsored: !!product.isPla || !!product.isSponsored,
                });
            }
        } catch (e) {
            log.debug(`Failed to parse __myx data: ${e.message}`);
        }
    });

    return items;
};

// ============================================
// PRIORITY 1b: JSON-LD EXTRACTION (Partial - only 10 items)
// ============================================

const extractProductsFromJsonLd = ($, baseUrl) => {
    const items = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = cleanText($(el).contents().text());
        if (!raw) return;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of nodes) {
            if (!node) continue;
            if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
                for (const entry of node.itemListElement) {
                    const item = entry?.item || entry;
                    if (!item) continue;
                    if (item['@type'] && item['@type'] !== 'Product') continue;
                    const availability = item.offers?.availability;
                    const inStock = availability ? !/OutOfStock/i.test(availability) : true;
                    items.push({
                        productId: item.sku || item.productID || null,
                        name: item.name || null,
                        brand: item.brand?.name || item.brand || null,
                        price: parseNumber(item.offers?.price),
                        mrp: null,
                        discountPercent: null,
                        rating: parseNumber(item.aggregateRating?.ratingValue),
                        ratingCount: parseNumber(item.aggregateRating?.reviewCount || item.aggregateRating?.ratingCount),
                        sizes: null,
                        imageUrl: Array.isArray(item.image) ? item.image[0] : item.image || null,
                        productUrl: toAbsoluteUrl(item.url, baseUrl),
                        inStock,
                        isSponsored: false,
                    });
                }
            }
        }
    });
    return items;
};

// ============================================
// PRIORITY 2: HTML DOM EXTRACTION (Fallback)
// ============================================

const extractProductsFromDom = ($, baseUrl) => {
    const items = [];

    // Multiple fallback selectors for robustness
    const cardSelectors = [
        'li.product-base',
        '[data-testid="product-card"]',
        '[class*="ProductCard"]',
        '.product-item',
        '.result-base',
    ];

    let cards = null;
    let usedSelector = '';
    for (const selector of cardSelectors) {
        const found = $(selector);
        if (found.length > 0) {
            cards = found;
            usedSelector = selector;
            break;
        }
    }

    if (!cards || !cards.length) return items;

    log.info(`Found ${cards.length} products using DOM selector: ${usedSelector}`);

    cards.each((_, el) => {
        const card = $(el);
        const href = card.find('a').first().attr('href');
        const productUrl = toAbsoluteUrl(href, baseUrl);

        // Product ID from various attributes
        const productId = card.attr('id') || card.attr('data-id') || card.attr('data-productid') || extractIdFromUrl(productUrl);

        const brand = cleanText(card.find('.product-brand').first().text());
        const name = cleanText(card.find('.product-product').first().text())
            || cleanText(card.find('img').first().attr('title'));
        const priceText = cleanText(card.find('.product-discountedPrice').first().text())
            || cleanText(card.find('.product-price').first().text());
        const mrpText = cleanText(card.find('.product-strike').first().text());
        const discountText = cleanText(card.find('.product-discountPercentage').first().text());
        const ratingText = cleanText(card.find('.product-ratingsContainer').first().text());
        const ratingCountText = cleanText(card.find('.product-ratingsCount').first().text());
        const sizesText = cleanText(card.find('.product-sizeInventoryPresent, .product-sizeInventory').first().text());
        const imageUrl = extractImageUrl(card);

        const outOfStock = card.find('.product-outOfStock, .product-soldOut, .product-notAvailable').length > 0;
        const inStock = !outOfStock;

        items.push({
            productId: productId || null,
            name: name || null,
            brand: brand || null,
            price: parseNumber(priceText),
            mrp: parseNumber(mrpText),
            discountPercent: parseNumber(discountText),
            rating: parseNumber(ratingText),
            ratingCount: parseNumber(ratingCountText) || parseRatingCountFromText(ratingText),
            sizes: parseSizes(sizesText),
            imageUrl: imageUrl || null,
            productUrl: productUrl || null,
            inStock,
            isSponsored: false,
        });
    });

    return items;
};

// ============================================
// PAGINATION
// ============================================

const findNextPage = ($, baseUrl, nextPageNo) => {
    const rel = $('link[rel="next"]').attr('href') || $('a[rel="next"]').attr('href');
    if (rel) return toAbsoluteUrl(rel, baseUrl);
    const nextLink = $('a.pagination-next, a[aria-label="Next"], a')
        .filter((_, el) => /next/i.test(cleanText($(el).text())))
        .first()
        .attr('href');
    if (nextLink) return toAbsoluteUrl(nextLink, baseUrl);
    try {
        const url = new URL(baseUrl);
        url.searchParams.set('p', String(nextPageNo));
        return url.href;
    } catch {
        return null;
    }
};

// ============================================
// INPUT NORMALIZATION
// ============================================

const normalizeStartUrls = (input) => {
    const urls = [];
    const addUrl = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            try {
                urls.push(new URL(value).href);
            } catch {
                log.warning(`Skipping invalid start URL: ${value}`);
            }
            return;
        }
        if (typeof value === 'object' && value.url) {
            try {
                urls.push(new URL(value.url).href);
            } catch {
                log.warning(`Skipping invalid start URL: ${value.url}`);
            }
        }
    };

    if (Array.isArray(input.startUrls)) {
        for (const entry of input.startUrls) addUrl(entry);
    }
    addUrl(input.startUrl);
    addUrl(input.url);

    const unique = [...new Set(urls)];
    return unique.length ? unique : [DEFAULT_START_URL];
};

const toPositiveInt = (value, fallback, label) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        if (value !== undefined) log.warning(`${label} must be a positive number. Using ${fallback}.`);
        return fallback;
    }
    return Math.floor(parsed);
};

const toNonNegativeNumber = (value, fallback, label) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        if (value !== undefined) log.warning(`${label} must be zero or higher. Using ${fallback}.`);
        return fallback;
    }
    return parsed;
};

// ============================================
// STEALTH CONFIGURATION (Search API Skill)
// ============================================

const headerGenerator = new HeaderGenerator({
    browsers: [
        { name: 'chrome', minVersion: 120, maxVersion: 130 },
        { name: 'firefox', minVersion: 115, maxVersion: 125 }
    ],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos'],
    locales: ['en-US', 'en'],
});

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const startUrls = normalizeStartUrls(input);
        const maxItems = toPositiveInt(input.maxItems, 200, 'maxItems');
        const maxPages = toPositiveInt(input.maxPages, 10, 'maxPages');
        const requestDelaySecs = toNonNegativeNumber(input.requestDelaySecs, 1, 'requestDelaySecs');
        const proxyConfiguration = input.proxyConfiguration
            ? await Actor.createProxyConfiguration(input.proxyConfiguration)
            : undefined;

        if (!startUrls.length) {
            log.error('No valid start URLs provided. Provide startUrls or a startUrl.');
            return;
        }

        log.info(`Starting Myntra scraper with ${startUrls.length} URL(s), maxItems=${maxItems}, maxPages=${maxPages}`);

        let saved = 0;
        const seen = new Set();

        const crawler = new CheerioCrawler({
            proxyConfiguration,
            maxRequestRetries: 5,
            useSessionPool: true,
            maxConcurrency: 3, // Lower for stealth
            requestHandlerTimeoutSecs: 60,

            // Session rotation for stealth
            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: {
                    maxUsageCount: 10,
                    maxErrorScore: 3,
                },
            },

            // Stealth headers (Search API Skill)
            preNavigationHooks: [
                async ({ request }) => {
                    const headers = headerGenerator.getHeaders();
                    request.headers = {
                        ...headers,
                        'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'document',
                        'sec-fetch-mode': 'navigate',
                        'sec-fetch-site': 'none',
                        'sec-fetch-user': '?1',
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.9',
                        'cache-control': 'max-age=0',
                    };

                    // Human-like delay before request
                    const humanDelay = 1000 + Math.random() * 2000;
                    await delay(humanDelay);
                },
            ],

            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const pageNo = request.userData?.pageNo || 1;

                // Check for blocking
                const title = $('title').text();
                if (title.includes('Access Denied') || title.includes('Captcha') || title.includes('Robot')) {
                    crawlerLog.error('BLOCKED! Page returned blocking response.');
                    await Actor.setValue('debug-blocked', $.html(), { contentType: 'text/html' });
                    return;
                }

                // Additional user-defined delay
                if (requestDelaySecs > 0) await delay(requestDelaySecs * 1000);

                let products = [];
                let extractionMethod = '';

                // PRIORITY 1: Try window.__myx extraction (BEST - found via browser investigation!)
                products = extractProductsFromMyx($, request.url);
                if (products.length) {
                    extractionMethod = 'window.__myx';
                }

                // PRIORITY 1b: Try JSON-LD (only gets ~10 items)
                if (!products.length) {
                    products = extractProductsFromJsonLd($, request.url);
                    if (products.length) {
                        extractionMethod = 'JSON-LD';
                    }
                }

                // PRIORITY 2: Fall back to HTML DOM parsing
                if (!products.length) {
                    products = extractProductsFromDom($, request.url);
                    if (products.length) {
                        extractionMethod = 'HTML DOM';
                    }
                }

                if (!products.length) {
                    crawlerLog.warning(`No products found on ${request.url}`);
                    // Save debug HTML for inspection
                    await Actor.setValue(`debug-page-${pageNo}`, $.html(), { contentType: 'text/html' });
                } else {
                    crawlerLog.info(`Extracted ${products.length} products via ${extractionMethod}`);

                    const batch = [];
                    for (const product of products) {
                        if (saved >= maxItems) break;
                        const key = product.productId || product.productUrl || `${product.brand || ''}:${product.name || ''}`;
                        if (key && seen.has(key)) continue;
                        if (key) seen.add(key);
                        batch.push({
                            ...product,
                            sourceUrl: request.url,
                            scrapedAt: new Date().toISOString(),
                        });
                        saved += 1;
                    }
                    if (batch.length) await Dataset.pushData(batch);
                    crawlerLog.info(`Saved ${batch.length} products from page ${pageNo} (Total: ${saved}/${maxItems})`);
                }

                if (saved >= maxItems) {
                    crawlerLog.info(`Reached maxItems limit (${maxItems}). Stopping.`);
                    return;
                }

                if (pageNo >= maxPages) {
                    crawlerLog.info(`Reached maxPages limit (${maxPages}). Stopping.`);
                    return;
                }

                const nextUrl = findNextPage($, request.url, pageNo + 1);
                if (nextUrl && nextUrl !== request.url) {
                    await enqueueLinks({
                        urls: [nextUrl],
                        userData: { label: 'LIST', pageNo: pageNo + 1 },
                    });
                }
            },

            failedRequestHandler({ request }, error) {
                log.error(`Request failed: ${request.url} - ${error.message}`);
            },
        });

        await crawler.run(startUrls.map((url) => ({ url, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`✅ Finished! Saved ${saved} products total.`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    log.exception(err, 'Actor failed');
    process.exit(1);
});
