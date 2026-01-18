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
// DATA EXTRACTION METHODS
// ============================================

const extractProductsFromMyx = ($, baseUrl) => {
    const items = [];

    $('script').each((_, el) => {
        const scriptText = $(el).text() || '';
        const myxMatch = scriptText.match(/window\.__myx\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|$)/);
        if (!myxMatch) return;

        try {
            const myxData = JSON.parse(myxMatch[1]);
            const searchData = myxData?.searchData?.results;
            if (!searchData) return;

            const products = searchData.products || [];
            const plaProducts = searchData.plaProducts || [];
            const allProducts = [...products, ...plaProducts];

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
        } catch {
            // Silent fail
        }
    });

    return items;
};

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

const extractProductsFromDom = ($, baseUrl) => {
    const items = [];
    const cardSelectors = ['li.product-base', '[data-testid="product-card"]', '.product-item'];

    let cards = null;
    for (const selector of cardSelectors) {
        const found = $(selector);
        if (found.length > 0) {
            cards = found;
            break;
        }
    }

    if (!cards || !cards.length) return items;

    cards.each((_, el) => {
        const card = $(el);
        const href = card.find('a').first().attr('href');
        const productUrl = toAbsoluteUrl(href, baseUrl);
        const productId = card.attr('id') || card.attr('data-id') || extractIdFromUrl(productUrl);

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
        const outOfStock = card.find('.product-outOfStock, .product-soldOut').length > 0;

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
            inStock: !outOfStock,
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
    try {
        const url = new URL(baseUrl);
        url.searchParams.set('p', String(nextPageNo));
        return url.href;
    } catch {
        return null;
    }
};

// ============================================
// INPUT HANDLING
// ============================================

const normalizeStartUrls = (input) => {
    const urls = [];
    const addUrl = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            try { urls.push(new URL(value).href); } catch { }
            return;
        }
        if (typeof value === 'object' && value.url) {
            try { urls.push(new URL(value.url).href); } catch { }
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

const toPositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

// ============================================
// STEALTH CONFIGURATION
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
// MAIN
// ============================================

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const startUrls = normalizeStartUrls(input);

        // Support both results_wanted (Apify QA) and maxItems (legacy)
        const resultsWanted = toPositiveInt(input.results_wanted || input.maxItems, 20);

        const proxyConfiguration = input.proxyConfiguration
            ? await Actor.createProxyConfiguration(input.proxyConfiguration)
            : undefined;

        if (!startUrls.length) {
            log.error('No valid start URLs provided.');
            return;
        }

        log.info(`Starting scraper: ${resultsWanted} products requested`);

        let saved = 0;
        const seen = new Set();

        const crawler = new CheerioCrawler({
            proxyConfiguration,
            maxRequestRetries: 5,
            useSessionPool: true,
            maxConcurrency: 3,
            requestHandlerTimeoutSecs: 60,

            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: {
                    maxUsageCount: 10,
                    maxErrorScore: 3,
                },
            },

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
                        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.9',
                    };
                    await delay(1000 + Math.random() * 2000);
                },
            ],

            async requestHandler({ request, $, enqueueLinks }) {
                const pageNo = request.userData?.pageNo || 1;

                // Check for blocking
                const title = $('title').text();
                if (title.includes('Access Denied') || title.includes('Captcha')) {
                    log.warning(`Page ${pageNo}: Access blocked, retrying...`);
                    throw new Error('Blocked');
                }

                // Extract products (try multiple methods silently)
                let products = extractProductsFromMyx($, request.url);
                if (!products.length) products = extractProductsFromJsonLd($, request.url);
                if (!products.length) products = extractProductsFromDom($, request.url);

                if (!products.length) {
                    log.warning(`Page ${pageNo}: No products found`);
                    return;
                }

                // Deduplicate and save
                const batch = [];
                for (const product of products) {
                    if (saved >= resultsWanted) break;
                    const key = product.productId || product.productUrl || `${product.brand}:${product.name}`;
                    if (key && seen.has(key)) continue;
                    if (key) seen.add(key);
                    batch.push({
                        ...product,
                        sourceUrl: request.url,
                        scrapedAt: new Date().toISOString(),
                    });
                    saved += 1;
                }

                if (batch.length) {
                    await Dataset.pushData(batch);
                    log.info(`Page ${pageNo}: Saved ${batch.length} products (${saved}/${resultsWanted})`);
                }

                // Stop if limit reached
                if (saved >= resultsWanted) return;

                // Paginate
                const nextUrl = findNextPage($, request.url, pageNo + 1);
                if (nextUrl && nextUrl !== request.url) {
                    await enqueueLinks({
                        urls: [nextUrl],
                        userData: { pageNo: pageNo + 1 },
                    });
                }
            },

            failedRequestHandler({ request }, error) {
                log.warning(`Request failed: ${request.url}`);
            },
        });

        await crawler.run(startUrls.map((url) => ({ url, userData: { pageNo: 1 } })));
        log.info(`Finished: ${saved} products collected`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    log.exception(err, 'Actor failed');
    process.exit(1);
});
